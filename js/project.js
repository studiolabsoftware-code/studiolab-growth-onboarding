/* Client-facing project page — token-link based access to a single
   project. Mirrors portal.js. Authentication is by URL token (?p=<uuid>
   &t=<token>); anyone with the link can read. Phase 6.3 will add
   deliverable approve / request-revisions interactions. */

(function () {
  'use strict';

  const FN_BASE = 'https://hiaruvsdamggenhqdvtp.supabase.co/functions/v1/';

  const STATUS_LABEL = {
    briefing: 'Briefing',
    in_progress: 'In progress',
    review: 'In review',
    complete: 'Complete',
    cancelled: 'Cancelled',
    on_hold: 'On hold',
  };

  const TYPE_LABEL = {
    service: 'Service',
    consulting: 'Consulting',
    website_build: 'Website build',
    custom: 'Custom',
    other: 'Other',
  };

  const ACTIVITY_LABEL = {
    project_created: 'Project opened',
    project_completed: 'Project complete',
    invoice_paid: 'Invoice paid',
    invoice_refunded: 'Invoice refunded',
    invoice_partially_refunded: 'Partial refund processed',
    external_contact_paid: 'Payment received',
  };

  const state = {
    projectId: null,
    token: null,
    project: null,
    invoices: [],
    activity: [],
    billedCents: 0,
    activeTab: 'overview',
  };

  const $ = (id) => document.getElementById(id);

  function ESC(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function moneyFmt(cents, currency) {
    if (cents == null) return '—';
    return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: currency || 'AUD' });
  }
  function longDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function boot() {
    const params = new URLSearchParams(window.location.search);
    state.projectId = params.get('p') || '';
    state.token = params.get('t') || '';
    if (!state.projectId || !state.token) return showError();

    bindTabs();
    $('projRefresh').addEventListener('click', load);
    load();
  }

  function bindTabs() {
    document.querySelectorAll('.portal-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (!tab || tab === state.activeTab) return;
        state.activeTab = tab;
        document.querySelectorAll('.portal-tab').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        $('projTabOverview').style.display = tab === 'overview' ? '' : 'none';
        $('projTabDeliverables').style.display = tab === 'deliverables' ? '' : 'none';
        $('projTabInvoices').style.display = tab === 'invoices' ? '' : 'none';
      });
    });
  }

  async function load() {
    try {
      const resp = await fetch(FN_BASE + 'portal-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'load',
          project_id: state.projectId,
          token: state.token,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) return showError();
      state.project = data.project || null;
      state.invoices = data.invoices || [];
      state.activity = data.activity || [];
      state.billedCents = data.billed_cents || 0;
      render();
    } catch (err) {
      console.error('project load failed:', err);
      showError();
    }
  }

  function showError() {
    $('projErrorView').style.display = '';
    $('projMain').style.display = 'none';
  }

  function render() {
    if (!state.project) return showError();
    $('projErrorView').style.display = 'none';
    $('projMain').style.display = '';

    const p = state.project;
    $('projRecipientName').textContent = p.recipient_name || '';
    $('projType').textContent = TYPE_LABEL[p.project_type] || 'Project';
    $('projName').textContent = p.name || 'Project';
    $('projHeroMeta').innerHTML = [
      `Started ${ESC(longDate(p.created_at))}`,
      p.due_at ? `Due ${ESC(longDate(p.due_at))}` : '',
      p.completed_at ? `Completed ${ESC(longDate(p.completed_at))}` : '',
    ].filter(Boolean).join(' · ');

    const pill = $('projStatusPill');
    pill.textContent = STATUS_LABEL[p.status] || p.status;
    pill.className = 'proj-status-pill ps-' + (p.status || 'in_progress');

    renderOverview();
    renderInvoices();
  }

  function renderOverview() {
    const p = state.project;
    const summary = (() => {
      if (p.status === 'briefing') return `We're getting your project ready. Once we kick off, this page will fill out with deliverables and a timeline.`;
      if (p.status === 'in_progress') return `Your project is underway. We'll post each deliverable here as it lands, and you'll be able to approve or request changes directly.`;
      if (p.status === 'review') return `Your project is currently in review. Watch this page — deliverables to look over will appear shortly.`;
      if (p.status === 'on_hold') return `Your project is paused. We'll be in touch when work resumes.`;
      if (p.status === 'complete') return `Your project is complete. Everything we delivered lives on this page for reference.`;
      return `Your project is open.`;
    })();
    $('projOverviewSummary').textContent = summary;

    $('projBilledTotal').textContent = moneyFmt(state.billedCents, p.currency || 'AUD');
    const paidCount = state.invoices.filter((i) => i.status === 'paid' || i.status === 'partially_refunded').length;
    $('projBilledSub').textContent = paidCount > 0
      ? `${paidCount} ${paidCount === 1 ? 'invoice' : 'invoices'} paid`
      : (state.invoices.length > 0
        ? `${state.invoices.length} ${state.invoices.length === 1 ? 'invoice' : 'invoices'} issued`
        : 'No invoices yet');

    const list = $('projActivityList');
    if (state.activity.length === 0) {
      list.innerHTML = '<li class="portal-muted">Nothing to report yet.</li>';
    } else {
      list.innerHTML = state.activity.map((a) => `
        <li>
          <span class="proj-activity-when">${ESC(shortDate(a.at))}</span>
          <span class="proj-activity-what">${ESC(ACTIVITY_LABEL[a.action] || a.action.replace(/_/g, ' '))}</span>
        </li>`).join('');
    }
  }

  function renderInvoices() {
    const host = $('projInvoicesList');
    if (state.invoices.length === 0) {
      host.innerHTML = '<p class="portal-muted">No invoices linked to this project yet.</p>';
      return;
    }
    host.innerHTML = `
      <table class="proj-inv-table">
        <thead>
          <tr><th>Number</th><th>Amount</th><th>Status</th><th>Date</th></tr>
        </thead>
        <tbody>
          ${state.invoices.map((i) => {
            const statusBadge = i.status === 'paid'
              ? '<span class="proj-status-pill ps-complete">Paid</span>'
              : i.status === 'partially_refunded'
                ? '<span class="proj-status-pill ps-on_hold">Partial refund</span>'
                : i.status === 'open' || i.status === 'past_due'
                  ? '<span class="proj-status-pill ps-in_progress">Awaiting payment</span>'
                  : `<span class="proj-status-pill">${ESC(i.status)}</span>`;
            const when = i.paid_at || i.issued_at;
            return `<tr>
              <td>${ESC(i.number || '—')}</td>
              <td>${moneyFmt(i.total_cents, i.currency)}</td>
              <td>${statusBadge}</td>
              <td>${ESC(when ? shortDate(when) : '')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
