// Supabase Edge Function: send-batch
// Deploy with: supabase functions deploy send-batch
// Set secret: supabase secrets set RESEND_API_KEY=re_xxx

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_URL = 'https://api.resend.com/emails';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  try {
    if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY Supabase secret.');
    const { from, emails } = await req.json();
    if (!from || !Array.isArray(emails)) throw new Error('Expected { from, emails[] }.');
    if (emails.length > 50) throw new Error('Safety limit: max 50 emails per batch.');
    const results = [];
    for (const item of emails) {
      if (!item.to || !item.subject || !item.body) {
        results.push({ id: item.id, ok: false, error: 'Missing to/subject/body' });
        continue;
      }
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: [item.to],
          subject: item.subject,
          text: item.body,
          headers: { 'X-PureGrid-Outreach': 'true' }
        })
      });
      const data = await res.json().catch(() => ({}));
      results.push({ id: item.id, ok: res.ok, provider: 'resend', data, error: res.ok ? null : data?.message || res.statusText });
      await new Promise((r) => setTimeout(r, 350));
    }
    return json({ results });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 400);
  }
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
}
