# Setup checklist for outreach.puregrid.es

## Repo
- Create GitHub repo
- Upload all files
- Enable GitHub Actions Pages deployment

## DNS
- Add CNAME record: outreach -> your-github-username.github.io
- Set custom domain in repo Pages settings: outreach.puregrid.es

## Cloud storage
- Create Supabase project
- Run `supabase/schema.sql`
- Paste Supabase URL + anon key into app settings

## Email sending
Free/manual mode:
- Use Gmail compose buttons
- Review and send yourself

Cloud mode:
- Verify puregrid.es in Resend
- Add Resend API key as a Supabase secret
- Deploy `send-batch` Edge Function
- Keep batch limit around 50/day while the domain is new

## Campaign flow
1. New Campaign
2. Set niche, offer, demo URL and tone
3. Import CSV
4. Work through queue
5. Mark outcomes
6. Export backup weekly

## Admin password page

The app opens behind a simple admin password gate.

Default password: `pg2180`

The browser remembers the admin session for 7 days on that device. Use **Lock admin** in the sidebar to sign out early.

Because GitHub Pages is static hosting, this is only a client-side privacy gate. For stronger protection on `outreach.puregrid.es`, use Cloudflare Access, Supabase Auth, or server-side hosting.
