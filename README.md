# PureGrid Outreach Hub

A mobile-friendly outreach CRM for PureGrid campaigns. It is built as a GitHub Pages-ready React app with optional Supabase cloud storage and optional Resend email sending via Supabase Edge Functions.

## What it does

- Create separate campaign pipelines: solar, beauty, gyms, dentists, etc.
- Upload a CSV and convert it into business profiles.
- Keep each business inside a clear profile with contact details, status, notes and activity.
- Generate human email and WhatsApp messages from templates.
- Open Gmail compose and WhatsApp click-to-chat for manual review.
- Select a controlled batch of leads and send via the optional Supabase/Resend function.
- Store locally by default; optionally connect Supabase for phone + desktop access.
- Includes GitHub Pages deployment workflow and `outreach.puregrid.es` CNAME.

## Important limitation

GitHub Pages hosts static frontend files only. It cannot safely store API secrets, run a database, or send emails by itself. This app therefore has two modes:

1. **Local browser mode**: data is stored in browser localStorage on one device.
2. **Cloud mode**: connect Supabase for cross-device data and deploy the included Edge Function if you want server-side email sending.

Never place secret keys such as Resend/OpenAI keys in the frontend code.

## Local test

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Deploy to GitHub Pages

1. Create a new private or public GitHub repo, for example `puregrid-outreach-hub`.
2. Upload/push these files.
3. In GitHub, go to **Settings → Pages**.
4. Set source to **GitHub Actions**.
5. Push to `main`; the workflow will build and deploy.
6. In your DNS provider, create a CNAME record:
   - Host/name: `outreach`
   - Target/value: your GitHub Pages hostname, usually `<username>.github.io`
7. In the repo Pages settings, set custom domain to `outreach.puregrid.es`.

## Supabase setup for cloud database

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/schema.sql`.
4. Copy your project URL and anon key.
5. In the app, open **Settings → Cloud storage** and paste them.
6. Enter your email and send yourself a magic login link.

The current app still saves local data first. The schema is included so this can be fully extended into Supabase persistence.

## Optional Resend email sending

1. Create a Resend account and verify your sending domain.
2. Create an API key.
3. Install Supabase CLI.
4. In the project folder, deploy the function:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set RESEND_API_KEY=re_xxxxxxxxx
supabase functions deploy send-batch
```

5. In the app, connect Supabase and use **Batch → Send selected via Resend**.

Safety limits are included: max 50 per batch, opt-out line in templates, and manual selection.

## CSV columns supported

The importer accepts common variations of:

- Business Name / Company / Name
- Email / All Emails Found / Decision Maker Emails
- Website / URL / Domain
- Phone / WhatsApp
- City / Country
- Facebook / Instagram / LinkedIn
- Notes / Recommended Outreach Route

## Mobile usage

Once hosted at `outreach.puregrid.es`, open it in your phone browser. On iPhone/Android, use “Add to Home Screen” to run it like a lightweight app.

## Compliance note

Use this as a controlled outreach workflow, not an uncontrolled spam blaster. Keep volumes conservative, contact one best address per business where possible, include opt-out wording, and maintain a do-not-contact list.

## Admin password page

The app opens behind a simple admin password gate.

Default password: `pg2180`

After a successful sign-in, the browser remembers the admin session for 7 days on that device. Use **Lock admin** in the sidebar to sign out early.

Important: because GitHub Pages is static hosting, this is a client-side gate. It keeps casual visitors out of the UI, but it is not the same as server-side authentication. For stronger protection on `outreach.puregrid.es`, put the app behind Cloudflare Access, Supabase Auth, or server-side hosting.

## Blank page fix
This repo includes `vite.config.js` with `base: './'` so GitHub Pages works before and after connecting the custom domain.

## Supabase cloud sync

This version includes real Supabase cloud storage for CRM state. It lets you import campaigns on desktop, continue on mobile, and keep lead statuses, outreach history, and warmup logs synced.

Setup summary:

1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. In Supabase Authentication URL Configuration, add `https://outreach.puregrid.es` as a redirect URL.
4. In the CRM, open Settings and paste your Supabase URL and anon key.
5. Send a magic link to your login email.
6. After login, the CRM auto-saves to Supabase and can restore from Supabase on another device.

Full guide: `docs/SUPABASE_SYNC_SETUP.md`.
