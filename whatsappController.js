"use strict";

// External packages
require("dotenv").config();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Google Sheets API
const { google } = require("googleapis");
const sheets = google.sheets("v4");

// Methods from another file
const { scheduleFollowUps, cancelFollowUps } = require("./followUpQueue");

// Whatsapp client
let whatsappClient = null;

// Sheet
const SHEETS_CONFIG = [
    {
        name: "Potential Clients",
        spreadsheetId: "1ntkhFRdzw6-xDQWIVOhd-Z0_Afl10qsj69ZHyY6fpYI",
        phoneRange: "Hoja 1!N2:N",
        activeRange: "Hoja 1!S2:S",
        allowedNumbers: new Set()
    },
    {
        name: "Extended Potential clients",
        spreadsheetId: "1xYh2ib46cH0tvfCa86UT-7Ww59agqHydlR7r9iEiEhw",
        phoneRange: "Hoja 1!P2:P",
        activeRange: "Hoja 1!V2:V",
        allowedNumbers: new Set()
    },
];

// Path to the Service Account JSON
const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_FILE || path.resolve(__dirname, "cloudStorageKeys.json");

// Path to the session data
const SESSION_DIR = path.resolve(__dirname, "session-data");
const AUTH_DIR = path.resolve(SESSION_DIR, "LocalAuth", "main-session");

// Load all allowed numbers from sheets
async function loadAllowedNumbersFromAllSheets() {
    for (let config of SHEETS_CONFIG) {
        try {
            await loadAllowedNumbersFromSheet(config);
        } catch (err) {
            console.error(`Error loading sheet '${config.name}':`, err);
        }
    }
}

// Load allowed numbers from one sheet
async function loadAllowedNumbersFromSheet(config) {
    try {
        // Verify that config exists and has a valid spreadsheetId
        if (!config || typeof config.spreadsheetId !== "string" || config.spreadsheetId.trim() === "") {
            throw new Error(`Invalid configuration object: ${JSON.stringify(config)}`);
        }

        if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            throw new Error(`Invalid configuration object: ${JSON.stringify(config)}`);
        }

        // Load service account credentials
        const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_FILE,
            scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });

        // Obtain an authenticated client
        const authClient = await auth.getClient();

        // Clear existing cache
        config.allowedNumbers.clear();

        // Use the client to call the Sheets API
        const phoneResponse = await sheets.spreadsheets.values.get({
            auth: authClient,
            spreadsheetId: config.spreadsheetId,
            range: config.phoneRange,
        });
        const phoneRows = phoneResponse.data.values || [];

        const activeResponse = await sheets.spreadsheets.values.get({
            auth: authClient,
            spreadsheetId: config.spreadsheetId,
            range: config.activeRange,
        });
        const activeRows = activeResponse.data.values || [];

        // Normalize and add each phone to the Set
        for (let i = 0; i < phoneRows.length; i++) {
            const rawPhone = phoneRows[i]?.[0] || "";
            const rawActive = activeRows[i]?.[0] || "";
            if (typeof rawPhone === "string" && rawPhone.trim() !== "" && rawActive.trim() === "") {
                const digits = normalizeNumber(rawPhone);
                if (digits) {
                    config.allowedNumbers.add(digits);
                }
            }
        }
        console.log(`Loaded ${config.allowedNumbers.size} allowed phone(s) from ${config.name}. (ID: ${config.spreadsheetId})`);
    } catch (err) {
        console.error("Error loading allowed phone numbers from Google Sheets:", err);
    }
}

// Helper function to load the list and setup the reminders
async function loadSpreadSheetFromMessage(spreadsheetId, phone, name, templateId) {
    // If ID is a non-empty string, do nothing
    if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
        cancelFollowUps(phone)
            .then(() => console.log(`Cancelados follow-ups para ${phone}`))
            .catch(err => console.error("Error cancelando follow-ups:", err));
        return false;
    }

    // Validate templateId
    if (![0, 1, 2].includes(templateId)) {
        return false;
    }

    // We schedule the reminders
    scheduleFollowUps(phone, name, templateId);

    // Find the configuration object
    const config = SHEETS_CONFIG.find(c => c.spreadsheetId === spreadsheetId.trim());
    if (!config) {
        throw new Error(`No configuration found for spreadsheetId '${spreadsheetId}'.`);
    }

    // Reload only that sheet
    await loadAllowedNumbersFromSheet(config);
    return true;
}

