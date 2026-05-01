# PureGrid Outreach Hub — Tomorrow MVP

A mobile-friendly private CRM for simple outreach campaigns hosted on GitHub Pages.

## Admin password

`pg2180`

The app remembers the current device for 7 days.

## What works now

- Password gate
- Campaigns by niche: Solar, Beauty, Gyms, Dentists, etc.
- CSV upload and paste fallback import
- Business profiles
- Work queue
- Human email generation without scraper notes leaking into copy
- WhatsApp message generation
- Gmail compose links
- Batch selected export CSV
- Status tracking: New, Drafted, Sent, Replied, Follow Up, Not Interested, Bad Contact, Do Not Contact
- Full JSON backup and CSV export
- Mobile responsive layout

## Important limitation

This GitHub Pages version stores CRM data in the browser on the device you are using. Download JSON backups regularly. For true cross-device storage, connect Supabase later.

## Deployment

1. Upload all files to the root of your GitHub repo.
2. Go to Settings → Pages → Source: GitHub Actions.
3. Wait for Actions to go green.
4. Open the Pages URL.
5. Add DNS CNAME for `outreach.puregrid.es` pointing to your GitHub Pages hostname.

## Suggested daily workflow

1. Create/select a campaign.
2. Import the full CSV.
3. Go to Work Queue.
4. Open Gmail/WhatsApp, review, send manually.
5. Mark the lead Sent / Follow Up / Replied.
6. Export a backup at the end of each day.
