const express = require("express");
const { scheduleHourBeforeNotification, cancelJob, listJobs } = require("./scheduler");

const app = express();
app.use(express.json());

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

// ─── POST /format-timestamp ───────────────────────────────────────────────────
// Format an ISO 8601 timestamp into a human-readable date and time.
//
// Request body:
// { "timestamp": "2026-03-21T10:00:00+00:00" }
//
// Response:
// { "date": "21st March 2026", "time": "10:00 AM" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/format-timestamp", (req, res) => {
  const { timestamp } = req.body;

  if (!timestamp) {
    return res.status(400).json({ error: "timestamp is required" });
  }

  const dt = new Date(timestamp);
  if (isNaN(dt.getTime())) {
    return res.status(400).json({ error: "Invalid timestamp format. Expected ISO 8601 (e.g. 2026-03-21T10:00:00+00:00)" });
  }

  // Extract parts using UTC values (preserve the timezone offset already applied)
  const offsetMatch = timestamp.match(/([+-])(\d{2}):(\d{2})$/);
  let hours, minutes, day, month, year;

  if (offsetMatch) {
    const sign = offsetMatch[1] === "+" ? 1 : -1;
    const offsetMinutes = sign * (parseInt(offsetMatch[2]) * 60 + parseInt(offsetMatch[3]));
    const local = new Date(dt.getTime() + offsetMinutes * 60000);
    hours = local.getUTCHours();
    minutes = local.getUTCMinutes();
    day = local.getUTCDate();
    month = local.getUTCMonth();
    year = local.getUTCFullYear();
  } else {
    hours = dt.getUTCHours();
    minutes = dt.getUTCMinutes();
    day = dt.getUTCDate();
    month = dt.getUTCMonth();
    year = dt.getUTCFullYear();
  }

  const ordinal = (d) => {
    const s = ["th", "st", "nd", "rd"];
    const v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinute = String(minutes).padStart(2, "0");

  return res.json({
    date: `${ordinal(day)} ${monthNames[month]} ${year}`,
    time: `${displayHour}:${displayMinute} ${period}`,
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Fyno scheduler running on port ${PORT}`);
});
