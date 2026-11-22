# Chithu Foundation website

```
chithu-foundation/
├── frontend/            the website: plain HTML/CSS/JS, no build step
│   ├── index.html       all pages, styles and scripts
│   ├── config.js        tells the site where the backend is
│   └── images/          logo and photos
└── backend/             small Node.js server (kept for future features)
    ├── server.js        receives the contact form and emails it to the organisation
    ├── package.json
    └── .env.example     settings template
```

## How the contact form works
Visitor fills in the form → website sends it to the backend → backend **emails it to the organisation**
(`NOTIFY_EMAIL`). The visitor's address is set as Reply-To, so staff just press Reply in their normal inbox.
Nothing is stored on the server; the email is the record. If the email cannot be sent, the visitor sees
"Open in email / WhatsApp / Copy" buttons instead, so no message is lost.

## Run it
1. Install Node.js 18 or newer.
2. ```
   cd backend
   npm install
   cp .env.example .env
   ```
3. Open `.env` and fill in the email settings (see below).
4. `npm start`, then open http://localhost:3000

Try it without sending real email first: set `MAIL_DRY_RUN=true` in `.env`. The email is printed in the terminal.

## Email settings (in backend/.env)
- `NOTIFY_EMAIL`: the organisation address that should receive messages.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: the mailbox the server sends from.
  - **Gmail / Google Workspace:** `smtp.gmail.com`, port `587`. Turn on 2-Step Verification, then create an
    **App password** (Google Account → Security → App passwords) and use it as `SMTP_PASS`.
  - Zoho: `smtp.zoho.com` · Brevo: `smtp-relay.brevo.com`: use the SMTP details from their dashboard.
- `SMTP_FROM`: the sender name/address shown, for example `"Chithu Website <info@chithufoundation.org>"`.

Use a dedicated organisation mailbox for sending, and keep `.env` private (it holds the password).

## Hosting them separately (optional)
- `frontend/` on any static host (Netlify, GitHub Pages, cPanel...).
- `backend/` on a Node host (Render, Railway, Fly.io, a VPS).
- `frontend/config.js`: set `window.CHITHU_API = 'https://your-backend-address'`.
- `backend/.env`: set `ALLOWED_ORIGIN=https://your-website-address`.

## Before going live
- Replace the example phone/email in `frontend/index.html` (search for `const CONFIG=`).
- Use HTTPS; behind a proxy/load balancer set `TRUST_PROXY=true`.
- The form is limited to 8 messages per hour per connection and has a hidden spam-trap field.
