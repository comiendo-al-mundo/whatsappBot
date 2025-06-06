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

// Whatsapp client
let whatsappClient = null;

// Sheet
const SHEETS_CONFIG = [
    {
        name: "Potential Clients",
        spreadsheetId: "1ntkhFRdzw6-xDQWIVOhd-Z0_Afl10qsj69ZHyY6fpYI",
        range: "Hoja 1!N2:N",
        allowedNumbers: new Set()
    },
    {
        name: "Extended Potential clients",
        spreadsheetId: "1xYh2ib46cH0tvfCa86UT-7Ww59agqHydlR7r9iEiEhw",
        range: "Hoja 1!P2:P",
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
        const response = await sheets.spreadsheets.values.get({
            auth: authClient,
            spreadsheetId: config.spreadsheetId,
            range: config.range,
        });

        // response.data.values is an array of rows, e.g. [[ "34600123456" ], [ "34900111222" ], …]
        const rows = response.data.values || [];

        // Normalize and add each phone to the Set
        for (let row of rows) {
            const rawPhone = row[0];
            if (typeof rawPhone === "string" && rawPhone.trim() !== "") {
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

// Auxiliar function to load the list
async function loadSpreadSheetFromMessage(spreadsheetId) {
    // If ID is not a non-empty string, do nothing
    if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
        return false;
    }

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
                    console.log(normalizedFrom)
                    console.log(SHEETS_CONFIG)
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
                    await axios.post(
                        "https://api.comiendoalmundo.com/api/whatsapp/receivedMessage",
                        payload,
                        {
                            headers: { "Content-Type": "application/json" },
                            timeout: 8000
                        }
                    );

                    console.log(`Incoming message from ${from} forwarded to backend.`);
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
    const { phone, message, spreadsheetId } = req.body;

    try {
        console.log(spreadsheetId)
        await loadSpreadSheetFromMessage(spreadsheetId);
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

    try {
        // Call the internal function that sends via WhatsApp
        await sendViaWhatsApp(phone, message);
        return res.status(200).json({
            success: true,
            message: "Message sent successfully via WhatsApp."
        });
    } catch (err) {
        console.error("Error in sendMessage:", err);
        return res.status(500).json({
            success: false,
            message: "Internal error sending WhatsApp message."
        });
    }
}

module.exports = {
    loadAllowedNumbersFromAllSheets,
    initializeWhatsApp,
    sendMessage
};