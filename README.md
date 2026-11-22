# Chithu Foundation website

```
chithu-foundation/
├── frontend/            the website: plain HTML/CSS/JS, no build step
│   ├── index.html       all pages, styles and scripts
│   ├── config.js        tells the site where the backend is
│   └── images/          logo and photos
├── package.json         root: install with `npm install`, run with `npm start`
├── DEPLOY-RAILWAY.md    deployment guide
└── backend/             small Node.js server (kept for future features)
    ├── server.js        receives the contact form and emails it to the organisation
    ├── package.json     backend dependencies
    └── .env.example     settings template
```

## How the contact form works
Visitor fills in the form → website sends it to the backend → backend **emails it to the organisation**
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
4. `npm start`, then open http://localhost:3000

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
