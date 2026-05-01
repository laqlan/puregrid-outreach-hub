import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const ADMIN_PASSWORD = 'pg2180'
const AUTH_KEY = 'pg_outreach_auth_until'
const STORE_KEY = 'pg_outreach_hub_v1'
const DAY_MS = 24 * 60 * 60 * 1000

const uid = (prefix='id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`
const nowIso = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0,10)
const safe = (v='') => String(v ?? '').trim()
const lower = (v='') => safe(v).toLowerCase()
const clamp = (n,min,max) => Math.max(min, Math.min(max, n))

const defaultStore = () => ({
  version: 1,
  activeCampaignId: null,
  campaigns: [],
  settings: {
    senderName: 'Loki from PureGrid',
    agencyEmail: 'loki@puregrid.es',
    defaultOptOut: "If this isn’t relevant, reply ‘no thanks’ and I won’t contact you again.",
    maxBatch: 50,
  }
})

function loadStore(){
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return defaultStore()
    const parsed = JSON.parse(raw)
    return { ...defaultStore(), ...parsed, settings: { ...defaultStore().settings, ...(parsed.settings || {}) } }
  } catch {
    return defaultStore()
  }
}
function saveStore(store){ localStorage.setItem(STORE_KEY, JSON.stringify(store)) }
function downloadText(filename, text, type='text/plain;charset=utf-8'){
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(()=>URL.revokeObjectURL(url), 1000)
}
function csvEscape(v){
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"','""')}"` : s
}
function makeCsv(rows){
  const headers = Array.from(new Set(rows.flatMap(r => Object.keys(r))))
  return [headers.join(','), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(','))].join('\n')
}
function splitEmails(text=''){
  const out = new Set()
  const str = String(text || '').replaceAll('\n',';')
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  let m
  while((m = re.exec(str))){
    const email = m[0].toLowerCase().replace(/[).,;]+$/,'')
    if (!/(example|test|placeholder|yourname|sentry|wixpress|schema|png|jpg|jpeg|webp|gif)$/i.test(email)) out.add(email)
  }
  return [...out]
}
function splitLoose(text=''){
  return [...new Set(String(text || '').split(/[;,|\n]+/).map(s=>s.trim()).filter(Boolean))]
}
function phoneDigits(text=''){
  const s = safe(text).replace(/[^0-9+]/g,'')
  return s.length >= 7 ? s : ''
}
function toWaMe(number){
  let n = phoneDigits(number)
  if (!n) return ''
  if (n.startsWith('00')) n = '+' + n.slice(2)
  if (!n.startsWith('+') && n.length === 9) n = '+34' + n
  return n.replace(/[^0-9]/g,'')
}
function normalizeUrl(url=''){
  const s = safe(url)
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  if (/^[\w.-]+\.[a-z]{2,}/i.test(s)) return 'https://' + s
  return s
}
function domainFromWebsite(website='', domain=''){
  const d = safe(domain).replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]
  if (d) return d.toLowerCase()
  try { return new URL(normalizeUrl(website)).hostname.replace(/^www\./,'').toLowerCase() } catch { return '' }
}
function titleCaseFromDomain(domain=''){
  const root = safe(domain).split('.')[0].replace(/[-_]/g,' ')
  return root ? root.replace(/\b\w/g, c => c.toUpperCase()) : ''
}
function findVal(row, names){
  const keys = Object.keys(row)
  for (const want of names){
    const exact = keys.find(k => lower(k) === lower(want))
    if (exact && safe(row[exact])) return safe(row[exact])
  }
  for (const want of names){
    const fuzzy = keys.find(k => lower(k).includes(lower(want)))
    if (fuzzy && safe(row[fuzzy])) return safe(row[fuzzy])
  }
  return ''
}

function parseCSV(text){
  const src = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i=0; i<src.length; i++){
    const c = src[i]
    const n = src[i+1]
    if (inQuotes){
      if (c === '"' && n === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* ignore */ }
      else field += c
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row) }
  const cleanRows = rows.filter(r => r.some(v => safe(v)))
  if (!cleanRows.length) return { headers: [], data: [] }
  const headers = cleanRows[0].map((h,i) => safe(h) || `Column ${i+1}`)
  const data = cleanRows.slice(1).map(r => {
    const obj = {}
    headers.forEach((h,i)=> obj[h] = r[i] ?? '')
    return obj
  }).filter(obj => Object.values(obj).some(v => safe(v)))
  return { headers, data }
}

function rowToLead(row, campaignId){
  const website = normalizeUrl(findVal(row, ['Website','URL','Site','Web','Web Site']))
  const domain = domainFromWebsite(website, findVal(row, ['Domain']))
  const allEmailText = [findVal(row, ['Email','Primary Email','Best Email']), findVal(row, ['All Emails Found','Emails','Other Emails','Decision Maker Emails','Sales/Commercial Emails','Admin Emails'])].join('; ')
  const emails = splitEmails(allEmailText)
  const rawName = findVal(row, ['Business Name','Company','Company Name','Name','Business','Organisation','Organization'])
  const businessName = (rawName && rawName.toLowerCase() !== 'results') ? rawName : titleCaseFromDomain(domain)
  const phone = findVal(row, ['Phone','Telephone','Tel','Number','Mobile'])
  const whatsapp = findVal(row, ['WhatsApp','Whatsapp','WA']) || phone
  const notes = findVal(row, ['Notes','Internal Notes','Research Notes','Recommended Outreach Route','Bottlenecks'])
  const city = findVal(row, ['City','Town','Location'])
  const country = findVal(row, ['Country','Nation'])
  const socials = {
    facebook: findVal(row, ['Facebook']),
    instagram: findVal(row, ['Instagram']),
    linkedin: findVal(row, ['LinkedIn','Linkedin']),
    youtube: findVal(row, ['YouTube','Youtube']),
    tiktok: findVal(row, ['TikTok','Tiktok']),
    other: findVal(row, ['Other Social Links','Social Links'])
  }
  return {
    id: uid('lead'), campaignId,
    businessName: businessName || 'Unnamed business',
    email: emails[0] || findVal(row, ['Email']) || '',
    allEmails: emails.join('; '),
    phone: phone || '',
    whatsapp: whatsapp || '',
    website, domain, city, country,
    notes: notes || '',
    contactForm: findVal(row, ['Contact Form URL','Contact Form']),
    sourceUrls: findVal(row, ['Email Source URLs','External Source URLs','Source URLs']),
    socials,
    status: 'New',
    priority: findVal(row, ['Priority']) || '',
    lastContacted: '',
    createdAt: nowIso(), updatedAt: nowIso(),
    activities: [],
    raw: row
  }
}

function createCampaign(name='New Campaign'){
  return {
    id: uid('camp'),
    name,
    niche: 'solar',
    serviceOffer: 'cleaner, faster website systems that make it easier for visitors to understand the offer and request a quote',
    demoLink: 'https://solar.puregrid.es',
    tone: 'warm, plain-English, helpful, direct, not pushy',
    language: 'English',
    dailyEmailLimit: 50,
    deliverabilitySafeMode: true,
    includeDemoLinkFirstEmail: false,
    maxFirstEmailWords: 130,
    ctaStyle: 'Ask permission before sending the demo/example',
    createdAt: nowIso(),
    leads: []
  }
}
function statsFor(campaign){
  const leads = campaign?.leads || []
  return {
    total: leads.length,
    withEmail: leads.filter(l => safe(l.email)).length,
    withWhatsApp: leads.filter(l => toWaMe(l.whatsapp)).length,
    new: leads.filter(l => l.status === 'New').length,
    sent: leads.filter(l => l.status === 'Sent').length,
    replied: leads.filter(l => l.status === 'Replied').length,
    follow: leads.filter(l => l.status === 'Follow Up').length,
    noEmail: leads.filter(l => !safe(l.email)).length
  }
}
function humanAngle(lead){
  const n = lower(lead.notes)
  const parts = []
  if (/mobile|movil|móvil/.test(n)) parts.push('the mobile journey could be made clearer for people ready to ask for a quote')
  if (/cta|call to action|quote|form|contact form|contacto/.test(n)) parts.push('the route to request a quote could be made more direct')
  if (/slow|heavy|speed|performance|image/.test(n)) parts.push('the site could feel faster and cleaner, especially on mobile')
  if (/old|dated|template|layout|design/.test(n)) parts.push('the site could be modernised without losing the current brand feel')
  if (/whatsapp/.test(n)) parts.push('WhatsApp and quote enquiries could be brought forward more clearly')
  if (parts.length) return parts[0]
  if (lead.website) return 'the website could make the next step clearer for visitors who are comparing solar providers'
  return 'there may be room to make the enquiry journey clearer and more conversion-focused'
}
function sanitizeBusinessName(name=''){
  return safe(name).replace(/\b(SL|S\.L\.|Ltd|Limited|SA|S\.A\.)\b/g,'').trim() || safe(name)
}
function emailDraft(lead, campaign, settings){
  const business = sanitizeBusinessName(lead.businessName)
  const cityText = lead.city ? ` in ${lead.city}` : ''
  const angle = humanAngle(lead)
  const demo = campaign.demoLink || 'https://solar.puregrid.es'
  const service = campaign.serviceOffer || 'cleaner, faster website systems that make it easier for visitors to understand the offer and request a quote'
  const safeMode = campaign.deliverabilitySafeMode !== false
  const includeDemo = campaign.includeDemoLinkFirstEmail === true
  const subject = `Quick website idea for ${business}`
  let body

  if (campaign.language === 'Spanish'){
    if (safeMode){
      body = `Hola equipo de ${business},\n\nHe encontrado vuestra web mientras revisaba empresas de ${campaign.niche || 'solar'}${cityText}.\n\nUna cosa que ajustaría es que ${angle}. Llevo PureGrid y trabajo en webs claras y rápidas para empresas de servicios que quieren convertir más visitas en consultas reales.\n\nTengo un ejemplo pensado para empresas solares que podría adaptarse a vuestra marca, servicios, fotos y estilo actual.${includeDemo ? `\n\nDemo: ${demo}` : ''}\n\n¿Te parecería útil que te lo enviara?\n\nUn saludo,\n${settings.senderName || 'Loki from PureGrid'}\n\n${settings.defaultOptOut || ''}`
    } else {
      body = `Hola equipo de ${business},\n\nHe encontrado vuestra web mientras revisaba empresas de ${campaign.niche || 'solar'}${cityText} y vi una cosa práctica que se podría mejorar: ${angle}.\n\nLlevo PureGrid y estoy preparando ${service}.\n\nTengo una demo aquí:\n${demo}\n\nLa idea sería adaptar esta estructura a vuestra marca, fotos, servicios y logo actual, no forzar una plantilla genérica.\n\n¿Te parecería útil que te enviara un ejemplo rápido de cómo podría verse ${business} con este estilo?\n\nUn saludo,\n${settings.senderName || 'Loki from PureGrid'}\n${settings.defaultOptOut || ''}`
    }
  } else {
    if (safeMode){
      body = `Hi ${business} team,\n\nI came across your site while looking at ${campaign.niche || 'solar'} companies${cityText}.\n\nOne thing I’d tighten is that ${angle}. I run PureGrid and build clean, fast websites for service businesses that need more enquiries from their existing traffic.\n\nI’ve put together a ${campaign.niche || 'solar'}-specific example that could be adapted around your current brand, services, photos and logo direction.${includeDemo ? `\n\nDemo: ${demo}` : ''}\n\nWould it be worth me sending it over?\n\nBest,\n${settings.senderName || 'Loki from PureGrid'}\n\n${settings.defaultOptOut || ''}`
    } else {
      const site = lead.website || (lead.domain ? `https://${lead.domain}` : 'your website')
      body = `Hi ${business} team,\n\nI came across ${site} while looking at ${campaign.niche || 'solar'} companies and noticed one practical thing: ${angle}.\n\nI run PureGrid, and I’m putting together ${service}.\n\nI’ve got a live demo here:\n${demo}\n\nThe idea would be to adapt this kind of structure to your current brand, photos, services and logo direction, rather than forcing you into a generic template.\n\nWould it be worth me sending over a quick example of how ${business} could look in this style?\n\nBest,\n${settings.senderName || 'Loki from PureGrid'}\n${settings.defaultOptOut || ''}`
    }
  }
  return { subject, body }
}
function whatsappDraft(lead, campaign, settings){
  const business = sanitizeBusinessName(lead.businessName)
  const demo = campaign.demoLink || 'https://solar.puregrid.es'
  if (campaign.language === 'Spanish'){
    return `Hola, soy ${settings.senderName || 'Loki de PureGrid'}. He visto la web de ${business} y pensé que la ruta para pedir presupuesto podría hacerse más clara en móvil. Tengo una demo para empresas solares aquí: ${demo}. ¿Te puedo enviar una idea rápida adaptada a vuestra marca?`
  }
  return `Hi, it’s ${settings.senderName || 'Loki from PureGrid'}. I came across ${business} and thought the quote/request journey could be made clearer on mobile. I’ve got a solar website demo here: ${demo}. Would it be okay to send a quick idea adapted to your brand?`
}
function gmailUrl(to, subject, body){
  const p = new URLSearchParams({ view:'cm', fs:'1', to: to || '', su: subject || '', body: body || '' })
  return `https://mail.google.com/mail/?${p.toString()}`
}
function mailtoUrl(to, subject, body){
  return `mailto:${encodeURIComponent(to||'')}?subject=${encodeURIComponent(subject||'')}&body=${encodeURIComponent(body||'')}`
}
function waUrl(number, message){
  const n = toWaMe(number)
  if (!n) return ''
  return `https://wa.me/${n}?text=${encodeURIComponent(message||'')}`
}
function csvForLeads(leads, campaign, settings){
  return makeCsv(leads.map(l => {
    const draft = emailDraft(l, campaign, settings)
    return {
      Campaign: campaign.name,
      'Business Name': l.businessName,
      Email: l.email,
      'All Emails': l.allEmails,
      Phone: l.phone,
      WhatsApp: l.whatsapp,
      Website: l.website,
      Domain: l.domain,
      City: l.city,
      Country: l.country,
      Status: l.status,
      Subject: draft.subject,
      Body: draft.body,
      Notes: l.notes,
      'Last Contacted': l.lastContacted
    }
  }))
}
function addActivity(lead, type, note=''){
  return {
    ...lead,
    updatedAt: nowIso(),
    activities: [{ id: uid('act'), type, note, at: nowIso() }, ...(lead.activities || [])]
  }
}
const statuses = ['New','Drafted','Sent','Replied','Follow Up','Not Interested','Bad Contact','Do Not Contact']

