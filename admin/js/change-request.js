/* Change request modal: admin picks fields + message + TTL, sends to studio
   via the send-change-request Edge Function. Plan-aware field list.
   Implements an accessible modal: focus trap, Esc-to-close, focus restore,
   inert background, and ARIA wiring. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;

  const ALL_FIELDS = [
    { group: 'Studio details', items: [
      ['studio_name', 'Studio name'],
      ['legal_name', 'Legal business name'],
      ['country', 'Country'],
      ['timezone', 'Time zone'],
      ['studio_type', 'Studio type'],
      ['address', 'Studio address'],
      ['website', 'Website URL'],
      ['support_url', 'Support URL'],
    ]},
    { group: 'Contact', items: [
      ['first_name', 'First name'],
      ['last_name', 'Last name'],
      ['contact_email', 'Email address'],
      ['contact_phone', 'Phone number'],
      ['role', 'Role'],
      ['studiolab_email', 'StudioLAB login email'],
    ]},
    { group: 'Branding', items: [
      ['primary_colour', 'Primary colour'],
      ['secondary_colour', 'Secondary colour'],
      ['sign_off', 'Email sign-off'],
      ['email_tone', 'Email tone'],
      ['footer_notes', 'Footer notes'],
      ['studio_description', 'Studio description'],
    ]},
    { group: 'Email setup', items: [
      ['from_name', 'From name'],
      ['reply_email', 'Reply-to email'],
      ['email_domain', 'Email domain'],
      ['dns_access', 'DNS access'],
    ]},
    { group: 'SMS & social', plan: ['scale','ai'], items: [
      ['sms_type', 'SMS number type'],
      ['area_code', 'Preferred area code'],
      ['port_number', 'Number to port'],
      ['sms_tone', 'SMS tone notes'],
    ]},
    { group: 'Automations', items: [
      ['season_name', 'Season name'],
      ['enrol_open_date', 'Enrolment open date'],
      ['billing_start', 'Billing start'],
      ['season_end', 'Season end'],
    ]},
    { group: 'AI knowledge base', plan: ['ai'], items: [
      ['kb_profile', 'Studio profile'],
      ['kb_classes', 'Classes & timetable'],
      ['kb_pricing', 'Pricing'],
      ['kb_policies', 'Policies'],
      ['kb_events', 'Upcoming events'],
      ['kb_restricted', 'Restricted topics'],
      ['kb_tone', 'AI tone'],
      ['voice_hours', 'Voice agent hours'],
      ['voice_escalate', 'Voice escalation rules'],
    ]},
  ];

  const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let context = null;          // current submission
  let lastFocused = null;      // element to restore focus to on close

  function modal() { return document.getElementById('crModal'); }
  function card()  { return modal().querySelector('.adm-modal-card'); }

  function open(submission) {
    context = submission;
    renderFieldPicker(submission.plan);
    document.getElementById('crMessage').value = '';
    document.getElementById('crTtl').value = '72';
    document.getElementById('crErr').classList.remove('vis');
    document.querySelector('#crFields').closest('.f').classList.remove('has-error');

    lastFocused = document.activeElement;
    const m = modal();
    m.hidden = false;
    m.removeAttribute('aria-hidden');
    document.body.classList.add('adm-modal-open');
    setBackgroundInert(true);

    // Defer focus until after the browser reflows the now-visible modal.
    requestAnimationFrame(() => {
      const first = card().querySelector(FOCUSABLE);
      if (first) first.focus();
    });
  }

  function close() {
    const m = modal();
    if (m.hidden) return;
    m.hidden = true;
    m.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('adm-modal-open');
    setBackgroundInert(false);
    context = null;
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
    lastFocused = null;
  }

  // Hide everything outside the modal from assistive tech and tab order so
  // screen readers and keyboards stay inside the dialog while it is open.
  function setBackgroundInert(on) {
    const m = modal();
    Array.from(document.body.children).forEach((node) => {
      if (node === m) return;
      if (on) {
        if (node.hasAttribute('aria-hidden')) node.dataset._ariaHiddenPrev = node.getAttribute('aria-hidden');
        node.setAttribute('aria-hidden', 'true');
        if ('inert' in node) node.inert = true;
      } else {
        if ('inert' in node) node.inert = false;
        if (node.dataset._ariaHiddenPrev !== undefined) {
          node.setAttribute('aria-hidden', node.dataset._ariaHiddenPrev);
          delete node.dataset._ariaHiddenPrev;
        } else {
          node.removeAttribute('aria-hidden');
        }
      }
    });
  }

  function trapFocus(e) {
    if (modal().hidden) return;
    if (e.key !== 'Tab') return;
    const focusable = Array.from(card().querySelectorAll(FOCUSABLE))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function renderFieldPicker(plan) {
    const wrap = document.getElementById('crFields');
    const sections = ALL_FIELDS.filter((g) => !g.plan || g.plan.includes(plan));
    wrap.innerHTML = sections.map((g) => `
      <div role="presentation" style="grid-column:1/-1;margin-top:8px;font-size:11px;font-weight:700;color:var(--g6);text-transform:uppercase;letter-spacing:0.6px;">${escapeHtml(g.group)}</div>
      ${g.items.map(([k, label]) => `
        <label class="adm-field-chk" data-key="${k}">
          <input type="checkbox" value="${k}">
          <span>${escapeHtml(label)}</span>
        </label>`).join('')}
    `).join('');

    wrap.querySelectorAll('.adm-field-chk input').forEach((cb) => {
      cb.addEventListener('change', () => {
        cb.closest('.adm-field-chk').classList.toggle('sel', cb.checked);
      });
    });
  }

  async function send() {
    if (!context) return;
    const fields = Array.from(document.querySelectorAll('#crFields input[type="checkbox"]:checked')).map((i) => i.value);
    const err = document.getElementById('crErr');
    err.classList.remove('vis');
    const fieldErr = document.querySelector('#crFields').closest('.f');
    fieldErr.classList.toggle('has-error', fields.length === 0);
    if (fields.length === 0) {
      const firstCb = document.querySelector('#crFields input[type="checkbox"]');
      if (firstCb) firstCb.focus();
      return;
    }

    const message = (document.getElementById('crMessage').value || '').trim();
    const ttl_hours = parseInt(document.getElementById('crTtl').value, 10) || 72;
    const btn = document.getElementById('crSend');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Sending...';

    try {
      const client = sb();
      const { error } = await client.functions.invoke('send-change-request', {
        body: {
          submission_id: context.id,
          fields,
          message: message || null,
          created_by: window.AdminAuth.currentUser || 'admin',
          ttl_hours,
        },
      });
      if (error) throw error;
      close();
      if (window.AdminDetail?.refresh) window.AdminDetail.refresh();
      if (window.AdminDashboard?.refresh) window.AdminDashboard.refresh();
    } catch (e) {
      console.error('Change request send failed:', e);
      err.classList.add('vis');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = orig;
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close-modal"]')) close();
  });
  document.addEventListener('keydown', (e) => {
    const m = modal();
    if (!m || m.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    trapFocus(e);
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('crSend').addEventListener('click', send);
  });

  window.AdminChangeRequest = { open, close };
})();
