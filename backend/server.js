'use strict';
/* Chithu Foundation: backend
   - POST /api/contact   receives the website contact form and emails it to the organisation
   - serves the static site from ../frontend (optional convenience)
   Nothing is stored: the email is the record. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

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
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || '';
const DRY_RUN = process.env.MAIL_DRY_RUN === 'true';

// ---- email transport ----
let transport = null;
if (DRY_RUN) {
  transport = nodemailer.createTransport({ jsonTransport: true });
  console.warn('[mail] MAIL_DRY_RUN=true: emails are printed here, NOT sent.');
} else if (process.env.SMTP_HOST && NOTIFY_EMAIL) {
  const port = Number(process.env.SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
} else {
  console.warn('[warn] Email is not configured (set NOTIFY_EMAIL and SMTP_* in .env). The contact form will show the email/WhatsApp fallback.');
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
      'upgrade-insecure-requests': process.env.HTTPS === 'true' ? [] : null
    }
  }
}));
app.use(express.json({ limit: '20kb' }));

// Optional CORS, only for the contact endpoint (when the frontend is hosted at a different address)
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

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const oneLine = s => s.replace(/[\r\n]+/g, ' ');

const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'Too many messages from this connection. Please try again later.' } });

app.post('/api/contact', contactLimiter, async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // hidden spam-trap field: bots fill it; pretend success
  const name = clean(b.name, 120), email = clean(b.email, 200), phone = clean(b.phone, 40), message = clean(b.message, 4000);
  const type = clean(b.type, 60) || 'Other';
  const errors = {};
  if (!name) errors.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address.';
  if (!message) errors.message = 'Please write a short message.';
  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

  if (!transport) return res.status(503).json({ ok: false, error: 'Email is not set up yet.' });
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || NOTIFY_EMAIL || 'website@localhost',
      to: NOTIFY_EMAIL || 'dry-run@localhost',
      replyTo: { name: oneLine(name), address: email }, // staff just press Reply
      subject: `Website enquiry (${oneLine(type)}) from ${oneLine(name)}`,
      text: `New message from the Chithu Foundation website\n\nName: ${name}\nEmail: ${email}\nPhone/WhatsApp: ${phone || '-'}\nGroup type: ${type}\n\n${message}\n`
    });
    if (DRY_RUN) console.log('[mail:dry-run]', info.message);
    res.json({ ok: true });
  } catch (err) {
    console.error('[mail] failed:', err.message);
    res.status(502).json({ ok: false, error: 'Could not send the email.' }); // the site then shows its email/WhatsApp fallback
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, emailConfigured: !!transport }));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
app.use(express.static(FRONTEND_DIR, { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ ok: false, error: 'Something went wrong.' }); });

app.listen(PORT, () => console.log(`Chithu Foundation running on http://localhost:${PORT}`));
