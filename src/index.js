const express = require("express");
const path = require("path");
const { scheduleHourBeforeNotification, scheduleDayBeforeNotification, cancelJob, listJobs, getEventLogs } = require("./scheduler");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 3000;

// Convert any ISO 8601 timestamp to IST-formatted { date, time }
function toIST(isoString) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const ist = new Date(new Date(isoString).getTime() + IST_OFFSET_MS);
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const day = ist.getUTCDate();
  const ordinal = (d) => { const s = ["th","st","nd","rd"]; const v = d % 100; return d + (s[(v-20)%10] || s[v] || s[0]); };
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  return {
    date: `${ordinal(day)} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`,
    time: `${h % 12 || 12}:${String(m).padStart(2,"0")} ${h < 12 ? "AM" : "PM"}`,
  };
}

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
    res.status(400).json({ error: "fyno.apiKey, fyno.workspaceId, fyno.eventName, and fyno.recipient are required" });
    return false;
  }
  return true;
}

// ─── POST /schedule ───────────────────────────────────────────────────────────
// Schedule a Fyno notification 1 hour before the given timestamp.
// Body: { timestamp, name, consultation_link, agent, fyno: { apiKey, workspaceId, eventName, recipient: { whatsapp } } }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/schedule", (req, res) => {
  if (!validateScheduleBody(req, res)) return;
  const { timestamp, name, consultation_link, agent, fyno } = req.body;
  try {
    const result = scheduleHourBeforeNotification(timestamp, buildEnrichedFyno(fyno, { timestamp, name, consultation_link, agent }));
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
// Schedule a Fyno notification 24 hours before the given timestamp.
// Same body as POST /schedule — timestamp must be >24h from now.
// ─────────────────────────────────────────────────────────────────────────────
app.post("/schedule/24h", (req, res) => {
  if (!validateScheduleBody(req, res)) return;
  const { timestamp, name, consultation_link, agent, fyno } = req.body;
  try {
    const result = scheduleDayBeforeNotification(timestamp, buildEnrichedFyno(fyno, { timestamp, name, consultation_link, agent }));
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
  if (!cancelled) return res.status(404).json({ error: "Job not found or already completed" });
  return res.json({ status: "cancelled", jobId: req.params.jobId });
});

// ─── GET /schedule/logs — must be before GET /schedule ───────────────────────
app.get("/schedule/logs", (req, res) => res.json({ logs: getEventLogs() }));

// ─── GET /schedule ────────────────────────────────────────────────────────────
app.get("/schedule", (req, res) => res.json({ jobs: listJobs() }));

// ─── POST /format-timestamp ───────────────────────────────────────────────────
// Convert an ISO 8601 timestamp to IST date and time.
// Body:     { "timestamp": "2026-03-21T10:00:00+00:00" }
// Response: { "date": "21st March 2026", "time": "3:30 PM" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/format-timestamp", (req, res) => {
  const { timestamp } = req.body;
  if (!timestamp) return res.status(400).json({ error: "timestamp is required" });
  const dt = new Date(timestamp);
  if (isNaN(dt.getTime())) return res.status(400).json({ error: "Invalid timestamp format. Expected ISO 8601 (e.g. 2026-03-21T10:00:00+00:00)" });
  return res.json(toIST(timestamp));
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`Fyno scheduler running on port ${PORT}`));
