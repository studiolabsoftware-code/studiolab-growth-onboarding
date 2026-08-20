/* Submission detail view: full record, status/assign controls, notes, activity. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;
  const fmt = () => window.AdminDashboard.formatters;

  const ESC = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const empty = '<span class="empty">Not provided</span>';
  // Each formatter returns the rendered HTML plus the raw clipboard string.
  // section() rows can be [label, rendered, copyableString] or [label, value]
  // where the formatter handles the copy string automatically.
  const fmtVal = (v) => (v === null || v === undefined || v === '') ? empty : ESC(v);
  const fmtBool = (v) => v === true ? 'Yes' : v === false ? 'No' : empty;
  const fmtList = (v) => Array.isArray(v) && v.length ? ESC(v.join(', ')) : empty;
  // Business-type label map (Phase 1 — onboarding access & compliance).
  // Keep aligned with the form's BUSINESS_TYPE_LABEL.
  const BIZ_TYPES = { sole_prop: 'Sole Proprietor', llc: 'LLC', corp: 'Corporation', partnership: 'Partnership', nonprofit: 'Non-profit', pty_ltd: 'Pty Ltd', other_au: 'Other Australian entity', other: 'Other' };
  const businessTypeLabel = (v) => v ? (BIZ_TYPES[v] || v) : '';
  // Mask sensitive tax IDs in admin display. Reveal only the last 4 of an EIN
  // (so admins can confirm what's on file) and a copy-to-clipboard affordance
  // lets the full value be retrieved when actually needed for a registration.
  const maskTaxId = (v) => {
    if (!v) return empty;
    const s = String(v);
    const tail = s.slice(-4);
    return '<span class="masked-id" title="Click row to reveal/copy">••••' + ESC(tail) + '</span>';
  };
  const fmtDate = (v) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : empty;
  // Raw helpers: what should land in the clipboard for each value type.
  const rawVal  = (v) => (v === null || v === undefined || v === '') ? '' : String(v);
  const rawBool = (v) => v === true ? 'Yes' : v === false ? 'No' : '';
  const rawList = (v) => Array.isArray(v) && v.length ? v.join(', ') : '';

  let current = null;
  let currentAssignment = null;
  let currentAssignees = [];
  // Service requests for the open submission. Stashed at load time so
  // the Overview render and the action handlers (Send quote, Apply,
  // Decline) operate on the same dataset without redundant queries.
  let currentRequests = [];

  // Tabbed detail view (Phase: 2026-05-15 — replaces the long stacked
  // page). Lazy-hydrates non-Overview tabs the first time they're shown so
  // we don't pay for inbox/invoice/quote fetches until the user actually
  // visits the tab. Overview is always rendered eagerly because it's
  // template-only and the default landing tab.
  const DETAIL_TABS = ['overview', 'messages', 'setup', 'invoices', 'quotes', 'activity'];
  let currentTab = 'overview';
  let tabHydrated = { overview: false, messages: false, invoices: false, quotes: false, activity: false };
  let pendingCounts = { invoices: 0, quotes: 0, messages: 0 };
  let pendingNotes = [];
  let pendingLog = [];

  const ASSIGNMENT_STATUS_LABEL = {
    assigned: 'Assigned',
    in_progress: 'In progress',
    needs_recheck: 'Needs re-check',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  async function open(id, opts) {
    const client = sb(); if (!client) return;
    window.AdminDashboard.showDetail();
    const screen = document.getElementById('detailScreen');
    screen.innerHTML = '<div class="adm-empty" style="padding:60px">Loading...</div>';

    // Pick the initial tab. Explicit opts.tab wins (used by inbox.js deep
    // links); otherwise honour the URL hash; fall back to Overview.
    const requestedTab = pickInitialTab(opts && opts.tab);

    const [
      { data: sub, error },
      { data: notes },
      { data: log },
      { data: assignees },
      { data: assignment },
      invoiceCountRes,
      quoteCountRes,
    ] = await Promise.all([
      client.from('submissions').select('*').eq('id', id).single(),
      client.from('admin_notes').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
      client.from('activity_log').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
      client.from('admin_users').select('id, name, email, role, is_active').eq('is_active', true).order('name'),
      client.from('submission_assignments')
        .select('id, admin_user_id, status, assigned_at, last_sent_at, completed_at, notes')
        .eq('submission_id', id)
        .in('status', ['assigned','in_progress','needs_recheck'])
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Counts for the tab badges. head:true keeps the payload tiny.
      client.from('invoices').select('id', { count: 'exact', head: true }).eq('submission_id', id),
      client.from('quotes').select('id', { count: 'exact', head: true }).eq('submission_id', id),
    ]);

    // Service requests come in a separate fetch so the destructuring on
    // the bulk load above stays readable. Cheap query (small payload,
    // single submission scope) so a second round trip is fine.
    const { data: reqRows } = await client.from('service_requests')
      .select('id, kind, target_plan, target_setup_type, notes, status, quote_id, declined_reason, created_at, applied_at, applied_by, updated_at')
      .eq('submission_id', id)
      .order('created_at', { ascending: false });
    currentRequests = reqRows || [];

    if (error || !sub) {
      screen.innerHTML = '<div class="adm-empty">Could not load this submission.</div>';
      return;
    }
    current = sub;
    currentAssignment = assignment || null;
    currentAssignees = (assignees || []).filter((a) => a.role !== 'owner' || a.is_active);
    pendingNotes = notes || [];
    pendingLog = log || [];
    // Count of setup_tasks that need admin attention (submitted, no_account,
    // in_progress). Drives the badge on the Setup tab so admins see which
    // submissions have outstanding tiles without opening every one.
    const { count: setupOpenCount } = await client.from('setup_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', id)
      .in('status', ['submitted', 'no_account', 'in_progress']);

    pendingCounts = {
      invoices: invoiceCountRes?.count || 0,
      quotes: quoteCountRes?.count || 0,
      messages: (window.AdminInbox?.getUnreadForSubmission?.(sub.id) || {}).count || 0,
      setup: setupOpenCount || 0,
    };
    currentTab = requestedTab;
    tabHydrated = { overview: false, messages: false, setup: false, invoices: false, quotes: false, activity: false };

    render(sub);
    activateTab(currentTab);

    // Log a 'viewed' activity (best-effort)
    try {
      await client.from('activity_log').insert({
        submission_id: id, action: 'viewed', actor: window.AdminAuth.currentUser || 'admin',
      });
    } catch (e) { /* ignore */ }
  }

  function pickInitialTab(explicit) {
    if (explicit && DETAIL_TABS.includes(explicit)) return explicit;
    const m = (window.location.hash || '').match(/tab=([a-z]+)/i);
    if (m && DETAIL_TABS.includes(m[1].toLowerCase())) return m[1].toLowerCase();
    return 'overview';
  }

  function writeTabToHash(tab) {
    // Preserve any existing hash params (e.g. #sub=<id>) so deep links keep
    // working. Strip a prior tab= and append the new one.
    const hash = (window.location.hash || '').replace(/^#/, '');
    const parts = hash.split('&').filter((p) => p && !/^tab=/.test(p));
    parts.push('tab=' + tab);
    const next = '#' + parts.join('&');
    if (window.location.hash !== next) {
      // replaceState so tab changes don't pollute the browser back stack.
      try { history.replaceState(null, '', window.location.pathname + window.location.search + next); }
      catch (_) { window.location.hash = next; }
    }
  }

  function render(sub) {
    const screen = document.getElementById('detailScreen');
    const { STATUS_LABEL, PLAN_LABEL, SETUP_LABEL } = fmt();
    const submitted = new Date(sub.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

    screen.innerHTML = `
      <button type="button" class="det-back" id="detBack">← Back to all submissions</button>

      <div class="det-head">
        <div class="det-h-info">
          <div class="det-h-name">${ESC(sub.studio_name || 'Untitled')}</div>
          <div class="det-h-meta">Submitted ${ESC(submitted)} · Ref ${ESC(String(sub.id).replace(/-/g,'').substring(0,8).toUpperCase())}</div>
          <div class="det-h-badges">
            <span class="bdg bdg-plan-${sub.plan}">${PLAN_LABEL[sub.plan] || sub.plan}</span>
            <span class="bdg bdg-setup">${SETUP_LABEL[sub.setup_type] || sub.setup_type}</span>
            <span class="bdg bdg-st-${sub.status}">${STATUS_LABEL[sub.status] || sub.status}</span>
          </div>
        </div>
        <div class="det-actions">
          <button type="button" class="btn btn-p" id="detNewInvoice">+ Invoice</button>
          <button type="button" class="btn btn-p" id="detNewQuote">+ Quote</button>
          <button type="button" class="btn btn-p" id="detChangeReq">Request changes</button>
          <button type="button" class="btn btn-danger" id="detDelete" title="Delete this submission">Delete</button>
        </div>
      </div>

      <div class="det-tabs" role="tablist" aria-label="Submission sections">
        ${renderTabButton('overview',  '📋', 'Overview',  null)}
        ${renderTabButton('messages',  '📬', 'Messages',  pendingCounts.messages || null, 'unread')}
        ${renderTabButton('setup',     '🧩', 'Setup',     pendingCounts.setup || null, 'unread')}
        ${renderTabButton('invoices',  '🧾', 'Invoices',  pendingCounts.invoices || null)}
        ${renderTabButton('quotes',    '📄', 'Quotes',    pendingCounts.quotes   || null)}
        ${renderTabButton('activity',  '📊', 'Activity',  null)}
      </div>

      <div class="det-grid">
        <div class="det-main">
          <div class="det-tab-panel" data-panel="overview" role="tabpanel" hidden>
            ${renderOverviewHtml(sub)}
          </div>
          <div class="det-tab-panel" data-panel="setup" role="tabpanel" hidden>
            <section class="det-section det-tab-section">
              <div class="det-section-hdr">
                <h2 class="det-section-title">🧩 Setup Checklist</h2>
              </div>
              <div class="det-section-body" id="detSetupTasksHost">
                <div class="adm-empty" style="padding:24px 0;">Loading tiles…</div>
              </div>
            </section>
          </div>
          <div class="det-tab-panel" data-panel="messages" role="tabpanel" hidden>
            <section class="det-section det-tab-section">
              <div class="det-section-hdr">
                <h2 class="det-section-title">📬 Messages</h2>
              </div>
              <div class="det-section-body" id="detMessagesHost">
                <div class="adm-empty" style="padding:24px 0;">Loading thread…</div>
              </div>
            </section>
          </div>
          <div class="det-tab-panel" data-panel="invoices" role="tabpanel" hidden>
            <section class="det-section det-tab-section">
              <div class="det-section-hdr">
                <h2 class="det-section-title">🧾 Invoices</h2>
                <button type="button" class="btn-link" id="detNewInvoiceInline">+ New invoice</button>
              </div>
              <div class="det-section-body" id="studioInvoicesHost">
                <div class="adm-empty" style="padding:16px 0;">Loading invoices…</div>
              </div>
            </section>
          </div>
          <div class="det-tab-panel" data-panel="quotes" role="tabpanel" hidden>
            <section class="det-section det-tab-section">
              <div class="det-section-hdr">
                <h2 class="det-section-title">📄 Quotes</h2>
                <button type="button" class="btn-link" id="detNewQuoteInline">+ New quote</button>
              </div>
              <div class="det-section-body" id="studioQuotesHost">
                <div class="adm-empty" style="padding:16px 0;">Loading quotes…</div>
              </div>
            </section>
          </div>
          <div class="det-tab-panel" data-panel="activity" role="tabpanel" hidden>
            <section class="det-section det-tab-section">
              <div class="det-section-hdr"><h2 class="det-section-title">📝 Internal notes</h2></div>
              <div class="det-section-body">
                <textarea id="detNote" rows="3" placeholder="Add a note for the team..." style="width:100%;border:1px solid var(--g2);border-radius:8px;padding:8px;font-family:inherit;font-size:13px;resize:vertical;"></textarea>
                <button type="button" class="btn btn-p" id="detAddNote" style="margin-top:8px;">Add note</button>
                <div class="det-notes-list" id="detNotesList" style="margin-top:12px;"></div>
              </div>
            </section>
            <section class="det-section det-tab-section">
              <div class="det-section-hdr"><h2 class="det-section-title">📊 Activity log</h2></div>
              <div class="det-section-body">
                <div class="det-timeline" id="detTimeline"></div>
              </div>
            </section>
          </div>
        </div>

        <div class="det-side">
          <div class="det-section">
            <div class="det-section-hdr">Manage</div>
            <div class="det-section-body">
              <div class="det-field">
                <label for="detStatus">Status</label>
                <select id="detStatus">
                  ${['submitted','in_review','changes_requested','setup_in_progress','complete','active'].map((s) =>
                    `<option value="${s}"${s === sub.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
                </select>
              </div>
              ${markActiveBlock(sub)}
              ${assignmentBlock()}
              ${sheetSyncRow(sub)}
            </div>
          </div>
        </div>
      </div>
    `;

    // Always-on bindings (header + side panel + tab bar).
    document.getElementById('detBack').addEventListener('click', () => window.AdminDashboard.showList());
    document.getElementById('detStatus').addEventListener('change', (e) => updateField('status', e.target.value));
    bindAssignmentControls();
    document.getElementById('detChangeReq').addEventListener('click', () => window.AdminChangeRequest.open(sub));
    const openInvoiceModal = () => window.AdminInvoice && window.AdminInvoice.openForStudio(sub);
    const newInvHeader = document.getElementById('detNewInvoice');
    if (newInvHeader) newInvHeader.addEventListener('click', openInvoiceModal);
    const openQuoteModal = () => window.AdminQuote && window.AdminQuote.openForStudio(sub);
    const newQuoteHeader = document.getElementById('detNewQuote');
    if (newQuoteHeader) newQuoteHeader.addEventListener('click', openQuoteModal);
    const delBtn = document.getElementById('detDelete');
    if (delBtn) delBtn.addEventListener('click', handleDelete);
    const syncOne = document.getElementById('detSheetSync');
    if (syncOne) syncOne.addEventListener('click', syncThisToSheet);
    const markActiveBtn = document.getElementById('detMarkActive');
    if (markActiveBtn) markActiveBtn.addEventListener('click', markActive);
    bindServiceRequestHandlers();

    // Tab bar wiring (delegation for keyboard + click).
    const tabBar = screen.querySelector('.det-tabs');
    if (tabBar) {
      tabBar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (btn) activateTab(btn.getAttribute('data-tab'));
      });
      tabBar.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const btns = Array.from(tabBar.querySelectorAll('[data-tab]'));
        const idx = btns.findIndex((b) => b.classList.contains('active'));
        if (idx < 0) return;
        const next = e.key === 'ArrowRight'
          ? btns[(idx + 1) % btns.length]
          : btns[(idx - 1 + btns.length) % btns.length];
        if (next) { next.focus(); activateTab(next.getAttribute('data-tab')); }
      });
    }
  }

  function renderTabButton(tab, ico, label, count, badgeKind) {
    const isActive = tab === currentTab;
    const badge = count
      ? `<span class="det-tab-badge${badgeKind === 'unread' ? ' det-tab-badge-unread' : ''}">${count}</span>`
      : '';
    return `
      <button type="button" class="det-tab${isActive ? ' active' : ''}"
              data-tab="${tab}" role="tab"
              aria-selected="${isActive ? 'true' : 'false'}"
              tabindex="${isActive ? '0' : '-1'}">
        <span class="det-tab-ico" aria-hidden="true">${ico}</span>
        <span class="det-tab-label">${label}</span>
        ${badge}
      </button>`;
  }

  // Switch the visible tab and hydrate its content on first activation.
  // Safe to call repeatedly — hydration is gated by tabHydrated[tab].
  function activateTab(tab) {
    if (!DETAIL_TABS.includes(tab)) tab = 'overview';
    currentTab = tab;
    writeTabToHash(tab);

    const screen = document.getElementById('detailScreen');
    if (!screen) return;

    screen.querySelectorAll('.det-tab').forEach((btn) => {
      const active = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.setAttribute('tabindex', active ? '0' : '-1');
    });
    screen.querySelectorAll('.det-tab-panel').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-panel') !== tab;
    });

    hydrateTab(tab);
  }

  function hydrateTab(tab) {
    if (!current) return;
    if (tabHydrated[tab]) return;
    tabHydrated[tab] = true;
    switch (tab) {
      case 'overview':  return hydrateOverviewTab(current);
      case 'messages':  return hydrateMessagesTab(current);
      case 'setup':     return hydrateSetupTasksTab(current);
      case 'invoices':  return hydrateInvoicesTab(current);
      case 'quotes':    return hydrateQuotesTab(current);
      case 'activity':  return hydrateActivityTab(current);
    }
  }

  // -- Setup Checklist (Phase 2) --------------------------------------------
  //
  // Reads setup_tasks for the current submission and renders one row per
  // tile with surface name, current status, and the studio's submitted
  // data. Admins can change status (drives the trigger-based stamping of
  // admin_started_at / completed_at) and append a private admin note.
  //
  // Reads/writes go through supabase-js directly (RLS policy added in
  // migration 042 grants authenticated full select+update on setup_tasks).
  const SETUP_SURFACE_LABEL = {
    gbp: { icon: '🗺️', name: 'Google Business Profile' },
    ga4: { icon: '📊', name: 'Google Analytics 4' },
    gsc: { icon: '🔎', name: 'Google Search Console' },
    gtm: { icon: '🏷️', name: 'Google Tag Manager' },
    google_ads: { icon: '💰', name: 'Google Ads' },
    meta: { icon: '📘', name: 'Meta Business Manager' },
    tiktok: { icon: '🎵', name: 'TikTok Business Center' },
    sms_a2p: { icon: '💬', name: 'SMS A2P compliance' },
    whatsapp: { icon: '🟢', name: 'WhatsApp Business' },
  };
  const SETUP_STATUS_LABEL = {
    pending: 'Not started',
    submitted: 'Submitted',
    no_account: 'Needs us to create',
    in_progress: 'In progress',
    complete: 'Complete',
  };
  // Inline pill styles. Re-uses the same palette as the .bdg-st-* classes
  // but without depending on labels that don't have matching admin CSS
  // (admin badges are keyed on submission status enum, not setup status).
  const SETUP_STATUS_STYLE = {
    pending:     'background:var(--g2);color:var(--g6);',
    submitted:   'background:var(--bl-l);color:var(--bl-d);',
    no_account:  'background:var(--bl-l);color:var(--bl-d);',
    in_progress: 'background:var(--am-l);color:var(--am);',
    complete:    'background:var(--gr-l);color:var(--gr);',
  };

  async function hydrateSetupTasksTab(sub) {
    const host = document.getElementById('detSetupTasksHost');
    if (!host) return;
    const client = sb();
    if (!client) {
      host.innerHTML = '<div class="adm-empty">No Supabase client; refresh the page.</div>';
      return;
    }
    const { data: tasks, error } = await client
      .from('setup_tasks')
      .select('id, surface, status, data, admin_notes, studio_submitted_at, admin_started_at, completed_at, updated_at')
      .eq('submission_id', sub.id)
      .order('surface', { ascending: true });
    if (error) {
      host.innerHTML = `<div class="adm-empty" style="color:var(--rd);">Could not load tiles: ${ESC(String(error.message || error))}</div>`;
      return;
    }
    if (!tasks || !tasks.length) {
      host.innerHTML = `<div class="adm-empty">No tiles yet. They are seeded automatically when the studio first loads /account.html after payment.</div>`;
      return;
    }
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${tasks.map(renderSetupTaskRow).join('')}
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:var(--g5);">Status changes save instantly. Notes save on blur. Studio sees nothing here — admin-internal view.</p>`;
    host.querySelectorAll('[data-task-status]').forEach((sel) => {
      sel.addEventListener('change', async (e) => {
        const taskId = e.target.getAttribute('data-task-status');
        const newStatus = e.target.value;
        await updateSetupTask(taskId, { status: newStatus });
        // Re-fetch and re-render so timestamps refresh.
        tabHydrated.setup = false;
        hydrateSetupTasksTab(sub);
      });
    });
    host.querySelectorAll('[data-task-notes]').forEach((ta) => {
      ta.addEventListener('blur', async (e) => {
        const taskId = e.target.getAttribute('data-task-notes');
        const newNotes = e.target.value.trim();
        await updateSetupTask(taskId, { admin_notes: newNotes || null });
      });
    });
  }

  async function updateSetupTask(taskId, patch) {
    const client = sb();
    if (!client) return;
    const { error } = await client.from('setup_tasks').update(patch).eq('id', taskId);
    if (error) {
      window.AdminModal && window.AdminModal.alert
        ? window.AdminModal.alert('Could not save: ' + (error.message || error))
        : alert('Could not save: ' + (error.message || error));
    }
  }

  function renderSetupTaskRow(task) {
    const meta = SETUP_SURFACE_LABEL[task.surface] || { icon: '•', name: task.surface };
    const data = task.data || {};
    const dataRows = Object.entries(data)
      .filter(([_, v]) => v != null && String(v).length > 0)
      .map(([k, v]) => `<div><span style="color:var(--g6);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">${ESC(k)}:</span> <span style="font-size:13px;color:var(--in-d);word-break:break-word;">${ESC(String(v))}</span></div>`)
      .join('');
    const ts = (label, iso) => iso
      ? `<span style="color:var(--g5);">${label}: ${ESC(new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}</span>`
      : '';
    const tsLine = [
      ts('Studio submitted', task.studio_submitted_at),
      ts('Admin started', task.admin_started_at),
      ts('Completed', task.completed_at),
    ].filter(Boolean).join(' · ');
    const statusOptions = ['pending', 'submitted', 'no_account', 'in_progress', 'complete']
      .map((s) => `<option value="${s}"${s === task.status ? ' selected' : ''}>${SETUP_STATUS_LABEL[s]}</option>`)
      .join('');
    const pillStyle = SETUP_STATUS_STYLE[task.status] || SETUP_STATUS_STYLE.pending;
    return `
      <div class="det-card" style="border:1px solid var(--g2);border-radius:10px;padding:14px 16px;background:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--in-d);font-size:14px;">
            <span style="font-size:18px;line-height:1;">${meta.icon}</span>
            ${ESC(meta.name)}
            <span class="bdg" style="margin-left:6px;${pillStyle}">${ESC(SETUP_STATUS_LABEL[task.status] || task.status)}</span>
          </div>
          <select data-task-status="${ESC(task.id)}" style="padding:6px 10px;border:1px solid var(--g2);border-radius:6px;font-size:12px;font-family:inherit;background:#fff;">
            ${statusOptions}
          </select>
        </div>
        ${dataRows ? `<div style="display:grid;gap:4px;padding:8px 10px;background:var(--g1);border-radius:8px;margin-bottom:10px;">${dataRows}</div>` : '<div style="font-size:12px;color:var(--g5);font-style:italic;margin-bottom:10px;">No data submitted yet.</div>'}
        <textarea data-task-notes="${ESC(task.id)}" placeholder="Admin-only notes (saved on blur)..." rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--g2);border-radius:6px;font-size:12px;font-family:inherit;color:var(--in-d);resize:vertical;">${ESC(task.admin_notes || '')}</textarea>
        ${tsLine ? `<div style="font-size:11px;margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;">${tsLine}</div>` : ''}
      </div>`;
  }

  // -- Per-tab hydration ----------------------------------------------------

  function hydrateOverviewTab(sub) {
    // Wire section copy buttons (handled by global listeners),
    // section-level inline edits (global listeners), attachments panel,
    // and logo preview hydration. Overview HTML is already in the DOM.
    const attachHost = document.getElementById('detAttachmentsHost');
    if (attachHost) renderAttachments(sub.id, attachHost);
    const uploadTrigger = document.getElementById('detAttachUploadTrigger');
    const fileInput = document.getElementById('detAttachFileInput');
    if (uploadTrigger && fileInput) {
      uploadTrigger.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (!files.length) return;
        await uploadAttachments(sub.id, files);
        renderAttachments(sub.id, attachHost);
      });
    }
    hydrateLogos();
  }

  function hydrateMessagesTab(sub) {
    if (window.AdminInbox?.renderThreadInto) {
      const host = document.getElementById('detMessagesHost');
      if (host) window.AdminInbox.renderThreadInto(host, sub.id, { studioName: sub.studio_name || '' });
    }
  }

  function hydrateInvoicesTab(sub) {
    const newInvInline = document.getElementById('detNewInvoiceInline');
    if (newInvInline) {
      newInvInline.addEventListener('click', () => window.AdminInvoice && window.AdminInvoice.openForStudio(sub));
    }
    if (window.AdminInvoice) {
      const host = document.getElementById('studioInvoicesHost');
      if (host) window.AdminInvoice.renderStudioInvoicesPanel(sub.id, host);
    }
  }

  function hydrateQuotesTab(sub) {
    const newQuoteInline = document.getElementById('detNewQuoteInline');
    if (newQuoteInline) {
      newQuoteInline.addEventListener('click', () => window.AdminQuote && window.AdminQuote.openForStudio(sub));
    }
    if (window.AdminQuote) {
      const qHost = document.getElementById('studioQuotesHost');
      if (qHost) {
        qHost._submission = sub;
        window.AdminQuote.renderStudioQuotesPanel(sub.id, qHost);
      }
    }
  }

  function hydrateActivityTab(_sub) {
    const noteBtn = document.getElementById('detAddNote');
    if (noteBtn) noteBtn.addEventListener('click', addNote);
    renderNotes(pendingNotes);
    renderTimeline(pendingLog);
  }

  // -- Overview HTML (the long-form setup data + attachments) ---------------

  function renderOverviewHtml(sub) {
    const isLaunch = sub.plan === 'launch';
    const isScale = sub.plan === 'scale';
    const isAi = sub.plan === 'ai';
    return `
      ${serviceRequestsBlock(sub)}

      ${section('🏫 Studio details', [
        ['Studio name', fmtVal(sub.studio_name), undefined, 'studio_name'],
        ['Country', fmtVal(sub.country), undefined, 'country'],
        ['Time zone', fmtVal(sub.timezone), undefined, 'timezone'],
        ['Studio type', fmtVal(sub.studio_type), undefined, 'studio_type'],
        ['Website', sub.website ? `<a href="${ESC(sub.website)}" target="_blank" rel="noopener">${ESC(sub.website)}</a>` : empty, sub.website || '', 'website'],
        ['Support URL', sub.support_url ? `<a href="${ESC(sub.support_url)}" target="_blank" rel="noopener">${ESC(sub.support_url)}</a>` : empty, sub.support_url || '', 'support_url'],
      ])}

      ${section('🏛️ Business details', [
        ['Legal business name', fmtVal(sub.legal_business_name || sub.legal_name), undefined, 'legal_business_name'],
        ['Trading name / DBA', fmtVal(sub.trading_name), undefined, 'trading_name'],
        ['Business type', fmtVal(businessTypeLabel(sub.business_type)), undefined, 'business_type'],
        ['EIN', maskTaxId(sub.ein, 'ein'), undefined, 'ein'],
        ['ABN', fmtVal(sub.abn), undefined, 'abn'],
        ['ACN', fmtVal(sub.acn), undefined, 'acn'],
        ['Business email',
          sub.business_email
            ? `<a href="mailto:${ESC(sub.business_email)}">${ESC(sub.business_email)}</a>${sub.business_email_is_personal_domain ? ' <span class="warn-pill" title="Personal email domain — A2P and Meta registration require a business-domain email.">personal</span>' : ''}`
            : empty,
          sub.business_email || '',
          'business_email'],
        ['Street address', fmtVal(sub.address_street), undefined, 'address_street'],
        ['City / suburb', fmtVal(sub.address_city), undefined, 'address_city'],
        ['State / region', fmtVal(sub.address_region), undefined, 'address_region'],
        ['Postcode / ZIP', fmtVal(sub.address_postcode), undefined, 'address_postcode'],
        ['Single-line address', fmtVal(sub.address), undefined, 'address'],
      ])}

      ${section('👤 Primary contact', [
        ['First name', fmtVal(sub.first_name), undefined, 'first_name'],
        ['Last name', fmtVal(sub.last_name), undefined, 'last_name'],
        ['Email', sub.contact_email ? `<a href="mailto:${ESC(sub.contact_email)}">${ESC(sub.contact_email)}</a>` : empty, sub.contact_email || '', 'contact_email'],
        ['Phone', fmtVal(sub.contact_phone), undefined, 'contact_phone'],
        ['Role', fmtVal(sub.role), undefined, 'role'],
        ['StudioLAB login email', fmtVal(sub.studiolab_email), undefined, 'studiolab_email'],
      ])}

      ${section('🎨 Branding', [
        ['Logo', logoBlock(sub.logo_url), sub.logo_url || ''],
        ['Primary colour', colourSwatch(sub.primary_colour), sub.primary_colour || '', 'primary_colour'],
        ['Secondary colour', colourSwatch(sub.secondary_colour), sub.secondary_colour || '', 'secondary_colour'],
        ['Sign-off', fmtVal(sub.sign_off), undefined, 'sign_off'],
        ['Email tone', fmtVal(sub.email_tone), undefined, 'email_tone'],
        ['Footer notes', fmtVal(sub.footer_notes), undefined, 'footer_notes'],
        ['Studio description', fmtVal(sub.studio_description), undefined, 'studio_description'],
      ])}

      ${section('✉️ Email setup', [
        ['From name', fmtVal(sub.from_name), undefined, 'from_name'],
        ['Reply-to', fmtVal(sub.reply_email), undefined, 'reply_email'],
        ['Custom domain', fmtBool(sub.custom_domain)],
        ['Email domain', fmtVal(sub.email_domain), undefined, 'email_domain'],
      ])}

      ${section('✅ Consent', [
        ['Send-on-behalf consent', sub.consent_send_on_behalf == null ? '—' : (sub.consent_send_on_behalf ? 'Given' : 'Not given')],
        ['Captured at', fmtVal(sub.consent_captured_at)],
        ['Wording version', fmtVal(sub.consent_version)],
      ])}

      ${(isScale || isAi) ? section('💬 SMS & social', [
        ['Set up texting?', sub.sms_setup_requested == null ? '—' : (sub.sms_setup_requested ? 'Yes' : 'No')],
        ['Texting tone', fmtVal(sub.sms_tone), undefined, 'sms_tone'],
        ['Lead sources', fmtList(sub.lead_sources)],
      ]) : planNotice('SMS & social', 'Launch')}

      ${section('⚡ Plan automations', [
        ['Included', planAutomations(sub.plan), ''],
        ['Notes', 'Activated automatically once the account is live. Timing is pulled from StudioLAB season data.', ''],
      ])}

      ${section('📝 Additional notes', [
        ['Notes', sub.extra_notes ? ESC(sub.extra_notes) : empty, undefined, 'extra_notes'],
      ])}

      <section class="det-section">
        <div class="det-section-hdr">
          <span>📎 Attachments</span>
          <button type="button" class="copy-section-btn" id="detAttachUploadTrigger" title="Upload a file to this submission">
            <span class="copy-btn-ico" aria-hidden="true">+</span>Upload file
          </button>
        </div>
        <div class="det-section-body" id="detAttachmentsHost">
          <div class="adm-empty" style="padding:16px 0;">Loading attachments…</div>
        </div>
        <input type="file" id="detAttachFileInput" multiple
          accept=".pdf,.png,.jpg,.jpeg,.svg,.docx,.doc,.xlsx,.xls,application/pdf,image/png,image/jpeg,image/svg+xml,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          hidden>
      </section>
    `;
  }

  // ── Attachments (admin side) ───────────────────────────────────────────────
  const ATTACH_BYTE_FMT = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  };

  async function renderAttachments(submissionId, host) {
    host.innerHTML = '<div class="adm-empty" style="padding:12px 0;">Loading attachments…</div>';
    const client = sb(); if (!client) { host.innerHTML = '<div class="adm-empty">Client unavailable.</div>'; return; }
    const { data, error } = await client.from('submission_attachments_view')
      .select('id, file_name, mime_type, size_bytes, uploaded_by_role, uploaded_at, expires_at, retention_basis, message_id')
      .eq('submission_id', submissionId)
      .order('uploaded_at', { ascending: false });
    if (error) {
      host.innerHTML = `<div class="adm-empty">Could not load attachments: ${ESC(error.message)}</div>`;
      return;
    }
    const rows = data || [];
    if (rows.length === 0) {
      host.innerHTML = '<div class="adm-empty" style="padding:12px 0;">No attachments yet. Use <strong>Upload file</strong> above to add one, or studio uploads will appear here automatically.</div>';
      return;
    }
    host.innerHTML = `
      <table class="inv-table">
        <thead>
          <tr>
            <th>File</th>
            <th>Size</th>
            <th>Source</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const days = Math.max(0, Math.ceil((new Date(r.expires_at).getTime() - Date.now()) / (24*60*60*1000)));
            const expiryText = r.retention_basis === 'scheduled'
              ? `<span title="Scheduled — submission completed">${days}d (scheduled)</span>`
              : `<span title="Orphan backstop — no completion yet" style="color:var(--g6);">${days}d (orphan backstop)</span>`;
            const source = r.message_id
              ? '<span title="Uploaded via the messages thread">From message</span>'
              : r.uploaded_by_role === 'admin'
                ? '<span title="Uploaded by an admin">By admin</span>'
                : '<span title="Uploaded by the studio on the form">By studio</span>';
            return `
              <tr>
                <td><span style="font-weight:600;color:var(--in-d);">${ESC(r.file_name)}</span></td>
                <td style="font-size:12px;color:var(--g6);">${ATTACH_BYTE_FMT(r.size_bytes)}</td>
                <td style="font-size:12px;color:var(--g6);">${source}</td>
                <td style="font-size:12px;">${expiryText}</td>
                <td style="display:flex;gap:10px;flex-wrap:wrap;">
                  <a class="btn-link" href="#" data-attach-act="download" data-attach-id="${ESC(r.id)}">Download</a>
                  <a class="btn-link" style="color:#B91C1C;" href="#" data-attach-act="delete" data-attach-id="${ESC(r.id)}" data-attach-name="${ESC(r.file_name)}">Delete</a>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    if (!host._attachBound) {
      host._attachBound = true;
      host.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-attach-act]');
        if (!a) return;
        e.preventDefault();
        const act = a.getAttribute('data-attach-act');
        const id = a.getAttribute('data-attach-id');
        if (act === 'download') await downloadAttachment(id);
        else if (act === 'delete') {
          const name = a.getAttribute('data-attach-name') || 'this file';
          const ok = window.AdminModal
            ? await window.AdminModal.confirm({
                title: 'Delete attachment?',
                message: `<p>This permanently removes <strong>${ESC(name)}</strong> from this submission. The file will also be deleted from storage.</p>`,
                confirmLabel: 'Delete file',
                danger: true,
              })
            : confirm(`Delete ${name}?`);
          if (!ok) return;
          await deleteAttachment(id);
          renderAttachments(submissionId, host);
        }
      });
    }
  }

  async function uploadAttachments(submissionId, files) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/upload-submission-attachment';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('submission_id', submissionId);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': jwt ? `Bearer ${jwt}` : '',
            'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
          },
          body: fd,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.ok) {
          await (window.AdminModal
            ? window.AdminModal.alert({ title: 'Upload failed', message: ESC(data.error || `Status ${resp.status}.`) })
            : Promise.resolve(alert(data.error || `Upload failed (${resp.status}).`)));
        }
      } catch (err) {
        console.error('attachment upload failed:', err);
        await (window.AdminModal
          ? window.AdminModal.alert('Could not upload that file. Please try again.')
          : Promise.resolve(alert('Could not upload that file.')));
      }
    }
  }

  async function downloadAttachment(attachmentId) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/get-attachment-download-url';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
        body: JSON.stringify({ attachment_id: attachmentId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok || !data.url) {
        alert(data.error || `Could not download (${resp.status}).`);
        return;
      }
      // The signed URL already carries the download disposition + filename;
      // navigating triggers the browser download.
      window.location.assign(data.url);
    } catch (err) {
      console.error('download attachment failed:', err);
      alert('Could not download that file.');
    }
  }

  async function deleteAttachment(attachmentId) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/delete-submission-attachment';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
        body: JSON.stringify({ attachment_id: attachmentId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        alert(data.error || `Could not delete (${resp.status}).`);
      }
    } catch (err) {
      console.error('delete attachment failed:', err);
      alert('Could not delete that file.');
    }
  }


  async function handleDelete() {
    if (!current) return;
    const studio = current.studio_name || current.contact_email || 'this submission';
    const ok = await window.AdminModal.confirm({
      title: 'Delete submission?',
      message:
        `<p>Delete <strong>${escapeHtml(studio)}</strong>? This cannot be undone.</p>` +
        '<p style="color:var(--g6);margin-top:8px;">Any uploaded logo will be removed too.</p>',
      confirmLabel: 'Delete submission',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;

    const client = sb();
    if (current.logo_url) {
      const [bucket, ...rest] = current.logo_url.split('/');
      try { await client.storage.from(bucket).remove([rest.join('/')]); }
      catch (e) { console.warn('logo cleanup failed:', e); }
    }
    const { data: deleted, error } = await client.from('submissions')
      .delete()
      .eq('id', current.id)
      .select('id');
    if (error) {
      console.error('delete failed:', error);
      await window.AdminModal.alert({ title: 'Delete failed', message: escapeHtml(error.message || 'Unknown error.') });
      return;
    }
    if (!deleted || !deleted.length) {
      await window.AdminModal.alert({
        title: 'Delete blocked',
        message: 'The database refused the delete. Run the latest migration (007_submissions_delete_admin.sql) to grant admins delete permission, then try again.',
      });
      return;
    }
    current = null;
    if (window.AdminDashboard && window.AdminDashboard.refresh) await window.AdminDashboard.refresh();
    window.AdminDashboard.showList();
  }

  function section(title, rows) {
    // Section-level Copy button: gathers every row's copy text and writes
    // a labelled plain-text block to the clipboard. The VA workflow is
    // typically "copy this whole section, paste into GHL", so the section
    // button is more useful than per-row copies for bulk work.
    return `
      <div class="det-section">
        <div class="det-section-hdr">
          <span>${title}</span>
          <button type="button" class="copy-section-btn" data-copy-section title="Copy this section as plain text">
            <span class="copy-btn-ico" aria-hidden="true">⧉</span>Copy section
          </button>
        </div>
        <div class="det-section-body">
          <dl>
            ${rows.map(renderRow).join('')}
          </dl>
        </div>
      </div>`;
  }

  // Walks the section DOM and produces a labelled plain-text block ready
  // for paste into GHL (or anywhere else). One field per line, blank line
  // before the section title, label and value on the same line with a
  // pipe separator so column-style imports still parse cleanly.
  function buildSectionPlainText(sectionEl) {
    const titleEl = sectionEl.querySelector('.det-section-hdr > span');
    const title = titleEl ? titleEl.textContent.trim() : 'Section';
    const lines = [`# ${title}`, ''];
    sectionEl.querySelectorAll('.det-row').forEach((row) => {
      const labelEl = row.querySelector('dt');
      const copyBtn = row.querySelector('.copy-btn[data-copy]');
      const label = labelEl ? labelEl.textContent.trim() : '';
      const value = copyBtn ? copyBtn.getAttribute('data-copy') : '';
      if (!label) return;
      // Multi-line values (descriptions, policies, etc.) get a label on a
      // separate line above the value for readability.
      if (value.includes('\n') || value.length > 80) {
        lines.push(`${label}:`);
        lines.push(value || '—');
        lines.push('');
      } else {
        lines.push(`${label}: ${value || '—'}`);
      }
    });
    return lines.join('\n').trim();
  }

  // Each row is [label, renderedHtml, copyText?, editField?]. copyText falls
  // back to a stripped version of renderedHtml. editField, when set, enables
  // an Edit button that swaps the value into an input/textarea inline.
  function renderRow(row) {
    const [k, v, explicitCopy, editField] = row;
    let copy;
    if (explicitCopy !== undefined) {
      copy = explicitCopy;
    } else if (typeof v === 'string') {
      const stripped = v.replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
      copy = (stripped && stripped !== 'Not provided') ? stripped : '';
    } else {
      copy = '';
    }
    const copyBtn = copy
      ? `<button type="button" class="copy-btn" data-copy="${ESC(copy)}" aria-label="Copy ${ESC(k)}"><span class="copy-btn-ico" aria-hidden="true">⧉</span>Copy</button>`
      : '';
    const editBtn = editField
      ? `<button type="button" class="edit-btn" data-edit-field="${ESC(editField)}" data-edit-label="${ESC(k)}" aria-label="Edit ${ESC(k)}"><span class="copy-btn-ico" aria-hidden="true">✎</span>Edit</button>`
      : '';
    const dataAttr = editField ? ` data-field="${ESC(editField)}"` : '';
    return `<div class="det-row"${dataAttr}><dt>${ESC(k)}</dt><dd><span class="det-val">${v}</span>${copyBtn}${editBtn}</dd></div>`;
  }

  // ── Inline edit ────────────────────────────────────────────────────────────
  function enterEditMode(rowEl) {
    if (rowEl.classList.contains('editing')) return;
    const field = rowEl.dataset.field;
    if (!field || !current) return;
    const dd = rowEl.querySelector('dd');
    const valEl = dd.querySelector('.det-val');
    if (!dd || !valEl) return;
    const raw = current[field];
    const initial = raw === null || raw === undefined ? '' : String(raw);
    // Structured-address fields (address_street/city/region/postcode) are
    // short single-line inputs; only the legacy free-text 'address' column
    // benefits from the textarea, and that's already handled by the
    // length-based check below.
    const useTextarea = initial.length > 60 || /(notes|description|policies|profile|classes|pricing|events|restricted|tone|escalate|hours)/i.test(field) || field === 'address';
    rowEl.classList.add('editing');
    rowEl.dataset.originalValue = initial;
    const inputHtml = useTextarea
      ? `<textarea class="edit-input" rows="${Math.min(8, Math.max(3, Math.ceil(initial.length / 60)))}">${ESC(initial)}</textarea>`
      : `<input type="text" class="edit-input" value="${ESC(initial)}">`;
    dd.innerHTML = `${inputHtml}
      <div class="edit-actions">
        <button type="button" class="btn btn-p edit-save">Save</button>
        <button type="button" class="btn btn-g edit-cancel">Cancel</button>
      </div>`;
    const inp = dd.querySelector('.edit-input');
    if (inp) {
      inp.focus();
      if (inp.tagName === 'INPUT') inp.select();
    }
  }

  async function saveEdit(rowEl) {
    const field = rowEl.dataset.field;
    if (!field || !current) return;
    const inp = rowEl.querySelector('.edit-input');
    if (!inp) return;
    const newVal = inp.value.trim();
    const original = rowEl.dataset.originalValue || '';
    if (newVal === original) { cancelEdit(rowEl); return; }
    const client = sb();
    const save = rowEl.querySelector('.edit-save');
    if (save) { save.disabled = true; save.textContent = 'Saving...'; }
    const updateValue = newVal === '' ? null : newVal;
    const { error } = await client.from('submissions').update({ [field]: updateValue, updated_at: new Date().toISOString() }).eq('id', current.id);
    if (error) {
      console.error('field update failed:', error);
      if (save) { save.disabled = false; save.textContent = 'Save'; }
      window.AdminModal.alert({ title: 'Save failed', message: escapeHtml(error.message || 'Unknown error.') });
      return;
    }
    await client.from('activity_log').insert({
      submission_id: current.id, action: 'note_added', // closest existing enum value
      actor: window.AdminAuth.currentUser || 'admin',
      details: { field, from: original, to: updateValue, edited_by_admin: true },
    });
    current[field] = updateValue;
    open(current.id); // simplest refresh; preserves scroll
  }

  function cancelEdit(rowEl) {
    if (!rowEl || !current) return;
    rowEl.classList.remove('editing');
    open(current.id);
  }

  function handleDetailClick(e) {
    const edit = e.target.closest('.edit-btn');
    if (edit) {
      const row = edit.closest('.det-row');
      if (row) enterEditMode(row);
      return;
    }
    const save = e.target.closest('.edit-save');
    if (save) { saveEdit(save.closest('.det-row')); return; }
    const cancel = e.target.closest('.edit-cancel');
    if (cancel) { cancelEdit(cancel.closest('.det-row')); return; }
  }

  async function writeToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
  }

  function flashCopied(btn, doneLabel) {
    const original = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = '<span class="copy-btn-ico" aria-hidden="true">✓</span>' + (doneLabel || 'Copied');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = original;
    }, 1400);
  }

  async function handleCopyClick(e) {
    // Section-level copy button — grab every field in the section.
    const sectionBtn = e.target.closest('[data-copy-section]');
    if (sectionBtn) {
      const sectionEl = sectionBtn.closest('.det-section');
      if (!sectionEl) return;
      const text = buildSectionPlainText(sectionEl);
      if (!text) return;
      const ok = await writeToClipboard(text);
      flashCopied(sectionBtn, ok ? 'Section copied' : 'Copy failed');
      return;
    }
    // Field-level copy button.
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const text = btn.dataset.copy || '';
    if (!text) return;
    const ok = await writeToClipboard(text);
    flashCopied(btn, ok ? 'Copied' : 'Copy failed');
  }

  const PLAN_AUTOMATIONS = {
    launch: [
      'Abandoned Enrolment Recovery (3 emails)',
      'Re-Enrolment Campaign (6 emails)',
    ],
    scale: [
      'Abandoned Enrolment Recovery (3 emails)',
      'Abandoned Enrolment SMS',
      'Re-Enrolment Campaign (6 emails)',
      'Re-Enrolment SMS',
      'Missed Call Text-Back',
    ],
    ai: [
      'Abandoned Enrolment Recovery (3 emails)',
      'Abandoned Enrolment SMS',
      'Re-Enrolment Campaign (6 emails)',
      'Re-Enrolment SMS',
      'Missed Call Text-Back',
      'AI Chat Widget (after KB review)',
      'AI Voice Agent (after KB review)',
    ],
  };

  function planAutomations(plan) {
    const items = PLAN_AUTOMATIONS[plan] || [];
    if (!items.length) return empty;
    return '<ul style="margin:0;padding-left:18px;line-height:1.7;">' +
      items.map((i) => `<li>${ESC(i)}</li>`).join('') + '</ul>';
  }

  function assignmentBlock() {
    const profile = window.AdminAuth?.profile;
    const myRole = profile?.role || 'admin';
    const canManage = myRole === 'owner' || myRole === 'admin';
    const isAssignee = !!(profile && currentAssignment && currentAssignment.admin_user_id === profile.id);

    const a = currentAssignment;
    const assigneeName = a ? (currentAssignees.find((x) => x.id === a.admin_user_id)?.name || 'Unknown') : '';
    const statusLabel = a ? (ASSIGNMENT_STATUS_LABEL[a.status] || a.status) : 'Unassigned';
    const statusBdgClass = a ? `bdg-asgn-${a.status}` : 'bdg-asgn-none';
    const assignedAt = a?.assigned_at ? new Date(a.assigned_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    const dropdown = canManage ? `
      <div class="det-field">
        <label for="detAssignee">Assigned to</label>
        <select id="detAssignee">
          <option value="">— Unassigned —</option>
          ${currentAssignees.map((u) => `
            <option value="${ESC(u.id)}"${a && a.admin_user_id === u.id ? ' selected' : ''}>
              ${ESC(u.name)} (${ESC(u.role)})
            </option>`).join('')}
        </select>
      </div>` : `
      <div class="det-field">
        <label>Assigned to</label>
        <div class="det-static">${a ? ESC(assigneeName) : '<span class="empty">Unassigned</span>'}</div>
      </div>`;

    const lastSent = a?.last_sent_at ? new Date(a.last_sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null;
    const statusBlock = a ? `
      <div class="det-field">
        <label>Assignment status</label>
        <div class="det-asgn-status">
          <span class="bdg ${statusBdgClass}">${ESC(statusLabel)}</span>
          <span class="det-asgn-since">since ${ESC(assignedAt)}${lastSent ? ` · handoff sent ${ESC(lastSent)}` : ''}</span>
        </div>
      </div>` : '';

    const handoffBlock = (a && canManage) ? `
      <div class="det-field det-asgn-actions">
        <label>Handoff document</label>
        <div class="det-asgn-btns">
          <button type="button" class="btn btn-p" data-asgn-action="send_handoff">
            ${a.last_sent_at ? 'Resend handoff' : 'Send handoff'}
          </button>
        </div>
        <p class="det-asgn-hint">Generates a .docx with every field and emails it to ${ESC(assigneeName)}.</p>
      </div>` : '';

    // VAs viewing their own assignment can advance the status. Admins can too.
    const showVaControls = a && (isAssignee || canManage);
    const vaControls = showVaControls ? `
      <div class="det-field det-asgn-actions">
        <label>Update assignment status</label>
        <div class="det-asgn-btns">
          ${a.status !== 'in_progress' ? '<button type="button" class="btn btn-g" data-asgn-action="in_progress">Mark in progress</button>' : ''}
          ${a.status !== 'completed' ? '<button type="button" class="btn btn-p" data-asgn-action="completed">Mark completed</button>' : ''}
          ${a.status !== 'needs_recheck' ? '<button type="button" class="btn btn-g" data-asgn-action="needs_recheck">Flag needs re-check</button>' : ''}
        </div>
      </div>` : '';

    return dropdown + statusBlock + handoffBlock + vaControls;
  }

  function bindAssignmentControls() {
    const select = document.getElementById('detAssignee');
    if (select) select.addEventListener('change', (e) => changeAssignee(e.target.value || null));
    document.querySelectorAll('[data-asgn-action]').forEach((btn) => {
      const action = btn.dataset.asgnAction;
      if (action === 'send_handoff') {
        btn.addEventListener('click', () => sendHandoff(btn));
      } else {
        btn.addEventListener('click', () => updateAssignmentStatus(action));
      }
    });
  }

  async function changeAssignee(adminUserId) {
    const client = sb();
    const profile = window.AdminAuth?.profile;

    // Unassign path: cancel the current active assignment
    if (!adminUserId) {
      if (!currentAssignment) return;
      const { error } = await client.from('submission_assignments')
        .update({ status: 'cancelled' })
        .eq('id', currentAssignment.id);
      if (error) { window.AdminModal.alert({ title: 'Could not unassign', message: escapeHtml(error.message) }); return; }
      await client.from('submissions').update({ assigned_to: null }).eq('id', current.id);
      await client.from('activity_log').insert({
        submission_id: current.id, action: 'assigned',
        actor: window.AdminAuth.currentUser || 'admin',
        details: { from: currentAssignment.admin_user_id, to: null },
      });
      currentAssignment = null;
      await refreshAssignmentBlock();
      return;
    }

    // Assign path: insert a new active row; the BEFORE INSERT trigger cancels prior active.
    const { data: inserted, error } = await client.from('submission_assignments').insert({
      submission_id: current.id,
      admin_user_id: adminUserId,
      assigned_by: profile?.id || null,
      status: 'assigned',
    }).select('*').single();
    if (error) { window.AdminModal.alert({ title: 'Could not assign', message: escapeHtml(error.message) }); return; }

    // Mirror to legacy free-text field so existing dashboard cards and Sheet sync keep working.
    const assignee = currentAssignees.find((u) => u.id === adminUserId);
    await client.from('submissions').update({ assigned_to: assignee?.email || null }).eq('id', current.id);

    await client.from('activity_log').insert({
      submission_id: current.id, action: 'assigned',
      actor: window.AdminAuth.currentUser || 'admin',
      details: { to: assignee?.email || null, name: assignee?.name || null },
    });
    currentAssignment = inserted;
    await refreshAssignmentBlock();
    refreshTimeline();
  }

  async function updateAssignmentStatus(nextStatus) {
    if (!currentAssignment) return;
    const client = sb();
    const profile = window.AdminAuth?.profile;
    const isVa = profile?.role === 'va';
    const isAssignee = profile && currentAssignment.admin_user_id === profile.id;

    let error = null;
    if (isVa && isAssignee) {
      // VA self-update via RPC
      const r = await client.rpc('va_update_my_assignment', {
        p_assignment_id: currentAssignment.id, p_status: nextStatus,
      });
      error = r.error;
    } else {
      // Owner/admin direct update via RLS
      const r = await client.from('submission_assignments')
        .update({ status: nextStatus })
        .eq('id', currentAssignment.id);
      error = r.error;
    }
    if (error) { window.AdminModal.alert({ title: 'Could not update', message: escapeHtml(error.message) }); return; }

    // Refresh assignment from server (completed_at gets set by trigger)
    const { data: refreshed } = await client.from('submission_assignments')
      .select('id, admin_user_id, status, assigned_at, last_sent_at, completed_at, notes')
      .eq('id', currentAssignment.id).maybeSingle();
    currentAssignment = refreshed && (refreshed.status !== 'cancelled' && refreshed.status !== 'completed') ? refreshed : (refreshed?.status === 'completed' ? null : currentAssignment);

    // If completed, drop the legacy assigned_to field too
    if (nextStatus === 'completed') {
      await client.from('submissions').update({ assigned_to: null }).eq('id', current.id);
      currentAssignment = null;
    }

    await client.from('activity_log').insert({
      submission_id: current.id, action: 'assignment_status_changed',
      actor: window.AdminAuth.currentUser || 'admin',
      details: { to: nextStatus },
    });
    await refreshAssignmentBlock();
    refreshTimeline();
  }

  async function sendHandoff(btn) {
    if (!currentAssignment) return;
    const isResend = !!currentAssignment.last_sent_at;
    const ok = await window.AdminModal.confirm({
      title: isResend ? 'Resend handoff?' : 'Send handoff?',
      message: isResend
        ? '<p>Resend the handoff document to the assignee?</p>'
        : '<p>Generate and send the handoff document to the assignee?</p>',
      confirmLabel: isResend ? 'Resend' : 'Send handoff',
    });
    if (!ok) return;

    const client = sb();
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const { data, error } = await client.functions.invoke('send-handoff', {
        body: { submission_id: current.id },
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || 'Send failed.');
      await window.AdminModal.alert({ title: 'Handoff sent', message: `Sent to <strong>${escapeHtml(data.sent_to)}</strong>.` });
      await refreshAssignmentBlock();
    } catch (err) {
      await window.AdminModal.alert({ title: 'Could not send handoff', message: escapeHtml(err.message || String(err)) });
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async function refreshAssignmentBlock() {
    // Re-fetch and re-render only the Manage section pieces we control.
    const client = sb();
    const { data: assignment } = await client.from('submission_assignments')
      .select('id, admin_user_id, status, assigned_at, last_sent_at, completed_at, notes')
      .eq('submission_id', current.id)
      .in('status', ['assigned','in_progress','needs_recheck'])
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentAssignment = assignment || null;
    // Re-fetch notes + log so Activity tab has fresh data when shown.
    const [{ data: notes }, { data: log }] = await Promise.all([
      client.from('admin_notes').select('*').eq('submission_id', current.id).order('created_at', { ascending: false }),
      client.from('activity_log').select('*').eq('submission_id', current.id).order('created_at', { ascending: false }),
    ]);
    pendingNotes = notes || [];
    pendingLog = log || [];
    // Re-render the whole screen and restore the user's current tab so
    // they don't get bounced to Overview when assignment state changes.
    const savedTab = currentTab;
    tabHydrated = { overview: false, messages: false, invoices: false, quotes: false, activity: false };
    render(current);
    activateTab(savedTab);
  }

  // Service requests strip at the top of Overview. Shows open / quoted
  // / paid requests prominently because they're action-bearing; closed
  // ones (applied, declined, withdrawn) fold into a quiet history line
  // so they don't crowd the page once volume builds up.
  const REQ_KIND_LABEL = {
    plan_upgrade: 'Plan upgrade',
    setup_change: 'Setup type change',
    custom_addon: 'Custom add-on',
    other: 'General request',
  };
  const REQ_PLAN_LABEL = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
  const REQ_SETUP_LABEL = { dfy: 'Done-For-You', guided: 'Guided self-setup' };
  const REQ_STATUS_LABEL = {
    open:      { cls: 'bdg-req-open',      label: 'New' },
    quoted:    { cls: 'bdg-req-quoted',    label: 'Quoted — awaiting acceptance' },
    paid:      { cls: 'bdg-req-paid',      label: 'Paid — needs apply' },
    applied:   { cls: 'bdg-req-applied',   label: 'Applied' },
    declined:  { cls: 'bdg-req-declined',  label: 'Declined' },
    withdrawn: { cls: 'bdg-req-withdrawn', label: 'Withdrawn' },
  };

  function describeReq(r, sub) {
    if (r.kind === 'plan_upgrade') {
      return `${REQ_PLAN_LABEL[sub.plan] || sub.plan} → ${REQ_PLAN_LABEL[r.target_plan] || r.target_plan}`;
    }
    if (r.kind === 'setup_change') {
      return `${REQ_SETUP_LABEL[sub.setup_type] || sub.setup_type} → ${REQ_SETUP_LABEL[r.target_setup_type] || r.target_setup_type}`;
    }
    if (r.kind === 'custom_addon') return 'Custom add-on';
    return 'General request';
  }

  function serviceRequestsBlock(sub) {
    if (!currentRequests.length) return '';
    const open = currentRequests.filter((r) => r.status !== 'applied' && r.status !== 'declined' && r.status !== 'withdrawn');
    const closed = currentRequests.filter((r) => !open.includes(r));
    if (!open.length && !closed.length) return '';

    const rowsHtml = open.map((r) => {
      const st = REQ_STATUS_LABEL[r.status] || REQ_STATUS_LABEL.open;
      const kindLabel = REQ_KIND_LABEL[r.kind] || r.kind;
      const target = describeReq(r, sub);
      const created = new Date(r.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
      const actions = [];
      if (r.status === 'open') {
        actions.push(`<button type="button" class="btn btn-p" data-req-quote="${ESC(r.id)}">Send quote</button>`);
        actions.push(`<button type="button" class="btn" data-req-decline="${ESC(r.id)}">Decline</button>`);
      } else if (r.status === 'quoted') {
        actions.push(`<button type="button" class="btn" data-req-decline="${ESC(r.id)}">Decline</button>`);
      } else if (r.status === 'paid') {
        actions.push(`<button type="button" class="btn btn-p" data-req-apply="${ESC(r.id)}">Apply now</button>`);
      }
      return `
        <div class="req-row">
          <div class="req-row-main">
            <div class="req-row-kind">${ESC(kindLabel)} · <span class="req-row-target">${ESC(target)}</span></div>
            <div class="req-row-meta">Raised ${ESC(created)}</div>
            <div class="req-row-notes">${ESC(r.notes || '')}</div>
          </div>
          <div class="req-row-side">
            <span class="bdg ${st.cls}">${ESC(st.label)}</span>
            <div class="req-row-actions">${actions.join('')}</div>
          </div>
        </div>`;
    }).join('');

    const closedLine = closed.length
      ? `<div class="req-closed-line">${closed.length} previous request${closed.length === 1 ? '' : 's'} — ${closed.map((r) => ESC(REQ_STATUS_LABEL[r.status]?.label || r.status)).join(', ')}.</div>`
      : '';

    return `
      <section class="det-section req-section">
        <div class="det-section-hdr">
          <h2 class="det-section-title">🔁 Service requests</h2>
        </div>
        <div class="det-section-body">
          ${open.length ? `<div class="req-list">${rowsHtml}</div>` : '<div class="req-empty">No open requests right now.</div>'}
          ${closedLine}
        </div>
      </section>`;
  }

  function bindServiceRequestHandlers() {
    document.querySelectorAll('[data-req-quote]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-req-quote');
        const r = currentRequests.find((x) => x.id === id);
        if (!r || !current) return;
        // Open the existing quote modal with a service_request context
        // so it stamps service_request_id on the created quote row.
        if (window.AdminQuote && window.AdminQuote.openForStudio) {
          window.AdminQuote.openForStudio(current, { serviceRequest: r });
        }
      });
    });
    document.querySelectorAll('[data-req-apply]').forEach((btn) => {
      btn.addEventListener('click', () => applyRequest(btn.getAttribute('data-req-apply'), btn));
    });
    document.querySelectorAll('[data-req-decline]').forEach((btn) => {
      btn.addEventListener('click', () => declineRequest(btn.getAttribute('data-req-decline')));
    });
  }

  async function applyRequest(id, btn) {
    const r = currentRequests.find((x) => x.id === id);
    if (!r || !current) return;
    const target = describeReq(r, current);
    const confirmed = await (window.AdminModal && window.AdminModal.confirm
      ? window.AdminModal.confirm({
          title: 'Apply this request?',
          message: `<p>Applying <strong>${ESC(REQ_KIND_LABEL[r.kind] || r.kind)}</strong> (${ESC(target)}) will:</p>
            <ul style="margin:0 0 12px 18px;line-height:1.6;font-size:13px;">
              ${r.kind === 'plan_upgrade' ? '<li>Switch their plan on the submission record.</li>' : ''}
              ${r.kind === 'setup_change' ? '<li>Switch their setup type on the submission record.</li>' : ''}
              <li>Mark the request as Applied and stamp the apply time + your email for audit.</li>
              <li>Post a system event into their inbox thread.</li>
              <li>Email them confirming the change is live on our side.</li>
            </ul>
            <p style="margin:0;">Only do this once the linked quote has been paid (it has).</p>`,
          confirmText: 'Apply',
          confirmStyle: 'primary',
        })
      : Promise.resolve(confirm('Apply this request? Sends the studio a confirmation email.')));
    if (!confirmed) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
    try {
      const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
      const resp = await fetch(window.SUPABASE_CONFIG.url + '/functions/v1/admin-apply-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) },
        body: JSON.stringify({ request_id: id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Apply now'; }
        if (window.AdminModal?.alert) {
          window.AdminModal.alert({ title: 'Apply failed', message: ESC((data && data.error) || `Status ${resp.status}.`) });
        } else { alert((data && data.error) || `Could not apply (status ${resp.status}).`); }
        return;
      }
      open(current.id);
    } catch (err) {
      console.error('apply request failed', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Apply now'; }
      alert('We could not reach the server. Check your connection and try again.');
    }
  }

  async function declineRequest(id) {
    const r = currentRequests.find((x) => x.id === id);
    if (!r || !current) return;
    // Reason is required (the studio sees it verbatim). Prompt for it
    // via the modal helper -- falling back to window.prompt when the
    // modal isn't available.
    const reason = window.AdminModal && window.AdminModal.prompt
      ? await window.AdminModal.prompt({
          title: 'Decline this request',
          message: 'Tell the studio why we can\'t take this on. They see this verbatim.',
          placeholder: 'e.g. We don\'t have capacity for a custom website right now -- happy to recommend a partner.',
          confirmText: 'Send decline',
        })
      : window.prompt('Decline reason (the studio sees this verbatim):');
    if (!reason || !reason.trim()) return;
    try {
      const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
      const resp = await fetch(window.SUPABASE_CONFIG.url + '/functions/v1/admin-decline-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) },
        body: JSON.stringify({ request_id: id, reason: reason.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        if (window.AdminModal?.alert) {
          window.AdminModal.alert({ title: 'Decline failed', message: ESC((data && data.error) || `Status ${resp.status}.`) });
        } else { alert((data && data.error) || `Could not decline (status ${resp.status}).`); }
        return;
      }
      open(current.id);
    } catch (err) {
      console.error('decline request failed', err);
      alert('We could not reach the server. Check your connection and try again.');
    }
  }

  // "Mark as active" surface in the side panel. Different from a plain
  // status-dropdown flip because activation has side effects (email to
  // studio, system message into the inbox, activated_at stamp, account
  // page swaps to its banner mode). The button calls admin-mark-active
  // which is idempotent — clicking twice is a no-op.
  function markActiveBlock(sub) {
    if (sub.status === 'active') {
      const when = sub.activated_at
        ? new Date(sub.activated_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
        : 'an unknown time';
      return `
        <div class="det-field" style="margin-top:14px;padding:12px 14px;background:#D1FAE5;border-radius:8px;border:1px solid #6EE7B7;">
          <div style="font-size:12px;color:#047857;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;">Active</div>
          <div style="font-size:13px;color:#065F46;">Marked active on ${ESC(when)}.</div>
        </div>`;
    }
    if (sub.status === 'draft') return '';
    return `
      <div class="det-field" style="margin-top:14px;padding:12px 14px;background:#F0FDF4;border-radius:8px;border:1px dashed #86EFAC;">
        <div style="font-size:12px;color:#047857;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px;">Handover</div>
        <p style="margin:0 0 10px;font-size:12px;color:#065F46;line-height:1.5;">
          Flip this studio to <strong>Active</strong> once their GHL platform account is live. They'll get the activation email and their onboarding portal switches to the "you're live" confirmation view.
        </p>
        <button type="button" id="detMarkActive" class="btn btn-p" style="background:#047857;border-color:#047857;">Mark as active</button>
      </div>`;
  }

  async function markActive() {
    if (!current) return;
    const confirmed = await (window.AdminModal && window.AdminModal.confirm
      ? window.AdminModal.confirm({
          title: 'Mark studio as active?',
          message: `<p>This will:</p>
            <ul style="margin:0 0 12px 18px;line-height:1.6;font-size:13px;">
              <li>Set status to <strong>Active</strong> and stamp the activation time.</li>
              <li>Email the studio that their account is now live.</li>
              <li>Post a system event into their inbox thread.</li>
              <li>Swap their onboarding portal to the "you're live" confirmation view (no more self-edit).</li>
            </ul>
            <p style="margin:0;">Only do this once their GHL platform account is set up and ready for them to log into.</p>`,
          confirmText: 'Mark as active',
          confirmStyle: 'primary',
        })
      : Promise.resolve(confirm('Mark studio as active? This sends them the activation email.')));
    if (!confirmed) return;

    const btn = document.getElementById('detMarkActive');
    if (btn) { btn.disabled = true; btn.textContent = 'Marking active…'; }
    try {
      const jwt = (function () {
        try { return localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt'); }
        catch (_) { return null; }
      })();
      const resp = await fetch(window.SUPABASE_CONFIG.url + '/functions/v1/admin-mark-active', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}),
        },
        body: JSON.stringify({ submission_id: current.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Mark as active'; }
        const msg = (data && data.error) || `Could not mark active (status ${resp.status}).`;
        if (window.AdminModal && window.AdminModal.alert) {
          window.AdminModal.alert({ title: 'Activation failed', message: ESC(msg) });
        } else {
          alert(msg);
        }
        return;
      }
      // Reload the detail screen so the side panel reflects the new state
      // and the status dropdown shows Active.
      open(current.id);
    } catch (err) {
      console.error('mark active failed', err);
      if (btn) { btn.disabled = false; btn.textContent = 'Mark as active'; }
      alert('We could not reach the server. Check your connection and try again.');
    }
  }

  function sheetSyncRow(sub) {
    if (sub.status === 'draft') return '';
    let label;
    let warn = false;
    if (sub.sheets_sync_error) {
      label = 'Sheet backup: last sync failed';
      warn = true;
    } else if (!sub.sheets_synced_at) {
      label = 'Sheet backup: not yet synced';
      warn = true;
    } else {
      label = 'Sheet backup: ' + timeAgo(new Date(sub.sheets_synced_at));
    }
    const title = sub.sheets_sync_error ? ESC(sub.sheets_sync_error)
      : sub.sheets_synced_at ? new Date(sub.sheets_synced_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    return `
      <div class="det-sheet-sync">
        <span class="det-sheet-sync-label${warn ? ' warn' : ''}" title="${title}">${label}</span>
        <button type="button" id="detSheetSync">↻ Sync now</button>
      </div>`;
  }

  function timeAgo(d) {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)   return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    return Math.floor(s / 86400) + ' day' + (s >= 172800 ? 's' : '') + ' ago';
  }

  async function syncThisToSheet() {
    if (!current) return;
    const btn = document.getElementById('detSheetSync');
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      const client = sb();
      const { data, error } = await client.functions.invoke('sync-to-sheet', { body: { submission_id: current.id } });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || 'Sync failed');
      // Pull the row again so the timestamp updates.
      const { data: fresh } = await client.from('submissions').select('*').eq('id', current.id).single();
      if (fresh) { current = fresh; open(current.id); }
    } catch (err) {
      console.error('sync-to-sheet failed:', err);
      window.AdminModal.alert({ title: 'Sheet sync failed', message: escapeHtml(err.message || String(err)) });
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  function planNotice(name, plan) {
    return `
      <div class="det-section">
        <div class="det-section-hdr">${ESC(name)}</div>
        <div class="det-plan-notice">Not included in the ${plan} plan.</div>
      </div>`;
  }

  function colourSwatch(hex) {
    if (!hex) return empty;
    return `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${ESC(hex)};border:1px solid var(--g2);"></span><span style="font-family:monospace;">${ESC(hex)}</span></span>`;
  }

  function logoBlock(path) {
    if (!path) return empty;
    return `<span class="logo-block" data-logo-path="${ESC(path)}">
      <span class="logo-preview-wrap"><span class="logo-loading">Loading preview...</span></span>
      <span class="logo-meta"><span class="logo-path">${ESC(path)}</span></span>
    </span>`;
  }

  async function hydrateLogos() {
    const client = sb();
    if (!client) return;
    const wrappers = document.querySelectorAll('.logo-block');
    for (const wrap of wrappers) {
      const path = wrap.dataset.logoPath;
      if (!path) continue;
      // logo_url stored as "logos/uuid.ext" — strip the bucket prefix
      const [bucket, ...rest] = path.split('/');
      const file = rest.join('/');
      try {
        const { data, error } = await client.storage.from(bucket).createSignedUrl(file, 3600);
        if (error || !data?.signedUrl) throw error || new Error('No signed URL');
        const preview = wrap.querySelector('.logo-preview-wrap');
        const meta = wrap.querySelector('.logo-meta');
        if (preview) preview.innerHTML = `<a href="${ESC(data.signedUrl)}" target="_blank" rel="noopener"><img src="${ESC(data.signedUrl)}" alt="Studio logo" class="logo-thumb"></a>`;
        if (meta) meta.innerHTML = `<a href="${ESC(data.signedUrl)}" target="_blank" rel="noopener" class="logo-download">Open / download</a>`;
      } catch (e) {
        const preview = wrap.querySelector('.logo-preview-wrap');
        if (preview) preview.innerHTML = '<span class="logo-loading" style="color:var(--rd);">Could not load preview</span>';
        console.warn('logo signed url failed:', e);
      }
    }
  }

  async function updateField(field, value) {
    const client = sb();
    const prev = current[field];
    current[field] = value;
    const { error } = await client.from('submissions').update({ [field]: value }).eq('id', current.id);
    if (error) {
      console.error(error);
      current[field] = prev;
      return;
    }
    const action = field === 'status' ? 'status_changed' : (field === 'assigned_to' ? 'assigned' : null);
    if (action) {
      await client.from('activity_log').insert({
        submission_id: current.id, action, actor: window.AdminAuth.currentUser || 'admin',
        details: { field, from: prev, to: value },
      });
      refreshTimeline();
    }
  }

  async function addNote() {
    const ta = document.getElementById('detNote');
    const content = (ta.value || '').trim();
    if (!content) return;
    const client = sb();
    await client.from('admin_notes').insert({
      submission_id: current.id, content,
      created_by: window.AdminAuth.currentUser || 'admin',
    });
    await client.from('activity_log').insert({
      submission_id: current.id, action: 'note_added',
      actor: window.AdminAuth.currentUser || 'admin',
    });
    ta.value = '';
    const { data: notes } = await client.from('admin_notes').select('*').eq('submission_id', current.id).order('created_at', { ascending: false });
    renderNotes(notes || []);
    refreshTimeline();
  }

  async function refreshTimeline() {
    const client = sb();
    const { data: log } = await client.from('activity_log').select('*').eq('submission_id', current.id).order('created_at', { ascending: false });
    renderTimeline(log || []);
  }

  function renderNotes(notes) {
    const el = document.getElementById('detNotesList');
    if (!el) return;
    if (!notes.length) { el.innerHTML = '<div class="adm-empty" style="padding:16px 0;">No notes yet.</div>'; return; }
    el.innerHTML = notes.map((n) => `
      <div class="det-note">
        <div class="det-note-meta">${ESC(n.created_by)} · ${fmtDate(n.created_at)}</div>
        <div class="det-note-body">${ESC(n.content)}</div>
      </div>`).join('');
  }

  const ACTION_LABEL = {
    submitted: 'Submission received',
    viewed: 'Viewed',
    status_changed: 'Status changed',
    change_request_sent: 'Change request sent',
    change_request_completed: 'Studio completed change request',
    note_added: 'Note added',
    assigned: 'Reassigned',
    assignment_status_changed: 'Assignment status changed',
    handoff_sent: 'Handoff document sent',
    plan_changed: 'Plan changed',
  };

  function renderTimeline(log) {
    const el = document.getElementById('detTimeline');
    if (!el) return;
    if (!log.length) { el.innerHTML = '<div class="adm-empty" style="padding:16px 0;">No activity yet.</div>'; return; }
    el.innerHTML = log.map((e) => {
      const detail = e.details ? formatDetails(e.action, e.details) : '';
      return `
        <div class="det-tl-item">
          <div class="det-tl-dot"></div>
          <div class="det-tl-body">
            <div class="det-tl-action">${ESC(ACTION_LABEL[e.action] || e.action)}</div>
            <div class="det-tl-meta">${ESC(e.actor)} · ${fmtDate(e.created_at)}${detail ? ' · ' + detail : ''}</div>
          </div>
        </div>`;
    }).join('');
  }

  function formatDetails(action, d) {
    if (action === 'status_changed' && d?.from && d?.to) return `${ESC(d.from)} → ${ESC(d.to)}`;
    if (action === 'change_request_sent' && Array.isArray(d?.fields)) return `${d.fields.length} field(s)`;
    if (action === 'change_request_completed' && Array.isArray(d?.fields_updated)) return `${d.fields_updated.length} field(s) updated`;
    return '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Delegated handlers for copy and inline-edit interactions across the detail view.
  document.addEventListener('click', handleCopyClick);
  document.addEventListener('click', handleDetailClick);

  window.AdminDetail = {
    open,
    refresh: () => current && open(current.id),
    getCurrent: () => current,
  };
})();
