// Admin Setup Queue — flat list of every setup_tasks row across all
// studios that needs admin attention (submitted, no_account, in_progress).
// Click a row to drop straight into the studio's detail Setup tab.
//
// Mirrors admin/js/projects.js as the "list screen + dynamic table" pattern.
// Reads via supabase-js directly (RLS policy from migration 042 grants
// authenticated full select on setup_tasks).

(function () {
  'use strict';

  const SETUP_SURFACE_LABEL = {
    gbp: { icon: '🗺️', name: 'Google Business Profile' },
    ga4: { icon: '📊', name: 'Google Analytics 4' },
    gsc: { icon: '🔎', name: 'Google Search Console' },
    gtm: { icon: '🏷️', name: 'Google Tag Manager' },
    google_ads: { icon: '💰', name: 'Google Ads' },
    meta: { icon: '📘', name: 'Meta Business Manager' },
    tiktok: { icon: '🎵', name: 'TikTok Business Center' },
    sms_a2p: { icon: '💬', name: 'SMS A2P' },
    whatsapp: { icon: '🟢', name: 'WhatsApp Business' },
  };
  const STATUS_LABEL = {
    submitted: 'Submitted by studio',
    no_account: 'Needs us to create',
    in_progress: 'In progress',
  };
  const STATUS_STYLE = {
    submitted:   'background:var(--bl-l);color:var(--bl-d);',
    no_account:  'background:var(--bl-l);color:var(--bl-d);',
    in_progress: 'background:var(--am-l);color:var(--am);',
  };
  const OPEN_STATUSES = ['submitted', 'no_account', 'in_progress'];

  const state = { rows: [], surface: 'all', status: 'all' };

  function sb() {
    return (window.AdminAuth && window.AdminAuth.sb) || (window.initSupabase && window.initSupabase());
  }
  function ESC(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function dateAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const day = 24 * 60 * 60 * 1000;
    if (diff < day) return 'today';
    const days = Math.floor(diff / day);
    if (days === 1) return '1 day';
    if (days < 30) return `${days} days`;
    if (days < 60) return '1 month';
    return `${Math.floor(days / 30)} months`;
  }

  async function openListScreen() {
    const screen = ensureListScreen();
    screen.style.display = '';
    const hideIds = ['listScreen', 'detailScreen', 'catalogScreen', 'invoicesScreen', 'quotesScreen', 'inboxScreen', 'projectsScreen', 'projectDetailScreen', 'usersScreen', 'settingsScreen'];
    for (const id of hideIds) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    await loadRows();
    renderList();
  }

  function ensureListScreen() {
    let screen = document.getElementById('setupQueueScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'setupQueueScreen';
    screen.className = 'inbox-screen';
    const surfaceOptions = ['all', ...Object.keys(SETUP_SURFACE_LABEL)]
      .map((s) => `<option value="${s}">${s === 'all' ? 'All surfaces' : (SETUP_SURFACE_LABEL[s].icon + ' ' + SETUP_SURFACE_LABEL[s].name)}</option>`)
      .join('');
    const statusOptions = ['all', ...OPEN_STATUSES, 'complete']
      .map((s) => `<option value="${s}">${s === 'all' ? 'All open' : (s === 'complete' ? 'Complete (recently)' : STATUS_LABEL[s])}</option>`)
      .join('');
    screen.innerHTML = `
      <div class="inbox-hdr">
        <div>
          <h2 class="users-title">Setup queue</h2>
          <p class="users-desc">Every Setup Checklist tile across every studio that needs attention. Click a row to jump into that studio's Setup tab.</p>
        </div>
      </div>
      <div class="inbox-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;">
        <select id="setupQueueSurfaceFilter" style="padding:8px 12px;border:1px solid var(--g2);border-radius:8px;font-family:inherit;font-size:13px;">
          ${surfaceOptions}
        </select>
        <select id="setupQueueStatusFilter" style="padding:8px 12px;border:1px solid var(--g2);border-radius:8px;font-family:inherit;font-size:13px;">
          ${statusOptions}
        </select>
        <span id="setupQueueCount" style="margin-left:auto;align-self:center;color:var(--g6);font-size:12px;"></span>
      </div>
      <div class="inv-list-host" id="setupQueueBody"><div class="adm-empty" style="padding:40px 0;">Loading…</div></div>`;
    document.querySelector('main.adm-main').appendChild(screen);

    screen.querySelector('#setupQueueSurfaceFilter').addEventListener('change', (e) => {
      state.surface = e.target.value;
      renderList();
    });
    screen.querySelector('#setupQueueStatusFilter').addEventListener('change', (e) => {
      state.status = e.target.value;
      // Refetch when toggling between open-only and complete views since
      // we only load open rows by default.
      loadRows().then(renderList);
    });
    return screen;
  }

  async function loadRows() {
    const client = sb();
    if (!client) { state.rows = []; return; }
    const wantsComplete = state.status === 'complete';
    let q = client.from('setup_tasks')
      .select(`id, submission_id, surface, status, data, admin_notes,
               studio_submitted_at, admin_started_at, completed_at, updated_at,
               submission:submissions(id, studio_name, contact_email, plan, region, setup_type)`)
      .order('studio_submitted_at', { ascending: true, nullsFirst: false })
      .limit(500);
    if (wantsComplete) {
      q = q.eq('status', 'complete');
    } else {
      q = q.in('status', OPEN_STATUSES);
    }
    const { data, error } = await q;
    if (error) {
      console.error('setup-queue load:', error);
      state.rows = [];
      return;
    }
    state.rows = data || [];
  }

  function renderList() {
    const body = document.getElementById('setupQueueBody');
    if (!body) return;
    const filtered = state.rows.filter((r) => {
      if (state.surface !== 'all' && r.surface !== state.surface) return false;
      if (state.status !== 'all' && state.status !== 'complete' && r.status !== state.status) return false;
      return true;
    });
    document.getElementById('setupQueueCount').textContent = `${filtered.length} tile${filtered.length === 1 ? '' : 's'}`;
    if (!filtered.length) {
      body.innerHTML = `<div class="adm-empty" style="padding:40px 0;">${state.status === 'complete' ? 'No completed tiles yet.' : 'Nothing in the queue. Either no studios have submitted, or you\'re all caught up.'}</div>`;
      return;
    }
    body.innerHTML = `
      <table class="acct-inv-table" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;padding:10px 8px;color:var(--g6);font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid var(--g2);">Studio</th>
            <th style="text-align:left;padding:10px 8px;color:var(--g6);font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid var(--g2);">Surface</th>
            <th style="text-align:left;padding:10px 8px;color:var(--g6);font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid var(--g2);">Status</th>
            <th style="text-align:left;padding:10px 8px;color:var(--g6);font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid var(--g2);">Submitted</th>
            <th style="text-align:left;padding:10px 8px;color:var(--g6);font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid var(--g2);">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(renderRow).join('')}
        </tbody>
      </table>`;
    body.querySelectorAll('[data-open-sub]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const subId = tr.getAttribute('data-open-sub');
        // Hide queue, then drive the existing detail flow with the
        // tab=setup hash so the detail page opens straight into the
        // Setup tab.
        const queue = document.getElementById('setupQueueScreen');
        if (queue) queue.style.display = 'none';
        window.location.hash = `sub=${subId}&tab=setup`;
        if (window.AdminDetail && window.AdminDetail.open) {
          window.AdminDetail.open(subId, { tab: 'setup' });
        }
      });
    });
  }

  function renderRow(r) {
    const sub = r.submission || {};
    const meta = SETUP_SURFACE_LABEL[r.surface] || { icon: '•', name: r.surface };
    const statusStyle = STATUS_STYLE[r.status] || '';
    const submitted = r.studio_submitted_at
      ? `${ESC(dateAgo(r.studio_submitted_at))} ago`
      : (r.status === 'no_account' ? 'No account flag' : '—');
    const adminNotes = r.admin_notes ? ESC(r.admin_notes.slice(0, 80)) + (r.admin_notes.length > 80 ? '…' : '') : '';
    return `
      <tr data-open-sub="${ESC(sub.id || '')}" style="cursor:pointer;border-bottom:1px solid var(--g1);transition:background 0.1s;" onmouseover="this.style.background='var(--g1)'" onmouseout="this.style.background='transparent'">
        <td style="padding:12px 8px;font-size:13px;color:var(--in-d);font-weight:600;">${ESC(sub.studio_name || 'Untitled')}<div style="font-size:11px;font-weight:400;color:var(--g6);">${ESC(sub.contact_email || '')}</div></td>
        <td style="padding:12px 8px;font-size:13px;color:var(--in-d);"><span style="font-size:16px;">${meta.icon}</span> ${ESC(meta.name)}</td>
        <td style="padding:12px 8px;"><span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;${statusStyle}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td style="padding:12px 8px;font-size:13px;color:var(--g6);">${submitted}</td>
        <td style="padding:12px 8px;font-size:12px;color:var(--g6);font-style:${adminNotes ? 'normal' : 'italic'};">${adminNotes || 'no notes'}</td>
      </tr>`;
  }

  // Public surface for auth.js to call when the Setup nav link is clicked.
  window.AdminSetupQueue = { openListScreen, refresh: async () => { await loadRows(); renderList(); } };
})();
