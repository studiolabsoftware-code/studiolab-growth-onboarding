/* StudioLAB Growth admin: Projects screen + detail page.
   Phase 6.2a — minimal surface for the new projects model. The list shows
   every project (auto-spawned + admin-created); the detail page shows the
   project header + linked invoices + a placeholder for deliverables
   (Phase 6.3). Open Project from an invoice row navigates here. */

(function () {
  'use strict';

  const STATUS_LABEL = {
    briefing: 'Briefing',
    in_progress: 'In progress',
    review: 'In review',
    complete: 'Complete',
    cancelled: 'Cancelled',
    on_hold: 'On hold',
  };
  const STATUS_CLASS = {
    briefing: 'bdg-st-submitted',
    in_progress: 'bdg-st-in_review',
    review: 'bdg-st-in_review',
    complete: 'bdg-st-complete',
    cancelled: 'bdg-st-changes_requested',
    on_hold: 'bdg-st-changes_requested',
  };
  const TYPE_LABEL = {
    service: 'Service',
    consulting: 'Consulting',
    website_build: 'Website build',
    custom: 'Custom',
    other: 'Other',
  };

  const listState = { search: '', status: 'all', rows: [] };
  const LIST_STATUS_FILTERS = ['all', 'in_progress', 'briefing', 'review', 'complete', 'cancelled'];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function ESC(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function moneyFmt(cents, currency) {
    if (cents == null) return '—';
    return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: currency || 'AUD' });
  }
  function shortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function authHeaders() {
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    return {
      'Content-Type': 'application/json',
      'Authorization': jwt ? `Bearer ${jwt}` : '',
      'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
    };
  }
  function apiBase() { return (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || ''; }

  // ── List screen ────────────────────────────────────────────────────────
  async function openListScreen() {
    const screen = ensureListScreen();
    screen.style.display = '';
    document.getElementById('listScreen').style.display = 'none';
    document.getElementById('detailScreen').style.display = 'none';
    const ids = ['catalogScreen', 'invoicesScreen', 'quotesScreen', 'inboxScreen', 'projectDetailScreen', 'usersScreen', 'settingsScreen'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    await loadListRows();
    renderList();
  }

  function ensureListScreen() {
    let screen = document.getElementById('projectsScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'projectsScreen';
    screen.className = 'inbox-screen';
    screen.innerHTML = `
      <div class="inbox-hdr">
        <div>
          <h2 class="users-title">Projects</h2>
          <p class="users-desc">Every engagement, auto-spawned on payment or created manually. Invoices fund the work; this is where it gets tracked.</p>
        </div>
        <button type="button" class="btn btn-p" id="projListNew">+ New project</button>
      </div>
      <div class="inbox-toolbar">
        <div class="adm-pills" id="projListPills" role="group" aria-label="Filter projects">
          ${LIST_STATUS_FILTERS.map((s, i) => `
            <button type="button" class="pill${i === 0 ? ' active' : ''}" data-f="${s}" aria-pressed="${i === 0 ? 'true' : 'false'}">${s === 'all' ? 'All' : (STATUS_LABEL[s] || s)}</button>
          `).join('')}
        </div>
        <div class="adm-search" role="search">
          <label class="sr-only" for="projListSearch">Search</label>
          <input type="search" id="projListSearch" placeholder="Search project, recipient…">
        </div>
      </div>
      <div class="inv-list-host" id="projListBody"><div class="adm-empty" style="padding:40px 0;">Loading…</div></div>`;
    document.querySelector('main.adm-main').appendChild(screen);

    screen.querySelector('#projListNew').addEventListener('click', openNewProjectDialog);
    screen.querySelector('#projListPills').addEventListener('click', (e) => {
      const p = e.target.closest('.pill'); if (!p) return;
      listState.status = p.dataset.f;
      screen.querySelectorAll('#projListPills .pill').forEach((b) => {
        const active = b === p;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderList();
    });
    screen.querySelector('#projListSearch').addEventListener('input', (e) => {
      listState.search = (e.target.value || '').toLowerCase();
      renderList();
    });
    return screen;
  }

  async function loadListRows() {
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) { listState.rows = []; return; }
    const { data, error } = await sb.from('projects')
      .select(`
        id, name, project_type, status, currency, due_at, created_at,
        submission_id, external_contact_id,
        submission:submissions(id, studio_name, contact_email),
        external_contact:external_contacts(id, name, email),
        invoices(id, total_cents, status, currency)
      `)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('loadListRows projects:', error);
      listState.rows = [];
      return;
    }
    listState.rows = (data || []).map((r) => {
      const isStudio = !!r.submission_id;
      const recipientName = isStudio
        ? (r.submission?.studio_name || r.submission?.contact_email || 'Unknown studio')
        : (r.external_contact?.name || r.external_contact?.email || 'External recipient');
      const recipientEmail = isStudio ? (r.submission?.contact_email || '') : (r.external_contact?.email || '');
      const invoices = r.invoices || [];
      const billed = invoices.reduce((s, i) => s + (i.status === 'paid' || i.status === 'partially_refunded' ? (i.total_cents || 0) : 0), 0);
      return { ...r, _isStudio: isStudio, _recipientName: recipientName, _recipientEmail: recipientEmail, _billedCents: billed, _invoiceCount: invoices.length };
    });
  }

  function renderList() {
    const host = document.getElementById('projListBody');
    if (!host) return;
    const filtered = listState.rows.filter((r) => {
      if (listState.status !== 'all' && r.status !== listState.status) return false;
      if (!listState.search) return true;
      const hay = [r.name, r._recipientName, r._recipientEmail].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(listState.search);
    });
    if (!filtered.length) {
      host.innerHTML = `<div class="adm-empty" style="padding:40px 0;">${listState.search || listState.status !== 'all' ? 'No projects match.' : 'No projects yet. Paying an external invoice auto-creates one, or click + New project.'}</div>`;
      return;
    }
    host.innerHTML = `
      <table class="inv-table inv-list-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Recipient</th>
            <th>Type</th>
            <th>Status</th>
            <th>Billed</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((r) => `
            <tr data-proj-open="${ESC(r.id)}" style="cursor:pointer;">
              <td>${ESC(r.name)}</td>
              <td>
                <div>${ESC(r._recipientName)}</div>
                <div class="inv-list-sub">${ESC(r._recipientEmail)}${r._isStudio ? '' : ' · <span class="inv-list-tag">External</span>'}</div>
              </td>
              <td>${ESC(TYPE_LABEL[r.project_type] || r.project_type)}</td>
              <td><span class="bdg ${STATUS_CLASS[r.status] || ''}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
              <td>${r._billedCents ? moneyFmt(r._billedCents, r.currency || 'AUD') : '<span class="adm-empty">—</span>'}${r._invoiceCount > 1 ? ` <span class="inv-list-sub">(${r._invoiceCount} invoices)</span>` : ''}</td>
              <td>${r.due_at ? shortDate(r.due_at) : '<span class="adm-empty">—</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    if (!host._bound) {
      host._bound = true;
      host.addEventListener('click', (e) => {
        const row = e.target.closest('[data-proj-open]');
        if (!row) return;
        const id = row.getAttribute('data-proj-open');
        openDetail(id);
      });
    }
  }

  // ── New project dialog ─────────────────────────────────────────────────
  async function openNewProjectDialog() {
    const sb = window.initSupabase && window.initSupabase();
    let studios = [];
    let externals = [];
    if (sb) {
      const [{ data: subs }, { data: ecs }] = await Promise.all([
        sb.from('submissions').select('id, studio_name, contact_email').order('created_at', { ascending: false }).limit(200),
        sb.from('external_contacts').select('id, name, email').order('last_invoiced_at', { ascending: false, nullsFirst: false }).limit(200),
      ]);
      studios = subs || [];
      externals = ecs || [];
    }
    const overlay = document.createElement('div');
    overlay.className = 'adm-modal';
    overlay.style.zIndex = '12000';
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="adm-modal-backdrop"></div>
      <div class="adm-modal-card" style="max-width:520px;">
        <div class="adm-modal-hdr"><h3 class="adm-modal-title">New project</h3></div>
        <div class="adm-modal-body">
          <p style="margin-top:0;color:var(--g6);font-size:13px;">For engagements that aren't billed through this system, or that started before invoicing was wired in. Most projects spawn automatically when you mark an external invoice paid.</p>
          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Project name</label>
          <input type="text" id="np_name" style="width:100%;" placeholder="e.g. Test Studio — Knowledge Base Build">
          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Type</label>
          <select id="np_type" style="width:100%;">
            <option value="service">Service</option>
            <option value="consulting">Consulting</option>
            <option value="website_build">Website build</option>
            <option value="custom">Custom</option>
            <option value="other">Other</option>
          </select>
          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Recipient</label>
          <div style="display:flex;gap:12px;align-items:center;margin-bottom:6px;">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="radio" name="np_recip" value="studio" checked>Studio</label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="radio" name="np_recip" value="external">External contact</label>
          </div>
          <select id="np_studio" style="width:100%;">
            <option value="">Select a studio…</option>
            ${studios.map((s) => `<option value="${ESC(s.id)}">${ESC(s.studio_name || s.contact_email)}</option>`).join('')}
          </select>
          <select id="np_external" style="width:100%;display:none;">
            <option value="">Select an external contact…</option>
            ${externals.map((e) => `<option value="${ESC(e.id)}">${ESC(e.name || e.email)}</option>`).join('')}
          </select>
          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Currency</label>
          <select id="np_currency" style="width:100%;">
            <option value="">— Set when first invoice attaches —</option>
            <option value="AUD">AUD</option>
            <option value="USD">USD</option>
          </select>
          <div style="display:none;color:#B91C1C;font-size:13px;margin-top:8px;" id="np_err"></div>
        </div>
        <div class="adm-modal-ftr">
          <button type="button" class="btn btn-g" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-p" data-act="create">Create project</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('adm-modal-open');

    function teardown() {
      overlay.remove();
      document.body.classList.remove('adm-modal-open');
    }

    overlay.querySelector('[data-act="cancel"]').addEventListener('click', teardown);
    overlay.querySelector('.adm-modal-backdrop').addEventListener('click', teardown);
    overlay.addEventListener('change', (e) => {
      if (e.target.name === 'np_recip') {
        const isStudio = e.target.value === 'studio';
        overlay.querySelector('#np_studio').style.display = isStudio ? '' : 'none';
        overlay.querySelector('#np_external').style.display = isStudio ? 'none' : '';
      }
    });
    overlay.querySelector('[data-act="create"]').addEventListener('click', async () => {
      const name = overlay.querySelector('#np_name').value.trim();
      const type = overlay.querySelector('#np_type').value;
      const recipKind = overlay.querySelector('input[name="np_recip"]:checked').value;
      const studioId = overlay.querySelector('#np_studio').value;
      const extId = overlay.querySelector('#np_external').value;
      const currency = overlay.querySelector('#np_currency').value;
      const errEl = overlay.querySelector('#np_err');
      function err(msg) { errEl.textContent = msg; errEl.style.display = ''; }
      if (!name) return err('Enter a project name.');
      if (recipKind === 'studio' && !studioId) return err('Select a studio.');
      if (recipKind === 'external' && !extId) return err('Select an external contact.');

      const body = {
        mode: 'standalone',
        name,
        project_type: type,
        ...(recipKind === 'studio' ? { submission_id: studioId } : { external_contact_id: extId }),
        ...(currency ? { currency } : {}),
      };
      try {
        const resp = await fetch(apiBase() + '/functions/v1/create-project', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) return err(data.error || `Failed (${resp.status})`);
        teardown();
        await loadListRows();
        renderList();
        openDetail(data.project_id);
      } catch (e) {
        err(String(e && e.message || e));
      }
    });

    setTimeout(() => overlay.querySelector('#np_name').focus(), 50);
  }

  // ── Detail screen ──────────────────────────────────────────────────────
  async function openDetail(projectId) {
    const screen = ensureDetailScreen();
    screen.style.display = '';
    document.getElementById('listScreen').style.display = 'none';
    document.getElementById('detailScreen').style.display = 'none';
    const ids = ['catalogScreen', 'invoicesScreen', 'quotesScreen', 'inboxScreen', 'projectsScreen', 'usersScreen', 'settingsScreen'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    screen.innerHTML = '<div class="adm-empty" style="padding:40px 0;">Loading…</div>';

    const sb = window.initSupabase && window.initSupabase();
    if (!sb) { screen.innerHTML = '<div class="adm-empty">Supabase unavailable.</div>'; return; }

    const [{ data: project, error: projErr }, { data: invoices }, { data: activity }, { data: deliverables }] = await Promise.all([
      sb.from('projects')
        .select(`
          id, name, project_type, status, currency, due_at, notes, created_at, completed_at, cancelled_at,
          submission_id, external_contact_id, owner_admin_id, token, token_expires_at,
          submission:submissions(id, studio_name, contact_email),
          external_contact:external_contacts(id, name, email)
        `)
        .eq('id', projectId).maybeSingle(),
      sb.from('invoices')
        .select('id, number, status, total_cents, currency, paid_at, issued_at, hosted_url, marked_paid_manually')
        .eq('project_id', projectId)
        .order('issued_at', { ascending: false }),
      sb.from('activity_log')
        .select('id, action, actor, details, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(50),
      sb.from('deliverables')
        .select('id, title, description, status, visibility, due_date, order_index, submitted_at, approved_at, delivered_at, cancelled_at, revisions_notes, created_at')
        .eq('project_id', projectId)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);
    if (projErr || !project) {
      screen.innerHTML = `<div class="adm-empty">Project not found.</div>`;
      return;
    }
    renderDetail(screen, project, invoices || [], activity || [], deliverables || []);
  }

  function ensureDetailScreen() {
    let screen = document.getElementById('projectDetailScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'projectDetailScreen';
    screen.className = 'inbox-screen';
    document.querySelector('main.adm-main').appendChild(screen);
    return screen;
  }

  const DELIV_STATUS_LABEL = {
    pending: 'Not started',
    in_progress: 'In progress',
    submitted_for_review: 'Awaiting client',
    revisions_requested: 'Revisions requested',
    approved: 'Approved',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  const DELIV_STATUS_CLASS = {
    pending: 'bdg-st-submitted',
    in_progress: 'bdg-st-in_review',
    submitted_for_review: 'bdg-st-in_review',
    revisions_requested: 'bdg-st-changes_requested',
    approved: 'bdg-st-complete',
    delivered: 'bdg-st-complete',
    cancelled: 'bdg-st-changes_requested',
  };

  function renderDetail(screen, p, invoices, activity, deliverables) {
    const isStudio = !!p.submission_id;
    const recipientName = isStudio
      ? (p.submission?.studio_name || p.submission?.contact_email || 'Unknown studio')
      : (p.external_contact?.name || p.external_contact?.email || 'External recipient');
    const recipientEmail = isStudio ? p.submission?.contact_email : p.external_contact?.email;
    const billed = invoices.reduce((s, i) => s + (i.status === 'paid' || i.status === 'partially_refunded' ? (i.total_cents || 0) : 0), 0);

    screen.innerHTML = `
      <div class="proj-detail">
        <div class="proj-detail-hdr">
          <button type="button" class="btn-link" id="projBack">← Back to projects</button>
          <div style="display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;">
            <h2 class="users-title" style="margin:0;" id="projName">${ESC(p.name)}</h2>
            <button type="button" class="btn-link" id="projRename">Rename</button>
            <span class="bdg ${STATUS_CLASS[p.status] || ''}" id="projStatusBadge">${ESC(STATUS_LABEL[p.status] || p.status)}</span>
          </div>
          <div style="color:var(--g6);font-size:13px;margin-top:4px;">
            ${ESC(TYPE_LABEL[p.project_type] || p.project_type)} ·
            ${ESC(recipientName)}${recipientEmail ? ` · ${ESC(recipientEmail)}` : ''}${isStudio ? '' : ' · External'} ·
            Started ${shortDate(p.created_at)}${p.due_at ? ` · Due ${shortDate(p.due_at)}` : ''}
          </div>
        </div>

        <div class="proj-detail-grid">
          <section class="proj-card">
            <div class="proj-card-hdr"><h3>Status</h3></div>
            <div class="proj-card-body">
              <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Project status</label>
              <select id="projStatus" style="width:100%;">
                ${Object.keys(STATUS_LABEL).map((s) => `<option value="${s}"${s === p.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
              </select>
            </div>
          </section>

          <section class="proj-card">
            <div class="proj-card-hdr"><h3>Billing</h3></div>
            <div class="proj-card-body">
              <div style="font-size:24px;font-weight:600;">${moneyFmt(billed, p.currency || 'AUD')}</div>
              <div style="color:var(--g6);font-size:12px;margin-top:2px;">${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}</div>
            </div>
          </section>

          <section class="proj-card proj-card-wide">
            <div class="proj-card-hdr"><h3>Share with client</h3></div>
            <div class="proj-card-body">
              ${p.token
                ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <input type="text" id="projClientUrl" readonly value="${ESC(window.location.origin + '/project.html?p=' + encodeURIComponent(p.id) + '&t=' + encodeURIComponent(p.token))}" style="flex:1;min-width:280px;padding:8px 10px;border:1px solid var(--g2);border-radius:8px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--g1);">
                    <button type="button" class="btn btn-g" id="projCopyUrl">Copy link</button>
                    <a class="btn btn-g" href="${ESC(window.location.origin + '/project.html?p=' + encodeURIComponent(p.id) + '&t=' + encodeURIComponent(p.token))}" target="_blank" rel="noopener">Preview</a>
                  </div>
                  <div style="color:var(--g6);font-size:12px;margin-top:8px;">Anyone with this link can view the project. ${p.token_expires_at ? `Link expires ${shortDate(p.token_expires_at)}.` : ''}</div>`
                : `<div class="adm-empty" style="padding:16px 0;">No client link yet — this project was created without a magic-link token.</div>`}
            </div>
          </section>

          <section class="proj-card proj-card-wide">
            <div class="proj-card-hdr" style="display:flex;justify-content:space-between;align-items:center;">
              <h3>Deliverables</h3>
              <button type="button" class="btn-link" id="deliverNew">+ Add deliverable</button>
            </div>
            <div class="proj-card-body">
              <div id="deliverList">${renderDeliverablesList(deliverables)}</div>
            </div>
          </section>

          <section class="proj-card proj-card-wide">
            <div class="proj-card-hdr"><h3>Invoices</h3></div>
            <div class="proj-card-body">
              ${invoices.length === 0
                ? '<div class="adm-empty" style="padding:16px 0;">No invoices linked to this project.</div>'
                : `<table class="inv-table"><thead><tr>
                    <th>Number</th><th>Status</th><th>Amount</th><th>Paid</th><th></th>
                  </tr></thead><tbody>
                  ${invoices.map((i) => `<tr>
                    <td>${ESC(i.number || '(draft)')}</td>
                    <td><span class="bdg ${i.status === 'paid' ? 'bdg-st-complete' : i.status === 'open' ? 'bdg-st-in_review' : 'bdg-st-changes_requested'}">${ESC(i.status)}</span></td>
                    <td>${moneyFmt(i.total_cents, i.currency)}</td>
                    <td style="font-size:12px;">${i.paid_at ? (i.marked_paid_manually ? 'Marked ' : '') + shortDate(i.paid_at) : '<span class="adm-empty">—</span>'}</td>
                    <td>${i.hosted_url ? `<a class="btn-link" href="${ESC(i.hosted_url)}" target="_blank" rel="noopener">Open on Stripe</a>` : ''}</td>
                  </tr>`).join('')}
                </tbody></table>`
              }
            </div>
          </section>

          <section class="proj-card proj-card-wide">
            <div class="proj-card-hdr"><h3>Activity</h3></div>
            <div class="proj-card-body">
              ${activity.length === 0
                ? '<div class="adm-empty" style="padding:16px 0;">No activity yet.</div>'
                : `<ul class="proj-activity">
                    ${activity.map((a) => `<li>
                      <span class="proj-activity-when">${shortDate(a.created_at)}</span>
                      <span class="proj-activity-what"><strong>${ESC(a.action)}</strong>${a.actor ? ` · ${ESC(a.actor)}` : ''}</span>
                    </li>`).join('')}
                  </ul>`
              }
            </div>
          </section>

          ${p.notes ? `<section class="proj-card proj-card-wide">
            <div class="proj-card-hdr"><h3>Notes</h3></div>
            <div class="proj-card-body" style="white-space:pre-wrap;">${ESC(p.notes)}</div>
          </section>` : ''}
        </div>
      </div>`;

    const copyBtn = screen.querySelector('#projCopyUrl');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const input = screen.querySelector('#projClientUrl');
        if (!input) return;
        try {
          await navigator.clipboard.writeText(input.value);
          const orig = copyBtn.textContent;
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        } catch (_) {
          input.select();
          document.execCommand('copy');
        }
      });
    }

    screen.querySelector('#projBack').addEventListener('click', () => {
      if (window.AdminAuth && window.AdminAuth.showSection) window.AdminAuth.showSection('projects');
      else openListScreen();
    });

    screen.querySelector('#projRename').addEventListener('click', async () => {
      const next = prompt('New project name', p.name);
      if (!next || next.trim() === p.name) return;
      const sb = window.initSupabase && window.initSupabase();
      if (!sb) return;
      const { error } = await sb.from('projects').update({ name: next.trim().slice(0, 200) }).eq('id', p.id);
      if (error) { alert('Rename failed: ' + error.message); return; }
      try {
        await sb.from('activity_log').insert({
          submission_id: p.submission_id || null,
          project_id: p.id,
          action: 'project_renamed',
          actor: (window.AdminAuth && window.AdminAuth.currentUser && window.AdminAuth.currentUser.email) || 'admin',
          details: { from: p.name, to: next.trim() },
        });
      } catch (_) {}
      openDetail(p.id);
    });

    wireDeliverables(screen, p);

    screen.querySelector('#projStatus').addEventListener('change', async (e) => {
      const next = e.target.value;
      if (next === p.status) return;
      const sb = window.initSupabase && window.initSupabase();
      if (!sb) return;
      const update = { status: next };
      if (next === 'complete') update.completed_at = new Date().toISOString();
      if (next === 'cancelled') update.cancelled_at = new Date().toISOString();
      const { error } = await sb.from('projects').update(update).eq('id', p.id);
      if (error) { alert('Status update failed: ' + error.message); return; }
      try {
        await sb.from('activity_log').insert({
          submission_id: p.submission_id || null,
          project_id: p.id,
          action: next === 'complete' ? 'project_completed' : (next === 'cancelled' ? 'project_cancelled' : 'project_status_changed'),
          actor: (window.AdminAuth && window.AdminAuth.currentUser && window.AdminAuth.currentUser.email) || 'admin',
          details: { from: p.status, to: next },
        });
      } catch (_) {}
      openDetail(p.id);
    });
  }

  // ── Deliverables (admin side) ──────────────────────────────────────────
  function renderDeliverablesList(deliverables) {
    if (!deliverables || deliverables.length === 0) {
      return '<div class="adm-empty" style="padding:16px 0;">No deliverables yet. Click <strong>+ Add deliverable</strong> to set up the first piece of work.</div>';
    }
    return `<table class="inv-table"><thead><tr>
        <th>Title</th><th>Visibility</th><th>Status</th><th>Due</th><th>Actions</th>
      </tr></thead><tbody>
      ${deliverables.map((d) => {
        const isTerminal = d.status === 'delivered' || d.status === 'cancelled';
        const acts = [];
        acts.push(`<button type="button" class="btn-link" data-deliver-act="edit" data-deliver-id="${ESC(d.id)}">Edit</button>`);
        if (d.status === 'in_progress' || d.status === 'pending' || d.status === 'revisions_requested') {
          acts.push(`<button type="button" class="btn-link" data-deliver-act="submit-for-review" data-deliver-id="${ESC(d.id)}">Submit for review</button>`);
        }
        if (d.status === 'submitted_for_review' || d.status === 'in_progress' || d.status === 'revisions_requested') {
          acts.push(`<button type="button" class="btn-link" data-deliver-act="mark-approved" data-deliver-id="${ESC(d.id)}">Approve</button>`);
        }
        if (d.status === 'approved') {
          acts.push(`<button type="button" class="btn-link" data-deliver-act="mark-delivered" data-deliver-id="${ESC(d.id)}">Mark delivered</button>`);
        }
        if (!isTerminal) {
          acts.push(`<button type="button" class="btn-link" style="color:#B91C1C;" data-deliver-act="cancel" data-deliver-id="${ESC(d.id)}">Cancel</button>`);
        }
        const sub = [];
        if (d.description) sub.push(ESC(d.description.slice(0, 140)) + (d.description.length > 140 ? '…' : ''));
        if (d.revisions_notes) sub.push(`<span style="color:#B91C1C;">Client asked: ${ESC(d.revisions_notes.slice(0, 200))}${d.revisions_notes.length > 200 ? '…' : ''}</span>`);
        return `<tr data-deliver-row="${ESC(d.id)}">
          <td>
            <div style="font-weight:500;">${ESC(d.title)}</div>
            ${sub.length ? `<div class="inv-list-sub">${sub.join(' · ')}</div>` : ''}
          </td>
          <td>${d.visibility === 'internal' ? '<span class="inv-list-tag">Internal</span>' : 'Client'}</td>
          <td><span class="bdg ${DELIV_STATUS_CLASS[d.status] || ''}">${ESC(DELIV_STATUS_LABEL[d.status] || d.status)}</span></td>
          <td>${d.due_date ? ESC(shortDate(d.due_date)) : '<span class="adm-empty">—</span>'}</td>
          <td style="display:flex;gap:8px;flex-wrap:wrap;">${acts.join('')}</td>
        </tr>`;
      }).join('')}
      </tbody></table>`;
  }

  function wireDeliverables(screen, project) {
    const addBtn = screen.querySelector('#deliverNew');
    if (addBtn) {
      addBtn.addEventListener('click', () => openDeliverableEditor(project, null));
    }
    const host = screen.querySelector('#deliverList');
    if (!host) return;
    host.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-deliver-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-deliver-act');
      const id = btn.getAttribute('data-deliver-id');
      if (act === 'edit') {
        const row = (project._deliverables || []).find((d) => d.id === id) || null;
        // Fall back to fetching the row if we don't have it cached.
        if (row) {
          openDeliverableEditor(project, row);
        } else {
          const sb = window.initSupabase && window.initSupabase();
          if (!sb) return;
          const { data } = await sb.from('deliverables').select('*').eq('id', id).maybeSingle();
          if (data) openDeliverableEditor(project, data);
        }
        return;
      }
      const confirmLabel = {
        'submit-for-review': 'Submit for review',
        'mark-approved': 'Approve',
        'mark-delivered': 'Mark delivered',
        'cancel': 'Cancel deliverable',
      }[act];
      if (confirmLabel) {
        const ok = await (window.AdminModal?.confirm
          ? window.AdminModal.confirm({ title: `${confirmLabel}?`, message: `<p>This will move the deliverable forward.</p>`, confirmLabel, destructive: act === 'cancel' })
          : confirm(`${confirmLabel}?`));
        if (!ok) return;
      }
      try {
        const resp = await fetch(apiBase() + '/functions/v1/manage-deliverable', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ action: act, id }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          alert(data.error || `Failed (${resp.status})`);
          return;
        }
        openDetail(project.id);
      } catch (err) {
        console.error('deliverable action failed:', err);
        alert('Action failed. Try again.');
      }
    });
  }

  async function openDeliverableEditor(project, existing) {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'adm-modal';
    overlay.style.zIndex = '12000';
    overlay.hidden = false;
    // Edit mode is wider so Files + Comments fit alongside the form. New
    // mode stays narrow — no id yet, so no files/comments can be attached
    // until after first save.
    const cardMax = isEdit ? '720px' : '560px';
    overlay.innerHTML = `
      <div class="adm-modal-backdrop"></div>
      <div class="adm-modal-card" style="max-width:${cardMax};">
        <div class="adm-modal-hdr"><h3 class="adm-modal-title">${isEdit ? 'Edit deliverable' : 'New deliverable'}</h3></div>
        <div class="adm-modal-body">
          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Title</label>
          <input type="text" id="del_title" style="width:100%;" placeholder="e.g. Knowledge base — first draft" value="${ESC(existing?.title || '')}">

          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Description <span style="color:var(--g6);font-weight:400;">(visible to client when this is client-visible)</span></label>
          <textarea id="del_desc" rows="4" style="width:100%;font-family:inherit;">${ESC(existing?.description || '')}</textarea>

          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Due date <span style="color:var(--g6);font-weight:400;">(optional)</span></label>
          <input type="date" id="del_due" style="width:100%;" value="${ESC(existing?.due_date || '')}">

          <label style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">Visibility</label>
          <div style="display:flex;gap:14px;">
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="radio" name="del_vis" value="client"${(!existing || existing.visibility === 'client') ? ' checked' : ''}>Client (shown on their project page)</label>
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;"><input type="radio" name="del_vis" value="internal"${existing?.visibility === 'internal' ? ' checked' : ''}>Internal (team only)</label>
          </div>
          <div style="display:none;color:#B91C1C;font-size:13px;margin-top:8px;" id="del_err"></div>

          ${isEdit ? `
          <hr style="border:none;border-top:1px solid var(--g2);margin:18px 0;">

          <h4 style="margin:0 0 6px;font-size:14px;font-weight:600;">Files</h4>
          <p style="margin:0 0 8px;font-size:12px;color:var(--g6);">Up to 10 files per deliverable. PDF, PNG, JPG, SVG, DOCX, DOC, XLSX, XLS — max 25 MB each. Client-visible deliverables show these on the project page.</p>
          <div id="del_files_host">
            <div class="adm-empty" style="padding:10px 0;font-size:12px;">Loading files…</div>
          </div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <input type="file" id="del_file_input" accept=".pdf,.png,.jpg,.jpeg,.svg,.docx,.doc,.xlsx,.xls" style="font-size:12px;">
            <button type="button" class="btn btn-g" id="del_file_upload" style="padding:6px 14px;font-size:13px;">Upload</button>
            <span id="del_file_status" style="font-size:12px;color:var(--g6);"></span>
          </div>

          <hr style="border:none;border-top:1px solid var(--g2);margin:18px 0;">

          <h4 style="margin:0 0 6px;font-size:14px;font-weight:600;">Comments</h4>
          <p style="margin:0 0 8px;font-size:12px;color:var(--g6);">Notes for the client on this deliverable. They see your comments and can reply from their project page.</p>
          <div id="del_comments_host" style="max-height:240px;overflow-y:auto;border:1px solid var(--g2);border-radius:8px;padding:10px;background:var(--g1);">
            <div class="adm-empty" style="padding:10px 0;font-size:12px;">Loading comments…</div>
          </div>
          <div style="margin-top:8px;">
            <textarea id="del_comment_input" rows="2" placeholder="Add a comment for the client…" style="width:100%;font-family:inherit;font-size:13px;"></textarea>
            <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
              <button type="button" class="btn btn-g" id="del_comment_send" style="padding:6px 14px;font-size:13px;">Post comment</button>
              <span id="del_comment_status" style="font-size:12px;color:var(--g6);"></span>
            </div>
          </div>
          ` : ''}
        </div>
        <div class="adm-modal-ftr">
          <button type="button" class="btn btn-g" data-act="cancel">${isEdit ? 'Close' : 'Cancel'}</button>
          <button type="button" class="btn btn-p" data-act="save">${isEdit ? 'Save changes' : 'Create'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.classList.add('adm-modal-open');
    function teardown() {
      overlay.remove();
      document.body.classList.remove('adm-modal-open');
      openDetail(project.id);
    }
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', teardown);
    overlay.querySelector('.adm-modal-backdrop').addEventListener('click', teardown);
    overlay.querySelector('[data-act="save"]').addEventListener('click', async () => {
      const title = overlay.querySelector('#del_title').value.trim();
      const description = overlay.querySelector('#del_desc').value.trim();
      const due = overlay.querySelector('#del_due').value || null;
      const vis = overlay.querySelector('input[name="del_vis"]:checked').value;
      const errEl = overlay.querySelector('#del_err');
      function err(m) { errEl.textContent = m; errEl.style.display = ''; }
      if (!title) return err('Title is required.');
      try {
        const body = isEdit
          ? { action: 'update', id: existing.id, title, description, due_date: due, visibility: vis }
          : { action: 'create', project_id: project.id, title, description, due_date: due, visibility: vis };
        const resp = await fetch(apiBase() + '/functions/v1/manage-deliverable', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) return err(data.error || `Failed (${resp.status})`);
        teardown();
      } catch (e) {
        err(String(e && e.message || e));
      }
    });

    if (isEdit) {
      wireDeliverableFiles(overlay, project, existing);
      wireDeliverableComments(overlay, project, existing);
    }
    setTimeout(() => overlay.querySelector('#del_title').focus(), 50);
  }

  // ── Deliverable files: list / upload / delete ─────────────────────────
  async function loadDeliverableFiles(deliverableId) {
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from('submission_attachments')
      .select('id, file_name, mime_type, size_bytes, uploaded_at, uploaded_by_role')
      .eq('deliverable_id', deliverableId)
      .order('uploaded_at', { ascending: true });
    if (error) { console.error('loadDeliverableFiles:', error); return []; }
    return data || [];
  }

  function renderDeliverableFiles(host, files) {
    if (!files.length) {
      host.innerHTML = '<div class="adm-empty" style="padding:8px 0;font-size:12px;">No files yet.</div>';
      return;
    }
    host.innerHTML = files.map((f) => {
      const kb = Math.max(1, Math.round((f.size_bytes || 0) / 1024));
      const sizeLabel = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
      return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--g2);border-radius:6px;background:#fff;margin-bottom:6px;font-size:13px;">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ESC(f.file_name)}</div>
          <div style="font-size:11px;color:var(--g6);">${sizeLabel} · ${shortDate(f.uploaded_at)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button type="button" class="btn-link" data-deliv-file-act="download" data-id="${ESC(f.id)}">Download</button>
          <button type="button" class="btn-link" style="color:#B91C1C;" data-deliv-file-act="remove" data-id="${ESC(f.id)}" data-name="${ESC(f.file_name)}">Remove</button>
        </div>
      </div>`;
    }).join('');
  }

  function wireDeliverableFiles(overlay, project, deliv) {
    const host = overlay.querySelector('#del_files_host');
    const fileInput = overlay.querySelector('#del_file_input');
    const uploadBtn = overlay.querySelector('#del_file_upload');
    const statusEl = overlay.querySelector('#del_file_status');
    if (!host) return;

    async function refresh() {
      const files = await loadDeliverableFiles(deliv.id);
      renderDeliverableFiles(host, files);
    }
    refresh();

    uploadBtn.addEventListener('click', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) { statusEl.textContent = 'Pick a file first.'; return; }
      statusEl.textContent = 'Uploading…';
      uploadBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('deliverable_id', deliv.id);
        const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
        const resp = await fetch(apiBase() + '/functions/v1/upload-submission-attachment', {
          method: 'POST',
          headers: {
            'Authorization': jwt ? `Bearer ${jwt}` : '',
            'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
          },
          body: fd,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          statusEl.textContent = data.error || `Upload failed (${resp.status})`;
          return;
        }
        statusEl.textContent = 'Uploaded.';
        fileInput.value = '';
        await refresh();
      } catch (e) {
        statusEl.textContent = `Upload failed: ${e && e.message || e}`;
      } finally {
        uploadBtn.disabled = false;
        setTimeout(() => { if (statusEl.textContent === 'Uploaded.') statusEl.textContent = ''; }, 2000);
      }
    });

    host.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-deliv-file-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-deliv-file-act');
      const id = btn.getAttribute('data-id');
      if (act === 'download') {
        const resp = await fetch(apiBase() + '/functions/v1/get-attachment-download-url', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ attachment_id: id }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok || !data.url) {
          alert(data.error || 'Could not get download URL.');
          return;
        }
        window.open(data.url, '_blank', 'noopener');
        return;
      }
      if (act === 'remove') {
        const name = btn.getAttribute('data-name') || 'this file';
        const ok = await (window.AdminModal?.confirm
          ? window.AdminModal.confirm({ title: 'Remove file?', message: `<p>Permanently remove <strong>${ESC(name)}</strong>? The client will no longer see this file.</p>`, confirmLabel: 'Remove', destructive: true })
          : confirm(`Remove ${name}?`));
        if (!ok) return;
        const resp = await fetch(apiBase() + '/functions/v1/delete-submission-attachment', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ attachment_id: id }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.ok === false) {
          alert(data.error || `Remove failed (${resp.status})`);
          return;
        }
        await refresh();
      }
    });
  }

  // ── Deliverable comments: list / post ─────────────────────────────────
  async function loadDeliverableComments(deliverableId) {
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from('deliverable_comments')
      .select('id, author_kind, author_label, body, created_at')
      .eq('deliverable_id', deliverableId)
      .order('created_at', { ascending: true });
    if (error) { console.error('loadDeliverableComments:', error); return []; }
    return data || [];
  }

  function renderDeliverableComments(host, comments) {
    if (!comments.length) {
      host.innerHTML = '<div class="adm-empty" style="padding:8px 0;font-size:12px;">No comments yet.</div>';
      return;
    }
    host.innerHTML = comments.map((c) => {
      const isAdmin = c.author_kind === 'admin';
      const bubble = isAdmin
        ? 'background:#fff;border:1px solid var(--g2);'
        : 'background:#EEF2FF;border:1px solid #C7D2FE;';
      return `<div style="margin-bottom:8px;">
        <div style="font-size:11px;color:var(--g6);margin-bottom:2px;">
          <strong>${ESC(c.author_label || (isAdmin ? 'Admin' : 'Client'))}</strong>
          <span style="margin-left:6px;">${shortDate(c.created_at)}</span>
          ${isAdmin ? '' : ' <span class="inv-list-tag">Client</span>'}
        </div>
        <div style="${bubble}border-radius:8px;padding:8px 10px;font-size:13px;white-space:pre-wrap;line-height:1.45;">${ESC(c.body)}</div>
      </div>`;
    }).join('');
    host.scrollTop = host.scrollHeight;
  }

  function wireDeliverableComments(overlay, project, deliv) {
    const host = overlay.querySelector('#del_comments_host');
    const input = overlay.querySelector('#del_comment_input');
    const sendBtn = overlay.querySelector('#del_comment_send');
    const statusEl = overlay.querySelector('#del_comment_status');
    if (!host) return;

    async function refresh() {
      const comments = await loadDeliverableComments(deliv.id);
      renderDeliverableComments(host, comments);
    }
    refresh();

    sendBtn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) { statusEl.textContent = 'Comment cannot be empty.'; return; }
      sendBtn.disabled = true;
      statusEl.textContent = 'Posting…';
      try {
        const resp = await fetch(apiBase() + '/functions/v1/manage-deliverable', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ action: 'add-comment', id: deliv.id, body: text }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          statusEl.textContent = data.error || `Failed (${resp.status})`;
          return;
        }
        input.value = '';
        statusEl.textContent = '';
        await refresh();
      } catch (e) {
        statusEl.textContent = `Failed: ${e && e.message || e}`;
      } finally {
        sendBtn.disabled = false;
      }
    });
  }

  window.AdminProjects = {
    openListScreen,
    openDetail,
  };
})();
