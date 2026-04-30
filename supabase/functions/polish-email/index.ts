// Optional Supabase Edge Function placeholder for AI polishing.
// Keep this disabled until you choose a model/API provider.
// Do not put model API keys in the browser frontend.

Deno.serve(async (req) => {
  const { draft } = await req.json();
  const cleaned = String(draft || '')
    .replace(/Priority:\s*[^.;\n]+[.;]?/gi, '')
    .replace(/Business name inferred from domain[.;]?/gi, '')
    .replace(/Website tracking\/redirect removed[.;]?/gi, '')
    .replace(/Email found on\s*[^.;\n]+[.;]?/gi, '')
    .replace(/MX not verified[.;]?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return new Response(JSON.stringify({ text: cleaned }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
});
