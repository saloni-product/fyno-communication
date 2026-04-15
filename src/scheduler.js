const schedule = require("node-schedule");
const axios = require("axios");

// In-memory store of scheduled jobs
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
 * @param {number} offsetMs    Milliseconds before target to fire
 * @param {string} type        "1hr" | "24hr"
 * @param {object} fynoConfig  { apiKey, workspaceId, eventName, recipient, data }
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
    console.log(`[${triggeredAt}] Job ${jobId} (${type}) triggered`);
    try {
      await sendFynoNotification(fynoConfig);
      console.log(`[${new Date().toISOString()}] Job ${jobId} — succeeded`);
      addLog({ jobId, type, eventName: fynoConfig.eventName, whatsapp: fynoConfig.recipient?.whatsapp, name: fynoConfig.data?.name, consultationLink: fynoConfig.data?.consultation_link, agent: fynoConfig.data?.agent, targetTime: targetTime.toISOString(), triggeredAt, status: "success", error: null });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Job ${jobId} — failed:`, err.message);
      addLog({ jobId, type, eventName: fynoConfig.eventName, whatsapp: fynoConfig.recipient?.whatsapp, name: fynoConfig.data?.name, consultationLink: fynoConfig.data?.consultation_link, agent: fynoConfig.data?.agent, targetTime: targetTime.toISOString(), triggeredAt, status: "failed", error: err.message });
    } finally {
      delete scheduledJobs[jobId];
    }
  });

  scheduledJobs[jobId] = { job, type, targetTime, notifyAt, eventName: fynoConfig.eventName, whatsapp: fynoConfig.recipient?.whatsapp, name: fynoConfig.data?.name, consultationLink: fynoConfig.data?.consultation_link, agent: fynoConfig.data?.agent };

  console.log(`[${new Date().toISOString()}] Scheduled ${type} job ${jobId}: target=${targetTime.toISOString()}, notify=${notifyAt.toISOString()}`);

  return { jobId, targetTime: targetTime.toISOString(), notifyAt: notifyAt.toISOString(), status: "scheduled" };
}

function scheduleHourBeforeNotification(timestamp, fynoConfig) {
  return scheduleNotification(timestamp, 60 * 60 * 1000, "1hr", fynoConfig);
}

function scheduleDayBeforeNotification(timestamp, fynoConfig) {
  return scheduleNotification(timestamp, 24 * 60 * 60 * 1000, "24hr", fynoConfig);
}

function cancelJob(jobId) {
  const entry = scheduledJobs[jobId];
  if (!entry) return false;
  entry.job.cancel();
  addLog({ jobId, type: entry.type, eventName: entry.eventName, whatsapp: entry.whatsapp, name: entry.name, consultationLink: entry.consultationLink, agent: entry.agent, targetTime: entry.targetTime.toISOString(), triggeredAt: new Date().toISOString(), status: "cancelled", error: null });
  delete scheduledJobs[jobId];
  return true;
}

function listJobs() {
  return Object.entries(scheduledJobs).map(([jobId, { type, targetTime, notifyAt, eventName, whatsapp, name, consultationLink, agent }]) => ({
    jobId, type, eventName, whatsapp, name, consultationLink, agent,
    targetTime: targetTime.toISOString(),
    notifyAt: notifyAt.toISOString(),
    status: "scheduled",
  }));
}

function getEventLogs() {
  return eventLogs;
}

async function sendFynoNotification(fynoConfig) {
  const { apiKey, workspaceId, eventName, recipient, data = {} } = fynoConfig;
  const url = `https://api.fyno.io/v1/${workspaceId}/event`;

  const to = {};
  if (recipient.whatsapp) to.whatsapp = recipient.whatsapp;
  if (recipient.sms) to.sms = recipient.sms;
  if (recipient.email) to.email = recipient.email;

  const response = await axios.post(url, { event: eventName, to, data }, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });

  return response.data;
}

module.exports = { scheduleHourBeforeNotification, scheduleDayBeforeNotification, cancelJob, listJobs, getEventLogs };
