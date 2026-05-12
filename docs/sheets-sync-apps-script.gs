/**
 * StudioLAB Growth — Submissions backup mirror
 *
 * Bound to the target Google Sheet and deployed as a Web App.
 * The Supabase `sync-to-sheet` Edge Function POSTs JSON here whenever a
 * submission is inserted or updated. Drafts are filtered upstream.
 *
 * Tabs managed by this script:
 *   • Dashboard       — one row per studio, master overview, sorted by recency
 *   • Submitted       — filtered view, one row per studio in that stage
 *   • In review
 *   • Changes requested
 *   • Setup in progress
 *   • Complete
 *   • [Studio name]   — one tab per studio, full vertical detail
 *
 * See docs/sheets-sync-setup.md for the one-time deployment steps.
 */

const SHARED_SECRET_PROP = 'SHARED_SECRET';

const STAGE_TABS = {
  submitted: 'Submitted',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  setup_in_progress: 'Setup in progress',
  complete: 'Complete',
};
const STAGE_ORDER = ['submitted','in_review','changes_requested','setup_in_progress','complete'];

const STAGE_COLOURS = {
  submitted:         '#E0E7FF',
  in_review:         '#FEF3C7',
  changes_requested: '#FED7AA',
  setup_in_progress: '#DBEAFE',
  complete:          '#D1FAE5',
};
const PLAN_COLOURS = { launch: '#DBEAFE', scale: '#E0E7FF', ai: '#FCE7F3' };
const PLAN_LABEL = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL = { dfy: 'Done-For-You', guided: 'Guided' };
const STATUS_LABEL = {
  submitted: 'Submitted',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  setup_in_progress: 'Setup in progress',
  complete: 'Complete',
};

// Dashboard / stage tab columns. The ID column is last and hidden so we can
// upsert by submission id without showing UUIDs to humans.
const DASH_HEADERS = [
  'Studio','Contact email','Plan','Setup','Stage','Region',
  'Submitted','Last updated','Days in stage','Assigned',
  'Detail','ID',
];

// Section layout for per-studio detail tabs.
const DETAIL_SECTIONS = [
  ['Submission', [
    ['Reference', (r) => shortRef(r.id)],
    ['Submitted at', (r) => fmtDate(r.submitted_at || r.created_at)],
    ['Last updated', (r) => fmtDate(r.updated_at)],
    ['Stage', (r) => STATUS_LABEL[r.status] || r.status],
    ['Plan', (r) => PLAN_LABEL[r.plan] || r.plan],
    ['Setup', (r) => SETUP_LABEL[r.setup_type] || r.setup_type],
    ['Region', (r) => r.region],
    ['Assigned to', (r) => r.assigned_to],
  ]],
  ['Studio details', [
    ['Studio name', 'studio_name'],
    ['Legal business name', 'legal_name'],
    ['Country', 'country'],
    ['Time zone', 'timezone'],
    ['Studio type', 'studio_type'],
    ['Address', 'address'],
    ['Website', 'website'],
    ['Support URL', 'support_url'],
  ]],
  ['Primary contact', [
    ['First name', 'first_name'],
    ['Last name', 'last_name'],
    ['Email', 'contact_email'],
    ['Phone', 'contact_phone'],
    ['Role', 'role'],
    ['StudioLAB login email', 'studiolab_email'],
  ]],
  ['Branding', [
    ['Logo URL', 'logo_url'],
    ['Primary colour', 'primary_colour'],
    ['Secondary colour', 'secondary_colour'],
    ['Sign-off', 'sign_off'],
    ['Email tone', 'email_tone'],
    ['Footer notes', 'footer_notes'],
    ['Studio description', 'studio_description'],
  ]],
  ['Email setup', [
    ['From name', 'from_name'],
    ['Reply-to', 'reply_email'],
    ['Custom domain', (r) => fmtBool(r.custom_domain)],
    ['Email domain', 'email_domain'],
    ['DNS access', 'dns_access'],
  ]],
  ['SMS & social', [
    ['Number preference', 'sms_type'],
    ['Area code', 'area_code'],
    ['Port number', 'port_number'],
    ['SMS tone notes', 'sms_tone'],
    ['Lead sources', (r) => fmtList(r.lead_sources)],
  ]],
  ['AI knowledge base', [
    ['Studio profile', 'kb_profile'],
    ['Classes & timetable', 'kb_classes'],
    ['Pricing', 'kb_pricing'],
    ['AI can quote prices', (r) => fmtBool(r.kb_price_quoting)],
    ['Policies', 'kb_policies'],
    ['Events', 'kb_events'],
    ['FAQs', (r) => fmtFaqs(r.kb_faqs)],
    ['Restricted topics', 'kb_restricted'],
    ['AI tone', 'kb_tone'],
    ['Voice agent hours', 'voice_hours'],
    ['Voice escalation', 'voice_escalate'],
  ]],
  ['Other', [
    ['Additional notes', 'extra_notes'],
  ]],
];

