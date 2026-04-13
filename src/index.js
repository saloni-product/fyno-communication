const express = require("express");
const path = require("path");
const { scheduleHourBeforeNotification, scheduleDayBeforeNotification, cancelJob, listJobs, getEventLogs } = require("./scheduler");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// Convert a UTC Date/ISO string to IST formatted { date, time }
function toIST(isoString) {
  const IST_OFFSET_MINUTES = 5 * 60 + 30;
  const dt = new Date(isoString);
  const ist = new Date(dt.getTime() + IST_OFFSET_MINUTES * 60000);

  const ordinal = (d) => {
    const s = ["th", "st", "nd", "rd"];
    const v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const hours = ist.getUTCHours();
  const minutes = ist.getUTCMinutes();
  const period = hours < 12 ? "AM" : "PM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  const displayMinute = String(minutes).padStart(2, "0");

  return {
    date: `${ordinal(ist.getUTCDate())} ${monthNames[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`,
    time: `${displayHour}:${displayMinute} ${period}`,
  };
}

const PORT = process.env.PORT || 3000;

// ─── POST /schedule ───────────────────────────────────────────────────────────
// Schedule a Fyno notification 1 hour before the given timestamp.
//
// Request body:
// {
//   "timestamp":         "2026-03-21T10:00:00+00:00",  // ISO 8601, must be >1h from now
//   "name":              "John Doe",                    // passed to message template
//   "consultation_link": "https://meet.example.com/x", // passed to message template
//   "fyno": {
//     "apiKey":      "YOUR_FYNO_API_KEY",
//     "workspaceId": "YOUR_WORKSPACE_ID",
//     "eventName":   "your_event_name",
//     "recipient": {
//       "whatsapp": "+917757855472",          // optional
//       "sms":      "+1234567890",            // optional
//       "email":    "user@example.com"        // optional
//     },
//     "data": { "key": "value" }              // optional extra template variables
//   }
// }
//
// Response:
// { "jobId": "...", "targetTime": "...", "notifyAt": "...", "status": "scheduled" }
// ─────────────────────────────────────────────────────────────────────────────
// Format "2026-03-24T15:00:00+05:30" → "24 Mar 2026"
function formatBookingDate(isoString) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!m) return isoString;
  return `${parseInt(m[3])} ${MONTHS[parseInt(m[2]) - 1]} ${m[1]}`;
}

// Format "2026-03-24T15:00:00+05:30" → "03:00 PM"
function formatBookingTime(isoString) {
  const m = isoString.match(/T(\d{2}):(\d{2})/);
  if (!m) return isoString;
  const h = parseInt(m[1]);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = String(h % 12 || 12).padStart(2, "0");
  return `${h12}:${m[2]} ${ampm}`;
}

app.post("/schedule", (req, res) => {
  const { timestamp, name, consultation_link, fyno } = req.body;

  if (!timestamp) {
    return res.status(400).json({ error: "timestamp is required" });
  }
  if (!fyno || !fyno.apiKey || !fyno.workspaceId || !fyno.eventName || !fyno.recipient) {
    return res.status(400).json({
      error: "fyno.apiKey, fyno.workspaceId, fyno.eventName, and fyno.recipient are required",
    });
  }

  try {
    const enrichedFyno = {
      ...fyno,
      data: {
        name,
        consultation_link,
        booking_date: formatBookingDate(timestamp),
        booking_time: formatBookingTime(timestamp),
        ...fyno.data,
      },
    };
    const result = scheduleHourBeforeNotification(timestamp, enrichedFyno);
    return res.status(201).json({
      jobId: result.jobId,
      status: result.status,
      targetTime: toIST(result.targetTime),
      notifyAt: toIST(result.notifyAt),
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── POST /schedule/24h ───────────────────────────────────────────────────────
// Schedule a Fyno notification 24 hours before the given timestamp (IST display).
//
// Request body:
// {
//   "timestamp": "2026-04-25T11:30:00+00:00",  // ISO 8601, must be >24h from now
//   "name":      "Saloni",
//   "fyno": {
//     "apiKey":      "YOUR_FYNO_API_KEY",
//     "workspaceId": "YOUR_WORKSPACE_ID",
//     "eventName":   "your_event_name",
//     "recipient": {
//       "distinct_id": "7757855472",   // optional
//       "whatsapp":    "7757855472",   // optional
//       "email":       ""              // optional
//     }
//   }
// }
//
// Response:
// { "jobId": "...", "targetTime": "...", "notifyAt": "...", "status": "scheduled" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/schedule/24h", (req, res) => {
  const { timestamp, name, fyno } = req.body;

  if (!timestamp) {
    return res.status(400).json({ error: "timestamp is required" });
  }
  if (!fyno || !fyno.apiKey || !fyno.workspaceId || !fyno.eventName || !fyno.recipient) {
    return res.status(400).json({
      error: "fyno.apiKey, fyno.workspaceId, fyno.eventName, and fyno.recipient are required",
    });
  }

  try {
    const enrichedFyno = {
      ...fyno,
      data: {
        name,
        booking_date: formatBookingDate(timestamp),
        booking_time: formatBookingTime(timestamp),
        ...fyno.data,
      },
    };
    const result = scheduleDayBeforeNotification(timestamp, enrichedFyno);
    return res.status(201).json({
      jobId: result.jobId,
      status: result.status,
      targetTime: toIST(result.targetTime),
      notifyAt: toIST(result.notifyAt),
    });
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

// ─── GET /schedule/logs ───────────────────────────────────────────────────────
// Return the event trigger history (success, failed, cancelled).
// NOTE: must be defined before GET /schedule to avoid route shadowing.
// ─────────────────────────────────────────────────────────────────────────────
app.get("/schedule/logs", (req, res) => {
  return res.json({ logs: getEventLogs() });
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

  return res.json(toIST(timestamp));
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Fyno scheduler running on port ${PORT}`);
});
