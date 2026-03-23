const express = require("express");
const path = require("path");
const { scheduleHourBeforeNotification, cancelJob, listJobs, getEventLogs } = require("./scheduler");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 3000;

// ─── POST /schedule ───────────────────────────────────────────────────────────
// Schedule a Fyno notification 1 hour before the given timestamp.
//
// Request body:
// {
//   "timestamp": "2026-03-21T10:00:00+00:00",   // ISO 8601, must be >1h from now
//   "fyno": {
//     "apiKey":      "YOUR_FYNO_API_KEY",
//     "workspaceId": "YOUR_WORKSPACE_ID",
//     "eventName":   "your_event_name",
//     "recipient": {
//       "distinct_id": "user_123",
//       "email":       "user@example.com",   // optional
//       "sms":         "+1234567890",         // optional
//       "whatsapp":    "+1234567890"          // optional
//     },
//     "data": { "key": "value" }              // optional template variables
//   }
// }
//
// Response:
// { "jobId": "...", "targetTime": "...", "notifyAt": "...", "status": "scheduled" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/schedule", (req, res) => {
  const { timestamp, fyno } = req.body;

  if (!timestamp) {
    return res.status(400).json({ error: "timestamp is required" });
  }
  if (!fyno || !fyno.apiKey || !fyno.workspaceId || !fyno.eventName || !fyno.recipient) {
    return res.status(400).json({
      error: "fyno.apiKey, fyno.workspaceId, fyno.eventName, and fyno.recipient are required",
    });
  }

  try {
    const result = scheduleHourBeforeNotification(timestamp, fyno);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── DELETE /schedule/:jobId ──────────────────────────────────────────────────
// Cancel a previously scheduled job.
// ─────────────────────────────────────────────────────────────────────────────
app.delete("/schedule/:jobId", (req, res) => {
  const cancelled = cancelJob(req.params.jobId);
  if (!cancelled) {
    return res.status(404).json({ error: "Job not found or already completed" });
  }
  return res.json({ status: "cancelled", jobId: req.params.jobId });
});

// ─── GET /schedule ────────────────────────────────────────────────────────────
// List all active scheduled jobs.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/schedule", (req, res) => {
  return res.json({ jobs: listJobs() });
});

// ─── GET /schedule/logs ───────────────────────────────────────────────────────
// Return the event trigger history (success, failed, cancelled).
// ─────────────────────────────────────────────────────────────────────────────
app.get("/schedule/logs", (req, res) => {
  return res.json({ logs: getEventLogs() });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Fyno scheduler running on port ${PORT}`);
});
