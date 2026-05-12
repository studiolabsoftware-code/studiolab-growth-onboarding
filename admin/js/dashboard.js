/* Admin dashboard: submissions list with filter, search, realtime updates,
   and row-click → detail view. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;

  const STATUS_LABEL = {
    submitted: 'Submitted',
    in_review: 'In review',
    changes_requested: 'Changes requested',
    setup_in_progress: 'Setup in progress',
    complete: 'Complete',
  };
  const PLAN_LABEL = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
  const SETUP_LABEL = { dfy: 'Done-For-You', guided: 'Guided' };

  const state = {
    rows: [],
    filter: 'all',
    search: '',
    sub: null,
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

    $('statusPills').addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      state.filter = pill.dataset.filter;
      document.querySelectorAll('#statusPills .pill').forEach((p) => {
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

    $('subsBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && window.AdminDetail) window.AdminDetail.open(tr.dataset.id);
    });

    $('subsBody').addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (window.AdminDetail) window.AdminDetail.open(tr.dataset.id);
      }
    });
  }

  async function loadRows() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('submissions')
      .select('id, created_at, status, assigned_to, plan, setup_type, studio_name, contact_email, first_name, last_name')
      .order('created_at', { ascending: false });
    if (error) { console.error(error); return; }
    state.rows = data || [];
    render();
  }

  function subscribeRealtime() {
    const client = sb(); if (!client) return;
    if (window._submissionsChannel) return;
    window._submissionsChannel = client
      .channel('submissions-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, () => loadRows())
      .subscribe();
  }

  function maybeOpenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id && window.AdminDetail) window.AdminDetail.open(id);
  }

  function render() {
    const body = $('subsBody');
    const filtered = state.rows.filter((r) => {
      if (state.filter !== 'all' && r.status !== state.filter) return false;
      if (!state.search) return true;
      const hay = [r.studio_name, r.contact_email, r.first_name, r.last_name, r.assigned_to].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(state.search);
    });

    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="7" class="adm-empty">No submissions match.</td></tr>';
      return;
    }

    body.innerHTML = filtered.map((r) => {
      const date = new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
      const contact = [r.first_name, r.last_name].filter(Boolean).join(' ');
      const label = `${r.studio_name || 'Untitled'}, ${PLAN_LABEL[r.plan] || r.plan} plan, ${STATUS_LABEL[r.status] || r.status}`;
      return `
        <tr data-id="${r.id}" tabindex="0" role="button" aria-label="${escapeHtml(label)}">
          <td class="studio-cell">
            <div>${escapeHtml(r.studio_name || 'Untitled')}</div>
            <div class="muted" style="font-size:11px;color:var(--g6);font-weight:400;margin-top:2px;">${escapeHtml(contact)}</div>
          </td>
          <td><span class="bdg bdg-plan-${r.plan}">${PLAN_LABEL[r.plan] || r.plan}</span></td>
          <td><span class="bdg bdg-setup">${SETUP_LABEL[r.setup_type] || r.setup_type}</span></td>
          <td><span class="bdg bdg-st-${r.status}">${STATUS_LABEL[r.status] || r.status}</span></td>
          <td class="muted">${escapeHtml(r.assigned_to || 'Unassigned')}</td>
          <td class="muted">${escapeHtml(date)}</td>
          <td class="muted" aria-hidden="true">›</td>
        </tr>`;
    }).join('');
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
