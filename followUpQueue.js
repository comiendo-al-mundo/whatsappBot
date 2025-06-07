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
/*
// Setup the reminder
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

// Cancel the reminder
async function cancelFollowUps(phone) {
    for (const hours of [24, 48, 72]) {
        const id = `followup-${phone}-${hours}`;
        const job = await followUpQueue.getJob(id);
        if (job) await job.remove();
    }
}*/

const TEST_PHONE = "34640616793";

async function scheduleFollowUps(phone) {
    if (phone !== TEST_PHONE) return;
    for (const mins of [1, 2, 3]) {
        await followUpQueue.add(
            "send-reminder",
            { phone, attempt: mins },
            {
                delay: mins * 60 * 1000,
                jobId: `test-${phone}-${mins}`,
                removeOnComplete: true,
                removeOnFail: true,
            }
        );
    }
}

async function cancelFollowUps(phone) {
    if (phone !== TEST_PHONE) return;
    for (const mins of [1, 2, 3]) {
        const id = `test-${phone}-${mins}`;
        const job = await followUpQueue.getJob(id);
        if (job) await job.remove();
    }
}

module.exports = { scheduleFollowUps, cancelFollowUps };