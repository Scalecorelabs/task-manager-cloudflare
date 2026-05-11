# Cloudflare Task Manager

This is the Cloudflare-ready version of your Google Apps Script Task Manager.

## What changed

- `index.html` now uses `fetch('/api/...')` instead of `google.script.run`.
- `worker.js` replaces the Google Apps Script backend.
- Cloudflare D1 replaces Google Sheets.
- Resend replaces `MailApp.sendEmail`.
- Cloudflare Cron Triggers replace `ScriptApp` time triggers.

## Files

```txt
index.html       Frontend dashboard
worker.js        Cloudflare Worker API + scheduled reminder logic
schema.sql       D1 database schema
wrangler.toml    Cloudflare Worker config
package.json     Local/dev/deploy commands
_headers         Basic security headers
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

### 3. Create the D1 database

```bash
npm run db:create
```

Copy the returned `database_id` into `wrangler.toml`.

### 4. Create the database table

For local development:

```bash
npm run db:migrate:local
```

For deployed production database:

```bash
npm run db:migrate:remote
```

### 5. Add your Resend API key

```bash
npm run secret:resend
```

Paste your Resend API key when prompted.

Optional: set a verified sender email in Cloudflare Worker variables:

```txt
FROM_EMAIL=Task Manager <tasks@yourdomain.com>
```

If you do not set `FROM_EMAIL`, the Worker uses Resend's default onboarding sender.

### 6. Run locally

```bash
npm run dev
```

Then open the local Wrangler URL.

### 7. Deploy

```bash
npm run deploy
```

## API routes

```txt
GET    /api/tasks
POST   /api/tasks
PUT    /api/tasks/:id
DELETE /api/tasks/:id
POST   /api/tasks/:id/complete
POST   /api/tasks/:id/test-email
GET    /api/stats
POST   /api/reminders/run
POST   /api/admin/reset-email-flags
```

## Cron reminders

The Worker is configured to run reminders every 6 hours:

```toml
[triggers]
crons = ["0 */6 * * *"]
```

You can change that in `wrangler.toml`.

## Important notes

- This version does not use Google Sheets anymore.
- Existing Google Sheet tasks need to be exported to CSV and imported into D1 if you want to migrate old tasks.
- Email sending requires a valid Resend API key.
- For production use, add authentication before sharing the app publicly.
