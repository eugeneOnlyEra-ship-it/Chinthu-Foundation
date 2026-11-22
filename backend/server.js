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

// ---- email ----
// EMAIL_PROVIDER: resend | brevo | smtp | dryrun (auto-detected from the keys you set if left empty).
// On Railway's Free/Trial/Hobby plans SMTP is blocked, so use resend or brevo (they send over HTTPS).
const ON_RAILWAY = !!(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_FROM || '';
const PROVIDER = (process.env.EMAIL_PROVIDER || (DRY_RUN ? 'dryrun' : process.env.RESEND_API_KEY ? 'resend'
  : process.env.BREVO_API_KEY ? 'brevo' : process.env.SMTP_HOST ? 'smtp' : '')).toLowerCase();

// Parse 'Name <addr@x>' or 'addr@x'
function parseAddr(v) { const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/); return m ? { name: m[1].trim(), email: m[2].trim() } : { name: '', email: String(v || '').trim() }; }

async function postJSON(url, headers, body) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`${url} answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json().catch(() => ({}));
  } finally { clearTimeout(t); }
}

let sendMail = null; // (msg: {to, replyTo:{name,email}, subject, text}) => Promise
if (PROVIDER === 'dryrun') {
  sendMail = async msg => console.log('[mail:dry-run] NOT sent:', JSON.stringify({ from: MAIL_FROM, ...msg }));
} else if (PROVIDER === 'resend' && process.env.RESEND_API_KEY) {
  sendMail = msg => postJSON(process.env.RESEND_API_URL || 'https://api.resend.com/emails', { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, {
    from: MAIL_FROM || 'Chithu Website <onboarding@resend.dev>', to: [msg.to],
    reply_to: msg.replyTo.name ? `${msg.replyTo.name} <${msg.replyTo.email}>` : msg.replyTo.email,
    subject: msg.subject, text: msg.text
  });
} else if (PROVIDER === 'brevo' && process.env.BREVO_API_KEY) {
  const from = parseAddr(MAIL_FROM || NOTIFY_EMAIL);
  sendMail = msg => postJSON(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', { 'api-key': process.env.BREVO_API_KEY }, {
    sender: { name: from.name || 'Chithu Foundation website', email: from.email }, to: [{ email: msg.to }],
    replyTo: msg.replyTo, subject: msg.subject, textContent: msg.text
  });
} else if (PROVIDER === 'smtp' && process.env.SMTP_HOST) {
  if (ON_RAILWAY) console.warn('[warn] SMTP is blocked on Railway Free/Trial/Hobby plans. Use EMAIL_PROVIDER=resend or brevo unless you are on Pro.');
  const port = Number(process.env.SMTP_PORT) || 587;
  const tr = require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  sendMail = msg => tr.sendMail({ from: MAIL_FROM || NOTIFY_EMAIL, to: msg.to, replyTo: msg.replyTo, subject: msg.subject, text: msg.text });
}
if (!NOTIFY_EMAIL && PROVIDER !== 'dryrun') sendMail = null;
console.log(sendMail ? `[mail] provider: ${PROVIDER}, delivering to ${NOTIFY_EMAIL || '(dry run)'}`
  : '[warn] Email is not configured (set NOTIFY_EMAIL and RESEND_API_KEY or BREVO_API_KEY). The contact form will show the email/WhatsApp fallback.');

const app = express();
if (process.env.TRUST_PROXY === 'true' || (ON_RAILWAY && process.env.TRUST_PROXY !== 'false')) app.set('trust proxy', 1); // Railway sits behind one proxy
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
      'upgrade-insecure-requests': (process.env.HTTPS === 'true' || ON_RAILWAY) ? [] : null
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

  if (!sendMail) return res.status(503).json({ ok: false, error: 'Email is not set up yet.' });
  try {
    await sendMail({
      to: NOTIFY_EMAIL,
      replyTo: { name: oneLine(name), email }, // staff just press Reply
      subject: `Website enquiry (${oneLine(type)}) from ${oneLine(name)}`,
      text: `New message from the Chithu Foundation website\n\nName: ${name}\nEmail: ${email}\nPhone/WhatsApp: ${phone || '-'}\nGroup type: ${type}\n\n${message}\n`
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[mail] failed:', err.message);
    res.status(502).json({ ok: false, error: 'Could not send the email.' }); // the site then shows its email/WhatsApp fallback
  }
});

app.get('/healthz', (req, res) => res.json({ ok: true, emailConfigured: !!sendMail, provider: sendMail ? PROVIDER : null }));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
app.use(express.static(FRONTEND_DIR, { extensions: ['html'], maxAge: '1h' }));
app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ ok: false, error: 'Something went wrong.' }); });

app.listen(PORT, '0.0.0.0', () => console.log(`Chithu Foundation running on http://localhost:${PORT}`));