// ─── HTTP entry point ─────────────────────────────────────────────────────

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty(SHARED_SECRET_PROP);
    if (!expected || body.secret !== expected) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return json({ ok: true, synced: 0 });

    ensureSheetStructure();
    rows.forEach(upsertRow);

    // Re-sort the Dashboard so newest activity floats to the top.
    sortDashboardByUpdated();

    return json({ ok: true, synced: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}

function doGet() {
  return json({ ok: true, service: 'studiolab-sheets-sync' });
}

function json(obj, _status) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Sheet bootstrap ──────────────────────────────────────────────────────

function ensureSheetStructure() {
  const ss = SpreadsheetApp.getActive();

  // Dashboard
  let dash = ss.getSheetByName('Dashboard');
  if (!dash) {
    dash = ss.insertSheet('Dashboard', 0);
    styleListSheet(dash);
  } else if (dash.getLastRow() === 0) {
    styleListSheet(dash);
  }

  // Stage tabs
  STAGE_ORDER.forEach((key) => {
    const name = STAGE_TABS[key];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      styleListSheet(sh);
    } else if (sh.getLastRow() === 0) {
      styleListSheet(sh);
    }
  });
}

function styleListSheet(sh) {
  sh.clear();
  sh.appendRow(DASH_HEADERS);
  const head = sh.getRange(1, 1, 1, DASH_HEADERS.length);
  head.setFontWeight('bold')
      .setBackground('#13102E')
      .setFontColor('#FFFFFF')
      .setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 32);

  // Reasonable column widths
  const widths = [220, 220, 110, 130, 160, 80, 150, 150, 110, 160, 90, 0];
  widths.forEach((w, i) => { if (w > 0) sh.setColumnWidth(i + 1, w); });

  // Hide ID column (last)
  const idCol = DASH_HEADERS.indexOf('ID') + 1;
  if (idCol > 0) sh.hideColumns(idCol);
}

// ─── Upsert per-row ───────────────────────────────────────────────────────

function upsertRow(row) {
  if (!row || !row.id) return;
  if (row.status === 'draft') return; // safety

  const ss = SpreadsheetApp.getActive();

  // 1) Per-studio detail tab
  const tabName = ensureDetailTab(ss, row);

  // 2) Dashboard
  upsertListRow(ss.getSheetByName('Dashboard'), row, tabName);

  // 3) Remove from any stage tab that does not match this row's status, then
  //    upsert into the matching stage tab.
  STAGE_ORDER.forEach((key) => {
    const sh = ss.getSheetByName(STAGE_TABS[key]);
    if (!sh) return;
    if (row.status === key) {
      upsertListRow(sh, row, tabName);
    } else {
      removeListRow(sh, row.id);
    }
  });
}

function upsertListRow(sh, row, tabName) {
  const idCol = DASH_HEADERS.indexOf('ID') + 1;
  const rowIndex = findRowById(sh, row.id, idCol);
  const values = buildListRowValues(row, tabName, sh);

  const target = rowIndex > 0
    ? sh.getRange(rowIndex, 1, 1, DASH_HEADERS.length)
    : sh.getRange(sh.getLastRow() + 1, 1, 1, DASH_HEADERS.length);
  target.setValues([values]);

  // Apply colour to the Stage cell and Plan cell on this row.
  const r = target.getRow();
  const stageCol = DASH_HEADERS.indexOf('Stage') + 1;
  const planCol  = DASH_HEADERS.indexOf('Plan') + 1;
  sh.getRange(r, stageCol).setBackground(STAGE_COLOURS[row.status] || '#FFFFFF');
  sh.getRange(r, planCol).setBackground(PLAN_COLOURS[row.plan] || '#FFFFFF');

  // Detail column gets a hyperlink to the studio tab within this spreadsheet.
  const detailCol = DASH_HEADERS.indexOf('Detail') + 1;
  const sheetGid  = SpreadsheetApp.getActive().getSheetByName(tabName)?.getSheetId();
  if (sheetGid != null) {
    const url = SpreadsheetApp.getActive().getUrl() + '#gid=' + sheetGid;
    sh.getRange(r, detailCol).setFormula('=HYPERLINK("' + url + '","Open ↗")');
  }
}

function removeListRow(sh, id) {
  const idCol = DASH_HEADERS.indexOf('ID') + 1;
  const rowIndex = findRowById(sh, id, idCol);
  if (rowIndex > 0) sh.deleteRow(rowIndex);
}

function findRowById(sh, id, idCol) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function buildListRowValues(row, tabName, sh) {
  const submitted = row.submitted_at || row.created_at;
  const updated = row.updated_at;
  const days = daysBetween(updated || submitted, new Date());

  return [
    row.studio_name || '(no name)',
    row.contact_email || '',
    PLAN_LABEL[row.plan] || row.plan || '',
    SETUP_LABEL[row.setup_type] || row.setup_type || '',
    STATUS_LABEL[row.status] || row.status || '',
    (row.region || '').toUpperCase(),
    fmtDate(submitted),
    fmtDate(updated),
    days,
    row.assigned_to || '',
    '', // Detail hyperlink set by caller via setFormula
    row.id,
  ];
}

// ─── Per-studio detail tab ────────────────────────────────────────────────

