// Without SMTP configured the app must still "send" mail so the whole
// registration flow is testable locally: messages are written as plain text
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

// With no SMTP the message must still be recoverable. The file alone is not
// enough on a hosted instance (ephemeral disk, restarts), so when a pool is
// available the message is also stored in the database where the admin page can
// show it. The file is still written because tests and local dev read it, but a
// read-only disk must not fail the request — the database copy is what matters.
async function sendMail(message, { pool } = {}) {
  if (smtpConfigured()) return sendViaSmtp(message);

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

module.exports = { sendMail, smtpConfigured };
