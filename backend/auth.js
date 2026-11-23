'use strict';
/* Staff accounts for posting activities.
   - The first owner is created from ADMIN_EMAIL + ADMIN_PASSWORD. They can change the password later.
     Changing ADMIN_PASSWORD on the server resets that owner's password (emergency recovery).
   - Owners can add other staff. A new person gets a one-time setup link to choose a password,
     and can also sign in with Google if GOOGLE_CLIENT_ID is set and their Google email matches.
   - Accounts are saved in DATA_DIR/users.json; passwords only as scrypt hashes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function setupAuth(app, { DATA_DIR, ON_RAILWAY, rateLimit }) {
  const FILE = path.join(DATA_DIR, 'users.json');
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
  const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || process.env.NOTIFY_EMAIL || 'info@chithufoundation.org').trim().toLowerCase();
  const ADMIN_NAME = process.env.ADMIN_NAME || 'Chithu Foundation';
  const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('chithu:' + ADMIN_PASSWORD).digest('hex');
  if (!process.env.SESSION_SECRET) console.warn('[warn] SESSION_SECRET is not set: using a value derived from ADMIN_PASSWORD. Set SESSION_SECRET for better security.');
  const envPrint = crypto.createHash('sha256').update('env:' + ADMIN_PASSWORD).digest('hex');
  const SESSION_HOURS = 12 * 24; // stay signed in for 12 days on a phone
  const INVITE_DAYS = 7;

  const now = () => new Date().toISOString();
  const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');
  const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k)));
  const newId = () => crypto.randomBytes(8).toString('hex');
  const cleanEmail = v => String(v || '').trim().toLowerCase().slice(0, 200);
  const cleanName = v => String(v || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 80);
  const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // ---- load / save ----
  let db = { envPrint: null, users: [] };
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(d.users)) db = d; }
  catch (e) { if (e.code !== 'ENOENT') console.error('[auth] could not read users.json:', e.message); }
  function save() { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 }); fs.renameSync(tmp, FILE); }

  async function hashPassword(pw) { const salt = crypto.randomBytes(16); return { passHash: (await scrypt(pw, salt)).toString('hex'), passSalt: salt.toString('hex') }; }
  async function checkPassword(u, pw) {
    if (!u || !u.passHash) return false;
    const k = await scrypt(pw, Buffer.from(u.passSalt, 'hex'));
    return crypto.timingSafeEqual(k, Buffer.from(u.passHash, 'hex'));
  }

  // ---- first owner from ADMIN_EMAIL / ADMIN_PASSWORD (and recovery when ADMIN_PASSWORD changes) ----
  const ready = (async () => {
    if (!ADMIN_PASSWORD) { if (!db.users.length) console.warn('[warn] ADMIN_PASSWORD is not set and there are no staff accounts: posting is switched off.'); return; }
    if (db.envPrint === envPrint && db.users.length) return;
    let owner = db.users.find(u => u.bootstrap) || db.users.find(u => u.email === ADMIN_EMAIL);
    const legacy = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'admin.json'), 'utf8')); } catch (_) { return null; } })();
    const creds = (!db.users.length && legacy && legacy.envPrint === envPrint && legacy.hash)
      ? { passHash: legacy.hash, passSalt: legacy.salt }       // keep a password changed with the previous version
      : await hashPassword(ADMIN_PASSWORD);
    if (owner) {
      Object.assign(owner, creds, { bootstrap: true, role: 'owner', disabled: false, ver: (owner.ver || 1) + 1, invite: null });
      console.log(`[auth] ADMIN_PASSWORD changed on the server: password for ${owner.email} reset to it.`);
    } else {
      owner = { id: newId(), email: ADMIN_EMAIL, name: ADMIN_NAME, role: 'owner', bootstrap: true, ...creds, google: false, ver: 1, createdAt: now(), invite: null };
      db.users.push(owner);
      console.log(`[auth] first owner account created: ${ADMIN_EMAIL} (password = ADMIN_PASSWORD; change it after signing in).`);
    }
    db.envPrint = envPrint; save();
    if (legacy) fs.rm(path.join(DATA_DIR, 'admin.json'), { force: true }, () => {});
  })();

  // ---- sessions: cookie = userId.version.expiry.signature ----
  const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
  const secure = () => (ON_RAILWAY || process.env.HTTPS === 'true') ? '; Secure' : '';
  function startSession(res, u) {
    const body = `${u.id}.${u.ver || 1}.${Date.now() + SESSION_HOURS * 3600e3}`;
    res.setHeader('Set-Cookie', `cf_session=${body}.${sign(body)}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; SameSite=Lax${secure()}`);
  }
  const endSession = res => res.setHeader('Set-Cookie', `cf_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure()}`);
  function currentUser(req) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)cf_session=([^;]+)/); if (!m) return null;
    const parts = m[1].split('.'); if (parts.length !== 4) return null;
    const [id, ver, exp, sig] = parts, body = `${id}.${ver}.${exp}`;
    const a = Buffer.from(sig), b = Buffer.from(sign(body));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || Number(exp) < Date.now()) return null;
    const u = db.users.find(x => x.id === id);
    return u && !u.disabled && String(u.ver || 1) === ver ? u : null;
  }
  const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, hasPassword: !!u.passHash, google: !!u.google, pending: !u.passHash && !u.google, firstOwner: !!u.bootstrap });
  // State-changing requests must come from this site (SameSite=Lax cookies + this Origin check block CSRF)
  function sameOrigin(req) {
    const o = req.headers.origin; if (!o) return true;
    try { return new URL(o).host === req.get('host'); } catch (_) { return false; }
  }
  const requireStaff = (req, res, next) => {
    const u = currentUser(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Please sign in again.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request blocked.' });
    req.user = u; next();
  };
  const requireOwner = (req, res, next) => requireStaff(req, res, () => req.user.role === 'owner' ? next() : res.status(403).json({ ok: false, error: 'Only owners can manage staff.' }));

  // ---- Google sign-in: verify the ID token Google gives the browser ----
  let jwks = null, jwksAt = 0;
  async function googleKey(kid, refresh) {
    if (refresh || !jwks || Date.now() - jwksAt > 3600e3) {
      const r = await fetch(process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs');
      if (!r.ok) throw new Error('Could not reach Google.');
      jwks = (await r.json()).keys || []; jwksAt = Date.now();
    }
    return jwks.find(k => k.kid === kid);
  }
  async function verifyGoogle(token) {
    const [h, p, s] = String(token || '').split('.'); if (!h || !p || !s) throw new Error('Bad token');
    const header = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url'));
    if (header.alg !== 'RS256') throw new Error('Bad token');
    const jwk = (await googleKey(header.kid)) || (await googleKey(header.kid, true)); if (!jwk) throw new Error('Unknown key');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + p), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
    if (!ok) throw new Error('Bad signature');
    if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('Wrong audience');
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Wrong issuer');
    if (!claims.exp || claims.exp * 1000 < Date.now() - 60e3) throw new Error('Expired');
    if (claims.email_verified !== true && claims.email_verified !== 'true') throw new Error('Email not verified');
    return { email: cleanEmail(claims.email), name: cleanName(claims.name) };
  }

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: 'Too many attempts. Try again in 15 minutes.' } });
  const pwProblem = pw => (String(pw).length < 10 ? 'Use at least 10 characters.' : String(pw).length > 200 ? 'Use 200 characters or fewer.' : null);
  const enabled = () => db.users.length > 0;
  const guard = fn => async (req, res, next) => { try { await ready; await fn(req, res, next); } catch (e) { next(e); } };

  // ---- sign in / out ----
  app.get('/api/auth/me', guard((req, res) => {
    const u = currentUser(req);
    res.json({ ok: true, enabled: enabled(), googleClientId: GOOGLE_CLIENT_ID || null, user: u ? publicUser(u) : null });
  }));
  app.post('/api/auth/login', limiter, guard(async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request blocked.' });
    const email = cleanEmail((req.body || {}).email), pw = String((req.body || {}).password || '');
    const u = db.users.find(x => x.email === email && !x.disabled);
    const ok = await checkPassword(u, pw);
    if (!ok) {
      if (u && !u.passHash) return res.status(401).json({ ok: false, error: u.google ? 'This account signs in with Google. Use the Google button.' : 'This account has no password yet. Use your setup link, or sign in with Google.' });
      return res.status(401).json({ ok: false, error: 'The email or password is not correct.' });
    }
    u.lastSignIn = now(); save(); startSession(res, u); res.json({ ok: true, user: publicUser(u) });
  }));
  app.post('/api/auth/google', limiter, guard(async (req, res) => {
    if (!GOOGLE_CLIENT_ID) return res.status(400).json({ ok: false, error: 'Google sign-in is not set up.' });
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request blocked.' });
    let g; try { g = await verifyGoogle((req.body || {}).credential); }
    catch (e) { console.warn('[auth] Google sign-in rejected:', e.message); return res.status(401).json({ ok: false, error: 'Google sign-in did not work. Try again.' }); }
    const u = db.users.find(x => x.email === g.email && !x.disabled);
    if (!u) return res.status(403).json({ ok: false, error: `${g.email} is not on the staff list. Ask an owner to add you.` });
    u.google = true; if (!u.name) u.name = g.name; u.invite = null; u.lastSignIn = now(); save();
    startSession(res, u); res.json({ ok: true, user: publicUser(u) });
  }));
  app.post('/api/auth/logout', (req, res) => { endSession(res); res.json({ ok: true }); });

  // ---- setup links (new staff, or a forgotten password) ----
  function inviteFor(token) {
    const h = sha256(token);
    return db.users.find(u => u.invite && u.invite.hash === h && Date.parse(u.invite.expires) > Date.now() && !u.disabled) || null;
  }
  app.get('/api/auth/invite/:token', guard((req, res) => {
    const u = inviteFor(req.params.token);
    u ? res.json({ ok: true, name: u.name, email: u.email }) : res.status(404).json({ ok: false, error: 'This setup link has expired or was already used. Ask an owner for a new one.' });
  }));
  app.post('/api/auth/invite/:token', limiter, guard(async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request blocked.' });
    const u = inviteFor(req.params.token);
    if (!u) return res.status(404).json({ ok: false, error: 'This setup link has expired or was already used. Ask an owner for a new one.' });
    const pw = String((req.body || {}).password || ''), bad = pwProblem(pw);
    if (bad) return res.status(400).json({ ok: false, errors: { password: bad } });
    Object.assign(u, await hashPassword(pw), { invite: null, ver: (u.ver || 1) + 1, lastSignIn: now() }); save();
    startSession(res, u); res.json({ ok: true, user: publicUser(u) });
  }));

  // ---- my account ----
  app.post('/api/auth/password', requireStaff, limiter, guard(async (req, res) => {
    const u = req.user, { current = '', next = '' } = req.body || {};
    if (u.passHash && !(await checkPassword(u, current))) return res.status(400).json({ ok: false, errors: { current: 'Your current password is not correct.' } });
    const bad = pwProblem(next); if (bad) return res.status(400).json({ ok: false, errors: { next: bad } });
    if (next === current) return res.status(400).json({ ok: false, errors: { next: 'Choose a password different from the current one.' } });
    Object.assign(u, await hashPassword(next), { ver: (u.ver || 1) + 1, passwordChangedAt: now() }); save();
    startSession(res, u); // other devices are signed out
    res.json({ ok: true, user: publicUser(u) });
  }));

  // ---- managing staff (owners only) ----
  function makeInvite(u) { const token = crypto.randomBytes(24).toString('base64url'); u.invite = { hash: sha256(token), expires: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString() }; return token; }
  const ownersLeft = () => db.users.filter(u => u.role === 'owner' && !u.disabled).length;
  app.get('/api/staff', requireOwner, guard((req, res) => res.json({ ok: true, staff: db.users.filter(u => !u.disabled).map(u => ({ ...publicUser(u), invitePending: !!(u.invite && Date.parse(u.invite.expires) > Date.now()), lastSignIn: u.lastSignIn || null })) })));
  app.post('/api/staff', requireOwner, guard((req, res) => {
    const name = cleanName((req.body || {}).name), email = cleanEmail((req.body || {}).email), role = (req.body || {}).role === 'owner' ? 'owner' : 'admin';
    const errors = {};
    if (!name) errors.name = 'Enter their name.';
    if (!validEmail(email)) errors.email = 'Enter a valid email address.';
    else if (db.users.some(u => u.email === email && !u.disabled)) errors.email = 'This person is already on the staff list.';
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });
    db.users = db.users.filter(u => !(u.email === email && u.disabled));
    const u = { id: newId(), email, name, role, google: false, ver: 1, createdAt: now(), addedBy: req.user.email, invite: null };
    const token = makeInvite(u); db.users.push(u); save();
    res.json({ ok: true, user: publicUser(u), token, days: INVITE_DAYS });
  }));
  app.patch('/api/staff/:id', requireOwner, guard((req, res) => {
    const u = db.users.find(x => x.id === req.params.id && !x.disabled); if (!u) return res.status(404).json({ ok: false, error: 'Not found.' });
    const role = (req.body || {}).role;
    if (!['owner', 'admin'].includes(role)) return res.status(400).json({ ok: false, error: 'Unknown role.' });
    if (u.role === 'owner' && role === 'admin' && ownersLeft() <= 1) return res.status(400).json({ ok: false, error: 'There must always be at least one owner.' });
    u.role = role; save(); res.json({ ok: true, user: publicUser(u) });
  }));
  app.post('/api/staff/:id/link', requireOwner, guard((req, res) => {
    const u = db.users.find(x => x.id === req.params.id && !x.disabled); if (!u) return res.status(404).json({ ok: false, error: 'Not found.' });
    const token = makeInvite(u); save(); res.json({ ok: true, token, days: INVITE_DAYS, user: publicUser(u) });
  }));
  app.delete('/api/staff/:id', requireOwner, guard((req, res) => {
    const u = db.users.find(x => x.id === req.params.id && !x.disabled); if (!u) return res.status(404).json({ ok: false, error: 'Not found.' });
    if (u.id === req.user.id) return res.status(400).json({ ok: false, error: 'You cannot remove yourself.' });
    if (u.role === 'owner' && ownersLeft() <= 1) return res.status(400).json({ ok: false, error: 'There must always be at least one owner.' });
    db.users = db.users.filter(x => x.id !== u.id); save(); res.json({ ok: true });
  }));

  return { requireStaff, currentUser, enabled, ready, GOOGLE_CLIENT_ID };
};
