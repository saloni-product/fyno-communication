const schedule = require("node-schedule");
const axios = require("axios");

// In-memory store of scheduled jobs: { jobId -> { job, targetTime, notifyAt, type, eventName, whatsapp, name, consultationLink, agent } }
const scheduledJobs = {};

// In-memory event log (capped at 200 entries, newest first)
const eventLogs = [];
const MAX_LOGS = 200;

function addLog(entry) {
  eventLogs.unshift(entry);
  if (eventLogs.length > MAX_LOGS) eventLogs.length = MAX_LOGS;
}

/**
 * Core scheduler — fires a Fyno notification `offsetMs` before the target time.
 *
 * @param {string} timestamp   ISO 8601 datetime string
 * @param {number} offsetMs    Milliseconds before target to fire (e.g. 1h = 3_600_000)
 * @param {string} type        Label stored on the job ("1hr" | "24hr")
 * @param {object} fynoConfig  { apiKey, workspaceId, eventName, recipient, data }
 * @returns {{ jobId, targetTime, notifyAt, status }}
 */
function scheduleNotification(timestamp, offsetMs, type, fynoConfig) {
  const targetTime = new Date(timestamp);

  if (isNaN(targetTime.getTime())) {
    throw new Error(`Invalid timestamp: "${timestamp}"`);
  }

  const notifyAt = new Date(targetTime.getTime() - offsetMs);
  const now = new Date();

  if (notifyAt <= now) {
    const label = offsetMs >= 24 * 60 * 60 * 1000 ? "24 hours" : "1 hour";
    throw new Error(
      `Notification time (${notifyAt.toISOString()}) is in the past. ` +
        `Timestamp must be more than ${label} from now.`
    );
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const job = schedule.scheduleJob(jobId, notifyAt, async () => {
    const triggeredAt = new Date().toISOString();
    console.log(`[${triggeredAt}] Job ${jobId} (${type}) triggered — sending Fyno notification`);
    try {
      await sendFynoNotification(fynoConfig);
      console.log(`[${new Date().toISOString()}] Job ${jobId} — Fyno call succeeded`);
      addLog({
        jobId,
        type,
        eventName: fynoConfig.eventName,
        whatsapp: fynoConfig.recipient?.whatsapp,
        name: fynoConfig.data?.name,
        consultationLink: fynoConfig.data?.consultation_link,
        agent: fynoConfig.data?.agent,
        targetTime: targetTime.toISOString(),
        triggeredAt,
        status: "success",
        error: null,
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Job ${jobId} — Fyno call failed:`, err.message);
      addLog({
        jobId,
        type,
        eventName: fynoConfig.eventName,
        whatsapp: fynoConfig.recipient?.whatsapp,
        name: fynoConfig.data?.name,
        consultationLink: fynoConfig.data?.consultation_link,
        agent: fynoConfig.data?.agent,
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
    type,
    targetTime,
    notifyAt,
    eventName: fynoConfig.eventName,
    whatsapp: fynoConfig.recipient?.whatsapp,
    name: fynoConfig.data?.name,
    consultationLink: fynoConfig.data?.consultation_link,
    agent: fynoConfig.data?.agent,
  };

  console.log(
    `[${new Date().toISOString()}] Scheduled job ${jobId} (${type}): ` +
      `target=${targetTime.toISOString()}, notify at=${notifyAt.toISOString()}`
  );

  return {
    jobId,
    targetTime: targetTime.toISOString(),
    notifyAt: notifyAt.toISOString(),
    status: "scheduled",
  };
}

function scheduleHourBeforeNotification(timestamp, fynoConfig) {
  return scheduleNotification(timestamp, 60 * 60 * 1000, "1hr", fynoConfig);
}

function scheduleDayBeforeNotification(timestamp, fynoConfig) {
  return scheduleNotification(timestamp, 24 * 60 * 60 * 1000, "24hr", fynoConfig);
}

/**
 * Parse an ISO 8601 timestamp and schedule a Fyno API call exactly
 * 24 hours before that time (computed in UTC; display is in IST).
 *
 * @param {string} timestamp   ISO 8601 datetime string
 * @param {object} fynoConfig  { apiKey, workspaceId, eventName, recipient, data }
 * @returns {{ jobId, targetTime, notifyAt, status }}
 */
function scheduleDayBeforeNotification(timestamp, fynoConfig) {
  const targetTime = new Date(timestamp);

  if (isNaN(targetTime.getTime())) {
    throw new Error(`Invalid timestamp: "${timestamp}"`);
  }

  const notifyAt = new Date(targetTime.getTime() - 24 * 60 * 60 * 1000); // subtract 24 hours
  const now = new Date();

  if (notifyAt <= now) {
    throw new Error(
      `Notification time (${notifyAt.toISOString()}) is in the past. ` +
        `Timestamp must be more than 24 hours from now.`
    );
  }

  const jobId = `job_24h_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const job = schedule.scheduleJob(jobId, notifyAt, async () => {
    const triggeredAt = new Date().toISOString();
    console.log(`[${triggeredAt}] Job ${jobId} triggered — sending Fyno notification (24h nudge)`);
    try {
      await sendFynoNotification(fynoConfig);
      console.log(`[${new Date().toISOString()}] Job ${jobId} — Fyno call succeeded`);
      addLog({
        jobId,
        eventName: fynoConfig.eventName,
        whatsapp: fynoConfig.recipient?.whatsapp,
        name: fynoConfig.data?.name,
        consultationLink: fynoConfig.data?.consultation_link,
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
        whatsapp: fynoConfig.recipient?.whatsapp,
        name: fynoConfig.data?.name,
        consultationLink: fynoConfig.data?.consultation_link,
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
    whatsapp: fynoConfig.recipient?.whatsapp,
    name: fynoConfig.data?.name,
    consultationLink: fynoConfig.data?.consultation_link,
  };

  console.log(
    `[${new Date().toISOString()}] Scheduled 24h job ${jobId}: ` +
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
    type: entry.type,
    eventName: entry.eventName,
    whatsapp: entry.whatsapp,
    name: entry.name,
    consultationLink: entry.consultationLink,
    agent: entry.agent,
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
  return Object.entries(scheduledJobs).map(([jobId, { type, targetTime, notifyAt, eventName, whatsapp, name, consultationLink, agent }]) => ({
    jobId,
    type,
    eventName,
    whatsapp,
    name,
    consultationLink,
    agent,
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
  const { apiKey, workspaceId, eventName, recipient, data = {} } = fynoConfig;

  const url = `https://api.fyno.io/v1/${workspaceId}/event`;

  const to = {};
  if (recipient.distinct_id) to.distinct_id = recipient.distinct_id;
  if (recipient.whatsapp) to.whatsapp = recipient.whatsapp;
  if (recipient.sms) to.sms = recipient.sms;
  if (recipient.email) to.email = recipient.email;

  const payload = { event: eventName, to, data };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  return response.data;
}

module.exports = { scheduleHourBeforeNotification, scheduleDayBeforeNotification, cancelJob, listJobs, getEventLogs };