// Initializes the WhatsApp client
async function initializeWhatsApp() {
    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
            fs.mkdirSync(SESSION_DIR, { recursive: true });

            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: "main-session",
                    dataPath: SESSION_DIR
                }),
                puppeteer: {
                    executablePath: "/usr/bin/chromium",
                    headless: true,
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--single-process"
                    ]
                }
            });

            // Display QR in console if scanning is required
            client.on("qr", qr => {
                qrcode.generate(qr, { small: true });
                console.log("Scan the QR code in the console to authenticate…");
            });

            client.on("auth_failure", msg => {
                console.error("Authentication failure:", msg);
            });

            client.on("disconnected", reason => {
                console.warn("Client disconnected:", reason);
            });

            client.on("ready", () => {
                console.log("WhatsApp client is ready and connected");
                whatsappClient = client;
                resolve();
            });

            // Listener for incoming messages
            client.on("message", async msg => {
                try {
                    // Now normalize to just digits
                    const normalizedFrom = normalizeNumber((msg.from || "").replace(/@c\.us$/, ""));

                    // We see if the input phone number is any of the allowed list
                    const isAllowed = SHEETS_CONFIG.some(config =>
                        config.allowedNumbers.has(normalizedFrom)
                    );

                    // If not in allowedNumbers, bail out
                    if (!isAllowed) {
                        console.log(`Ignoring message from ${normalizedFrom}, not in allowedNumbers.`);
                        return;
                    }

                    // Extract basic info
                    const from = msg.from;
                    const body = msg.body;
                    const tsSeconds = msg.timestamp;
                    const timestamp = new Date(tsSeconds * 1000).toISOString();

                    // Get history from the last 48 hours (up to 200 messages)
                    const chat = await whatsappClient.getChatById(from);

                    // Fetch the last 200 messages (the API doesn't filter by date directly)
                    const fetched = await chat.fetchMessages({ limit: 200 });
                    const fortyEightHoursAgo = Date.now() - 48 * 3600 * 1000;

                    // Filter messages whose timestamp is within the last 48 hours
                    const recentHistory = fetched
                        .filter(m => (m.timestamp * 1000) >= fortyEightHoursAgo)
                        .map(m => ({
                            from: m.from,
                            body: m.body,
                            timestamp: new Date(m.timestamp * 1000).toISOString()
                        }));

                    // Build the payload
                    const payload = {
                        from,
                        body,
                        timestamp,
                        history: recentHistory
                    };

                    // Send the POST to your backend endpoint
                    axios
                        .post(
                            "https://api.comiendoalmundo.com/api/whatsapp/receivedMessage",
                            payload,
                            { headers: { "Content-Type": "application/json" } }
                        ).then(() => console.log(`Incoming message from ${from} forwarded to backend.`))
                        .catch(err => console.error("Error forwarding incoming message:", err.message));
                } catch (err) {
                    console.error("Error handling incoming message:", err);
                }
            });

            client.initialize().catch(err => {
                console.error("Error starting client.initialize():", err);
                reject(err);
            });
        } catch (err) {
            console.error("Exception in initializeWhatsApp:", err);
            reject(err);
        }
    });
}

// Normalizes a phone number by removing all non-digit characters.
function normalizeNumber(str) {
    return String(str).replace(/\D/g, "");
}

// Internal function that sends a message via WhatsApp.
async function sendViaWhatsApp(number, message) {
    // Ensure the client is initialized
    if (!whatsappClient || !whatsappClient.info) {
        throw new Error("WhatsApp client is not ready");
    }

    // Normalize the number and add country prefix if needed
    const onlyDigits = normalizeNumber(number);
    const withCountry = onlyDigits.length >= 11 ? onlyDigits : `34${onlyDigits}`;
    const chatId = `${withCountry}@c.us`;
    return whatsappClient.sendMessage(chatId, message);
}

// Express handler when a message has to be sent
async function sendMessage(req, res) {
    const { phone, name, message, spreadsheetId, templateId } = req.body;

    try {
        await loadSpreadSheetFromMessage(spreadsheetId, phone, name, templateId);
    } catch (err) {
        console.error("Error reloading specific sheet:", err);
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    // Validate that the parameters are provided and non-empty
    if (
        typeof phone !== "string" || phone.trim() === "" ||
        typeof message !== "string" || message.trim() === ""
    ) {
        return res.status(400).json({
            success: false,
            message: "Missing parameters: 'phone' or 'message' are invalid."
        });
    }

    // Call the internal function that sends via WhatsApp
    sendViaWhatsApp(phone, message)
        .then(() => console.log("Message sent successfully via WhatsApp."))
        .catch(err => console.error("Internal error sending WhatsApp message."))

    return res.status(200).json({
        success: true,
        message: "Message sent successfully via WhatsApp."
    });
}

// Function to reload a phone number
async function reloadPhone(req, res) {
    const { spreadsheetId, phone } = req.body;
    if (!spreadsheetId || typeof phone !== "string") {
        return res.status(400).json({ success: false, message: "SpreadsheetId and phone are compulsory" });
    }

    // We cancel all followup from this phone
    await cancelFollowUps(phone);

    // We upload the active values
    const config = SHEETS_CONFIG.find(c => c.spreadsheetId === spreadsheetId.trim());
    if (!config) {
        return res.status(404).json({ success: false, message: "SpreadsheetId no configurado" });
    }
    await loadAllowedNumbersFromSheet(config);

    return res.json({ success: true });
}

module.exports = {
    loadAllowedNumbersFromAllSheets,
    initializeWhatsApp,
    sendViaWhatsApp,
    sendMessage,
    reloadPhone
};