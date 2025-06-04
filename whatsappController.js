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
const SPREADSHEET_ID = "1ntkhFRdzw6-xDQWIVOhd-Z0_Afl10qsj69ZHyY6fpYI";

// Phone number range
const PHONE_COLUMN_RANGE = "Hoja 1!P2:P";

// Path to the Service Account JSON
const SERVICE_ACCOUNT_FILE = process.env.SERVICE_ACCOUNT_FILE || path.resolve(__dirname, "cloudStorageKeys.json");

// In-memory cache of allowed phone‐numbers (just digits, no “@c.us”)
let allowedNumbers = new Set();

async function loadAllowedNumbersFromSheet() {
    try {
        if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            throw new Error(
                `No se encontró el fichero de credenciales en ${SERVICE_ACCOUNT_FILE}`
            );
        }

        // Load service account credentials
        const auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_FILE,
            scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });

        // Obtain an authenticated client
        const authClient = await auth.getClient();

        // Use the client to call the Sheets API
        const response = await sheets.spreadsheets.values.get({
            auth: authClient,
            spreadsheetId: SPREADSHEET_ID,
            range: PHONE_COLUMN_RANGE,
        });

        // response.data.values is an array of rows, e.g. [[ "34600123456" ], [ "34900111222" ], …]
        const rows = response.data.values || [];

        // Clear existing cache
        allowedNumbers.clear();

        // Normalize and add each phone to the Set
        for (let row of rows) {
            const rawPhone = row[0];
            if (typeof rawPhone === "string" && rawPhone.trim() !== "") {
                const digits = normalizeNumber(rawPhone);
                if (digits) {
                    allowedNumbers.add(digits);
                }
            }
        }

        console.log(`Loaded ${allowedNumbers.size} allowed phone(s) from Sheets.`);
    } catch (err) {
        console.error("Error loading allowed phone numbers from Google Sheets:", err);
    }
}

// Periodically refresh the list every hour
function startPeriodicRefresh(intervalMs = 1000 * 60 * 60) {
    // On startup, load once
    loadAllowedNumbersFromSheet();

    // Then schedule recurring refresh
    setInterval(() => {
        loadAllowedNumbersFromSheet();
    }, intervalMs);
}

// Initializes the WhatsApp client
async function initializeWhatsApp() {
    // const authPath = path.resolve("./session-data/LocalAuth/main-session");
    // fs.mkdirSync(authPath, { recursive: true });

    // const client = new Client({
    //     authStrategy: new LocalAuth({
    //         clientId: "main-session",
    //         dataPath: "./session-data"
    //     }),
    //     puppeteer: {
    //         executablePath: "/usr/bin/chromium",
    //         headless: true,
    //         args: [
    //             "--no-sandbox",
    //             "--disable-setuid-sandbox",
    //             "--disable-dev-shm-usage",
    //             "--disable-gpu",
    //             "--single-process"
    //         ]
    //     }
    // });

    // Si existe, borramos el directorio de perfil para empezar "limpio"
    const chromeProfilePath = "/tmp/whatsapp-bot-chrome-profile";
    try {
        if (fs.existsSync(chromeProfilePath)) {
            // Elimina toda la carpeta y su contenido
            fs.rmSync(chromeProfilePath, { recursive: true, force: true });
        }
    } catch (e) {
        console.warn("No pude borrar el perfil de Chrome (no crítico):", e.message);
    }

    // Crear carpeta vacía para el perfil
    fs.mkdirSync(chromeProfilePath, { recursive: true });
    fs.chmodSync(chromeProfilePath, 0o700);

    // Ruta al binario de Google Chrome Stable
    const chromePath = "/usr/bin/google-chrome-stable";

    // Verificamos que exista el binario
    if (!fs.existsSync(chromePath)) {
        throw new Error(`No encontré el ejecutable de Chrome en ${chromePath}`);
    }

    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: "main-session",
            dataPath: "./session-data"
        }),
        puppeteer: {
            executablePath: chromePath,
            headless: true,
            // dumpio: true volcará stdout/stderr de Chrome a tu consola para depuración
            dumpio: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
                "--disable-infobars",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                `--user-data-dir=${chromeProfilePath}`,
                "--enable-logging",
                "--v=1"
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
    });

    await client.initialize();

    return new Promise((resolve, reject) => {
        // Listener for incoming messages
        client.on("message", async msg => {
            try {
                // Now normalize to just digits
                const normalizedFrom = normalizeNumber((msg.from || "").replace(/@c\.us$/, ""));

                // If not in allowedNumbers, bail out
                if (!allowedNumbers.has(normalizedFrom)) {
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

        // Listener for "ready" event to resolve the promise
        client.on("ready", async () => {
            resolve(client);
        });

        // Start the initialization process
        client.initialize();
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
        await initializeWhatsApp();
    }

    if (!whatsappClient || !whatsappClient.info) {
        throw new Error("WhatsApp client is not ready");
    }

    // Normalize the number and add country prefix if needed
    const onlyDigits = normalizeNumber(number);
    const withCountry = onlyDigits.length >= 11 ? onlyDigits : `34${onlyDigits}`;

    const chatId = `${withCountry}@c.us`;
    return whatsappClient.sendMessage(chatId, message);
}

// Express handler that receives req/res
const sendMessage = async function (req, res) {
    const { phone, message } = req.body;

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
};

module.exports = {
    startPeriodicRefresh,
    initializeWhatsApp,
    sendMessage
};