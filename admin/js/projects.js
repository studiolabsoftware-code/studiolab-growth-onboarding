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

    const [{ data: project, error: projErr }, { data: invoices }, { data: activity }] = await Promise.all([
      sb.from('projects')
        .select(`
          id, name, project_type, status, currency, due_at, notes, created_at, completed_at, cancelled_at,
          submission_id, external_contact_id, owner_admin_id,
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
    ]);
    if (projErr || !project) {
      screen.innerHTML = `<div class="adm-empty">Project not found.</div>`;
      return;
    }
    renderDetail(screen, project, invoices || [], activity || []);
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

  function renderDetail(screen, p, invoices, activity) {
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
            <div class="proj-card-hdr"><h3>Deliverables</h3></div>
            <div class="proj-card-body">
              <div class="adm-empty" style="padding:24px 0;">Coming in Phase 6.3 — per-project deliverables with submit-for-review, client approve, and revisions.</div>
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

  window.AdminProjects = {
    openListScreen,
    openDetail,
  };
})();