function App(){
  const [authed, setAuthed] = useState(() => Number(localStorage.getItem(AUTH_KEY) || 0) > Date.now())
  const [store, setStore] = useState(loadStore)
  const [page, setPage] = useState('Start')
  const [toast, setToast] = useState('')
  const [selectedLeadId, setSelectedLeadId] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const activeCampaign = useMemo(() => store.campaigns.find(c => c.id === store.activeCampaignId) || store.campaigns[0] || null, [store])
  useEffect(()=>{ saveStore(store) }, [store])
  const updateStore = fn => setStore(prev => typeof fn === 'function' ? fn(prev) : fn)
  const notify = msg => { setToast(msg); setTimeout(()=>setToast(''), 3500) }
  const setCampaign = campaign => updateStore(s => ({...s, campaigns: s.campaigns.map(c => c.id === campaign.id ? campaign : c)}))
  const updateLead = (leadId, patchOrFn) => {
    updateStore(s => ({...s, campaigns: s.campaigns.map(c => c.id !== activeCampaign?.id ? c : ({...c, leads: c.leads.map(l => l.id === leadId ? (typeof patchOrFn === 'function' ? patchOrFn(l) : {...l, ...patchOrFn, updatedAt: nowIso()}) : l)})) }))
  }
  if (!authed) return <Login onLogin={()=>setAuthed(true)} />
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="logo">PG</div><div><b>PureGrid<br/>Outreach Hub</b><span>Private CRM</span></div></div>
      <button className="new-campaign" onClick={()=>setPage('Campaigns')}>+ New Campaign</button>
      {['Start','Campaigns','Import','Work Queue','Batch','Profiles','Settings'].map(p => <button key={p} className={`nav ${page===p?'active':''}`} onClick={()=>setPage(p)}>{p}<span>›</span></button>)}
      <div className="side-card">
        <small>Active campaign</small>
        <strong>{activeCampaign?.name || 'No campaign yet'}</strong>
        {activeCampaign && <div className="mini-stats"><span>{activeCampaign.leads.length} leads</span><span>{statsFor(activeCampaign).withEmail} emails</span></div>}
      </div>
      <button className="lock" onClick={()=>{localStorage.removeItem(AUTH_KEY); setAuthed(false)}}>Lock admin</button>
    </aside>
    <main className="main">
      {toast && <div className="toast">{toast}</div>}
      {page === 'Start' && <Start store={store} campaign={activeCampaign} setPage={setPage} />}
      {page === 'Campaigns' && <Campaigns store={store} updateStore={updateStore} setPage={setPage} notify={notify}/>} 
      {page === 'Import' && <ImportPage campaign={activeCampaign} setCampaign={setCampaign} notify={notify} setPage={setPage}/>} 
      {page === 'Work Queue' && <WorkQueue campaign={activeCampaign} settings={store.settings} updateLead={updateLead} selectedLeadId={selectedLeadId} setSelectedLeadId={setSelectedLeadId} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} notify={notify}/>} 
      {page === 'Batch' && <Batch campaign={activeCampaign} settings={store.settings} updateStore={updateStore} notify={notify}/>} 
      {page === 'Profiles' && <Profiles campaign={activeCampaign} query={query} setQuery={setQuery} updateLead={updateLead}/>} 
      {page === 'Settings' && <Settings store={store} updateStore={updateStore} campaign={activeCampaign} notify={notify}/>} 
    </main>
  </div>
}
function Login({onLogin}){
  const [pw,setPw] = useState('')
  const [error,setError] = useState('')
  const submit = e => { e.preventDefault(); if (pw === ADMIN_PASSWORD){ localStorage.setItem(AUTH_KEY, String(Date.now()+7*DAY_MS)); onLogin() } else setError('Wrong password') }
  return <div className="login-screen"><form className="login-card" onSubmit={submit}>
    <div className="logo big">PG</div><h1>PureGrid Outreach Hub</h1><p>Private CRM for campaign outreach.</p>
    <label>Admin password</label><input type="password" autoFocus value={pw} onChange={e=>setPw(e.target.value)} placeholder="Enter password" />
    {error && <div className="error">{error}</div>}
    <button className="primary">Enter CRM</button><small>Remembers this device for 7 days.</small>
  </form></div>
}
function Header({eyebrow,title,children}){return <div className="page-head"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children}</div>}
function Start({store,campaign,setPage}){
  const s = statsFor(campaign)
  return <><Header eyebrow="Start here" title="Run outreach without getting lost"><button className="primary" onClick={()=>setPage(campaign?'Import':'Campaigns')}>{campaign?'Import leads':'Create campaign'}</button></Header>
    <div className="grid four"><Stat label="Campaigns" value={store.campaigns.length}/><Stat label="Active leads" value={s.total}/><Stat label="With email" value={s.withEmail}/><Stat label="Sent" value={s.sent}/></div>
    <div className="card steps"><h2>Simple workflow</h2>
      <div className="step"><b>1</b><div><strong>Create a campaign</strong><p>Solar, beauty, gyms, dentists — each niche gets its own pipeline.</p></div><button onClick={()=>setPage('Campaigns')}>Go</button></div>
      <div className="step"><b>2</b><div><strong>Import your full CSV</strong><p>The CRM turns each row into a business profile with email, WhatsApp, socials and notes.</p></div><button onClick={()=>setPage('Import')}>Go</button></div>
      <div className="step"><b>3</b><div><strong>Work the queue</strong><p>Review one business at a time, open Gmail/WhatsApp, then mark the status.</p></div><button onClick={()=>setPage('Work Queue')}>Go</button></div>
      <div className="step"><b>4</b><div><strong>Export backups</strong><p>Download the full CRM backup whenever you want. No coding required.</p></div><button onClick={()=>setPage('Settings')}>Go</button></div>
    </div>
    <div className="notice"><b>Tomorrow-ready mode:</b> this version stores data in your browser and works on GitHub Pages. For true multi-device shared storage, connect a backend later; use exports as your backup today.</div>
  </>
}
function Stat({label,value}){return <div className="stat"><span>{label}</span><strong>{value}</strong></div>}
function Campaigns({store,updateStore,setPage,notify}){
  const [name,setName] = useState('Solar Spain')
  const create = () => {
    const c = createCampaign(name || 'New Campaign')
    updateStore(s => ({...s, activeCampaignId: c.id, campaigns: [c, ...s.campaigns]}))
    notify(`Campaign created: ${c.name}`); setPage('Import')
  }
  return <><Header eyebrow="Campaigns" title="Separate every niche into its own pipeline" />
    <div className="grid two"><div className="card"><h2>Create campaign</h2><label>Campaign name</label><input value={name} onChange={e=>setName(e.target.value)} /><button className="primary" onClick={create}>Create campaign</button></div>
    <div className="card"><h2>Your campaigns</h2>{store.campaigns.length===0 && <p>No campaigns yet.</p>}{store.campaigns.map(c => {const st=statsFor(c); return <div key={c.id} className="campaign-row"><div><strong>{c.name}</strong><p>{st.total} leads · {st.withEmail} emails · {st.sent} sent</p></div><button onClick={()=>{updateStore(s=>({...s, activeCampaignId:c.id})); notify(`Selected ${c.name}`)}}>{store.activeCampaignId===c.id?'Active':'Select'}</button></div>})}</div></div>
  </>
}
function ImportPage({campaign,setCampaign,notify,setPage}){
  const [paste,setPaste] = useState('')
  const [last,setLast] = useState(null)
  const fileRef = useRef(null)
  if (!campaign) return <Empty title="Create a campaign first" button="Go to Campaigns" onClick={()=>setPage('Campaigns')} />
  const runImport = (text, source='pasted CSV') => {
    const parsed = parseCSV(text)
    const leads = parsed.data.map(r => rowToLead(r, campaign.id)).filter(l => l.businessName || l.email || l.website)
    const newCampaign = {...campaign, leads: [...campaign.leads, ...leads]}
    setCampaign(newCampaign)
    setLast({source, headers: parsed.headers.length, parsed: parsed.data.length, imported: leads.length, at: new Date().toLocaleString()})
    notify(`Imported ${leads.length} leads into ${campaign.name}`)
  }
  const onFile = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      runImport(text, file.name)
    } catch (err) {
      notify('File upload failed. Use the paste import box instead.')
      setLast({source:file.name, parsed:0, imported:0, error: String(err.message || err), at: new Date().toLocaleString()})
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const clear = () => { if(confirm(`Clear all leads from ${campaign.name}?`)){ setCampaign({...campaign, leads: []}); setLast({source:'clear', parsed:0, imported:0, at:new Date().toLocaleString(), error:'Campaign cleared'}); notify('Campaign cleared') } }
  const st = statsFor(campaign)
  return <><Header eyebrow="Import" title="Import full CSV into active campaign"><span className="pill">{campaign.name}</span></Header>
    <div className="grid two"><div className="card"><h2>Option A: upload CSV</h2><p>Use a normal local file from Desktop or Downloads. If Windows blocks it, use Option B.</p><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile}/><button className="danger" onClick={clear}>Clear this campaign first</button></div>
    <div className="card"><h2>Import health check</h2><div className="grid two small"><Stat label="Rows in campaign" value={st.total}/><Stat label="With email" value={st.withEmail}/><Stat label="With WhatsApp" value={st.withWhatsApp}/><Stat label="Missing email" value={st.noEmail}/></div>{last && <pre className="log">Last import: {last.at}\nSource: {last.source}\nParsed rows: {last.parsed}\nImported rows: {last.imported}\n{last.error?`Note: ${last.error}`:'Errors: None'}</pre>}</div></div>
    <div className="card"><h2>Option B: paste CSV fallback</h2><p>Open the CSV in Notepad or Google Sheets, select all, copy, paste here, then import. This bypasses browser file-access problems.</p><textarea className="paste-box" value={paste} onChange={e=>setPaste(e.target.value)} placeholder="Business Name,Phone,Website,Domain,City,Country,Email,Notes..."/><button className="primary" onClick={()=>runImport(paste,'paste box')} disabled={!paste.trim()}>Import pasted CSV</button></div>
  </>
}
function filterLeads(leads, q, status){
  const s = lower(q)
  return (leads || []).filter(l => (status==='All' || l.status===status) && (!s || [l.businessName,l.email,l.website,l.domain,l.city,l.country,l.notes].some(v => lower(v).includes(s))))
}
function WorkQueue({campaign, settings, updateLead, selectedLeadId, setSelectedLeadId, query, setQuery, statusFilter, setStatusFilter, notify}){
  const leads = filterLeads(campaign?.leads || [], query, statusFilter)
  const lead = (campaign?.leads || []).find(l => l.id === selectedLeadId) || leads[0]
  useEffect(()=>{ if (!selectedLeadId && lead) setSelectedLeadId(lead.id) }, [lead?.id])
  if (!campaign) return <Empty title="Create a campaign first" />
  if (!campaign.leads.length) return <Empty title="No leads yet" button="Import CSV" onClick={()=>{}} />
  return <><Header eyebrow="Work queue" title="Review, send, and track one business at a time"><span className="pill">{leads.length} visible</span></Header>
    <div className="toolbar"><input placeholder="Search business, city, email..." value={query} onChange={e=>setQuery(e.target.value)}/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div>
    <div className="queue-layout"><div className="lead-list">{leads.map(l => <button key={l.id} className={`lead-item ${lead?.id===l.id?'active':''}`} onClick={()=>setSelectedLeadId(l.id)}><strong>{l.businessName}</strong><span>{l.email || 'No email'} · {l.status}</span></button>)}</div>{lead && <LeadDetail lead={lead} campaign={campaign} settings={settings} updateLead={updateLead} notify={notify}/>}</div>
  </>
}
function LeadDetail({lead,campaign,settings,updateLead,notify}){
  const email = emailDraft(lead,campaign,settings)
  const wa = whatsappDraft(lead,campaign,settings)
  const mark = status => updateLead(lead.id, l => addActivity({...l, status, lastContacted: ['Sent','Drafted'].includes(status) ? today() : l.lastContacted}, status))
  const copy = async txt => { await navigator.clipboard.writeText(txt); notify('Copied') }
  return <div className="lead-detail card"><div className="profile-head"><div><h2>{lead.businessName}</h2><p>{lead.website || lead.domain} {lead.city && `· ${lead.city}`}</p></div><span className={`status ${lead.status.replaceAll(' ','-')}`}>{lead.status}</span></div>
    <div className="contact-grid"><p><b>Email</b><br/>{lead.email || 'Missing'}</p><p><b>WhatsApp</b><br/>{lead.whatsapp || 'Missing'}</p><p><b>Phone</b><br/>{lead.phone || 'Missing'}</p><p><b>Country</b><br/>{lead.country || '—'}</p></div>
    <h3>Final email</h3><input value={email.subject} readOnly/><textarea value={email.body} readOnly className="draft" />
    <div className="button-row"><a className="primary linkbtn" href={gmailUrl(lead.email,email.subject,email.body)} target="_blank" onClick={()=>mark('Drafted')}>Open Gmail</a><a className="linkbtn" href={mailtoUrl(lead.email,email.subject,email.body)} onClick={()=>mark('Drafted')}>Open mail app</a><button onClick={()=>copy(`${email.subject}\n\n${email.body}`)}>Copy email</button><button onClick={()=>mark('Sent')}>Mark Sent</button></div>
    <h3>WhatsApp message</h3><textarea value={wa} readOnly className="wa"/><div className="button-row"><a className={`linkbtn ${toWaMe(lead.whatsapp)?'':'disabled'}`} href={waUrl(lead.whatsapp,wa) || '#'} target="_blank">Open WhatsApp</a><button onClick={()=>copy(wa)}>Copy WhatsApp</button></div>
    <h3>Status</h3><div className="button-row wrap">{statuses.map(s => <button key={s} onClick={()=>mark(s)}>{s}</button>)}</div>
    <details><summary>Internal notes / raw research</summary><pre className="notes">{lead.notes || 'No notes'}\n\nAll emails: {lead.allEmails || '—'}\nSource URLs: {lead.sourceUrls || '—'}\nContact form: {lead.contactForm || '—'}</pre></details>
    <details><summary>Activity history</summary>{(lead.activities||[]).length===0 ? <p>No activity yet.</p> : lead.activities.map(a=><p key={a.id}><b>{a.type}</b> · {new Date(a.at).toLocaleString()} {a.note}</p>)}</details>
  </div>
}
function Batch({campaign,settings,updateStore,notify}){
  const [selected,setSelected] = useState(new Set())
  const [filter,setFilter] = useState('New')
  if (!campaign) return <Empty title="Create a campaign first" />
  const eligible = (campaign.leads || []).filter(l => safe(l.email) && (filter==='All' || l.status===filter)).slice(0, Number(campaign.dailyEmailLimit || settings.maxBatch || 50))
  const toggle = id => setSelected(prev => { const n = new Set(prev); n.has(id)?n.delete(id):n.add(id); return n })
  const selectedLeads = eligible.filter(l => selected.has(l.id))
  const markSelected = status => {
    updateStore(s => ({...s, campaigns: s.campaigns.map(c => c.id !== campaign.id ? c : ({...c, leads: c.leads.map(l => selected.has(l.id) ? addActivity({...l, status, lastContacted: status==='Sent'?today():l.lastContacted}, status) : l)}))}))
    notify(`Marked ${selectedLeads.length} as ${status}`)
  }
  return <><Header eyebrow="Batch" title="Prepare selected outreach"><span className="pill">Manual-send safe mode</span></Header>
    <div className="notice"><b>Important:</b> GitHub Pages cannot send emails from a backend. This page prepares the batch, exports the final messages, and lets you open/review Gmail manually.</div>
    <div className="toolbar"><select value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option>{statuses.map(s=><option key={s}>{s}</option>)}</select><button onClick={()=>setSelected(new Set(eligible.map(l=>l.id)))}>Select visible</button><button onClick={()=>setSelected(new Set())}>Clear</button><button className="primary" onClick={()=>downloadText(`${campaign.name.replace(/\W+/g,'_')}_batch.csv`, csvForLeads(selectedLeads,campaign,settings), 'text/csv;charset=utf-8')}>Download selected batch CSV</button><button onClick={()=>markSelected('Drafted')}>Mark Drafted</button><button onClick={()=>markSelected('Sent')}>Mark Sent</button></div>
    <div className="card"><h2>{selectedLeads.length} selected / {eligible.length} visible</h2>{eligible.map(l => <label key={l.id} className="check-row"><input type="checkbox" checked={selected.has(l.id)} onChange={()=>toggle(l.id)}/><span><b>{l.businessName}</b><small>{l.email} · {l.status}</small></span></label>)}</div>
  </>
}
function Profiles({campaign,query,setQuery,updateLead}){
  const leads = filterLeads(campaign?.leads || [], query, 'All')
  if (!campaign) return <Empty title="Create a campaign first" />
  return <><Header eyebrow="Profiles" title="Business profiles"/><div className="toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search profiles..."/></div>
    <div className="profiles-grid">{leads.map(l => <div className="card profile" key={l.id}><div className="profile-head"><h2>{l.businessName}</h2><span className={`status ${l.status.replaceAll(' ','-')}`}>{l.status}</span></div><p>{l.website || l.domain}</p><p><b>Email:</b> {l.email || '—'}</p><p><b>WhatsApp:</b> {l.whatsapp || '—'}</p><p><b>City:</b> {l.city || '—'}</p><details><summary>Notes</summary><pre className="notes">{l.notes || 'No notes'}</pre></details></div>)}</div></>
}
function Settings({store,updateStore,campaign,notify}){
  const [json,setJson] = useState('')
  const updateSetting = (k,v) => updateStore(s => ({...s, settings: {...s.settings, [k]: v}}))
  const updateCampaign = (k,v) => campaign && updateStore(s => ({...s, campaigns: s.campaigns.map(c => c.id === campaign.id ? {...c, [k]: v} : c)}))
  const exportAllCsv = () => downloadText('puregrid_all_campaigns.csv', makeCsv(store.campaigns.flatMap(c => (c.leads||[]).map(l => ({Campaign:c.name, ...l, socials: JSON.stringify(l.socials||{}), activities: JSON.stringify(l.activities||{})})))), 'text/csv;charset=utf-8')
  const importBackup = () => { try { const parsed = JSON.parse(json); updateStore(parsed); notify('Backup imported') } catch { notify('Invalid backup JSON') } }
  return <><Header eyebrow="Settings" title="CRM settings and backups"/><div className="grid two"><div className="card"><h2>Campaign settings</h2><label>Niche</label><input value={campaign?.niche || ''} onChange={e=>updateCampaign('niche',e.target.value)} /><label>Service offered</label><textarea value={campaign?.serviceOffer || ''} onChange={e=>updateCampaign('serviceOffer',e.target.value)} /><label>Demo link</label><input value={campaign?.demoLink || ''} onChange={e=>updateCampaign('demoLink',e.target.value)} /><label>Language</label><select value={campaign?.language || 'English'} onChange={e=>updateCampaign('language',e.target.value)}><option>English</option><option>Spanish</option></select><label>Daily email limit</label><input type="number" value={campaign?.dailyEmailLimit || 50} onChange={e=>updateCampaign('dailyEmailLimit',e.target.value)} /><h3>Deliverability safe mode</h3><label className="inline-check"><input type="checkbox" checked={campaign?.deliverabilitySafeMode !== false} onChange={e=>updateCampaign('deliverabilitySafeMode',e.target.checked)} /> Use safer first-touch emails</label><label className="inline-check"><input type="checkbox" checked={campaign?.includeDemoLinkFirstEmail === true} onChange={e=>updateCampaign('includeDemoLinkFirstEmail',e.target.checked)} /> Include demo link in first email</label><p className="helper">Recommended for new inboxes: safe mode ON and demo link OFF. The email asks permission before sending the demo, uses plain text, avoids raw scraper notes, and keeps the CTA soft.</p></div>
    <div className="card"><h2>Sender settings</h2><label>Sender name</label><input value={store.settings.senderName} onChange={e=>updateSetting('senderName',e.target.value)}/><label>Agency email</label><input value={store.settings.agencyEmail} onChange={e=>updateSetting('agencyEmail',e.target.value)}/><label>Opt-out line</label><textarea value={store.settings.defaultOptOut} onChange={e=>updateSetting('defaultOptOut',e.target.value)}/></div></div>
    <div className="card"><h2>Backups</h2><div className="button-row"><button className="primary" onClick={()=>downloadText(`puregrid_crm_backup_${today()}.json`, JSON.stringify(store,null,2), 'application/json')}>Download full JSON backup</button><button onClick={exportAllCsv}>Download all campaigns CSV</button>{campaign && <button onClick={()=>downloadText(`${campaign.name.replace(/\W+/g,'_')}_active_campaign.csv`, csvForLeads(campaign.leads,campaign,store.settings), 'text/csv;charset=utf-8')}>Download active campaign CSV</button>}</div><label>Restore from JSON backup</label><textarea className="paste-box smallbox" value={json} onChange={e=>setJson(e.target.value)} placeholder="Paste backup JSON here"/><button onClick={importBackup}>Import backup JSON</button></div>
    <div className="card danger-zone"><h2>Reset</h2><p>Only use this if you have downloaded a backup.</p><button className="danger" onClick={()=>{ if(confirm('Delete all local CRM data?')){ localStorage.removeItem(STORE_KEY); location.reload() }}}>Delete all local CRM data</button></div>
  </>
}
function Empty({title,button,onClick}){return <div className="empty"><h1>{title}</h1>{button && <button className="primary" onClick={onClick}>{button}</button>}</div>}

createRoot(document.getElementById('root')).render(<App />)
