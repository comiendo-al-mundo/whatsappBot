"use strict";

// External packages
const { Queue } = require("bullmq");
const IORedis = require("ioredis");

// Redis connection
const redisOptions = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    maxRetriesPerRequest: null,
};
const connection = new IORedis(redisOptions);

const followUpQueue = new Queue("follow-up", { connection });

// Setup the reminder
async function scheduleFollowUps(phone) {
    for (const hours of [24, 48, 72]) {
        await followUpQueue.add(
            "send-reminder",
            { phone, attempt: hours, templateId },
            {
                delay: hours * 3600 * 1000,
                jobId: `followup-${phone}-${hours}-${templateId}`,
                removeOnComplete: true,
                removeOnFail: true
            }
        );
    }
}

// Cancel the reminder
async function cancelFollowUps(phone) {
    for (const hours of [24, 48, 72]) {
        for (const tid of [0, 1, 2]) {
            const id = `followup-${phone}-${hours}-${tid}`;
            const job = await followUpQueue.getJob(id);
            if (job) await job.remove();
        }
    }
}

module.exports = { scheduleFollowUps, cancelFollowUps };