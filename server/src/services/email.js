// G-MAPS email service (Task 7). Sends via Resend in real environments.
// In the Jest test environment (NODE_ENV === 'test' or JEST_WORKER_ID set)
// the service falls back to an in-memory log so test suites can inspect
// sent mail without a network or a RESEND_API_KEY. Tests import this module
// and may also replace implementations with jest.spyOn.
const { Resend } = require('resend');
const { OTP_TTL_MINUTES } = require('./otp');

const GLOBE_BLUE = '#00539B';
const DEFAULT_FROM = 'G-MAPS <noreply@ebisudps.com>';

const sentEmails = [];

function isTestEnv() {
  return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
}

function fromAddress() {
  return process.env.EMAIL_FROM || DEFAULT_FROM;
}

function htmlLayout(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8ee;">
        <tr><td style="background:${GLOBE_BLUE};height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px 28px 8px 28px;">
          <div style="font-size:20px;font-weight:700;letter-spacing:0.5px;color:${GLOBE_BLUE};">G-MAPS</div>
        </td></tr>
        <tr><td style="padding:0 28px 24px 28px;font-size:14px;line-height:1.6;color:#1a1a1a;">
          ${bodyHtml}
        </td></tr>
      </table>
      <div style="font-size:11px;color:#6b7280;padding:14px 0 0 0;">G-MAPS</div>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildOtpEmail(code) {
  const subject = 'Your G-MAPS verification code';
  const text = [
    'G-MAPS verification',
    '',
    `Your G-MAPS verification code is: ${code}`,
    '',
    `This code expires in ${OTP_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.`,
  ].join('\n');
  const html = htmlLayout(
    subject,
    `<p style="margin:0 0 12px 0;">Your G-MAPS verification code is:</p>
     <p style="margin:0 0 16px 0;font-size:28px;font-weight:700;letter-spacing:6px;color:${GLOBE_BLUE};">${code}</p>
     <p style="margin:0;color:#4b5563;">This code expires in ${OTP_TTL_MINUTES} minutes. If you did not request it, you can ignore this email.</p>`
  );
  return { subject, text, html };
}

function buildTempPasswordEmail(tempPassword) {
  const subject = 'Your G-MAPS temporary password';
  const text = [
    'G-MAPS account',
    '',
    `Your G-MAPS temporary password is: ${tempPassword}`,
    '',
    'Please sign in with this temporary password and change it immediately. If you did not request this, contact your administrator.',
  ].join('\n');
  const html = htmlLayout(
    subject,
    `<p style="margin:0 0 12px 0;">Your G-MAPS temporary password is:</p>
     <p style="margin:0 0 16px 0;font-size:20px;font-weight:700;letter-spacing:2px;color:${GLOBE_BLUE};word-break:break-all;">${tempPassword}</p>
     <p style="margin:0;color:#4b5563;">Please sign in with this temporary password and change it immediately. If you did not request this, contact your administrator.</p>`
  );
  return { subject, text, html };
}

function requireApiKey() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY is not set. Cannot send email without it. ' +
        'Set RESEND_API_KEY in the environment (see .env.example).'
    );
  }
  return apiKey;
}

async function deliver({ to, subject, text, html }) {
  const resend = new Resend(requireApiKey());
  const { error } = await resend.emails.send({ from: fromAddress(), to, subject, text, html });
  if (error) {
    throw new Error(`Failed to send email via Resend: ${error.message || error}`);
  }
}

async function sendOtpEmail(to, otp) {
  if (isTestEnv()) {
    sentEmails.push({ to, otp, type: 'otp' });
    return;
  }
  return deliver({ to, ...buildOtpEmail(otp) });
}

async function sendTempPasswordEmail(to, tempPassword) {
  if (isTestEnv()) {
    sentEmails.push({ to, tempPassword, type: 'temp-password' });
    return;
  }
  return deliver({ to, ...buildTempPasswordEmail(tempPassword) });
}

function getSentEmails() {
  return sentEmails;
}

function clearSentEmails() {
  sentEmails.length = 0;
}

module.exports = {
  sendOtpEmail,
  sendTempPasswordEmail,
  getSentEmails,
  clearSentEmails,
  // Exported for tests and reuse; not part of the route-facing API.
  buildOtpEmail,
  buildTempPasswordEmail,
  DEFAULT_FROM,
  GLOBE_BLUE,
};
