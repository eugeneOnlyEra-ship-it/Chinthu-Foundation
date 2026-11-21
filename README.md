# Chithu Foundation website

```
chithu-foundation/
├── frontend/            the website: plain HTML/CSS/JS, no build step
│   ├── index.html       all pages, styles and scripts
│   ├── config.js        tells the site where the backend is
│   └── images/          logo and photos
└── backend/             Node.js server
    ├── server.js        contact API, staff login, database
    ├── admin/           staff inbox page (/admin)
    ├── data/            database file is created here (back it up)
    ├── package.json
    └── .env.example     settings template
```

## Quick start (runs both together)
1. Install Node.js **22.13 or newer** (nodejs.org, the LTS version).
2. In a terminal:
   ```
   cd backend
   npm install
   ```
3. Copy `.env.example` to `.env`. Set `ADMIN_PASSWORD` (long passphrase) and `SESSION_SECRET`
   (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
4. `npm start`
5. Open http://localhost:3000 (website) and http://localhost:3000/admin (staff inbox).

By default the backend also serves the `frontend/` folder, so one server runs everything.

## Hosting them separately (optional)
- Put `frontend/` on any static host (Netlify, GitHub Pages, cPanel...).
- Deploy `backend/` to a Node host (Render, Railway, Fly.io, a VPS).
- In `frontend/config.js` set `window.CHITHU_API = 'https://your-backend-address'`.
- In `backend/.env` set `ALLOWED_ORIGIN=https://your-website-address`.

## What the backend does
- `POST /api/contact` validates the contact form, stores it, and optionally emails a copy to `NOTIFY_EMAIL`
  (fill in the `SMTP_*` settings). Limited to 8 messages/hour per connection; hidden spam-trap field.
- `/admin` is a single password-protected page: read messages, mark handled, delete, export CSV.
  There are no user accounts, just one shared staff password.
- If the backend is unreachable, the site's form falls back to "Open in email / WhatsApp / Copy".

## Before going live
- Replace the example phone/email: search `frontend/index.html` for `const CONFIG=`.
- Use HTTPS and set `COOKIE_SECURE=true` (and `TRUST_PROXY=true` behind a proxy/load balancer).
- On hosts with temporary disks, attach a persistent volume (or set `DB_PATH`), or messages vanish on redeploy.
- Back up `backend/data/chithu.db`. It holds people's names, emails and phone numbers; keep the admin password
  private and delete messages you no longer need.
