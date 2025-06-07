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
async function scheduleFollowUps(phone, name, templateId) {
    for (const hours of [24]) {
        await followUpQueue.add(
            "send-reminder",
            { phone, name, attempt: hours, templateId },
            {
                delay: hours * 3600 * 1000,
                jobId: `followup-${phone}-${hours}`,
                removeOnComplete: true,
                removeOnFail: true
            }
        );
    }
}

// Cancel the reminder
async function cancelFollowUps(phone) {
    for (const hours of [24]) {
        const id = `followup-${phone}-${hours}`;
        const job = await followUpQueue.getJob(id);
        if (job) await job.remove();
    }
}

module.exports = { scheduleFollowUps, cancelFollowUps };