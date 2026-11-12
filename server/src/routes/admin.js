// Admin page + invite-code API. Everything here is disabled (404) unless
// ADMIN_PASSWORD is set, and every API call requires the admin_session cookie.
// This is meant to be used in a browser, so it accepts ordinary HTML form
// posts and answers them with redirects, while JSON callers still get JSON.
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

// Express 4 does not forward rejected promises; without this a database error
// would leave the browser hanging until it times out.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

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

// The page is posted to by <form>, which sends an urlencoded body; anything
// else (the JSON API, GETs, scripts, tests) keeps getting JSON answers.
function isFormPost(req) {
  return Boolean(req.is('application/x-www-form-urlencoded') || req.is('multipart/form-data'));
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  if (isFormPost(req)) return res.redirect('/admin');
  res.status(401).json({ error: 'ADMIN_AUTH_REQUIRED' });
}

// Constant-time compare so the password cannot be guessed by timing.
function adminPasswordMatches(candidate) {
  const a = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  const b = crypto
    .createHash('sha256')
    .update(String(process.env.ADMIN_PASSWORD ?? ''))
    .digest();
  return crypto.timingSafeEqual(a, b);
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// Disable the whole area when no password is configured.
router.use((req, res, next) => {
  if (!adminEnabled()) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-store');
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
  .error{color:#b00020;font-weight:600}
  .bar{display:flex;justify-content:space-between;align-items:center}
</style></head><body>${body}</body></html>`;

function loginPage(error) {
  return page(`
    <h1>EBISU NAP Checker — Admin</h1>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/admin/login">
      <input type="password" name="password" placeholder="Admin password" required />
      <button type="submit">Log in</button>
    </form>`);
}

function codesPage(codes) {
  const rows = codes
    .map(
      (c) =>
        `<tr><td><code>${escapeHtml(c.code)}</code></td>` +
        `<td>${escapeHtml(c.uses)}/${escapeHtml(c.max_uses)}</td>` +
        `<td>${escapeHtml(c.last_used_by)}</td></tr>`
    )
    .join('');
  return page(`
    <div class="bar">
      <h1>Invite codes</h1>
      <form method="post" action="/admin/logout">
        <button type="submit">Log out</button>
      </form>
    </div>
    <p>Give a code to one person. They need it to register in the app.</p>
    <form method="post" action="/admin/api/invite-codes">
      <input type="number" name="max_uses" value="1" min="1" max="1000" />
      <button type="submit">Generate code</button>
    </form>
    <table><tr><th>Code</th><th>Uses</th><th>Last used by</th></tr>${rows}</table>`);
}

router.get('/', asyncHandler(async (req, res) => {
  if (!isAdmin(req)) return res.send(loginPage());
  const { rows } = await req.db.query(
    `SELECT code, max_uses, uses, last_used_by, last_used_at, created_at
     FROM invite_codes ORDER BY created_at DESC`
  );
  res.send(codesPage(rows));
}));

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || !adminPasswordMatches(password)) {
    if (isFormPost(req)) return res.status(401).send(loginPage('Wrong password. Try again.'));
    return res.status(401).json({ error: 'WRONG_ADMIN_PASSWORD' });
  }

  const token = jwt.sign({ scope: 'admin' }, secret(), { expiresIn: '8h' });
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  if (isFormPost(req)) return res.redirect('/admin');
  res.json({ message: 'Logged in' });
});

router.post('/logout', (req, res) => {
  res.clearCookie('admin_session');
  if (isFormPost(req)) return res.redirect('/admin');
  res.json({ message: 'Logged out' });
});

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing 0/O/1/I
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  return code;
}

router.post('/api/invite-codes', requireAdmin, asyncHandler(async (req, res) => {
  const requested = Number(req.body?.max_uses);
  const maxUses = Number.isFinite(requested) ? Math.min(1000, Math.max(1, Math.trunc(requested))) : 1;

  const code = generateCode();
  await req.db.query('INSERT INTO invite_codes (code, max_uses) VALUES ($1, $2)', [code, maxUses]);

  if (isFormPost(req)) return res.redirect('/admin');
  res.json({ code });
}));

router.get('/api/invite-codes', requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await req.db.query(
    `SELECT code, max_uses, uses, last_used_by, last_used_at, created_at
     FROM invite_codes ORDER BY created_at DESC`
  );
  res.json({ codes: rows });
}));

module.exports = router;
