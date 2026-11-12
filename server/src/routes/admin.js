// Admin page + invite-code API. Everything here is disabled (404) unless
// ADMIN_PASSWORD is set, and every API call requires the admin_session cookie.
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const router = express.Router();

function secret() {
  return process.env.JWT_SECRET || 'dev-only-insecure-secret';
}

function adminEnabled() {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  const part = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

function isAdmin(req) {
  const token = readCookie(req, 'admin_session');
  if (!token) return false;
  try {
    return jwt.verify(token, secret()).scope === 'admin';
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'ADMIN_AUTH_REQUIRED' });
  next();
}

// Disable the whole area when no password is configured.
router.use((req, res, next) => {
  if (!adminEnabled()) return res.status(404).json({ error: 'Not found' });
  next();
});

const page = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>EBISU NAP Checker — Admin</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px}
  input,button{font-size:16px;padding:8px;margin:4px 0}
  table{border-collapse:collapse;width:100%;margin-top:16px}
  td,th{border-bottom:1px solid #ddd;text-align:left;padding:6px}
  code{background:#f3f3f3;padding:2px 6px}
</style></head><body>${body}</body></html>`;

function loginPage() {
  return page(`
    <h1>EBISU NAP Checker — Admin</h1>
    <form method="post" action="/admin/login">
      <input type="password" name="password" placeholder="Admin password" required />
      <button type="submit">Log in</button>
    </form>`);
}

function codesPage(codes) {
  const rows = codes
    .map(
      (c) =>
        `<tr><td><code>${c.code}</code></td><td>${c.uses}/${c.max_uses}</td>` +
        `<td>${c.last_used_by || ''}</td></tr>`
    )
    .join('');
  return page(`
    <h1>Invite codes</h1>
    <form method="post" action="/admin/api/invite-codes">
      <input type="number" name="max_uses" value="1" min="1" />
      <button type="submit">Generate code</button>
    </form>
    <table><tr><th>Code</th><th>Uses</th><th>Last used by</th></tr>${rows}</table>`);
}

router.get('/', async (req, res) => {
  if (!isAdmin(req)) return res.send(loginPage());
  const { rows } = await req.db.query(
    `SELECT code, max_uses, uses, last_used_by, last_used_at, created_at
     FROM invite_codes ORDER BY created_at DESC`
  );
  res.send(codesPage(rows));
});

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'WRONG_ADMIN_PASSWORD' });
  }
  const token = jwt.sign({ scope: 'admin' }, secret(), { expiresIn: '8h' });
  res.cookie('admin_session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ message: 'Logged in' });
});

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

router.post('/api/invite-codes', requireAdmin, async (req, res) => {
  const maxUses = Math.max(1, Number(req.body?.max_uses) || 1);
  const code = generateCode();
  await req.db.query(
    'INSERT INTO invite_codes (code, max_uses) VALUES ($1, $2)',
    [code, maxUses]
  );
  res.json({ code });
});

router.get('/api/invite-codes', requireAdmin, async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT code, max_uses, uses, last_used_by, last_used_at, created_at
     FROM invite_codes ORDER BY created_at DESC`
  );
  res.json({ codes: rows });
});

module.exports = router;
