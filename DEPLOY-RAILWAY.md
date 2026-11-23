# Deploying to Railway

The whole project runs as **one Railway service**: the Node backend serves the website, handles the
contact form, and stores posted activities and photos on a Railway Volume. Railway detects Node automatically from the root `package.json`, installs with `npm ci`,
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

## 5. Storage for activities and photos (required for posting)
Railway's normal disk is wiped on every deploy, so posts and photos need a **Volume**:
1. In your project, right-click the empty canvas (or press **Ctrl/Cmd + K**) and choose **Create volume** /
   **Add volume**, then attach it to the website service.
2. Set the **mount path** to `/data`.
3. Nothing else is needed: the server finds the volume through Railway's `RAILWAY_VOLUME_MOUNT_PATH` variable.
   The deploy logs show `[store] activities and photos are saved in /data`.

If the logs say `No Railway Volume attached`, posts will be lost on the next deploy.
A volume is also why this service should run as a single instance (the default).

## 6. Staff accounts
Add these **Variables**:

| Name | Value |
|---|---|
| `ADMIN_EMAIL` | the first owner's email, e.g. `info@chithufoundation.org` |
| `ADMIN_NAME` | how their name shows, e.g. `David Mponela` |
| `ADMIN_PASSWORD` | the first owner's **starting** password (a long passphrase) |
| `SESSION_SECRET` | a long random string (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `SITE_URL` | optional: your final address, e.g. `https://www.chithufoundation.org`, used in share previews |

Then:
1. Open the website, click **Staff sign in** in the footer (or go to `/login`), and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
2. Go to **My account** and change the password.
3. Go to **Staff** to add other people. Each new person gets a one-time setup link (valid 7 days) to send on WhatsApp.
   **Owners** can add and remove staff; **admins** can post and edit activities.

Accounts are saved on the Volume (`/data/users.json`, passwords only as secure hashes).
**Forgotten password:** an owner can send a "Password reset link" from the Staff page. If the first owner is locked
out, set a **new** `ADMIN_PASSWORD` in Variables; on restart, that owner's password is reset to it.

### Optional: Sign in with Google
1. Go to https://console.cloud.google.com, create a project (e.g. "Chithu website").
2. **APIs & Services → OAuth consent screen**: choose *External*, enter the app name (Chithu Foundation) and a support
   email, save, then **Publish app** so it is not limited to test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type *Web application*.
   Under **Authorized JavaScript origins** add your site address(es), e.g. `https://your-app.up.railway.app` and
   `https://www.chithufoundation.org`. No redirect URI is needed.
4. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) into a Railway Variable named `GOOGLE_CLIENT_ID`.

A "Sign in with Google" button then appears on `/login`. It only lets in people whose Google email is on the
Staff list; anyone else sees "not on the staff list".

## 7. Health check and restarts (recommended)
In the service **Settings**:
- **Healthcheck Path:** `/healthz`
- **Restart Policy:** On Failure

## 8. Get a web address
**Settings → Networking → Generate Domain** gives you a `*.up.railway.app` address.
For your own domain, choose **Custom Domain**, enter e.g. `chithufoundation.org` or `www.chithufoundation.org`,
and add the DNS record Railway shows you at your domain registrar. HTTPS is set up automatically.

## 9. Check it works
- Open `https://YOUR-ADDRESS/healthz`. It should show `"emailConfigured":true`, `"postingEnabled":true`, `"storage":"/data"` and, if set up, `"googleSignIn":true`.
- Sign in at `/login`, post a test activity with a photo, then redeploy and check it and your sign-in still work.
- Send a test message from the Contact page and confirm it arrives at info@chithufoundation.org.
  Pressing Reply in the inbox should reply to the visitor.
- If something fails, open the service's **Deployments → View logs**. Lines starting with `[mail]` explain
  email problems.

## Updating the site later
Edit files, then `git add . && git commit -m "Describe the change" && git push`. Railway redeploys automatically.
