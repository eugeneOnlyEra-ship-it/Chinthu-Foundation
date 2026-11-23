'use strict';
/* Chithu Foundation: backend
   - serves the website from ../frontend, with proper link previews for sharing
   - POST /api/contact     emails contact-form messages to the organisation (nothing stored)
   - /api/posts            published activities (public)
   - /admin                password-protected editor for posting activities with photos */
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
      'script-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com/gsi/client'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://accounts.google.com/gsi/style'],
      'frame-src': ['https://accounts.google.com/gsi/'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'", 'https://accounts.google.com/gsi/'],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': (process.env.HTTPS === 'true' || ON_RAILWAY) ? [] : null
    }
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // needed by the Google sign-in pop-up
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
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

// ---- staff accounts + activities ----
const store = require('./store');
console.log('[store] activities and photos are saved in', store.DATA_DIR);
if (ON_RAILWAY && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.DATA_DIR) console.warn('[warn] No Railway Volume attached: posted activities, photos and staff accounts will be LOST on the next deploy. Attach a volume (see DEPLOY-RAILWAY.md).');
store.cleanOrphans(); setInterval(() => store.cleanOrphans(), 6 * 3600e3).unref();
const auth = require('./auth')(app, { DATA_DIR: store.DATA_DIR, ON_RAILWAY, rateLimit });
const { requireStaff } = auth;

app.get('/api/admin/session', (req, res) => res.json({ ok: !!auth.currentUser(req), enabled: auth.enabled(), categories: store.CATEGORIES }));
app.get('/api/admin/posts', requireStaff, (req, res) => res.json({ ok: true, posts: store.listAll() }));
app.get('/api/admin/posts/:id', requireStaff, (req, res) => { const p = store.getById(req.params.id); p ? res.json({ ok: true, post: p }) : res.status(404).json({ ok: false, error: 'Activity not found.' }); });
app.post('/api/admin/posts', requireStaff, (req, res) => { const r = store.create({ ...(req.body || {}), author: req.user.name }); r.errors ? res.status(400).json({ ok: false, errors: r.errors }) : res.json({ ok: true, post: r.post }); });
app.put('/api/admin/posts/:id', requireStaff, (req, res) => {
  const r = store.update(req.params.id, req.body || {});
  if (r.notFound) return res.status(404).json({ ok: false, error: 'Activity not found.' });
  r.errors ? res.status(400).json({ ok: false, errors: r.errors }) : res.json({ ok: true, post: r.post });
});
app.delete('/api/admin/posts/:id', requireStaff, (req, res) => store.remove(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ ok: false, error: 'Activity not found.' }));
app.post('/api/admin/uploads', requireStaff, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '6mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ ok: false, error: 'Choose a JPG, PNG or WebP photo.' });
  const url = store.saveUpload(req.body);
  url ? res.json({ ok: true, url }) : res.status(400).json({ ok: false, error: 'That file is not a JPG, PNG or WebP photo.' });
});

app.get('/api/posts', (req, res) => res.json({ ok: true, posts: store.listPublished(Math.min(100, Number(req.query.limit) || 100)) }));
app.get('/api/posts/:slug', (req, res) => {
  const p = store.getBySlug(req.params.slug);
  const staff = !!auth.currentUser(req);
  if (!p || (!p.published && !staff)) return res.status(404).json({ ok: false, error: 'Activity not found.' });
  const { id, ...pub } = p; res.json({ ok: true, post: staff ? p : pub, staff });
});

app.get('/healthz', (req, res) => res.json({ ok: true, emailConfigured: !!sendMail, provider: sendMail ? PROVIDER : null, postingEnabled: auth.enabled(), googleSignIn: !!auth.GOOGLE_CLIENT_ID, storage: store.DATA_DIR }));
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));

// ---- pages, with link previews (Open Graph) so shared links show a title, text and photo ----
app.use('/uploads', express.static(store.UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false }));
app.get('/admin', (req, res) => { res.setHeader('X-Robots-Tag', 'noindex'); res.sendFile(path.join(__dirname, 'admin', 'index.html')); });

