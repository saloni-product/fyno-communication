const schedule = require("node-schedule");
const axios = require("axios");

// In-memory store of scheduled jobs: { jobId -> { job, targetTime, notifyAt, eventName, distinctId } }
const scheduledJobs = {};

// In-memory event log (capped at 200 entries, newest first)
const eventLogs = [];
const MAX_LOGS = 200;

function addLog(entry) {
  eventLogs.unshift(entry);
  if (eventLogs.length > MAX_LOGS) eventLogs.length = MAX_LOGS;
}

/**
 * Parse an ISO 8601 timestamp (e.g. "2026-03-21T10:00:00+00:00") and
 * schedule a Fyno API call exactly 1 hour before that time.
 *
 * @param {string} timestamp   ISO 8601 datetime string
 * @param {object} fynoConfig  { apiKey, workspaceId, eventName, recipient, data }
 * @returns {{ jobId, targetTime, notifyAt, status }}
 */
function scheduleHourBeforeNotification(timestamp, fynoConfig) {
  const targetTime = new Date(timestamp);

  if (isNaN(targetTime.getTime())) {
    throw new Error(`Invalid timestamp: "${timestamp}"`);
  }

  const notifyAt = new Date(targetTime.getTime() - 60 * 60 * 1000); // subtract 1 hour
  const now = new Date();

  if (notifyAt <= now) {
    throw new Error(
      `Notification time (${notifyAt.toISOString()}) is in the past. ` +
        `Timestamp must be more than 1 hour from now.`
    );
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const job = schedule.scheduleJob(jobId, notifyAt, async () => {
    const triggeredAt = new Date().toISOString();
    console.log(`[${triggeredAt}] Job ${jobId} triggered — sending Fyno notification`);
    try {
      await sendFynoNotification(fynoConfig);
      console.log(`[${new Date().toISOString()}] Job ${jobId} — Fyno call succeeded`);
      addLog({
        jobId,
        eventName: fynoConfig.eventName,
        distinctId: fynoConfig.recipient?.distinct_id,
        targetTime: targetTime.toISOString(),
        triggeredAt,
        status: "success",
        error: null,
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Job ${jobId} — Fyno call failed:`, err.message);
      addLog({
        jobId,
        eventName: fynoConfig.eventName,
        distinctId: fynoConfig.recipient?.distinct_id,
        targetTime: targetTime.toISOString(),
        triggeredAt,
        status: "failed",
        error: err.message,
      });
    } finally {
      delete scheduledJobs[jobId];
    }
  });

  scheduledJobs[jobId] = {
    job,
    targetTime,
    notifyAt,
    eventName: fynoConfig.eventName,
    distinctId: fynoConfig.recipient?.distinct_id,
  };

  console.log(
    `[${new Date().toISOString()}] Scheduled job ${jobId}: ` +
      `target=${targetTime.toISOString()}, notify at=${notifyAt.toISOString()}`
  );

  return {
    jobId,
    targetTime: targetTime.toISOString(),
    notifyAt: notifyAt.toISOString(),
    status: "scheduled",
  };
}

/**
 * Cancel a previously scheduled job by ID.
 */
function cancelJob(jobId) {
  const entry = scheduledJobs[jobId];
  if (!entry) return false;
  entry.job.cancel();
  addLog({
    jobId,
    eventName: entry.eventName,
    distinctId: entry.distinctId,
    targetTime: entry.targetTime.toISOString(),
    triggeredAt: new Date().toISOString(),
    status: "cancelled",
    error: null,
  });
  delete scheduledJobs[jobId];
  return true;
}

/**
 * List all active scheduled jobs.
 */
function listJobs() {
  return Object.entries(scheduledJobs).map(([jobId, { targetTime, notifyAt, eventName, distinctId }]) => ({
    jobId,
    eventName,
    distinctId,
    targetTime: targetTime.toISOString(),
    notifyAt: notifyAt.toISOString(),
    status: "scheduled",
  }));
}

/**
 * Return the event log history.
 */
function getEventLogs() {
  return eventLogs;
}

/**
 * Fire the Fyno event API.
 * Docs: https://docs.fyno.io/reference/trigger-event
 */
async function sendFynoNotification(fynoConfig) {
  const {
    apiKey,
    workspaceId,
    eventName,
    recipient,
    data = {},
  } = fynoConfig;

  const url = `https://api.fyno.io/v1/${workspaceId}/event`;

  const payload = {
    event: eventName,
    to: {
      distinct_id: recipient.distinct_id,
      // Optional channel-specific identifiers
      ...(recipient.email && { email: [{ channel: "email", address: recipient.email }] }),
      ...(recipient.sms && { sms: [{ channel: "sms", number: recipient.sms }] }),
      ...(recipient.whatsapp && { whatsapp: [{ channel: "whatsapp", number: recipient.whatsapp }] }),
      ...(recipient.push && { push: [{ channel: "push", token: recipient.push }] }),
    },
    data,
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  return response.data;
}

module.exports = { scheduleHourBeforeNotification, cancelJob, listJobs, getEventLogs };
