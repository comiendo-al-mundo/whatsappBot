"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const http = require("http");

(async () => {
    try {
        const { initializeWhatsApp, startPeriodicRefresh } = require("./whatsappController");

        // Load the phone list once, and refresh hourly
        startPeriodicRefresh();

        // Initialize the WhatsApp client 
        initializeWhatsApp()
            .then(() => console.log("WhatsApp initialized."))
            .catch(err => console.error("Error initializing WhatsApp:", err));

        const app = express();
        const port = 8080;
        app.use(cors());
        app.use(express.json());
        app.use(helmet());

        const server = http.createServer(app);
        server.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });

        const whatsappRoute = require("./whatsappRoute");
        app.use("/api", [whatsappRoute]);
    } catch (error) {
        console.error("Error initializing the app", error);
        process.exit(1);
    }
})();