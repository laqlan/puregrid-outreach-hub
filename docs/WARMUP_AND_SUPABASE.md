# PureGrid Outreach Hub — Locked Safe Warmup

This build locks in the inbox-safety version and adds a Warmup tab.

## Included

- Visible Inbox Safety settings
- Deliverability Safe Mode ON by default
- Demo link OFF by default for first-touch emails
- Warmup Planner tab
- Warmup seed inbox list
- Gmail compose links for manual warmup sends
- Warmup log: Sent, Inbox, Spam, Reply, Not spam
- Supabase fields in Settings for future phone/desktop sync

## Important security note

Do not store Gmail passwords, Google OAuth secrets, Resend API keys, or OpenAI API keys directly in the browser app.

Use Supabase Edge Function secrets for private API keys if you add automated sending or AI polishing later.

## Warmup policy

This app does not auto-send fake warmup chains. It supports real manual warmup activity and tracking so the account is warmed more safely.
