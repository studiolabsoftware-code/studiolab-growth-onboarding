/* Admin dashboard: stats per stage + grouped submission cards by status.
   Realtime updates via Supabase Realtime. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;

  const STATUS_LABEL = {
    submitted: 'Submitted',
    in_review: 'In review',
    changes_requested: 'Changes requested',
    setup_in_progress: 'Setup in progress',
    complete: 'Complete',
    active: 'Active',
    draft: 'Draft (not submitted)',
  };
  const PLAN_LABEL = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
  const SETUP_LABEL = { dfy: 'Done-For-You', guided: 'Guided' };

  // Visible groups in order. 'complete' and 'active' are hidden by default
  // behind a toggle — once a studio is past setup their row stops being
  // actionable from the dashboard list, but we still want a way to see
  // them when toggled on.
  const VISIBLE_GROUPS = ['submitted', 'in_review', 'changes_requested', 'setup_in_progress'];
  const STAT_GROUPS = ['submitted', 'in_review', 'changes_requested', 'setup_in_progress', 'complete', 'active'];

  const state = {
    rows: [],
    plan: 'all',
    search: '',
    statusFilter: 'all', // 'all' | one of STAT_GROUPS | 'draft'
    showCompleted: false,
    showActive: false,
    showDrafts: false,
  };

  const $ = (id) => document.getElementById(id);

  async function init() {
    bindUi();
    await loadRows();
    subscribeRealtime();
    maybeOpenFromUrl();
  }

  function bindUi() {
    if (window._dashboardBound) return;
    window._dashboardBound = true;

    $('planPills').addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      state.plan = pill.dataset.plan;
      document.querySelectorAll('#planPills .pill').forEach((p) => {
        const isActive = p === pill;
        p.classList.toggle('active', isActive);
        p.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      render();
    });

    $('searchInput').addEventListener('input', (e) => {
      state.search = (e.target.value || '').toLowerCase();
      render();
    });

    // Open preview when link is clicked — small dialog with six URLs
    $('previewLink').addEventListener('click', (e) => {
      e.preventDefault();
      openPreviewPicker();
    });

    // Delegated handlers for group expand toggles and submission card clicks
    $('groupsContainer').addEventListener('click', (e) => {
      const toggle = e.target.closest('[data-toggle-completed]');
      if (toggle) {
        state.showCompleted = !state.showCompleted;
        render();
        return;
      }
      const draftsToggle = e.target.closest('[data-toggle-drafts]');
      if (draftsToggle) {
        state.showDrafts = !state.showDrafts;
        render();
        return;
      }
      const activeToggle = e.target.closest('[data-toggle-active]');
      if (activeToggle) {
        state.showActive = !state.showActive;
        render();
        return;
      }
      const card = e.target.closest('.sub-card[data-id]');
      if (card && window.AdminDetail) window.AdminDetail.open(card.dataset.id);
    });

    const syncBtn = $('sheetSyncBtn');
    if (syncBtn) syncBtn.addEventListener('click', syncAllToSheet);

    $('groupsContainer').addEventListener('keydown', (e) => {
      const card = e.target.closest('.sub-card[data-id]');
      if (!card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (window.AdminDetail) window.AdminDetail.open(card.dataset.id);
      }
    });
  }

  async function loadRows() {
    const client = sb(); if (!client) return;

    const profile = window.AdminAuth?.profile;
    const isVa = profile?.role === 'va';

    // For VAs, restrict to submissions they have an active assignment on.
    let allowedIds = null;
    if (isVa) {
      const { data: ids } = await client.rpc('my_assigned_submission_ids');
      allowedIds = (ids || []).map((row) => row.my_assigned_submission_ids || row);
      if (!allowedIds.length) {
        state.rows = [];
        render();
        renderSheetSyncStatus();
        return;
      }
    }

    let q = client
      .from('submissions')
      .select('id, created_at, last_saved_at, status, assigned_to, plan, region, setup_type, studio_name, contact_email, first_name, last_name, sheets_synced_at, sheets_sync_error')
      .order('created_at', { ascending: false });
    if (allowedIds) q = q.in('id', allowedIds);

    const { data, error } = await q;
    if (error) { console.error(error); return; }

    // Pull active assignments alongside so the cards can show assignee name + status.
    const subIds = (data || []).map((r) => r.id);
    let assignmentMap = {};
    if (subIds.length) {
      const { data: asgns } = await client.from('submission_assignments')
        .select('submission_id, admin_user_id, status, assigned_at')
        .in('submission_id', subIds)
        .in('status', ['assigned','in_progress','needs_recheck']);
      const { data: users } = await client.from('admin_users')
        .select('id, name, email');
      const userById = {};
      (users || []).forEach((u) => { userById[u.id] = u; });
      (asgns || []).forEach((a) => {
        assignmentMap[a.submission_id] = {
          status: a.status,
          assignee: userById[a.admin_user_id],
        };
      });
    }

    state.rows = (data || []).map((r) => ({ ...r, _assignment: assignmentMap[r.id] || null }));
    render();
    renderSheetSyncStatus();
    // Surface inbox unread state on the cards. Cheap; cached in AdminInbox.
    if (window.AdminInbox?.refreshUnreadMap) {
      window.AdminInbox.refreshUnreadMap().then(render).catch(() => {});
    }
  }

  function renderSheetSyncStatus() {
    const el = document.getElementById('sheetSyncStatus');
    if (!el) return;
    const nonDrafts = state.rows.filter((r) => r.status !== 'draft');
    if (!nonDrafts.length) { el.textContent = 'Sheet backup: no submissions yet'; el.classList.remove('warn'); return; }
    const errored = nonDrafts.find((r) => r.sheets_sync_error);
    if (errored) {
      el.textContent = 'Sheet backup: last attempt failed';
      el.classList.add('warn');
      el.title = errored.sheets_sync_error;
      return;
    }
    const stamps = nonDrafts.map((r) => r.sheets_synced_at).filter(Boolean).map((s) => new Date(s).getTime());
    if (!stamps.length) { el.textContent = 'Sheet backup: never synced'; el.classList.add('warn'); return; }
    const latest = new Date(Math.max(...stamps));
    el.textContent = 'Sheet backup: synced ' + timeAgo(latest);
    el.classList.remove('warn');
    el.title = 'Last sync: ' + latest.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function timeAgo(d) {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)   return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    return Math.floor(s / 86400) + ' day' + (s >= 172800 ? 's' : '') + ' ago';
  }

  async function syncAllToSheet() {
    const btn = document.getElementById('sheetSyncBtn');
    const status = document.getElementById('sheetSyncStatus');
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    if (status) status.textContent = 'Sheet backup: syncing...';
    try {
      const client = sb();
      const { data, error } = await client.functions.invoke('sync-to-sheet', { body: { all: true } });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || 'Sync failed');
      await loadRows();
    } catch (err) {
      console.error('sync-to-sheet failed:', err);
      if (status) {
        status.textContent = 'Sheet backup: sync failed';
        status.classList.add('warn');
        status.title = String(err.message || err);
      }
      window.AdminModal.alert({ title: 'Sheet sync failed', message: escapeHtml(err.message || String(err)) });
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  function subscribeRealtime() {
    const client = sb(); if (!client) return;
    if (window._submissionsChannel) return;
    window._submissionsChannel = client
      .channel('submissions-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => loadRows())
      .subscribe();
  }

  // Deep-link router. Runs once at boot. Handles every link shape the
  // outbound emails use so admins click through to the right screen
  // instead of landing on the dashboard with the URL fragment ignored.
  //
  // Supported shapes (anything else is ignored, falls through to dashboard):
  //   ?id=<submission_id>          (legacy) -> open submission detail
  //   ?submission=<submission_id>  -> open submission detail
  //   ?project=<project_id>        -> open project detail
  //   ?invoice=<invoice_id>        -> open Invoices screen + select row
  //   ?quote=<quote_id>            -> open Quotes screen + select row
  //   #project=<project_id>        -> same as ?project=
  //   #invoice=<invoice_id>        -> same as ?invoice=
  //   #quote=<quote_id>            -> same as ?quote=
  //   #submission=<submission_id>  -> same as ?submission=
  //
  // Hash parses are needed because email clients sometimes strip the
  // querystring on link previews while preserving the fragment.
  function maybeOpenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    const pick = (k) => params.get(k) || hashParams.get(k);

    const submissionId = pick('id') || pick('submission');
    const projectId = pick('project');
    const invoiceId = pick('invoice');
    const quoteId = pick('quote');

    // Priority: project > invoice > quote > submission. The deliverable
    // emails are the most common case of users wanting to land on a
    // specific entity, and a project link should win if the URL carries
    // both (shouldn't happen, but defensive).
    if (projectId && window.AdminProjects?.openDetail) {
      window.AdminProjects.openDetail(projectId);
      return;
    }
    if (invoiceId && window.AdminInvoice?.openListScreen) {
      // The invoice list screen accepts an optional focus_invoice_id to
      // scroll-to + highlight. Falls back to just opening the list when
      // that argument isn't supported.
      try { window.AdminInvoice.openListScreen({ focusInvoiceId: invoiceId }); }
      catch (_) { window.AdminInvoice.openListScreen(); }
      return;
    }
    if (quoteId && window.AdminQuote?.openListScreen) {
      try { window.AdminQuote.openListScreen({ focusQuoteId: quoteId }); }
      catch (_) { window.AdminQuote.openListScreen(); }
      return;
    }
    if (submissionId && window.AdminDetail?.open) {
      window.AdminDetail.open(submissionId);
    }
  }

  function matchesFilters(r) {
    if (state.plan !== 'all' && r.plan !== state.plan) return false;
    if (state.statusFilter !== 'all' && r.status !== state.statusFilter) return false;
    if (!state.search) return true;
    const hay = [r.studio_name, r.contact_email, r.first_name, r.last_name, r.assigned_to].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(state.search);
  }

  function render() {
    renderStats();
    renderGroups();
  }

  function renderStats() {
    // Counts respect the plan + search filters so the chip totals match
    // what the studio list actually shows below. Status filter itself
    // does NOT affect counts (the chips are the way to pick a status, so
    // their totals stay stable as you change selection).
    const inScope = state.rows.filter((r) => {
      if (state.plan !== 'all' && r.plan !== state.plan) return false;
      if (state.search) {
        const hay = [r.studio_name, r.contact_email, r.first_name, r.last_name].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(state.search)) return false;
      }
      return true;
    });
    const counts = STAT_GROUPS.reduce((m, s) => (m[s] = 0, m), {});
    counts.draft = 0;
    inScope.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });
    const total = STAT_GROUPS.reduce((n, s) => n + counts[s], 0);

    // "All" chip + one per known status. The Active chip stays visible
    // even at zero so admin can navigate there post-handover without
    // dropping into the manual status dropdown on every detail page.
    const chip = (id, label, count) => {
      const isActive = state.statusFilter === id;
      const muted = !isActive && count === 0 && id !== 'all' ? ' muted' : '';
      return `
        <button type="button" class="stat-chip st-${id}${isActive ? ' active' : ''}${muted}" data-status-chip="${id}" aria-pressed="${isActive}">
          ${id === 'all' ? '' : '<span class="stat-chip-dot" aria-hidden="true"></span>'}
          <span>${escapeHtml(label)}</span>
          <span class="stat-chip-count">${count}</span>
        </button>`;
    };
    const parts = [chip('all', 'All', total)];
    STAT_GROUPS.forEach((s) => parts.push(chip(s, STATUS_LABEL[s], counts[s])));

    $('statsRow').innerHTML = parts.join('');
    $('statsRow').querySelectorAll('[data-status-chip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.statusFilter = btn.getAttribute('data-status-chip');
        // Selecting Complete or Active via the chip rail implicitly
        // unhides the matching collapsible group below — otherwise the
        // pill would highlight but the list would stay empty, which is
        // a confusing state.
        if (state.statusFilter === 'complete') state.showCompleted = true;
        if (state.statusFilter === 'draft') state.showDrafts = true;
        render();
      });
    });
  }

  function renderGroups() {
    const container = $('groupsContainer');
    const filtered = state.rows.filter(matchesFilters);

    // Group rows by status
    const byStatus = {};
    filtered.forEach((r) => {
      const k = r.status || 'submitted';
      (byStatus[k] = byStatus[k] || []).push(r);
    });

    // When a specific status is selected via the chip rail, render only
    // that single group full-bleed — the chip itself does the navigation
    // job that the previous toggles handled. When filter='all', keep the
    // historical layout: VISIBLE_GROUPS stacked, plus collapsibles for
    // complete / active / drafts.
    let html = '';
    if (state.statusFilter !== 'all') {
      const s = state.statusFilter;
      html += groupBlock(s, byStatus[s] || []);
    } else {
      VISIBLE_GROUPS.forEach((s) => {
        html += groupBlock(s, byStatus[s] || []);
      });

      const completed = byStatus.complete || [];
      html += `
        <div class="completed-toggle">
          <button type="button" data-toggle-completed>${state.showCompleted ? 'Hide' : 'Show'} completed (${completed.length})</button>
        </div>`;
      if (state.showCompleted) {
        html += groupBlock('complete', completed);
      }

      // Active is a terminal state too — surface a parallel toggle so
      // admin can scan the post-handover list without flipping the chip
      // filter explicitly.
      const activeRows = byStatus.active || [];
      if (activeRows.length || state.showActive) {
        html += `
          <div class="completed-toggle">
            <button type="button" data-toggle-active>${state.showActive ? 'Hide' : 'Show'} active (${activeRows.length})</button>
          </div>`;
        if (state.showActive) {
          html += groupBlock('active', activeRows);
        }
      }

      const drafts = byStatus.draft || [];
      if (drafts.length) {
        html += `
          <div class="completed-toggle">
            <button type="button" data-toggle-drafts>${state.showDrafts ? 'Hide' : 'Show'} drafts (${drafts.length})</button>
          </div>`;
        if (state.showDrafts) {
          html += groupBlock('draft', drafts);
        }
      }
    }

    container.innerHTML = html || '<div class="adm-empty" style="padding:40px 0;">No submissions match.</div>';
  }

  function groupBlock(status, rows) {
    const isEmpty = !rows.length;
    return `
      <div class="group-block${isEmpty ? ' empty' : ''}">
        <div class="group-hdr">
          <span>${escapeHtml(STATUS_LABEL[status] || status)}</span>
          <span class="group-count">${rows.length}</span>
        </div>
        <div class="group-body">
          ${isEmpty ? 'No submissions in this stage.' : rows.map(subCard).join('')}
        </div>
      </div>`;
  }

  function subCard(r) {
    const date = new Date(r.last_saved_at || r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const contact = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.contact_email || 'No contact yet';
    const region = (r.region || 'AU').toUpperCase();
    const planLabel = PLAN_LABEL[r.plan] || r.plan || '—';
    const setupLabel = r.setup_type ? (SETUP_LABEL[r.setup_type] || r.setup_type) : 'Setup TBD';

    const asgn = r._assignment;
    let asgnBadge = '';
    if (asgn && asgn.assignee) {
      const aStatusLabel = ASSIGNMENT_STATUS_LABEL[asgn.status] || asgn.status;
      asgnBadge = `<span class="bdg bdg-asgn-${asgn.status}" title="${escapeHtml(aStatusLabel)}">${escapeHtml(asgn.assignee.name)} · ${escapeHtml(aStatusLabel)}</span>`;
    } else if (r.assigned_to) {
      asgnBadge = `<span class="bdg bdg-setup">Assigned: ${escapeHtml(r.assigned_to)}</span>`;
    }

    // Unread messages indicator. The data lives on conversations.admin_unread_count
    // and is loaded by AdminInbox. Cards that have nothing waiting stay quiet.
    const unread = window.AdminInbox?.getUnreadForSubmission?.(r.id);
    const unreadBadge = unread && unread.count > 0
      ? `<span class="bdg bdg-unread" title="${unread.count} unread message${unread.count === 1 ? '' : 's'}">✉ ${unread.count} unread</span>`
      : '';
    const unreadRowClass = unread && unread.count > 0 ? ' has-unread' : '';

    return `
      <div class="sub-card${unreadRowClass}" data-id="${escapeHtml(r.id)}" tabindex="0" role="button" aria-label="${escapeHtml(r.studio_name || r.contact_email || 'Untitled')}">
        <div class="sc-row1">
          <span class="sc-name">${escapeHtml(r.studio_name || r.contact_email || 'Untitled')}</span>
          <span class="bdg bdg-plan-${r.plan || 'launch'}">${escapeHtml(planLabel)}</span>
        </div>
        <div class="sc-meta">${escapeHtml(contact)}<br>${escapeHtml(date)} · ${region} · ${escapeHtml(setupLabel)}</div>
        <div class="sc-badges">
          <span class="bdg bdg-st-${r.status}">${escapeHtml(STATUS_LABEL[r.status] || r.status)}</span>
          ${asgnBadge}
          ${unreadBadge}
        </div>
      </div>`;
  }

  const ASSIGNMENT_STATUS_LABEL = {
    assigned: 'Assigned',
    in_progress: 'In progress',
    needs_recheck: 'Needs re-check',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  function openPreviewPicker() {
    const baseHtml = `
      <div class="adm-modal" id="previewModal">
        <div class="adm-modal-backdrop" data-action="close-preview"></div>
        <div class="adm-modal-card" role="dialog" aria-modal="true" aria-labelledby="prevTitle">
          <div class="adm-modal-hdr">
            <h2 id="prevTitle" class="adm-modal-title">Preview a studio form</h2>
            <button type="button" class="adm-modal-close" data-action="close-preview" aria-label="Close"><span aria-hidden="true">&times;</span></button>
          </div>
          <div class="adm-modal-body">
            <p style="margin:0 0 14px;font-size:13px;color:var(--g6);line-height:1.55;">Open any of the six studio onboarding forms with the gate bypassed. You can cycle through every step without filling in your email. Nothing you do here is saved.</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              ${['launch','scale','ai'].flatMap((p) => ['au','us'].map((r) => {
                const label = (r === 'au' ? 'AU' : 'US') + ' · ' + PLAN_LABEL[p];
                return `<a class="picker-card" target="_blank" rel="noopener" href="/${r}/${p}/?preview=1"><span><strong>${label}</strong></span></a>`;
              })).join('')}
            </div>
          </div>
          <div class="adm-modal-ftr">
            <button type="button" class="btn btn-g" data-action="close-preview">Close</button>
          </div>
        </div>
      </div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = baseHtml;
    document.body.appendChild(wrap.firstElementChild);
    document.body.addEventListener('click', closePreviewMaybe, { once: false });
    function closePreviewMaybe(e) {
      const close = e.target.closest('[data-action="close-preview"]');
      if (close) {
        const m = document.getElementById('previewModal');
        if (m) m.remove();
        document.body.removeEventListener('click', closePreviewMaybe);
      }
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  window.AdminDashboard = {
    init,
    refresh: loadRows,
    showList() { document.getElementById('listScreen').style.display = ''; document.getElementById('detailScreen').style.display = 'none'; },
    showDetail() { document.getElementById('listScreen').style.display = 'none'; document.getElementById('detailScreen').style.display = ''; },
    formatters: { STATUS_LABEL, PLAN_LABEL, SETUP_LABEL },
  };
})();
