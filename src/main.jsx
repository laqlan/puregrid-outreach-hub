import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import './styles.css';

const STORAGE_KEY = 'puregrid_outreach_hub_v1';
const CLOUD_TABLE = 'crm_states';
const AUTH_STORAGE_KEY = 'puregrid_outreach_hub_admin_auth_v1';
const ADMIN_PASSWORD_SHA256 = 'ed4ed4d5495a5d49ca9cab8c26012ae58596bda84d65bfb2a8666daccc22b6ed';
const AUTH_DAYS = 7;
const STATUS_OPTIONS = ['New', 'Ready', 'Drafted', 'Sent', 'Replied', 'Follow Up', 'Not Interested', 'Bad Contact', 'Do Not Contact'];
const DEFAULT_TEMPLATE = `Hi {{businessName}} team,

I came across {{website}} while looking at {{niche}} companies and noticed one thing I would tighten: {{humanAngle}}

I run PureGrid, and I help {{niche}} businesses turn their websites into clearer, faster quote-generation systems. I’ve got a live example here: {{demoLink}}

The idea would be to adapt that structure around your current brand, photos, services and logo direction rather than forcing you into a generic template.

Would it be worth me sending over a quick example of how {{businessName}} could look in this style?

Best,
{{senderName}}
{{senderSignature}}

If this is not relevant, reply “no thanks” and I won’t contact you again.`;

const DEFAULT_SAFE_EMAIL_TEMPLATE = `Hi {{businessName}} team,

I came across your site while looking at {{niche}} companies{{cityPhrase}}.

One thing I’d tighten is that {{humanAngle}}. I run PureGrid and build clean, fast website systems for service businesses that want more enquiries from their existing traffic.

I’ve put together a {{niche}}-specific example that could be adapted around your current brand, services, photos and logo direction.{{demoLine}}

Would it be worth me sending it over?

Best,
{{senderSignature}}

{{optOut}}`;

const DEFAULT_WHATSAPP = `Hi {{businessName}}, I’m {{senderName}} from PureGrid. I came across your site and thought the quote/contact journey could be made clearer for mobile visitors. I have a live {{niche}} website example here: {{demoLink}}. Would it be worth me sending a quick idea for how your site could look?`;

const DEFAULT_STATE = {
  settings: {
    supabaseUrl: '',
    supabaseAnonKey: '',
    senderName: 'Loki',
    senderEmail: 'loki@puregrid.es',
    senderSignature: 'Loki from PureGrid',
    defaultDailyLimit: 50,
    gmailMode: 'compose',
    resendFrom: 'PureGrid <loki@puregrid.es>',
    complianceLine: 'If this is not relevant, reply “no thanks” and I won’t contact you again.',
    deliverabilitySafeMode: true,
    includeDemoLinkFirstEmail: false,
    maxFirstEmailWords: 130,
    warmupSeedEmails: '',
    warmupDailyTarget: 5,
    warmupSubject: 'PureGrid email setup check',
    warmupBody: `Hey,\n\nI’m checking the new PureGrid workspace inbox is delivering properly.\n\nCould you reply when you see this and let me know whether it landed in your inbox or spam?\n\nThanks,\nLachlan`
  },
  campaigns: [],
  activeCampaignId: null,
  leads: [],
  logs: [],
  suppressions: [],
  warmupLogs: [],
  lastImport: null
};

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function countStateItems(state) {
  return (state?.campaigns?.length || 0) + (state?.leads?.length || 0) + (state?.logs?.length || 0) + (state?.warmupLogs?.length || 0);
}
function prepStateForCloud(state) {
  return {
    ...state,
    settings: { ...(state?.settings || {}) },
    cloudSavedAt: new Date().toISOString(),
    appVersion: 'locked-safe-warmup-supabase-sync-v1'
  };
}
function mergeRestoredState(remoteState, currentSettings = {}) {
  const merged = { ...DEFAULT_STATE, ...(remoteState || {}) };
  merged.settings = { ...DEFAULT_STATE.settings, ...(remoteState?.settings || {}) };
  if (!merged.settings.supabaseUrl && currentSettings.supabaseUrl) merged.settings.supabaseUrl = currentSettings.supabaseUrl;
  if (!merged.settings.supabaseAnonKey && currentSettings.supabaseAnonKey) merged.settings.supabaseAnonKey = currentSettings.supabaseAnonKey;
  return merged;
}

function clean(v) { return String(v ?? '').trim(); }
function lower(v) { return clean(v).toLowerCase(); }
function splitList(v) {
  return clean(v).split(/[;,|\n]+/).map(x => x.trim()).filter(Boolean);
}
function firstNonEmpty(row, names) {
  const keys = Object.keys(row || {});
  for (const n of names) {
    const k = keys.find(x => lower(x) === lower(n));
    if (k && clean(row[k])) return clean(row[k]);
  }
  const fuzzy = keys.find(k => names.some(n => lower(k).includes(lower(n))));
  return fuzzy ? clean(row[fuzzy]) : '';
}
function normalizeUrl(url) {
  const v = clean(url);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}
