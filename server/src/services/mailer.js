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

async function sendMail(message) {
  if (smtpConfigured()) return sendViaSmtp(message);
  return sendViaOutbox(message);
}

module.exports = { sendMail };
