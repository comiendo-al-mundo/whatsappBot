"use strict";

// External packages
const { Worker } = require("bullmq");
const IORedis = require("ioredis");

// Redis connection
const redisOptions = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    maxRetriesPerRequest: null,
};
const connection = new IORedis(redisOptions);

// Controllers
const { sendViaWhatsApp } = require("./whatsappController");

// Templates to use
const templates = require("./reminderTemplates");

/*
const worker = new Worker(
    "follow-up",
    async job => {
        const { phone, attempt } = job.data;

        // Customized text based on the time
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
);*/

const TEST_PHONE = "34640616793";

const worker = new Worker(
    "follow-up",
    async job => {
        const { phone, attempt, templateId } = job.data;
        if (phone !== TEST_PHONE) return;

        // Pick the message for that inteval and id
        const list = templates[attempt] || [];
        const text = list[templateId] || list[0] || "No hemos recibido respuesta. Qué te ha parecido nuestra Sub-web?";

        await sendViaWhatsApp(phone, text);
        console.log(`Test reminder (${attempt} min, template ${templateId}) sent to ${phone}`);
    },
    { connection }
);

worker.on("failed", (job, err) => {
    console.error(`Job ${job.id} has failed:`, err);
});