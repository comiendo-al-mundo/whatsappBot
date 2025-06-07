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

const worker = new Worker(
    "follow-up",
    async job => {
        const { phone, attempt, templateId } = job.data;

        // Pick the message for that inteval and id
        const list = templates[attempt] || [];
        const text = list[templateId] || list[0] || "No hemos recibido respuesta. Qué te ha parecido nuestra Sub-web?";

        await sendViaWhatsApp(phone, text);
        console.log(`Remainder at ${attempt} h send to ${phone}`);
    },
    { connection }
);

worker.on("failed", (job, err) => {
    console.error(`Job ${job.id} has failed:`, err);
});