const SITE = 'Chithu Foundation';
const PAGES = {
  '/': ['Chithu Foundation | Plastic off our land, organic waste back into the soil', 'An NGO in Karonga District, Malawi, keeping plastic bags and bottles off the land, separating bottles for recycling, and turning other waste into organic manure.', '/images/kids.jpg'],
  '/about': ['About us | Chithu Foundation', 'Who we are, our team and how Chithu Foundation is governed.', '/images/kids.jpg'],
  '/vision': ['Vision and mission | Chithu Foundation', 'A clean, resilient Malawi, built through disciplined stewardship and healthy soils.', '/images/volunteers.jpg'],
  '/institutions': ['Institutional clean-ups | Chithu Foundation', 'Clean-ups and plastic collection with schools, hospitals, markets and civic institutions in Karonga.', '/images/kids.jpg'],
  '/farmers': ['Farmer and Soil Hub | Chithu Foundation', 'How to turn organic waste into rich manure: our six-step compost guide and farmer programmes.', '/images/compost.jpg'],
  '/activities': ['Activities | Chithu Foundation', 'Clean-ups, plastic collection and composting activities by Chithu Foundation in Karonga District.', '/images/volunteers.jpg'],
  '/login': ['Staff sign in | Chithu Foundation', 'Sign in to post activities on the Chithu Foundation website.', '/images/kids.jpg'],
  '/contact': ['Contact us | Chithu Foundation', 'Partner with Chithu Foundation, nominate an institution for a clean-up, or volunteer.', '/images/kids.jpg']
};
const escA = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let shell = null, shellMtime = 0;
function getShell() {
  const f = path.join(FRONTEND_DIR, 'index.html'), m = fs.statSync(f).mtimeMs;
  if (!shell || m !== shellMtime) { shell = fs.readFileSync(f, 'utf8'); shellMtime = m; }
  return shell;
}
const origin = req => (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
function render(req, res, meta, status = 200) {
  const o = origin(req), url = o + (req.path === '/' ? '/' : req.path.replace(/\/$/, ''));
  const img = /^https?:/.test(meta.image) ? meta.image : o + meta.image;
  const tags = [
    `<link rel="canonical" href="${escA(url)}">`,
    `<meta property="og:site_name" content="${SITE}">`, `<meta property="og:type" content="${meta.type || 'website'}">`,
    `<meta property="og:title" content="${escA(meta.title)}">`, `<meta property="og:description" content="${escA(meta.desc)}">`,
    `<meta property="og:url" content="${escA(url)}">`, `<meta property="og:image" content="${escA(img)}">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ].join('\n');
  const html = getShell()
    .replace(/<title>[^<]*<\/title>/, `<title>${escA(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escA(meta.desc)}">`)
    .replace('</head>', tags + '\n</head>');
  res.status(status).type('html').setHeader('Cache-Control', 'no-cache'); res.send(html);
}
app.get(Object.keys(PAGES), (req, res) => { const [title, desc, image] = PAGES[req.path]; render(req, res, { title, desc, image }); });
app.get('/activities/:slug', (req, res) => {
  const p = store.getBySlug(req.params.slug);
  if (!p || !p.published) return render(req, res, { title: 'Activity not found | ' + SITE, desc: PAGES['/activities'][1], image: PAGES['/activities'][2] }, 404);
  const text = p.body.replace(/\s+/g, ' ');
  render(req, res, { type: 'article', title: `${p.title} | ${SITE}`, desc: text.length > 200 ? text.slice(0, 197) + '…' : text, image: p.images[0] ? p.images[0].url : '/images/volunteers.jpg' });
});
app.get('/sitemap.xml', (req, res) => {
  const o = origin(req), urls = Object.keys(PAGES).filter(p => p !== '/login').map(p => o + p).concat(store.listPublished().map(p => `${o}/activities/${p.slug}`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${escA(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
});
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /login\nDisallow: /api/\nSitemap: ${origin(req)}/sitemap.xml\n`));
app.use(express.static(FRONTEND_DIR, { index: false, maxAge: '1h' }));
app.use((req, res) => render(req, res, { title: 'Page not found | ' + SITE, desc: PAGES['/'][1], image: PAGES['/'][2] }, 404));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ ok: false, error: err.type === 'entity.too.large' ? 'That photo is too large.' : 'Something went wrong.' }); });

app.listen(PORT, '0.0.0.0', () => console.log(`Chithu Foundation running on http://localhost:${PORT}`));