function extractDomain(website, fallback) {
  const source = normalizeUrl(website || fallback);
  try { return new URL(source).hostname.replace(/^www\./, ''); } catch { return clean(fallback).replace(/^www\./, ''); }
}
function inferBusinessName(row, domain) {
  const val = firstNonEmpty(row, ['Business Name', 'business_name', 'Company', 'Company Name', 'Name', 'Business']);
  if (val && lower(val) !== 'results') return val;
  const base = (domain || '').split('.')[0] || 'Business';
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function bestEmail(row) {
  const fields = ['Email', 'Primary Email', 'Decision Maker Emails', 'Sales/Commercial Emails', 'Admin Emails', 'All Emails Found'];
  for (const f of fields) {
    const raw = firstNonEmpty(row, [f]);
    const found = splitList(raw).find(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (found) return found;
  }
  return '';
}
function bestWhatsapp(row) {
  const raw = firstNonEmpty(row, ['WhatsApp', 'Whatsapp', 'Phone', 'Mobile', 'Telephone']);
  const found = splitList(raw).find(Boolean) || '';
  return found.replace(/[^+\d]/g, '');
}
function humanAngleFromNotes(notes, route, niche='solar') {
  const n = lower(notes + ' ' + route);
  if (!n.trim()) return `the site could make the next step clearer for visitors who are ready to ask for a quote`;
  if (n.includes('no clear') || n.includes('cta') || n.includes('call to action')) return 'the site could make the main quote/contact button more obvious, especially for mobile visitors';
  if (n.includes('slow') || n.includes('heavy') || n.includes('image')) return 'the site could likely feel faster and cleaner on mobile, especially around the first impression';
  if (n.includes('contact form') || n.includes('contact route') || n.includes('contacto')) return 'the contact path could be made more direct for visitors who are ready to request a quote';
  if (n.includes('mobile')) return 'the mobile journey could be made clearer and easier to use for people browsing from their phone';
  if (n.includes('old') || n.includes('dated') || n.includes('template')) return 'the design could be made sharper and more trust-building without losing the existing brand feel';
  if (n.includes('social') || n.includes('facebook') || n.includes('instagram')) return 'there is an opportunity to make the website work harder as the main conversion point instead of relying only on social channels';
  return `the site could make the offer and quote request journey clearer for people comparing ${niche} providers`;
}
function makeLead(row, campaignId) {
  const website = normalizeUrl(firstNonEmpty(row, ['Website', 'URL', 'Site', 'Web']));
  const domain = firstNonEmpty(row, ['Domain']) || extractDomain(website, '');
  const name = inferBusinessName(row, domain);
  const allEmails = firstNonEmpty(row, ['All Emails Found', 'Emails', 'Email']) || bestEmail(row);
  const notes = firstNonEmpty(row, ['Notes', 'Internal Notes', 'Recommended Outreach Route', 'Bottlenecks']);
  return {
    id: uid('lead'), campaignId,
    businessName: name,
    email: bestEmail(row),
    allEmails,
    phone: firstNonEmpty(row, ['Phone', 'Telephone', 'Mobile']),
    whatsapp: bestWhatsapp(row),
    website,
    domain,
    city: firstNonEmpty(row, ['City', 'Town', 'Location']),
    country: firstNonEmpty(row, ['Country']),
    facebook: firstNonEmpty(row, ['Facebook']),
    instagram: firstNonEmpty(row, ['Instagram']),
    linkedin: firstNonEmpty(row, ['LinkedIn', 'Linkedin']),
    contactForm: firstNonEmpty(row, ['Contact Form URL', 'Contact Form']),
    notes,
    humanAngle: humanAngleFromNotes(notes, firstNonEmpty(row, ['Recommended Outreach Route']), ''),
    status: 'New',
    lastContacted: '',
    replies: 0,
    selected: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
function merge(template, lead, campaign, settings) {
  const values = {
    businessName: lead.businessName || 'your team',
    website: lead.website || lead.domain || 'your website',
    domain: lead.domain || '',
    city: lead.city || '',
    country: lead.country || '',
    cityPhrase: lead.city ? ` in ${lead.city}` : '',
    niche: campaign?.niche || 'your industry',
    serviceOffer: campaign?.serviceOffer || 'a clearer, faster website',
    demoLink: campaign?.demoLink || '',
    demoLine: campaign?.demoLink ? `\n\nDemo: ${campaign.demoLink}` : '',
    humanAngle: lead.humanAngle || humanAngleFromNotes(lead.notes, '', campaign?.niche || ''),
    senderName: settings.senderName || 'Loki',
    senderEmail: settings.senderEmail || '',
    senderSignature: settings.senderSignature || 'Loki from PureGrid',
    optOut: settings.complianceLine || ''
  };
  return template.replace(/{{\s*([\w]+)\s*}}/g, (_, key) => values[key] ?? '');
}
function polishEmail(text) {
  // Free local polish: no paid API, no external request. Keeps it short and removes internal scraper language.
  const banned = [/Priority:\s*[^.;\n]+[.;]?/gi, /Business name inferred from domain[.;]?/gi, /Website tracking\/redirect removed[.;]?/gi, /Duplicate domain appears in source[.;]?/gi, /Email found on\s*[^.;\n]+[.;]?/gi, /MX not verified[.;]?/gi, /MX verified[.;]?/gi, /scrap(?:ed|ing|er)[^.;\n]*[.;]?/gi];
  let out = text;
  banned.forEach(rx => { out = out.replace(rx, ''); });
  out = out.replace(/one quick thing:\s*\|?/gi, 'one practical thing: ');
  out = out.replace(/\s+\|\s+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}
function gmailComposeUrl(to, subject, body) {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${p.toString()}`;
}
function whatsappUrl(phone, body) {
  const cleaned = String(phone || '').replace(/[^+\d]/g, '');
  if (!cleaned) return '';
  return `https://wa.me/${cleaned.replace(/^\+/, '')}?text=${encodeURIComponent(body)}`;
}
function csvEscape(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }
function exportCSV(rows) {
  const headers = ['Campaign','Business Name','Email','All Emails','WhatsApp','Website','Status','Last Contacted','Human Angle','Notes'];
  const lines = [headers.join(',')];
  for (const r of rows) lines.push([r.campaignName, r.businessName, r.email, r.allEmails, r.whatsapp, r.website, r.status, r.lastContacted, r.humanAngle, r.notes].map(csvEscape).join(','));
  return lines.join('\n');
}
function todayISO() { return new Date().toISOString().slice(0,10); }
function validEmailList(raw) {
  return splitList(raw).map(x => x.replace(/^mailto:/i,'').trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}
function warmupBodyFor(email, settings) {
  return clean(settings.warmupBody).replace(/{{\s*recipientEmail\s*}}/g, email).replace(/{{\s*senderName\s*}}/g, settings.senderName || 'Lachlan');
}

async function sha256Text(text) {
  const data = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function loadAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return false;
    const session = JSON.parse(raw);
    return Number(session.expiresAt || 0) > Date.now();
  } catch {
    return false;
  }
}
function saveAuthSession() {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    signedInAt: Date.now(),
    expiresAt: Date.now() + AUTH_DAYS * 24 * 60 * 60 * 1000
  }));
}
function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}
function AuthGate({ children }) {
  const [isAuthed, setIsAuthed] = useState(loadAuthSession);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const hash = await sha256Text(password);
      if (hash === ADMIN_PASSWORD_SHA256) {
        saveAuthSession();
        setIsAuthed(true);
      } else {
        setError('Wrong password. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (isAuthed) return children(() => { clearAuthSession(); setIsAuthed(false); });

  return <div className="auth-screen">
    <form className="auth-card" onSubmit={submit}>
      <div className="logo auth-logo">PG</div>
      <div className="eyebrow">Private admin</div>
      <h1>PureGrid Outreach Hub</h1>
      <p>Enter the admin password to access campaigns, contacts, outreach logs and sending tools. You will stay signed in on this device for {AUTH_DAYS} days.</p>
      <div className="field">
        <label>Admin password</label>
        <input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" />
      </div>
      {error && <div className="auth-error">{error}</div>}
      <button className="btn primary auth-button" disabled={busy || !password}>{busy ? 'Checking...' : 'Enter CRM'}</button>
      <div className="helper auth-helper">For stronger protection on a public domain, use Supabase Auth, Cloudflare Access, or server-side hosting. This page lock is a simple private gate for GitHub Pages.</div>
    </form>
  </div>;
}
function RootApp() {
  return <AuthGate>{(lock) => <App onLock={lock} />}</AuthGate>;
}

function App({ onLock }) {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState('home');
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [supabase, setSupabase] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [cloud, setCloud] = useState({ user: null, status: 'Local browser mode', lastSync: '', remoteUpdatedAt: '', loading: false });
  const fileInput = useRef(null);
  const cloudSaveTimer = useRef(null);
  const cloudBootedUser = useRef('');
  const cloudRestoring = useRef(false);

  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    if (state.settings.supabaseUrl && state.settings.supabaseAnonKey) {
      try { setSupabase(createClient(state.settings.supabaseUrl, state.settings.supabaseAnonKey)); } catch { setSupabase(null); }
    } else setSupabase(null);
  }, [state.settings.supabaseUrl, state.settings.supabaseAnonKey]);

  useEffect(() => {
    if (!supabase) {
      setCloud({ user: null, status: 'Local browser mode', lastSync: '', remoteUpdatedAt: '', loading: false });
      cloudBootedUser.current = '';
      return;
    }
    let alive = true;
    setCloud(prev => ({ ...prev, status: 'Checking Supabase session...' }));
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const user = data?.session?.user || null;
      setCloud(prev => ({ ...prev, user, status: user ? `Signed in as ${user.email}` : 'Supabase ready — not signed in' }));
      if (user && cloudBootedUser.current !== user.id) {
        cloudBootedUser.current = user.id;
        restoreFromCloud({ auto: true, userOverride: user });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      const user = session?.user || null;
      setCloud(prev => ({ ...prev, user, status: user ? `Signed in as ${user.email}` : 'Supabase ready — not signed in' }));
      if (user && cloudBootedUser.current !== user.id) {
        cloudBootedUser.current = user.id;
        restoreFromCloud({ auto: true, userOverride: user });
      }
    });
    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !cloud.user || cloudRestoring.current) return;
    clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = setTimeout(() => { saveToCloud({ auto: true }); }, 1400);
    return () => clearTimeout(cloudSaveTimer.current);
  }, [state, supabase, cloud.user?.id]);

  const activeCampaign = useMemo(() => state.campaigns.find(c => c.id === state.activeCampaignId) || state.campaigns[0] || null, [state.campaigns, state.activeCampaignId]);
  const leads = useMemo(() => activeCampaign ? state.leads.filter(l => l.campaignId === activeCampaign.id) : [], [state.leads, activeCampaign]);
  const selectedLead = useMemo(() => leads.find(l => l.id === selectedLeadId) || leads[0] || null, [leads, selectedLeadId]);
  const selectedLeads = leads.filter(l => l.selected && l.status !== 'Do Not Contact');
  const stats = {
    campaigns: state.campaigns.length,
    leads: leads.length,
    ready: leads.filter(l => l.email && !['Sent','Do Not Contact','Bad Contact'].includes(l.status)).length,
    sent: leads.filter(l => l.status === 'Sent').length,
    replies: leads.filter(l => l.status === 'Replied').length,
    follow: leads.filter(l => l.status === 'Follow Up').length
  };

  function updateState(patch) { setState(prev => ({ ...prev, ...patch })); }
  function updateSettings(patch) { setState(prev => ({ ...prev, settings: { ...prev.settings, ...patch } })); }
  function updateCampaign(id, patch) { setState(prev => ({ ...prev, campaigns: prev.campaigns.map(c => c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c) })); }
  function updateLead(id, patch) { setState(prev => ({ ...prev, leads: prev.leads.map(l => l.id === id ? { ...l, ...patch, updatedAt: new Date().toISOString() } : l) })); }
  function addLog(leadId, type, message) { setState(prev => ({ ...prev, logs: [{ id: uid('log'), leadId, campaignId: activeCampaign?.id, type, message, createdAt: new Date().toISOString() }, ...prev.logs] })); }
  function newCampaign() {
    const campaign = { id: uid('campaign'), name: 'New Campaign', niche: 'solar', serviceOffer: 'web design and lead-generation website system', demoLink: 'https://solar.puregrid.es', tone: 'warm, direct, plain-English, consultative', deliverabilitySafeMode: state.settings.deliverabilitySafeMode !== false, includeDemoLinkFirstEmail: state.settings.includeDemoLinkFirstEmail === true, emailTemplate: DEFAULT_TEMPLATE, whatsappTemplate: DEFAULT_WHATSAPP, dailyLimit: state.settings.defaultDailyLimit, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setState(prev => ({ ...prev, campaigns: [campaign, ...prev.campaigns], activeCampaignId: campaign.id }));
    setTab('campaigns');
  }
  function finishCSVImport(csvText, sourceName = 'CSV upload') {
    if (!activeCampaign) { alert('Create a campaign first.'); return; }
    if (!csvText || !String(csvText).trim()) { alert('The CSV looked empty. Try opening the file in Excel/Sheets and saving/downloading it again as CSV.'); return; }
    Papa.parse(String(csvText), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: h => String(h || '').replace(/^\uFEFF/, '').trim(),
      complete: ({ data, errors }) => {
        const rows = (data || []).filter(row => Object.values(row || {}).some(v => clean(v)));
        const imported = rows.map(row => makeLead(row, activeCampaign.id));
        const report = {
          fileName: sourceName,
          campaignId: activeCampaign.id,
          campaignName: activeCampaign.name,
          parsedRows: data?.length || 0,
          nonEmptyRows: rows.length,
          importedRows: imported.length,
          errors: (errors || []).slice(0, 5).map(e => e.message).join(' | '),
          importedAt: new Date().toISOString()
        };
        setState(prev => ({
          ...prev,
          leads: [...imported, ...prev.leads],
          logs: [{ id: uid('log'), campaignId: activeCampaign.id, type: 'Import', message: `Imported ${imported.length} rows from ${sourceName}`, createdAt: new Date().toISOString() }, ...prev.logs],
          lastImport: report
        }));
        setSelectedLeadId(imported[0]?.id || null);
        setTab('import');
        alert(`Import complete: ${imported.length} leads added to ${activeCampaign.name}.`);
      },
      error: (error) => alert(`CSV import failed: ${error.message || error}`)
    });
  }
  async function importCSV(file) {
    if (!activeCampaign) { alert('Create a campaign first.'); return; }
    if (!file) return;
    try {
      const csvText = await file.text();
      finishCSVImport(csvText, file.name || 'CSV upload');
    } catch (error) {
      alert(`CSV file could not be read from your device: ${error?.message || error}. Move the CSV to your Desktop or Downloads as a normal local file, then try again. You can also use the paste-box import on this page.`);
    }
  }
  function importCSVText(csvText) {
    finishCSVImport(csvText, 'Pasted CSV text');
  }
  function clearActiveCampaignLeads() {
    if (!activeCampaign) return alert('No active campaign selected.');
    const count = leads.length;
    if (!count) return alert('This campaign has no leads to clear.');
    if (!confirm(`Remove ${count} leads from ${activeCampaign.name}? This only clears this browser CRM, not your original CSV.`)) return;
    setState(prev => ({
      ...prev,
      leads: prev.leads.filter(l => l.campaignId !== activeCampaign.id),
      logs: [{ id: uid('log'), campaignId: activeCampaign.id, type: 'Clear', message: `Cleared ${count} leads from ${activeCampaign.name}`, createdAt: new Date().toISOString() }, ...prev.logs],
      lastImport: { fileName: 'Cleared campaign', campaignId: activeCampaign.id, campaignName: activeCampaign.name, parsedRows: 0, nonEmptyRows: 0, importedRows: 0, errors: '', importedAt: new Date().toISOString() }
    }));
    setSelectedLeadId(null);
  }
  function createSubject(lead) { return `Quick website idea for ${lead.businessName}`; }
  function emailForLead(lead) {
    const safeMode = activeCampaign?.deliverabilitySafeMode !== false && state.settings.deliverabilitySafeMode !== false;
    if (safeMode) {
      const includeDemo = activeCampaign?.includeDemoLinkFirstEmail === true || state.settings.includeDemoLinkFirstEmail === true;
      const safeCampaign = { ...activeCampaign };
      if (!includeDemo) safeCampaign.demoLink = '';
      return polishEmail(merge(DEFAULT_SAFE_EMAIL_TEMPLATE, lead, safeCampaign, state.settings));
    }
    return polishEmail(merge(activeCampaign?.emailTemplate || DEFAULT_TEMPLATE, lead, activeCampaign, state.settings));
  }
  function whatsappForLead(lead) { return polishEmail(merge(activeCampaign?.whatsappTemplate || DEFAULT_WHATSAPP, lead, activeCampaign, state.settings)); }
  function markLead(id, status) {
    updateLead(id, { status, lastContacted: ['Sent','Drafted'].includes(status) ? new Date().toISOString().slice(0,10) : state.leads.find(l=>l.id===id)?.lastContacted });
    addLog(id, status, `Marked as ${status}`);
  }
  function addWarmupLog(email, status, note='') {
    setState(prev => ({
      ...prev,
      warmupLogs: [{ id: uid('warmup'), email, status, note, date: todayISO(), createdAt: new Date().toISOString() }, ...(prev.warmupLogs || [])]
    }));
  }
  function toggleAllSelected(value) {
    setState(prev => ({ ...prev, leads: prev.leads.map(l => l.campaignId === activeCampaign?.id && l.email ? { ...l, selected: value } : l) }));
  }
  async function sendBatchViaSupabase() {
    if (!supabase) return alert('Connect Supabase first.');
    if (!selectedLeads.length) return alert('Select leads first.');
    if (selectedLeads.length > (activeCampaign?.dailyLimit || 50)) return alert(`Selected leads exceed this campaign daily limit of ${activeCampaign?.dailyLimit || 50}.`);
    const confirmation = confirm(`Send ${selectedLeads.length} emails using the Supabase/Resend function? This should only be used for legitimate business outreach with an opt-out line.`);
    if (!confirmation) return;
    const payload = selectedLeads.map(lead => ({ id: lead.id, to: lead.email, subject: createSubject(lead), body: emailForLead(lead), businessName: lead.businessName }));
    const { data, error } = await supabase.functions.invoke('send-batch', { body: { from: state.settings.resendFrom, emails: payload } });
    if (error) return alert(`Send failed: ${error.message}`);
    const sentIds = (data?.results || []).filter(r => r.ok).map(r => r.id);
    setState(prev => ({ ...prev, leads: prev.leads.map(l => sentIds.includes(l.id) ? { ...l, status: 'Sent', selected: false, lastContacted: new Date().toISOString().slice(0,10) } : l), logs: [...sentIds.map(id => ({ id: uid('log'), leadId: id, campaignId: activeCampaign?.id, type: 'Sent', message: 'Sent via Resend function', createdAt: new Date().toISOString() })), ...prev.logs] }));
    alert(`Done. Sent ${sentIds.length}/${selectedLeads.length}.`);
  }
  async function magicLink() {
    if (!supabase) return alert('Add Supabase URL and anon key first.');
    if (!authEmail || !authEmail.includes('@')) return alert('Enter the email address you want to use for Supabase login.');
    const { error } = await supabase.auth.signInWithOtp({ email: authEmail, options: { emailRedirectTo: window.location.href } });
    if (error) alert(error.message); else alert('Check your email for the Supabase login link. After signing in, this CRM will restore/save your cloud data automatically.');
  }
  async function saveToCloud({ auto = false } = {}) {
    if (auto && cloudRestoring.current) return;
    if (!supabase) { if (!auto) alert('Add Supabase URL and anon key first.'); return; }
    const user = cloud.user;
    if (!user) { if (!auto) alert('Sign in to Supabase first.'); return; }
    try {
      if (!auto) setCloud(prev => ({ ...prev, loading: true, status: 'Saving to Supabase...' }));
      const payload = prepStateForCloud(state);
      const { error } = await supabase.from(CLOUD_TABLE).upsert({
        user_id: user.id,
        email: user.email || authEmail || '',
        data: payload,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) throw error;
      const stamp = new Date().toLocaleString();
      setCloud(prev => ({ ...prev, loading: false, status: auto ? `Auto-saved to Supabase ${stamp}` : `Saved to Supabase ${stamp}`, lastSync: stamp }));
      if (!auto) alert('Saved to Supabase. You can now restore this CRM from another device after signing in.');
    } catch (error) {
      setCloud(prev => ({ ...prev, loading: false, status: `Cloud save failed: ${error.message || error}` }));
      if (!auto) alert(`Cloud save failed: ${error.message || error}`);
    }
  }
  async function restoreFromCloud({ auto = false, userOverride = null } = {}) {
    if (!supabase) { if (!auto) alert('Add Supabase URL and anon key first.'); return; }
    const user = userOverride || cloud.user;
    if (!user) { if (!auto) alert('Sign in to Supabase first.'); return; }
    try {
      cloudRestoring.current = true;
      setCloud(prev => ({ ...prev, loading: true, status: 'Checking Supabase cloud storage...' }));
      const { data, error } = await supabase.from(CLOUD_TABLE).select('data,updated_at,email').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!data?.data) {
        setCloud(prev => ({ ...prev, loading: false, status: 'No cloud backup found yet — current CRM will save automatically.' }));
        if (!auto && countStateItems(state)) await saveToCloud({ auto: false });
        return;
      }
      const remoteState = mergeRestoredState(data.data, state.settings);
      const localCount = countStateItems(state);
      const remoteCount = countStateItems(remoteState);
      const shouldRestore = !auto || localCount === 0 || remoteCount > localCount;
      if (shouldRestore) {
        setState(remoteState);
        saveState(remoteState);
        setCloud(prev => ({ ...prev, loading: false, status: `Restored ${remoteCount} cloud records from Supabase`, remoteUpdatedAt: data.updated_at || '' }));
        if (!auto) alert('Restored CRM data from Supabase.');
      } else {
        setCloud(prev => ({ ...prev, loading: false, status: `Cloud found ${remoteCount} records. Local has ${localCount}. Auto-restore skipped to avoid overwriting. Use Restore from Supabase if needed.`, remoteUpdatedAt: data.updated_at || '' }));
      }
    } catch (error) {
      setCloud(prev => ({ ...prev, loading: false, status: `Cloud restore failed: ${error.message || error}` }));
      if (!auto) alert(`Cloud restore failed: ${error.message || error}`);
    } finally {
      cloudRestoring.current = false;
    }
  }
  async function signOutCloud() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setCloud({ user: null, status: 'Signed out of Supabase', lastSync: '', remoteUpdatedAt: '', loading: false });
  }

  const nav = [
    ['home','Start'], ['campaigns','Campaigns'], ['import','Import'], ['queue','Work Queue'], ['blast','Batch'], ['profiles','Profiles'], ['warmup','Warmup'], ['settings','Settings']
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-row"><div className="logo">PG</div><div><div className="brand-title">PureGrid<br/>Outreach Hub</div><div className="brand-subtitle">CRM + campaigns</div></div></div>
      <div className="nav">{nav.map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={tab===id?'active':''}>{label}<span>›</span></button>)}</div>
      <div className="sidebar-card"><span className="dot"/> {cloud.user ? 'Cloud sync active' : supabase ? 'Cloud-ready mode' : 'Local browser mode'}<br/><br/>{cloud.user ? cloud.status : 'Data saves on this device. Connect Supabase for multi-device sync.'}<br/><br/><button className="btn small" onClick={onLock}>Lock admin</button></div>
    </aside>
    <main className="main">
      <div className="topbar">
        <div><div className="eyebrow">PureGrid private CRM</div><h1>{pageTitle(tab)}</h1><p>{pageDescription(tab)}</p></div>
        <div className="actions"><button className="btn primary" onClick={newCampaign}>+ New Campaign</button>{activeCampaign && <span className="badge blue">{activeCampaign.name}</span>}</div>
      </div>

      {tab === 'home' && <Home stats={stats} campaign={activeCampaign} setTab={setTab} newCampaign={newCampaign} />}
      {tab === 'campaigns' && <Campaigns campaigns={state.campaigns} activeId={activeCampaign?.id} setActive={(id)=>updateState({activeCampaignId:id})} updateCampaign={updateCampaign} newCampaign={newCampaign} />}
      {tab === 'import' && <ImportPanel activeCampaign={activeCampaign} fileInput={fileInput} importCSV={importCSV} importCSVText={importCSVText} leads={leads} lastImport={state.lastImport} clearActiveCampaignLeads={clearActiveCampaignLeads} />}
      {tab === 'queue' && <WorkQueue leads={leads} selectedLead={selectedLead} setSelectedLeadId={setSelectedLeadId} updateLead={updateLead} markLead={markLead} emailForLead={emailForLead} whatsappForLead={whatsappForLead} createSubject={createSubject} settings={state.settings} activeCampaign={activeCampaign} />}
      {tab === 'blast' && <Batch leads={leads} selectedLeads={selectedLeads} toggleAllSelected={toggleAllSelected} updateLead={updateLead} emailForLead={emailForLead} createSubject={createSubject} settings={state.settings} activeCampaign={activeCampaign} sendBatchViaSupabase={sendBatchViaSupabase} />}
      {tab === 'profiles' && <Profiles leads={leads} logs={state.logs} updateLead={updateLead} setSelectedLeadId={(id)=>{setSelectedLeadId(id); setTab('queue')}} />}
      {tab === 'warmup' && <Warmup settings={state.settings} updateSettings={updateSettings} warmupLogs={state.warmupLogs || []} addWarmupLog={addWarmupLog} />}
      {tab === 'settings' && <Settings settings={state.settings} updateSettings={updateSettings} supabase={supabase} cloud={cloud} authEmail={authEmail} setAuthEmail={setAuthEmail} magicLink={magicLink} saveToCloud={()=>saveToCloud({auto:false})} restoreFromCloud={()=>restoreFromCloud({auto:false})} signOutCloud={signOutCloud} exportData={() => ({ state, csv: exportCSV(state.leads.map(l => ({...l, campaignName: state.campaigns.find(c=>c.id===l.campaignId)?.name || ''}))), activeCsv: exportCSV(leads.map(l => ({...l, campaignName: activeCampaign?.name || ''}))) })} importState={(s)=>setState(s)} activeCampaign={activeCampaign} activeCount={leads.length} />}
      <input ref={fileInput} className="hidden-file" type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files?.[0]; if (f) await importCSV(f); e.target.value = ''; }} />
    </main>
    <div className="mobile-tabbar">{nav.map(([id,label]) => <button key={id} onClick={() => setTab(id)} className={tab===id?'active':''}>{label}</button>)}</div>
  </div>;
}
function pageTitle(tab) { return ({home:'Start Here',campaigns:'Campaign Pipelines',import:'Import Leads',queue:'Work Queue',blast:'Batch Outreach',profiles:'Business Profiles',warmup:'Warmup Planner',settings:'Settings & Cloud'})[tab] || 'Outreach Hub'; }
function pageDescription(tab) { return ({home:'The simple route: create a campaign, upload a CSV, review messages, send, then track replies and follow-ups.',campaigns:'Keep solar, beauty, gyms, dentists and other niches separated into their own outreach pipelines.',import:'Upload a CSV from any niche. The app converts it into campaign leads and keeps your work inside the CRM.',queue:'Work through one business at a time with a polished email and WhatsApp message ready to review.',blast:'Select a safe batch of contacts, preview the template output, then send manually or via the optional Resend function.',profiles:'See every business profile clearly: contacts, status, notes, activity and receptiveness.',warmup:'Plan and track real inbox warmup activity without storing Gmail passwords or running deceptive fake-thread automation.',settings:'Configure sender info, inbox safety, Supabase cloud sync and safe email sending options.'})[tab] || ''; }
function Home({stats,campaign,setTab,newCampaign}) { return <div className="grid">
  <div className="grid four"><Stat n={stats.campaigns} label="Campaigns"/><Stat n={stats.leads} label="Leads in active campaign"/><Stat n={stats.ready} label="Email-ready leads"/><Stat n={stats.sent} label="Sent"/></div>
  <div className="grid two">
    <div className="card"><div className="card-title">4-step workflow</div><div className="grid">
      <Step n="1" title="Create campaign" text="Solar, beauty, gyms, dentists — each niche gets its own profile and settings." action="Create" onClick={newCampaign}/>
      <Step n="2" title="Import CSV" text="Upload enriched leads. The CRM maps business names, emails, websites, WhatsApp and notes." action="Import" onClick={()=>setTab('import')}/>
      <Step n="3" title="Review queue" text="Handle one business at a time. The app writes a human email and WhatsApp message." action="Open Queue" onClick={()=>setTab('queue')}/>
      <Step n="4" title="Track outcomes" text="Mark sent, replied, follow-up, not interested, or do-not-contact." action="Profiles" onClick={()=>setTab('profiles')}/>
    </div></div>
    <div className="card"><div className="card-title">Current campaign</div>{campaign ? <><h2>{campaign.name}</h2><p><b>Niche:</b> {campaign.niche}</p><p><b>Offer:</b> {campaign.serviceOffer}</p><p><b>Demo:</b> {campaign.demoLink || 'No demo set'}</p><div className="actions"><button className="btn primary" onClick={()=>setTab('queue')}>Start outreach</button><button className="btn" onClick={()=>setTab('campaigns')}>Edit campaign</button></div></> : <><p>No campaign yet. Create one first.</p><button className="btn primary" onClick={newCampaign}>+ New Campaign</button></>}</div>
  </div>
  <div className="warning">This is built for controlled business outreach: review messages, include opt-out wording, respect suppression lists, and keep daily volume conservative.</div>
</div>; }
function Stat({n,label}) { return <div className="card stat"><div className="num">{n}</div><div className="label">{label}</div></div>; }
function Step({n,title,text,action,onClick}) { return <div className="card compact"><span className="badge">Step {n}</span><h3>{title}</h3><p>{text}</p><button className="btn small" onClick={onClick}>{action}</button></div>; }
function Campaigns({campaigns,activeId,setActive,updateCampaign,newCampaign}) { return <div className="grid">
  <div className="actions"><button className="btn primary" onClick={newCampaign}>+ New campaign</button></div>
  <div className="grid two">{campaigns.map(c => <div key={c.id} className="card">
    <div className="actions" style={{justifyContent:'space-between'}}><span className={c.id===activeId?'badge good':'badge'}>{c.id===activeId?'Active':'Campaign'}</span><button className="btn small" onClick={()=>setActive(c.id)}>Use this</button></div>
    <div className="field"><label>Campaign name</label><input value={c.name} onChange={e=>updateCampaign(c.id,{name:e.target.value})}/></div>
    <div className="field"><label>Niche</label><input value={c.niche} placeholder="solar, beauty, gyms..." onChange={e=>updateCampaign(c.id,{niche:e.target.value})}/></div>
    <div className="field"><label>Service offered</label><textarea value={c.serviceOffer} onChange={e=>updateCampaign(c.id,{serviceOffer:e.target.value})}/></div>
    <div className="field"><label>Live demo / proof link</label><input value={c.demoLink} onChange={e=>updateCampaign(c.id,{demoLink:e.target.value})}/></div>
    <div className="field"><label>Tone</label><input value={c.tone} onChange={e=>updateCampaign(c.id,{tone:e.target.value})}/></div>
    <div className="field"><label>Daily email limit</label><input type="number" value={c.dailyLimit} onChange={e=>updateCampaign(c.id,{dailyLimit:Number(e.target.value)})}/></div>
    <div className="notice"><b>Inbox safety</b><br/>Recommended for a new inbox: safe mode ON and demo link OFF for the first email.</div>
    <label className="inline-check"><input type="checkbox" checked={c.deliverabilitySafeMode !== false} onChange={e=>updateCampaign(c.id,{deliverabilitySafeMode:e.target.checked})}/> Deliverability Safe Mode: ask permission before sending demo, plain-text style, no raw scraper notes</label>
    <label className="inline-check"><input type="checkbox" checked={c.includeDemoLinkFirstEmail === true} onChange={e=>updateCampaign(c.id,{includeDemoLinkFirstEmail:e.target.checked})}/> Include demo link in first email</label>
    <details><summary>Email template</summary><textarea style={{minHeight:260}} value={c.emailTemplate} onChange={e=>updateCampaign(c.id,{emailTemplate:e.target.value})}/></details>
    <details><summary>WhatsApp template</summary><textarea style={{minHeight:160}} value={c.whatsappTemplate} onChange={e=>updateCampaign(c.id,{whatsappTemplate:e.target.value})}/></details>
  </div>)}</div>
</div>; }
function ImportPanel({activeCampaign,fileInput,importCSV,importCSVText,leads,lastImport,clearActiveCampaignLeads}) {
  const [pastedCsv, setPastedCsv] = useState('');
  const withEmail = leads.filter(l => l.email).length;
  const withWhatsapp = leads.filter(l => l.whatsapp).length;
  const missingEmail = leads.length - withEmail;
  return <div className="grid two">
  <div className="card"><div className="card-title">Import CSV into pipeline</div><p>Upload the full enriched CSV. The CRM imports every non-empty row into the active campaign — the daily email limit does not limit imports.</p><div className="notice">Active campaign: <b>{activeCampaign?.name || 'None'}</b></div><div className="actions"><button className="btn primary" disabled={!activeCampaign} onClick={()=>fileInput.current?.click()}>Upload full CSV</button><button className="btn danger" disabled={!activeCampaign || !leads.length} onClick={clearActiveCampaignLeads}>Clear this campaign first</button></div><p className="helper">If you accidentally imported a 50-row export, clear the campaign, then upload your original full enriched CSV again.</p></div>
  <div className="card"><div className="card-title">Import health check</div><div className="grid two"><Stat n={leads.length} label="Rows in this campaign"/><Stat n={withEmail} label="With email"/><Stat n={withWhatsapp} label="With WhatsApp"/><Stat n={missingEmail} label="Missing email"/></div>{lastImport && <div className="preview-box">Last import: {lastImport.fileName}
Parsed rows: {lastImport.parsedRows}
Non-empty rows: {lastImport.nonEmptyRows}
Imported rows: {lastImport.importedRows}
Campaign: {lastImport.campaignName}
Errors: {lastImport.errors || 'None'}</div>}</div>
  <div className="card"><div className="card-title">Paste CSV fallback</div><p>If the browser cannot read the uploaded file from your device, open the CSV, copy everything, paste it here, then import.</p><textarea className="code-input" value={pastedCsv} onChange={e=>setPastedCsv(e.target.value)} placeholder="Paste your CSV contents here, including the header row..."/><div className="actions"><button className="btn primary" disabled={!activeCampaign || !pastedCsv.trim()} onClick={()=>importCSVText(pastedCsv)}>Import pasted CSV</button><button className="btn" onClick={()=>setPastedCsv('')}>Clear paste box</button></div></div>
  <div className="card"><div className="card-title">Expected columns</div><p>Any of these names are accepted. You do not need perfect headers.</p><div className="preview-box">Business Name / Company / Name
Email / All Emails Found / Decision Maker Emails
Website / URL / Domain
Phone / WhatsApp
City / Country
Facebook / Instagram / LinkedIn
Notes / Recommended Outreach Route</div></div>
  <div className="card" style={{gridColumn:'1/-1'}}><div className="card-title">Preview of latest leads</div><p>Showing 10 rows only as a preview. Your total imported count is shown above.</p><RecentTable leads={leads.slice(0,10)}/></div>
</div>; }
function RecentTable({leads}) { if (!leads.length) return <p>No leads imported yet.</p>; return <div className="table-wrap"><table><thead><tr><th>Business</th><th>Email</th><th>Website</th><th>Status</th></tr></thead><tbody>{leads.map(l => <tr key={l.id}><td>{l.businessName}</td><td>{l.email}</td><td>{l.website}</td><td><span className="badge">{l.status}</span></td></tr>)}</tbody></table></div>; }
function WorkQueue({leads,selectedLead,setSelectedLeadId,updateLead,markLead,emailForLead,whatsappForLead,createSubject}) {
  if (!leads.length) return <div className="card"><p>No leads yet. Import a CSV first.</p></div>;
  return <div className="lead-layout">
    <div className="card"><div className="field"><label>Filter</label><select onChange={e=>{const f=e.target.value; const first=leads.find(l=>f==='All'||l.status===f); if(first) setSelectedLeadId(first.id)}}><option>All</option>{STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></div><div className="lead-list">{leads.map(l => <button key={l.id} className={`lead-item ${selectedLead?.id===l.id?'active':''}`} onClick={()=>setSelectedLeadId(l.id)}><div className="lead-name">{l.businessName}</div><div className="lead-meta"><span>{l.email || 'No email'}</span><span>{l.website || l.domain}</span><span className="badge">{l.status}</span></div></button>)}</div></div>
    <div className="card">{selectedLead && <><div className="actions" style={{justifyContent:'space-between'}}><div><h2>{selectedLead.businessName}</h2><p>{selectedLead.website}</p></div><select value={selectedLead.status} onChange={e=>markLead(selectedLead.id,e.target.value)}>{STATUS_OPTIONS.map(s=><option key={s}>{s}</option>)}</select></div>
      <div className="grid two"><div className="field"><label>Email</label><input value={selectedLead.email} onChange={e=>updateLead(selectedLead.id,{email:e.target.value})}/></div><div className="field"><label>WhatsApp</label><input value={selectedLead.whatsapp} onChange={e=>updateLead(selectedLead.id,{whatsapp:e.target.value})}/></div></div>
      <div className="field"><label>Human outreach angle</label><textarea value={selectedLead.humanAngle} onChange={e=>updateLead(selectedLead.id,{humanAngle:e.target.value})}/></div>
      <div className="grid two"><div><div className="card-title">Email preview</div><div className="preview-box">Subject: {createSubject(selectedLead)}\n\n{emailForLead(selectedLead)}</div><div className="actions" style={{marginTop:12}}><a className="btn primary" target="_blank" href={gmailComposeUrl(selectedLead.email, createSubject(selectedLead), emailForLead(selectedLead))}>Open Gmail</a><button className="btn" onClick={()=>navigator.clipboard.writeText(emailForLead(selectedLead))}>Copy</button><button className="btn good" onClick={()=>markLead(selectedLead.id,'Sent')}>Mark Sent</button></div></div>
      <div><div className="card-title">WhatsApp preview</div><div className="preview-box">{whatsappForLead(selectedLead)}</div><div className="actions" style={{marginTop:12}}>{selectedLead.whatsapp && <a className="btn primary" target="_blank" href={whatsappUrl(selectedLead.whatsapp, whatsappForLead(selectedLead))}>Open WhatsApp</a>}<button className="btn" onClick={()=>navigator.clipboard.writeText(whatsappForLead(selectedLead))}>Copy</button></div></div></div>
      <details style={{marginTop:16}}><summary>Internal notes</summary><div className="preview-box">{selectedLead.notes || 'No notes'}</div></details>
    </>}</div>
  </div>;
}
function Batch({leads,selectedLeads,toggleAllSelected,updateLead,emailForLead,createSubject,settings,activeCampaign,sendBatchViaSupabase}) {
  const ready = leads.filter(l => l.email && !['Do Not Contact','Bad Contact','Sent'].includes(l.status));
  return <div className="grid">
    <div className="card"><div className="actions" style={{justifyContent:'space-between'}}><div><div className="card-title">Batch outreach</div><p>Select contacts, preview messages, then use Gmail compose or optional Resend/Supabase sending.</p></div><div className="actions"><button className="btn" onClick={()=>toggleAllSelected(true)}>Select all ready</button><button className="btn" onClick={()=>toggleAllSelected(false)}>Clear</button><button className="btn primary" onClick={sendBatchViaSupabase}>Send selected via Resend</button></div></div><div className="warning">Selected: {selectedLeads.length}. Daily cap for this campaign: {activeCampaign?.dailyLimit || settings.defaultDailyLimit}. Keep volume low and only send relevant business outreach with opt-out wording.</div></div>
    <div className="table-wrap"><table><thead><tr><th>Select</th><th>Business</th><th>Email</th><th>Status</th><th>Preview</th><th>Gmail</th></tr></thead><tbody>{ready.map(l => <tr key={l.id}><td><input type="checkbox" checked={!!l.selected} onChange={e=>updateLead(l.id,{selected:e.target.checked})}/></td><td>{l.businessName}</td><td>{l.email}</td><td><span className="badge">{l.status}</span></td><td>{emailForLead(l).slice(0,130)}...</td><td><a className="btn small" target="_blank" href={gmailComposeUrl(l.email, createSubject(l), emailForLead(l))}>Open</a></td></tr>)}</tbody></table></div>
  </div>;
}
function Profiles({leads,logs,updateLead,setSelectedLeadId}) { return <div className="grid two">{leads.map(l => <div className="card" key={l.id}><div className="actions" style={{justifyContent:'space-between'}}><h3>{l.businessName}</h3><span className={`badge ${l.status==='Replied'?'good':l.status==='Follow Up'?'warn':l.status==='Not Interested'?'bad':'blue'}`}>{l.status}</span></div><p>{l.website}</p><p><b>Email:</b> {l.email || 'Missing'}<br/><b>WhatsApp:</b> {l.whatsapp || 'Missing'}<br/><b>City:</b> {l.city || '-'}</p><div className="field"><label>Receptiveness / profile notes</label><textarea value={l.notes} onChange={e=>updateLead(l.id,{notes:e.target.value})}/></div><div className="actions"><button className="btn primary" onClick={()=>setSelectedLeadId(l.id)}>Open in queue</button>{STATUS_OPTIONS.map(s=><button key={s} className="btn small" onClick={()=>updateLead(l.id,{status:s})}>{s}</button>)}</div><details><summary>Activity</summary>{logs.filter(x=>x.leadId===l.id).map(log=><p key={log.id}>{log.createdAt.slice(0,10)} — {log.message}</p>)}</details></div>)}</div>; }

function Warmup({settings, updateSettings, warmupLogs, addWarmupLog}) {
  const emails = validEmailList(settings.warmupSeedEmails || '');
  const today = todayISO();
  const sentToday = warmupLogs.filter(l => l.date === today && l.status === 'Sent').length;
  const inboxToday = warmupLogs.filter(l => l.date === today && l.status === 'Inbox').length;
  const spamToday = warmupLogs.filter(l => l.date === today && l.status === 'Spam').length;
  const target = Number(settings.warmupDailyTarget || 5);
  const queue = emails.slice(0, Math.max(target, 1));
  const subject = settings.warmupSubject || 'PureGrid email setup check';
  return <div className="grid two">
    <div className="card safety-card"><div className="card-title">Warmup mode — safe/manual</div><p>This tab helps you run a real warmup routine. It does not auto-send fake conversations in the background. Use Gmail compose, send normal emails, then mark where they landed.</p><div className="grid three"><Stat n={sentToday} label="Sent today"/><Stat n={inboxToday} label="Inbox confirmations"/><Stat n={spamToday} label="Spam reports"/></div><div className="notice"><b>Recommended now:</b> 5–10 real warmup emails/day, ask for natural replies, no links, no images, no fake business threads.</div></div>
    <div className="card"><div className="card-title">Warmup settings</div><div className="field"><label>Daily warmup target</label><input type="number" value={settings.warmupDailyTarget || 5} onChange={e=>updateSettings({warmupDailyTarget:Number(e.target.value)})}/></div><div className="field"><label>Warmup subject</label><input value={settings.warmupSubject || ''} onChange={e=>updateSettings({warmupSubject:e.target.value})}/></div><div className="field"><label>Warmup message</label><textarea value={settings.warmupBody || ''} onChange={e=>updateSettings({warmupBody:e.target.value})}/></div></div>
    <div className="card" style={{gridColumn:'1/-1'}}><div className="card-title">Warmup seed inboxes</div><p>Add only inboxes you own or people who agreed to help. One email per line.</p><textarea className="code-input" value={settings.warmupSeedEmails || ''} onChange={e=>updateSettings({warmupSeedEmails:e.target.value})} placeholder={'friend@gmail.com\nbackup@hotmail.com\nteam@example.com'}/><p className="helper">Detected valid addresses: {emails.length}. These sync to Supabase automatically after you sign in and cloud storage is connected.</p></div>
    <div className="card" style={{gridColumn:'1/-1'}}><div className="card-title">Today’s warmup queue</div>{!emails.length ? <p>Add seed inboxes above first.</p> : <div className="table-wrap"><table><thead><tr><th>Email</th><th>Open Gmail</th><th>Track result</th></tr></thead><tbody>{queue.map(email => { const body = warmupBodyFor(email, settings); return <tr key={email}><td>{email}</td><td><a className="btn small primary" target="_blank" href={gmailComposeUrl(email, subject, body)}>Open compose</a></td><td><div className="actions"><button className="btn small" onClick={()=>addWarmupLog(email,'Sent')}>Sent</button><button className="btn small good" onClick={()=>addWarmupLog(email,'Inbox')}>Inbox</button><button className="btn small danger" onClick={()=>addWarmupLog(email,'Spam')}>Spam</button><button className="btn small" onClick={()=>addWarmupLog(email,'Reply')}>Reply</button><button className="btn small" onClick={()=>addWarmupLog(email,'Not spam')}>Not spam</button></div></td></tr> })}</tbody></table></div>}</div>
    <div className="card" style={{gridColumn:'1/-1'}}><div className="card-title">Warmup log</div>{!warmupLogs.length ? <p>No warmup activity logged yet.</p> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Email</th><th>Status</th><th>Time</th></tr></thead><tbody>{warmupLogs.slice(0,80).map(l => <tr key={l.id}><td>{l.date}</td><td>{l.email}</td><td><span className="badge">{l.status}</span></td><td>{new Date(l.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</div>
  </div>;
}

function Settings({settings,updateSettings,supabase,cloud,authEmail,setAuthEmail,magicLink,saveToCloud,restoreFromCloud,signOutCloud,exportData,importState,activeCampaign,activeCount}) {
  function download(name, content, type='text/plain') { const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
  return <div className="grid two">
    <div className="card"><div className="card-title">Sender settings</div>{['senderName','senderEmail','senderSignature','resendFrom','complianceLine'].map(k=><div className="field" key={k}><label>{k}</label><input value={settings[k]} onChange={e=>updateSettings({[k]:e.target.value})}/></div>)}<div className="field"><label>Default daily limit</label><input type="number" value={settings.defaultDailyLimit} onChange={e=>updateSettings({defaultDailyLimit:Number(e.target.value)})}/></div></div>
    <div className="card safety-card"><div className="card-title">Inbox safety settings</div><p>These defaults are used for new campaigns and keep first-touch emails safer while the inbox warms up.</p><label className="inline-check"><input type="checkbox" checked={settings.deliverabilitySafeMode !== false} onChange={e=>updateSettings({deliverabilitySafeMode:e.target.checked})}/> Deliverability Safe Mode ON</label><label className="inline-check"><input type="checkbox" checked={settings.includeDemoLinkFirstEmail === true} onChange={e=>updateSettings({includeDemoLinkFirstEmail:e.target.checked})}/> Include demo link in first email</label><div className="field"><label>Max first email words</label><input type="number" value={settings.maxFirstEmailWords || 130} onChange={e=>updateSettings({maxFirstEmailWords:Number(e.target.value)})}/></div><div className="notice"><b>Recommended now:</b> Safe Mode ON, demo link OFF, plain text, no images, no tracking, daily limit 5–10.</div></div>
    <div className="card"><div className="card-title">Cloud storage: Supabase sync</div><p>Use this to continue the same CRM from desktop and phone. Once signed in, campaigns, leads, statuses, outreach logs, warmup logs and settings auto-save to Supabase.</p><div className="field"><label>Supabase URL</label><input value={settings.supabaseUrl} onChange={e=>updateSettings({supabaseUrl:e.target.value})} placeholder="https://xxxx.supabase.co"/></div><div className="field"><label>Supabase anon key</label><input type="password" value={settings.supabaseAnonKey} onChange={e=>updateSettings({supabaseAnonKey:e.target.value})}/></div><div className="field"><label>Supabase login email</label><input value={authEmail} onChange={e=>setAuthEmail(e.target.value)} placeholder="loki@puregrid.es"/></div><div className="notice"><b>Status:</b> {cloud?.status || (supabase ? 'Supabase ready' : 'Local browser mode')}<br/>{cloud?.user ? `Signed in: ${cloud.user.email}` : 'Not signed in to Supabase yet.'}{cloud?.lastSync ? <><br/>Last cloud save: {cloud.lastSync}</> : null}</div><div className="actions"><button className="btn primary" onClick={magicLink}>{supabase?'Send magic login link':'Save Supabase first'}</button><button className="btn" disabled={!cloud?.user || cloud?.loading} onClick={saveToCloud}>Save to Supabase now</button><button className="btn" disabled={!cloud?.user || cloud?.loading} onClick={restoreFromCloud}>Restore from Supabase</button>{cloud?.user && <button className="btn danger" onClick={signOutCloud}>Sign out cloud</button>}</div><div className="notice">Safe rule: store CRM data in Supabase. Do not store Gmail passwords or private API secrets in this browser app. Use Supabase Edge Function secrets for Resend/OpenAI later.</div></div>
    <div className="card"><div className="card-title">Backup</div><p>Download everything before changing hosting or browsers.</p><div className="actions"><button className="btn" onClick={()=>download('puregrid-outreach-backup.json', JSON.stringify(exportData().state,null,2),'application/json')}>Download full JSON backup</button><button className="btn" onClick={()=>download('puregrid-outreach-all-campaigns.csv', exportData().csv,'text/csv')}>Download all campaigns CSV</button><button className="btn primary" onClick={()=>download(`${(activeCampaign?.name || 'active-campaign').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-leads.csv`, exportData().activeCsv,'text/csv')}>Download active campaign CSV ({activeCount})</button></div><div className="divider"/><label className="btn">Import JSON backup<input className="hidden-file" type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0]; if(!f)return; const r=new FileReader(); r.onload=()=>importState(JSON.parse(r.result)); r.readAsText(f);}}/></label></div>
    <div className="card"><div className="card-title">Email sending options</div><p><b>Free/simple:</b> Gmail compose opens messages for review. <br/><b>Cloud:</b> deploy the included Supabase Edge Function and add your Resend API key as a Supabase secret.</p><div className="notice">Never put a Resend/OpenAI secret key directly in this browser app. Use the included Edge Function for secrets.</div></div>
  </div>;
}

createRoot(document.getElementById('root')).render(<RootApp />);
