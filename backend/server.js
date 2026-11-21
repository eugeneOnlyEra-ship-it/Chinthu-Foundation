'use strict';
/* Chithu Foundation: backend
   - serves the static site from ../frontend (optional convenience)
   - POST /api/contact        public contact form endpoint
   - /admin                   password-protected staff inbox
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { DatabaseSync } = require('node:sqlite'); // built into Node 22.13+, no native build step needed

// ---- tiny .env loader (no extra dependency) ----
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (_) { /* no .env file: rely on real environment variables */ }

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_DIR = path.resolve(__dirname, process.env.FRONTEND_DIR || '../frontend');
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || '').replace(/\/$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
if (!process.env.SESSION_SECRET) console.warn('[warn] SESSION_SECRET not set: admin sessions reset on every restart.');
if (!ADMIN_PASSWORD) console.warn('[warn] ADMIN_PASSWORD not set: /admin is disabled.');

// ---- database ----
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'data', 'chithu.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, type TEXT, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','handled'))
)`);
const insertMsg = db.prepare('INSERT INTO messages(name,email,phone,type,message) VALUES(?,?,?,?,?)');

// ---- optional email notification ----
let mailer = null;
if (process.env.SMTP_HOST && process.env.NOTIFY_EMAIL) {
  mailer = require('nodemailer').createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

const app = express();
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': COOKIE_SECURE ? [] : null
    }
  }
}));
app.use(express.json({ limit: '20kb' }));

// Optional CORS, only for the public contact endpoint (when the frontend is hosted on a different address)
app.use('/api/contact', (req, res, next) => {
  if (ALLOWED_ORIGIN && req.headers.origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- helpers ----
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const TYPES = ['School', 'Hospital or Health Center', 'Market', 'Civic or Religious Group', 'Farming Club', 'Individual Volunteer', 'Individual', 'Other'];

// ---- public API ----
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Too many messages from this connection. Please try again later.' } });

app.post('/api/contact', contactLimiter, (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields; pretend success
  const name = clean(b.name, 120), email = clean(b.email, 200), phone = clean(b.phone, 40), message = clean(b.message, 4000);
  let type = clean(b.type, 60); if (!type) type = 'Other';
  const errors = {};
  if (!name) errors.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address.';
  if (!message) errors.message = 'Please write a short message.';
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });
  insertMsg.run(name, email, phone, type, message);
  if (mailer) {
    mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.NOTIFY_EMAIL, to: process.env.NOTIFY_EMAIL, replyTo: email,
      subject: `Website enquiry (${type}) from ${name.replace(/[\r\n]/g, ' ')}`,
      text: `Name: ${name}\nEmail: ${email}\nPhone/WhatsApp: ${phone || '-'}\nGroup type: ${type}\n\n${message}`
    }).catch(err => console.error('[mail] failed:', err.message));
  }
  res.json({ ok: true });
});

// ---- admin auth (signed, expiring cookie) ----
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = () => { const exp = Date.now() + 8 * 3600e3; return exp + '.' + sign(String(exp)); };
const validToken = t => {
  if (!t) return false; const [exp, sig] = t.split('.'); if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp)); return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const cookieOf = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(p => p[0]));
const hash = s => crypto.createHash('sha256').update(s).digest();
const requireAdmin = (req, res, next) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ ok: false, error: 'Admin is not configured.' });
  if (validToken(cookieOf(req).cf_admin)) return next();
  res.status(401).json({ ok: false, error: 'Not signed in.' });
};
const cookieOpts = () => `Path=/; HttpOnly; SameSite=Strict${COOKIE_SECURE ? '; Secure' : ''}`;

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Too many attempts. Try again in 15 minutes.' } });

app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ ok: false, error: 'Admin is not configured.' });
  const ok = crypto.timingSafeEqual(hash(String((req.body || {}).password || '')), hash(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ ok: false, error: 'Wrong password.' });
  res.setHeader('Set-Cookie', `cf_admin=${makeToken()}; Max-Age=${8 * 3600}; ${cookieOpts()}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.setHeader('Set-Cookie', `cf_admin=; Max-Age=0; ${cookieOpts()}`); res.json({ ok: true }); });
app.get('/api/admin/session', (req, res) => res.json({ ok: validToken(cookieOf(req).cf_admin) }));

app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json({ ok: true, messages: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 1000').all() });
});
app.patch('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const status = (req.body || {}).status; if (!['new', 'handled'].includes(status)) return res.status(400).json({ ok: false });
  db.prepare('UPDATE messages SET status=? WHERE id=?').run(status, Number(req.params.id)); res.json({ ok: true });
});
app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM messages WHERE id=?').run(Number(req.params.id)); res.json({ ok: true });
});
app.get('/api/admin/export.csv', requireAdmin, (req, res) => {
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"'; // neutralise spreadsheet formulas
  const rows = db.prepare('SELECT * FROM messages ORDER BY id DESC').all();
  res.type('text/csv').attachment('chithu-messages.csv').send(
    ['id,received_utc,name,email,phone,type,status,message', ...rows.map(r => [r.id, r.created_at, r.name, r.email, r.phone, r.type, r.status, r.message].map(q).join(','))].join('\r\n'));
});

// ---- pages ----
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.use('/admin-assets', express.static(path.join(__dirname, 'admin'), { index: false, extensions: [] }));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
app.use(express.static(FRONTEND_DIR, { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, 'index.html'))); // single-page hash router
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ ok: false, error: 'Something went wrong.' }); });

app.listen(PORT, () => console.log(`Chithu Foundation running on http://localhost:${PORT}  (admin: /admin)`));
