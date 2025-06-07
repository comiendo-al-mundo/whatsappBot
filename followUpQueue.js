"use strict";

const { Queue } = require("bullmq");
const IORedis = require("ioredis");

const connection = new IORedis({ host: "127.0.0.1", port: 6379 });

const followUpQueue = new Queue("follow-up", { connection });

/**
 * Cada job será { phone, attempt } donde attempt = 24|48|72
 * JobId lo fijamos como `followup-${phone}-${attempt}`
 */
async function scheduleFollowUps(phone) {
    for (const hours of [24, 48, 72]) {
        await followUpQueue.add(
            "send-reminder",
            { phone, attempt: hours },
            {
                delay: hours * 3600 * 1000,
                jobId: `followup-${phone}-${hours}`,
                removeOnComplete: true,
                removeOnFail: true
            }
        );
    }
}

/**
 * Si el usuario ya contestó, lo marcamos
 * (puede ser en DB, Notion, Sheets, lo que uses).
 */
async function cancelFollowUps(phone) {
    for (const hours of [24, 48, 72]) {
        const id = `followup-${phone}-${hours}`;
        const job = await followUpQueue.getJob(id);
        if (job) await job.remove();
    }
}

module.exports = { scheduleFollowUps, cancelFollowUps };