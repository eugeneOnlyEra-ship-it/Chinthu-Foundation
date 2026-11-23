'use strict';
/* Activity posts and their photos, kept as files in DATA_DIR:
     DATA_DIR/posts.json      all posts
     DATA_DIR/uploads/*.jpg   photos
   On Railway, DATA_DIR must be a mounted Volume (it is picked up automatically), or posts vanish on redeploy. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const FILE = path.join(DATA_DIR, 'posts.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let posts = [];
try { posts = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(posts)) posts = []; }
catch (e) { if (e.code !== 'ENOENT') console.error('[store] could not read posts.json:', e.message); }

function save() { // write to a temp file, then rename, so a crash never leaves a half-written file
  const tmp = FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(posts, null, 2));
  fs.renameSync(tmp, FILE);
}

const CATEGORIES = ['Schools', 'Hospitals and health centres', 'Markets', 'Farmers and composting', 'Plastics and recycling', 'Community'];
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

function slugify(title) {
  const base = clean(title, 200).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'activity';
  let slug = base, n = 2;
  while (posts.some(p => p.slug === slug)) slug = `${base}-${n++}`;
  return slug;
}

const IMG_RE = /^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/;
function validate(input) {
  const errors = {};
  const title = clean(input.title, 140);
  const body = clean(input.body, 20000);
  const date = clean(input.date, 10);
  const location = clean(input.location, 120);
  const category = CATEGORIES.includes(input.category) ? input.category : 'Community';
  const images = (Array.isArray(input.images) ? input.images : []).slice(0, 12)
    .filter(i => i && IMG_RE.test(i.url))
    .map(i => ({ url: i.url, w: Math.max(0, Math.round(+i.w || 0)), h: Math.max(0, Math.round(+i.h || 0)), caption: clean(i.caption, 200) }));
  if (!title) errors.title = 'Give the activity a title.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) errors.date = 'Choose the date of the activity.';
  if (!body) errors.body = 'Write a few sentences about what happened.';
  return { errors, value: { title, body, date, location, category, images, published: input.published !== false } };
}

function summary(p) {
  const text = p.body.replace(/\s+/g, ' ');
  return { slug: p.slug, title: p.title, date: p.date, location: p.location, category: p.category,
    excerpt: text.length > 180 ? text.slice(0, 177).replace(/\s+\S*$/, '') + '…' : text,
    cover: p.images[0] || null, photos: p.images.length };
}
const byDate = (a, b) => (b.date.localeCompare(a.date)) || (b.createdAt.localeCompare(a.createdAt));

module.exports = {
  DATA_DIR, UPLOAD_DIR, CATEGORIES,
  listPublished: (limit) => posts.filter(p => p.published).sort(byDate).slice(0, limit || 1000).map(summary),
  listAll: () => posts.slice().sort(byDate).map(p => ({ ...summary(p), id: p.id, published: p.published, updatedAt: p.updatedAt })),
  getBySlug: (slug) => posts.find(p => p.slug === slug) || null,
  getById: (id) => posts.find(p => p.id === id) || null,
  create(input) {
    const { errors, value } = validate(input); if (Object.keys(errors).length) return { errors };
    const now = new Date().toISOString();
    const post = { id: crypto.randomBytes(8).toString('hex'), slug: slugify(value.title), ...value, createdAt: now, updatedAt: now };
    posts.push(post); save(); return { post };
  },
  update(id, input) {
    const post = posts.find(p => p.id === id); if (!post) return { notFound: true };
    const { errors, value } = validate(input); if (Object.keys(errors).length) return { errors };
    const removed = post.images.filter(i => !value.images.some(n => n.url === i.url));
    Object.assign(post, value, { updatedAt: new Date().toISOString() }); // slug never changes, so shared links keep working
    save(); removed.forEach(i => removeUpload(i.url)); return { post };
  },
  remove(id) {
    const i = posts.findIndex(p => p.id === id); if (i < 0) return false;
    const [post] = posts.splice(i, 1); save(); post.images.forEach(img => removeUpload(img.url)); return true;
  },
  saveUpload(buf) {
    const type = sniff(buf); if (!type) return null;
    const name = crypto.randomBytes(12).toString('hex') + '.' + type;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    return '/uploads/' + name;
  },
  cleanOrphans() { // photos uploaded but never saved in a post (e.g. editor closed), older than a day
    const used = new Set(posts.flatMap(p => p.images.map(i => path.basename(i.url))));
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      const full = path.join(UPLOAD_DIR, f);
      try { if (!used.has(f) && Date.now() - fs.statSync(full).mtimeMs > 864e5) fs.unlinkSync(full); } catch (_) {}
    }
  }
};

function removeUpload(url) {
  if (!IMG_RE.test(url) || posts.some(p => p.images.some(i => i.url === url))) return;
  fs.rm(path.join(UPLOAD_DIR, path.basename(url)), { force: true }, () => {});
}
function sniff(b) { // trust the file's bytes, not its name
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
  if (b.length > 12 && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