function ensureDetailTab(ss, row) {
  const tabName = detailTabName(row);

  // Look for an existing tab whose A1 holds this submission id.
  let sh = findDetailSheetById(ss, row.id);
  if (!sh) {
    // Avoid duplicate names by appending a short ref if collision.
    let name = tabName;
    if (ss.getSheetByName(name)) name = tabName + ' · ' + shortRef(row.id);
    sh = ss.insertSheet(name);
  } else if (sh.getName() !== tabName) {
    // Studio renamed itself — keep the tab name in sync where possible.
    try { sh.setName(tabName); } catch (_) { /* name collision; leave it */ }
  }

  renderDetailSheet(sh, row);
  return sh.getName();
}

function findDetailSheetById(ss, id) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (sh.getRange('B1').getValue() === id) return sh;
  }
  return null;
}

function renderDetailSheet(sh, row) {
  sh.clear();

  // A1 cell holds a hidden marker so we can find this tab by id later.
  sh.getRange('A1').setValue('__id');
  sh.getRange('B1').setValue(row.id);
  sh.hideRows(1);

  // Header block
  sh.getRange('A2').setValue(row.studio_name || '(no name)')
    .setFontSize(18).setFontWeight('bold').setFontColor('#13102E');
  sh.getRange('A3').setValue(
    'Ref ' + shortRef(row.id) +
    ' · ' + (PLAN_LABEL[row.plan] || row.plan || '') +
    ' · ' + (SETUP_LABEL[row.setup_type] || row.setup_type || '') +
    ' · ' + (STATUS_LABEL[row.status] || row.status || '')
  ).setFontColor('#666666');
  sh.getRange('A4').setValue('Last synced: ' + fmtDate(new Date())).setFontColor('#999999').setFontSize(10);

  // Back link to Dashboard
  const dashGid = SpreadsheetApp.getActive().getSheetByName('Dashboard')?.getSheetId();
  if (dashGid != null) {
    const dashUrl = SpreadsheetApp.getActive().getUrl() + '#gid=' + dashGid;
    sh.getRange('C2').setFormula('=HYPERLINK("' + dashUrl + '","← Dashboard")');
  }

  // Sections
  let r = 6;
  DETAIL_SECTIONS.forEach((section) => {
    const [title, fields] = section;

    // Section header
    const hdr = sh.getRange(r, 1, 1, 2);
    hdr.merge()
       .setValue(title)
       .setFontWeight('bold')
       .setFontColor('#FFFFFF')
       .setBackground('#13102E')
       .setVerticalAlignment('middle');
    sh.setRowHeight(r, 28);
    r++;

    // Field rows
    fields.forEach(([label, accessor]) => {
      const value = typeof accessor === 'function' ? accessor(row) : row[accessor];
      const display = (value === null || value === undefined || value === '') ? '—' : value;
      sh.getRange(r, 1).setValue(label)
        .setFontWeight('bold')
        .setBackground('#F5F5F7')
        .setVerticalAlignment('top');
      sh.getRange(r, 2).setValue(display).setWrap(true).setVerticalAlignment('top');
      r++;
    });

    r++; // spacer row between sections
  });

  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 520);
  sh.setFrozenRows(4);
}

function detailTabName(row) {
  const raw = (row.studio_name || row.contact_email || 'Studio').toString();
  // Sheet tab names: max 100 chars, no [ ] * ? / \ :
  const cleaned = raw.replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.substring(0, 90) || 'Studio';
}

// ─── Sorting ──────────────────────────────────────────────────────────────

function sortDashboardByUpdated() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Dashboard');
  if (!sh) return;
  const last = sh.getLastRow();
  if (last < 3) return;
  const col = DASH_HEADERS.indexOf('Last updated') + 1;
  sh.getRange(2, 1, last - 1, DASH_HEADERS.length).sort({ column: col, ascending: false });
}

// ─── Formatters ───────────────────────────────────────────────────────────

function fmtDate(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, 'Australia/Sydney', 'd MMM yyyy, h:mm a');
}

function fmtBool(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '';
}

function fmtList(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.join(', ');
  try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed.join(', ') : String(v); }
  catch (_) { return String(v); }
}

function fmtFaqs(v) {
  if (!v) return '';
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (_) { return v; } }
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.map((f) => `Q: ${f.q || f.question || ''}\nA: ${f.a || f.answer || ''}`).join('\n\n');
}

function shortRef(id) {
  return String(id || '').replace(/-/g, '').substring(0, 8).toUpperCase();
}

function daysBetween(a, b) {
  if (!a) return '';
  const t1 = (a instanceof Date) ? a : new Date(a);
  const t2 = (b instanceof Date) ? b : new Date(b);
  if (isNaN(t1.getTime()) || isNaN(t2.getTime())) return '';
  return Math.max(0, Math.floor((t2.getTime() - t1.getTime()) / 86400000));
}

// ─── Manual helpers (run from the editor) ─────────────────────────────────

function setSharedSecret_(value) {
  PropertiesService.getScriptProperties().setProperty(SHARED_SECRET_PROP, value);
}

function rebuildSheetStructure_() {
  ensureSheetStructure();
}
