/* In-app confirm/alert dialogs. Replaces window.confirm and window.alert so
   the admin panel stays inside the app shell. Returns a Promise<boolean> for
   confirm and Promise<void> for alert. */
(function () {
  'use strict';

  let lastFocus = null;

  function el() { return document.getElementById('admConfirmModal'); }
  function card() { return el().querySelector('.adm-modal-card'); }

  function focusable(root) {
    return Array.from(root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter((n) => !n.disabled && n.offsetParent !== null);
  }

  function trapTab(e) {
    if (e.key !== 'Tab') return;
    const items = focusable(card());
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(opts) {
    return new Promise((resolve) => {
      const {
        title = 'Are you sure?',
        message = '',
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        danger = false,
        kind = 'confirm', // 'confirm' | 'alert'
      } = opts || {};

      const m = el();
      m.querySelector('[data-mod-title]').textContent = title;
      m.querySelector('[data-mod-body]').innerHTML = message;
      const confirmBtn = m.querySelector('[data-mod-confirm]');
      const cancelBtn = m.querySelector('[data-mod-cancel]');
      const closeBtn = m.querySelector('[data-mod-close]');

      confirmBtn.textContent = confirmLabel;
      confirmBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-p');
      cancelBtn.textContent = cancelLabel;
      cancelBtn.style.display = kind === 'alert' ? 'none' : '';

      lastFocus = document.activeElement;
      m.hidden = false;
      document.body.classList.add('adm-modal-open');

      function cleanup(result) {
        m.hidden = true;
        document.body.classList.remove('adm-modal-open');
        document.removeEventListener('keydown', onKey);
        m.removeEventListener('click', onClick);
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn.removeEventListener('click', onCancel);
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(kind === 'alert'); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        else if (e.key === 'Enter' && document.activeElement !== cancelBtn) { e.preventDefault(); onConfirm(); }
        else trapTab(e);
      }
      function onClick(e) {
        if (e.target.matches('[data-mod-backdrop]')) onCancel();
      }

      document.addEventListener('keydown', onKey);
      m.addEventListener('click', onClick);
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn.addEventListener('click', onCancel);

      requestAnimationFrame(() => {
        (kind === 'alert' ? confirmBtn : (danger ? cancelBtn : confirmBtn)).focus();
      });
    });
  }

  // Render a select-driven prompt by injecting it into the message body and
  // reading the choice on confirm. Resolves with the selected value or null on
  // cancel. Options: [{ value, label }, ...].
  async function prompt(opts) {
    const {
      title = 'Choose an option',
      message = '',
      options = [],
      value = '',
      confirmLabel = 'Save',
      cancelLabel = 'Cancel',
    } = opts || {};
    const selectId = 'admPromptSel_' + Math.random().toString(36).slice(2, 8);
    const optsHtml = options.map((o) =>
      `<option value="${o.value}"${o.value === value ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    const body = (message ? `<p>${message}</p>` : '') +
      `<div class="f" style="margin-top:10px;"><select id="${selectId}" style="width:100%;">${optsHtml}</select></div>`;
    const ok = await open({ kind: 'confirm', title, message: body, confirmLabel, cancelLabel });
    if (!ok) return null;
    const sel = document.getElementById(selectId);
    return sel ? sel.value : null;
  }

  // Reusable dialog hygiene for custom modals (the quote + invoice forms
  // built their own markup rather than using AdminModal.confirm). Wires ESC
  // to close, traps Tab inside the modal-card, and restores focus to the
  // trigger element on close. Returns a "teardown" function that detaches
  // listeners — call it from your modal's close() handler so listeners
  // don't accumulate across opens.
  function attachDialogHygiene(modalEl, opts) {
    const { onEscape, initialFocus } = opts || {};
    const lastFocused = document.activeElement;
    const cardEl = modalEl.querySelector('.adm-modal-card') || modalEl;

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof onEscape === 'function') onEscape();
      } else if (e.key === 'Tab') {
        const items = focusable(cardEl);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);

    requestAnimationFrame(() => {
      const target = (typeof initialFocus === 'function' ? initialFocus() : initialFocus)
        || focusable(cardEl)[0];
      if (target && typeof target.focus === 'function') target.focus();
    });

    return function teardown() {
      document.removeEventListener('keydown', onKey);
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try { lastFocused.focus(); } catch (_) { /* element gone */ }
      }
    };
  }

  window.AdminModal = {
    confirm(opts) { return open(Object.assign({ kind: 'confirm' }, opts)); },
    alert(opts) {
      const o = typeof opts === 'string' ? { message: opts } : (opts || {});
      return open(Object.assign({ kind: 'alert', confirmLabel: 'OK', title: 'Notice' }, o));
    },
    prompt,
    attachDialogHygiene,
  };
})();
