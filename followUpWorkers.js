"use strict";

const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { sendViaWhatsApp } = require("./whatsappController");

const connection = new IORedis({ host: "127.0.0.1", port: 6379 });

const worker = new Worker(
    "follow-up",
    async job => {
        const { phone, attempt } = job.data;

        // Personalized text based on the time
        const texts = {
            24: "¡Hola! ¿Tienes alguna duda? Te escribo para recordarte…",
            48: "Seguimos a tu disposición si necesitas más información.",
            72: "Último recordatorio: aquí estamos para ayudarte."
        };
        const text = texts[attempt] || texts[24];

        await sendViaWhatsApp(phone, text);
        console.log(`Remainder at ${attempt} h send to ${phone}`);
    },
    { connection }
);

worker.on("failed", (job, err) => {
    console.error(`❌ Falló job ${job.id}:`, err);
});