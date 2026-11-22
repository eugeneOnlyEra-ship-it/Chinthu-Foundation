# Deploying to Railway

The whole project runs as **one Railway service**: the Node backend serves the website and handles the
contact form. Railway detects Node automatically from the root `package.json`, installs with `npm ci`,
and starts with `npm start`. No config file is needed.

## 1. Put the project on GitHub
From the project folder (the one containing `package.json`, `backend/` and `frontend/`):
```
git init
git add .
git commit -m "Chithu Foundation website"
```
Create an empty repository on GitHub, then follow GitHub's instructions to `git remote add origin ...` and
`git push -u origin main`. `.gitignore` already keeps `node_modules` and `.env` out of the repository.

## 2. Create the service
1. On railway.com: **New Project → Deploy from GitHub repo**, and pick the repository.
2. Leave **Root Directory** empty (the repository root). Railway builds and deploys it.

## 3. Set up email (required for the contact form)
Railway blocks normal SMTP email on the Free, Trial and Hobby plans, so use an email service that sends
over HTTPS. Pick one:

**Option A: Resend** (Railway's recommendation)
1. Sign up at resend.com **using info@chithufoundation.org**, and create an API key.
2. Without verifying a domain, Resend only delivers to the address you signed up with. That is fine here,
   because every message goes to info@chithufoundation.org. Use `MAIL_FROM=Chithu Website <onboarding@resend.dev>`.
3. Later, to send from your own address, verify chithufoundation.org in Resend (it gives you DNS records)
   and change `MAIL_FROM` to e.g. `Chithu Website <website@chithufoundation.org>`.

**Option B: Brevo** (free plan, no DNS needed)
1. Sign up at brevo.com, then under **Senders** add and verify info@chithufoundation.org.
2. Create an API key under **SMTP & API → API Keys**.
3. Use `MAIL_FROM=info@chithufoundation.org`.

## 4. Add variables
In the service, open **Variables** and add:

| Name | Value |
|---|---|
| `NOTIFY_EMAIL` | `info@chithufoundation.org` |
| `RESEND_API_KEY` *or* `BREVO_API_KEY` | your key |
| `MAIL_FROM` | see step 3 |

Do **not** set `PORT`; Railway provides it. Railway redeploys when you save variables.

## 5. Health check and restarts (recommended)
In the service **Settings**:
- **Healthcheck Path:** `/healthz`
- **Restart Policy:** On Failure

## 6. Get a web address
**Settings → Networking → Generate Domain** gives you a `*.up.railway.app` address.
For your own domain, choose **Custom Domain**, enter e.g. `chithufoundation.org` or `www.chithufoundation.org`,
and add the DNS record Railway shows you at your domain registrar. HTTPS is set up automatically.

## 7. Check it works
- Open `https://YOUR-ADDRESS/healthz`. It should show `"emailConfigured":true` and your provider.
- Send a test message from the Contact page and confirm it arrives at info@chithufoundation.org.
  Pressing Reply in the inbox should reply to the visitor.
- If something fails, open the service's **Deployments → View logs**. Lines starting with `[mail]` explain
  email problems.

## Updating the site later
Edit files, then `git add . && git commit -m "Describe the change" && git push`. Railway redeploys automatically.
