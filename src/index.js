const express = require("express");
const path = require("path");
const { scheduleHourBeforeNotification, scheduleDayBeforeNotification, cancelJob, listJobs, getEventLogs } = require("./scheduler");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 3000;

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

// Build the enriched fyno config with all template variables
function buildEnrichedFyno(fyno, { timestamp, name, consultation_link, agent }) {
  return {
    ...fyno,
    data: {
      name,
      consultation_link,
      agent,
      booking_date: formatBookingDate(timestamp),
      booking_time: formatBookingTime(timestamp),
      ...fyno.data,
    },
  };
}

function validateScheduleBody(req, res) {
  const { timestamp, fyno } = req.body;
  if (!timestamp) {
    res.status(400).json({ error: "timestamp is required" });
    return false;
  }
  if (!fyno || !fyno.apiKey || !fyno.workspaceId || !fyno.eventName || !fyno.recipient) {
    res.status(400).json({
      error: "fyno.apiKey, fyno.workspaceId, fyno.eventName, and fyno.recipient are required",
    });
    return false;
  }
  return true;
}

// ─── POST /schedule ───────────────────────────────────────────────────────────
// Schedule a Fyno notification 1 hour before the given timestamp.
//
// Request body:
// {
//   "timestamp":         "2026-03-21T10:00:00+00:00",
//   "name":              "John Doe",
//   "consultation_link": "https://meet.example.com/x",
//   "agent":             "Dr. Smith",
//   "fyno": {
//     "apiKey":      "YOUR_FYNO_API_KEY",
//     "workspaceId": "YOUR_WORKSPACE_ID",
//     "eventName":   "1_hour_nudge",
//     "recipient": { "whatsapp": "+917757855472" }
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/schedule", (req, res) => {
  if (!validateScheduleBody(req, res)) return;
  const { timestamp, name, consultation_link, agent, fyno } = req.body;
  try {
    const result = scheduleHourBeforeNotification(
      timestamp,
      buildEnrichedFyno(fyno, { timestamp, name, consultation_link, agent })
    );
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ─── POST /schedule/24h ───────────────────────────────────────────────────────
// Schedule a Fyno notification 24 hours before the given timestamp.
//
// Same request body as POST /schedule — timestamp must be >24h from now.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/schedule/24h", (req, res) => {
  if (!validateScheduleBody(req, res)) return;
  const { timestamp, name, consultation_link, agent, fyno } = req.body;
  try {
    const result = scheduleDayBeforeNotification(
      timestamp,
      buildEnrichedFyno(fyno, { timestamp, name, consultation_link, agent })
    );
    return res.status(201).json(result);
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
app.delete("/schedule/:jobId", (req, res) => {
  const cancelled = cancelJob(req.params.jobId);
  if (!cancelled) {
    return res.status(404).json({ error: "Job not found or already completed" });
  }
  return res.json({ status: "cancelled", jobId: req.params.jobId });
});

// ─── GET /schedule/logs ───────────────────────────────────────────────────────
app.get("/schedule/logs", (req, res) => {
  return res.json({ logs: getEventLogs() });
});

// ─── GET /schedule ────────────────────────────────────────────────────────────
app.get("/schedule", (req, res) => {
  return res.json({ jobs: listJobs() });
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`Fyno scheduler running on port ${PORT}`);
});
