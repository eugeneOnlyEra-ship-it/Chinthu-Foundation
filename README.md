# Chithu Foundation website

```
chithu-foundation/
├── frontend/            the website: plain HTML/CSS/JS, no build step
│   ├── index.html       all pages, styles and scripts
│   ├── config.js        tells the site where the backend is
│   └── images/          logo and photos
├── package.json         root: install with `npm install`, run with `npm start`
├── DEPLOY-RAILWAY.md    deployment guide
├── HOW-TO-POST.md       guide for staff posting activities
└── backend/             Node.js server
    ├── server.js        pages + share previews, contact form email, activities API
    ├── store.js         saves activities and photos
    ├── auth.js          staff accounts, Google sign-in, setup links
    ├── admin/           the /admin editor for posting activities
    ├── package.json     backend dependencies
    └── .env.example     settings template
```

## Activities (posting news with photos)
Staff sign in from the website (**Staff sign in** in the footer, `/login`) with their own account (email and password, or
Google) and post activities from the dashboard at `/admin`: title, date, place, type, story and up to
12 photos (shrunk in the browser before upload). Each activity gets its own address, e.g.
`/activities/plastic-clean-up-at-karonga-market`, which shows a proper preview (title, text, cover photo) when shared
on WhatsApp, Facebook or LinkedIn. Every page has share buttons.

Posts are saved in `DATA_DIR/posts.json` and photos in `DATA_DIR/uploads/` (default `backend/data/`; on Railway the
attached Volume). Back up that folder. Staff instructions: **HOW-TO-POST.md**.

## Staff accounts
The first owner comes from `ADMIN_EMAIL` + `ADMIN_PASSWORD` and can change the password at `/admin` (My account).
Owners add other staff (roles: owner or admin); each gets a one-time setup link. Optional Google sign-in with
`GOOGLE_CLIENT_ID`. Accounts live in `DATA_DIR/users.json` (scrypt password hashes). Setting a new `ADMIN_PASSWORD`
resets the first owner's password on restart. Details: DEPLOY-RAILWAY.md, section 6.

## Page addresses
The site uses real addresses (`/about`, `/farmers`, `/activities`, `/contact`) served by the backend, which adds
share-preview tags to each page. Old `#about`-style links redirect automatically. Also served: `/sitemap.xml`,
`/robots.txt`, `/healthz`.

## How the contact form works
Visitor fills in the form, the website sends it to the backend, and the backend **emails it to the organisation**
(`NOTIFY_EMAIL`). The visitor's address is set as Reply-To, so staff just press Reply in their normal inbox.
Nothing is stored on the server; the email is the record. If the email cannot be sent, the visitor sees
"Open in email / WhatsApp / Copy" buttons instead, so no message is lost.

## Run it on your computer
1. Install Node.js 22 (`nvm use` reads `.nvmrc`).
2. In the project folder (where this README is):
   ```
   npm install
   cp backend/.env.example backend/.env
   ```
3. Open `backend/.env` and fill in the email settings (see below).
4. Set `ADMIN_PASSWORD` too if you want to try posting: sign in at http://localhost:3000/login with `ADMIN_EMAIL`
5. `npm start`, then open http://localhost:3000

Try it without sending real email first: set `MAIL_DRY_RUN=true` in `backend/.env`. The email is printed in the terminal.

## Deploying
See **DEPLOY-RAILWAY.md** for step-by-step Railway instructions.

## Email settings (backend/.env locally, "Variables" on Railway)
- `NOTIFY_EMAIL`: the organisation address that receives messages.
- One way to send:
  - `RESEND_API_KEY` (resend.com) or `BREVO_API_KEY` (brevo.com): send over HTTPS and work on every Railway plan.
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: e.g. Gmail with an App password. Blocked on Railway's
    Free/Trial/Hobby plans, but fine on your own computer or other hosts.
- `MAIL_FROM`: the sender shown on the email (see DEPLOY-RAILWAY.md for what to use with each service).

Keep `.env` and API keys private.

## Hosting them separately (optional)
- `frontend/` on any static host (Netlify, GitHub Pages, cPanel...).
- `backend/` on a Node host (Render, Railway, Fly.io, a VPS).
- `frontend/config.js`: set `window.CHITHU_API = 'https://your-backend-address'`.
- `backend/.env`: set `ALLOWED_ORIGIN=https://your-website-address`.

## Before going live
- Replace the example phone/email in `frontend/index.html` (search for `const CONFIG=`).
- Use HTTPS; behind a proxy/load balancer set `TRUST_PROXY=true`.
- The form is limited to 8 messages per hour per connection and has a hidden spam-trap field.
