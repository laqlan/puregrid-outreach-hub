# Supabase Sync Setup for PureGrid Outreach Hub

This enables cloud storage so desktop and phone can share the same campaigns, lead statuses, warmup logs, and outreach history.

## 1. Create a Supabase project

Create a free Supabase project and copy:

- Project URL
- anon/public key

You will paste both into **Settings → Cloud storage: Supabase sync** inside the CRM.

## 2. Create the CRM storage table

In Supabase, open:

**SQL Editor → New query**

Paste the contents of:

```text
supabase/schema.sql
```

Then click **Run**.

This creates one protected table:

```text
crm_states
```

It stores the CRM state as JSON for the signed-in user only.

## 3. Enable email login

In Supabase:

**Authentication → Providers → Email**

Make sure Email provider is enabled.

For easiest testing, you can disable email confirmations only if you understand the security tradeoff. The normal setup uses magic links.

## 4. Add redirect URLs

In Supabase:

**Authentication → URL Configuration**

Add these to allowed redirect URLs:

```text
https://outreach.puregrid.es
https://outreach.puregrid.es/
https://laqlan.github.io/puregrid-outreach-hub/
```

## 5. Connect inside the CRM

Open:

```text
https://outreach.puregrid.es
```

Go to:

**Settings → Cloud storage: Supabase sync**

Paste:

- Supabase URL
- Supabase anon key
- Login email

Click **Send magic login link**.

After logging in:

- Existing cloud data restores automatically on a blank device.
- Local changes auto-save to Supabase.
- You can manually press **Save to Supabase now** or **Restore from Supabase**.

## What syncs

- Campaigns
- Leads / business profiles
- Lead statuses
- Outreach logs
- Warmup logs
- Settings
- Imported CSV state

## What does not sync

Do not store Gmail passwords, Google secrets, Resend secret keys, or OpenAI keys in this browser app. Use Supabase Edge Function secrets later for any sensitive API keys.
