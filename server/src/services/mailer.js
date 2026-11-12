// Without SMTP or an HTTP API configured the app must still "send" mail so the
// whole registration flow is testable locally: messages are written as plain text
// files into an outbox directory. Tests point MAIL_OUTBOX_DIR at a temp dir.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Defaults to server/outbox — keep in sync with the repo .gitignore.
function outboxDir() {
  return process.env.MAIL_OUTBOX_DIR || path.join(__dirname, '../../outbox');
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

// Also returns true when a Re:Send key is present — it is the only mail provider
// we support on Render's free tier because Re:Send is HTTPS-only.
function mailProviderActive() {
  return Boolean(smtpConfigured() || process.env.RESEND_API_KEY);
}

async function sendViaOutbox({ to, subject, text }) {
  const dir = outboxDir();
  fs.mkdirSync(dir, { recursive: true });

  // Colliding timestamps must not overwrite an earlier message.
  const base = new Date().toISOString().replace(/[:.]/g, '-');
  let file = path.join(dir, `${base}-${to}.txt`);
  let n = 0;
  while (fs.existsSync(file)) file = path.join(dir, `${base}-${++n}-${to}.txt`);

  const body = `To: ${to}\nSubject: ${subject}\n\n${text}\n`;
  fs.writeFileSync(file, body, 'utf8');
  return { delivered: 'outbox', path: file };
}

async function sendViaSmtp({ to, subject, text }) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject,
    text,
  });
  return { delivered: 'smtp' };
}

// Send via Re:Send's REST API (HTTPS). No extra dependency — native fetch since
// Node 18. Requires RESEND_API_KEY in the environment. The from address defaults
// to do-not-reply@ebisudps.com if MAIL_FROM is not set, which matches the domain
// we verified earlier.
async function sendViaHttp({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  const from = process.env.MAIL_FROM || 'do-not-reply@ebisudps.com';

  const body = JSON.stringify({
    from,
    to,
    subject,
    text,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'OpenZeppelin-Project': 'EBISU-NAP-Checker',
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Re:Send API ${res.status}: ${raw.slice(0, 200)}`);
  }

  let id;
  try {
    id = JSON.parse(raw).id;
  } catch (_) {
    id = raw.slice(0, 60);
  }
  return { delivered: 'http', messageId: String(id) };
}

// With no SMTP the message must still be recoverable. The file alone is not
// enough on a hosted instance (ephemeral disk, restarts), so when a pool is
// available the message is also stored in the database where the admin page can
// show it. The file is still written because tests and local dev read it, but a
// read-only disk must not fail the request — the database copy is what matters.
async function sendMail(message, { pool } = {}) {
  if (smtpConfigured()) return sendViaSmtp(message);
  if (process.env.RESEND_API_KEY) return sendViaHttp(message);

  let fileResult = { delivered: 'outbox' };
  try {
    fileResult = await sendViaOutbox(message);
  } catch (err) {
    if (!pool) throw err; // no fallback available: surface the failure
    console.error('could not write the file outbox:', err.message);
  }

  if (pool) {
    try {
      await pool.query(
        'INSERT INTO mail_outbox (to_email, subject, body) VALUES ($1, $2, $3)',
        [message.to, message.subject, message.text]
      );
    } catch (err) {
      console.error('could not archive mail to the database:', err.message);
    }
  }

  return fileResult;
}

module.exports = { sendMail, smtpConfigured, mailProviderActive };
