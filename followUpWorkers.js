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
        const { phone, attempt } = job.data;
        if (phone !== TEST_PHONE) return;

        // Mensajes de prueba para 1, 2 y 3 minutos
        const texts = {
            1: "🕐 Recordatorio de prueba a 1 minuto",
            2: "🕑 Recordatorio de prueba a 2 minutos",
            3: "🕒 Recordatorio de prueba a 3 minutos",
        };
        const text = texts[attempt] || texts[1];

        await sendViaWhatsApp(phone, text);
        console.log(`✅ Test reminder (${attempt} min) sent to ${phone}`);
    },
    { connection }
);

worker.on("failed", (job, err) => {
    console.error(`Job ${job.id} has failed:`, err);
});