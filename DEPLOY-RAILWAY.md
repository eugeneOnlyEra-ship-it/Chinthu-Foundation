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

## 6. Staff accounts (Sign in with Google)
The main owner signs in with their **Google account** and adds everyone else. There is no shared password.

### a. Get a Google Client ID (about 10 minutes, free)
1. Go to https://console.cloud.google.com and create a project, e.g. "Chithu website".
2. **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform → Branding**): choose *External*,
   enter the app name (Chithu Foundation) and a support email, and save. Then, under **Audience**, press
   **Publish app** so anyone on the staff list can sign in (not only "test users").
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** (or **Clients → Create client**):
   type *Web application*. Under **Authorized JavaScript origins** add every address the site uses, e.g.
   `https://your-app.up.railway.app` and `https://www.chithufoundation.org` (no slash at the end).
   No redirect URI is needed.
4. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

### b. Add these Variables

| Name | Value |
|---|---|
| `ADMIN_EMAIL` | the main owner's Google email, e.g. `david.mponela@gmail.com` |
| `ADMIN_NAME` | optional: their name, e.g. `David Mponela` |
| `GOOGLE_CLIENT_ID` | the Client ID from step a |
| `SITE_URL` | optional: your final address, e.g. `https://www.chithufoundation.org`, used in share previews |

`SESSION_SECRET` is no longer required: the server creates one and keeps it on the Volume.

### c. First sign-in
1. Open the website, click **Staff sign in** in the footer (or go to `/login`), and press **Sign in with Google**
   with the `ADMIN_EMAIL` account.
2. Go to **Staff** and add people by the email of their Google account. They can sign in with Google straight away.
   You also get a one-time setup link (valid 7 days) for anyone who would rather use a password.
   **Owners** can add and remove staff; **admins** can post and edit activities.

The `ADMIN_EMAIL` account is the **main owner**: nobody can remove or demote it from the dashboard.
To hand over to someone else, change `ADMIN_EMAIL` in Variables; after the redeploy that person is the main owner
(the previous one stays an owner until someone removes them). Accounts are saved on the Volume (`/data/users.json`).

If you add a custom domain later, add it to **Authorized JavaScript origins** in Google Cloud too, or the Google
button will not work on that address.

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
