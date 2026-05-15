/* StudioLAB Growth admin: one-off custom invoice creator.
   Opens a modal with two recipient modes (studio / external), one or more
   line items, currency, collection method, and posts to the
   create-custom-invoice edge function. Also renders the per-studio
   Invoices panel on the detail page. */

(function () {
  'use strict';

  const COUNTRY_LABEL = {
    AU: 'Australia',
    US: 'United States',
    CA: 'Canada',
    UK: 'United Kingdom',
    GB: 'United Kingdom',
    NZ: 'New Zealand',
  };

  const KIND_LABEL = {
    setup_invoice: 'Setup',
    custom_charge: 'Custom',
    quote_invoice: 'Quote',
    credit_note: 'Credit note',
  };

  const STATUS_LABEL = {
    draft: 'Draft',
    open: 'Open',
    paid: 'Paid',
    voided: 'Voided',
    uncollectible: 'Uncollectible',
    refunded: 'Refunded',
    partially_refunded: 'Partial refund',
  };

  const STATUS_CLASS = {
    draft: 'bdg-st-submitted',
    open: 'bdg-st-in_review',
    paid: 'bdg-st-complete',
    voided: 'bdg-st-changes_requested',
    uncollectible: 'bdg-st-changes_requested',
    refunded: 'bdg-st-changes_requested',
    partially_refunded: 'bdg-st-changes_requested',
  };

  // ── State (per-open) ───────────────────────────────────────────────────────
  let currentContext = null; // { mode: 'studio'|'external', submission?: {...} }
  let detachHygiene = null;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function moneyFmt(cents, currency) {
    if (cents == null) return '—';
    return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: currency || 'AUD' });
  }

  function ESC(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // Strict country-to-currency mapping. AU recipients are always invoiced in
  // AUD with GST; everyone else is invoiced in USD without GST. This is
  // load-bearing for tax handling — invoicing an AU recipient in USD would
  // skip the GST line and invoicing an overseas recipient in AUD would add
  // GST that shouldn't apply. We enforce this in the UI by locking the
  // currency selector once a country is known.
  function currencyForCountry(c) {
    if (!c) return null;
    const u = c.trim().toUpperCase();
    if (u === 'AU' || u === 'AUS' || u === 'AUSTRALIA') return 'AUD';
    return 'USD';
  }

  function lockCurrency(currency, reason) {
    const sel = $('#invCurrency');
    if (!sel) return;
    if (currency) {
      sel.value = currency;
      sel.disabled = true;
      sel.title = reason || '';
    } else {
      sel.disabled = false;
      sel.title = '';
    }
  }

  // ── Modal: open / close ────────────────────────────────────────────────────
  function open(ctx) {
    currentContext = ctx;
    const modal = $('#invoiceModal');
    if (!modal) {
      console.error('invoiceModal markup missing from admin/index.html');
      return;
    }
    // Default state
    const isStudio = ctx && ctx.mode === 'studio' && ctx.submission;
    $('#invRecipientStudio').checked = isStudio;
    $('#invRecipientExternal').checked = !isStudio;
    if (isStudio) {
      $('#invStudioName').textContent = ctx.submission.studio_name || ctx.submission.contact_email || '—';
      $('#invStudioMeta').textContent = [
        ctx.submission.contact_email,
        COUNTRY_LABEL[(ctx.submission.country || '').toUpperCase()] || ctx.submission.country,
      ].filter(Boolean).join(' · ');
      const studioCurrency = currencyForCountry(ctx.submission.country) || 'AUD';
      lockCurrency(studioCurrency,
        studioCurrency === 'AUD'
          ? 'Australian studio — AUD with GST is required.'
          : 'Overseas studio — USD without GST is required.');
    } else {
      $('#invStudioName').textContent = 'No studio selected';
      $('#invStudioMeta').textContent = '';
      $('#invCurrency').value = 'AUD';
      lockCurrency(null);
    }
    // Reset external fields
    $('#invExtEmail').value = '';
    $('#invExtName').value = '';
    $('#invExtCountry').value = '';
    // Reset other fields
    $('#invCollection').value = 'send_invoice';
    $('#invDueDays').value = '14';
    $('#invDescription').value = '';
    $('#invMemo').value = '';
    // Reset line items. If we're opening as a revision of an existing
    // invoice, rehydrate every line item from the Stripe snapshot so the
    // admin sees exactly what's on the original. The original is NOT
    // voided yet — that happens later, on submit, only if the admin
    // actually sends. Cancelling leaves the original untouched.
    $('#invItems').innerHTML = '';
    const rev = ctx && ctx.revision;
    if (rev && Array.isArray(rev.lines) && rev.lines.length) {
      for (const line of rev.lines) {
        addLineItemRow({
          description: line.description || '',
          quantity: line.quantity || 1,
          amount: (((line.unit_amount_cents != null ? line.unit_amount_cents : 0) / 100) || 0).toFixed(2),
        });
      }
      if (rev.description) $('#invDescription').value = rev.description;
      if (rev.due_days) $('#invDueDays').value = String(rev.due_days);
      if (rev.collection_method) $('#invCollection').value = rev.collection_method;
      if (rev.currency && $('#invCurrency')) $('#invCurrency').value = rev.currency;
    } else if (rev) {
      // Legacy single-line fallback (kept so older callers don't break).
      addLineItemRow({
        description: rev.description || '',
        quantity: rev.quantity || 1,
        amount: rev.amount || '',
      });
      if (rev.description) $('#invDescription').value = rev.description;
    } else {
      addLineItemRow();
    }
    updateModeUI();
    updateTotalsUI();
    $('#invErr').classList.remove('vis');
    $('#invSuccess').hidden = true;
    $('#invForm').hidden = false;
    $('#invSendBtn').disabled = false;
    // Reframe the CTA when revising so the admin knows the original will
    // be voided as part of this action.
    $('#invSendBtn').textContent = rev && rev.pendingVoidId
      ? 'Void original and re-issue'
      : 'Create and send';

    modal.hidden = false;
    document.body.classList.add('adm-modal-open');
    if (window.AdminModal && window.AdminModal.attachDialogHygiene) {
      detachHygiene = window.AdminModal.attachDialogHygiene(modal, {
        onEscape: close,
        initialFocus: () => isStudio
          ? $('#invItems input[data-fld="description"]')
          : $('#invExtEmail'),
      });
    } else {
      setTimeout(() => {
        const target = isStudio ? $('#invItems input[data-fld="description"]') : $('#invExtEmail');
        if (target) target.focus();
      }, 50);
    }
  }

  function close() {
    const modal = $('#invoiceModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('adm-modal-open');
    currentContext = null;
    if (typeof detachHygiene === 'function') {
      detachHygiene();
      detachHygiene = null;
    }
  }

  function updateModeUI() {
    const isStudio = $('#invRecipientStudio').checked;
    $('#invStudioBlock').hidden = !isStudio;
    $('#invExternalBlock').hidden = isStudio;
    // The dueDays row only matters for send_invoice
    const send = $('#invCollection').value === 'send_invoice';
    $('#invDueDaysRow').hidden = !send;
    // Re-evaluate the currency lock when toggling recipient mode.
    if (isStudio && currentContext?.submission) {
      const c = currencyForCountry(currentContext.submission.country) || 'AUD';
      lockCurrency(c,
        c === 'AUD'
          ? 'Australian studio — AUD with GST is required.'
          : 'Overseas studio — USD without GST is required.');
    } else {
      onExternalCountryChange();
    }
  }

  function onExternalCountryChange() {
    const country = $('#invExtCountry').value;
    const c = currencyForCountry(country);
    if (c === 'AUD') {
      lockCurrency('AUD', 'Australian recipient — AUD with GST is required.');
    } else if (c === 'USD') {
      lockCurrency('USD', 'Overseas recipient — USD without GST is required.');
    } else {
      lockCurrency(null);
    }
    updateTotalsUI();
  }

  // ── Catalog picker (upgrade SKUs) ────────────────────────────────────────
  // Opens the shared AdminCatalogPicker. The picked row is converted into a
  // new line item — manual rows added via "+ Add line" are unaffected and
  // the admin can still edit any picked row's fields before sending.
  function openCatalogPicker() {
    if (!window.AdminCatalogPicker || typeof window.AdminCatalogPicker.open !== 'function') {
      console.warn('AdminCatalogPicker not loaded yet');
      return;
    }
    const currency = ($('#invCurrency').value || 'AUD').toUpperCase();
    window.AdminCatalogPicker.open({
      currency,
      onPick(row) {
        // Append a pre-filled line. Amount is in major units (dollars) to
        // match the existing line-item input format; quantity defaults to 1.
        const amount = ((row.amount_cents || 0) / 100).toFixed(2);
        const includesNote = Array.isArray(row.includes) && row.includes.length
          ? ' — ' + row.includes.join('; ')
          : '';
        addLineItemRow({
          description: row.name + (row.description ? ' · ' + row.description : '') + includesNote,
          quantity: 1,
          amount,
        });
        updateTotalsUI();
      },
    });
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  function addLineItemRow(initial) {
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.innerHTML = `
      <input type="text" data-fld="description" placeholder="Description" value="${ESC(initial?.description || '')}">
      <input type="number" data-fld="quantity" min="1" step="1" value="${ESC(initial?.quantity || 1)}" style="width:70px;">
      <input type="number" data-fld="amount" min="0" step="0.01" placeholder="0.00" value="${ESC(initial?.amount || '')}" style="width:120px;">
      <button type="button" class="btn-link" data-act="remove">Remove</button>
    `;
    row.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateTotalsUI));
    row.querySelector('[data-act="remove"]').addEventListener('click', () => {
      const all = $$('#invItems .inv-row');
      if (all.length <= 1) return; // Always keep at least one row
      row.remove();
      updateTotalsUI();
    });
    $('#invItems').appendChild(row);
  }

  function collectLineItems() {
    const rows = $$('#invItems .inv-row');
    return rows.map((r) => ({
      description: r.querySelector('[data-fld="description"]').value.trim(),
      quantity: parseInt(r.querySelector('[data-fld="quantity"]').value, 10) || 1,
      amount_cents: Math.round(parseFloat(r.querySelector('[data-fld="amount"]').value || '0') * 100),
    }));
  }

  function updateTotalsUI() {
    const items = collectLineItems();
    const currency = $('#invCurrency').value;
    const subtotalCents = items.reduce((s, li) => s + (li.amount_cents * li.quantity), 0);
    // GST preview shown only for AUD; Stripe Tax computes the actual value
    // based on the customer's address.country at finalize time.
    const isAud = currency === 'AUD';
    const taxCents = isAud ? Math.round(subtotalCents * 0.10) : 0;
    const totalCents = subtotalCents + taxCents;
    $('#invSubtotal').textContent = moneyFmt(subtotalCents, currency);
    $('#invTax').textContent = isAud
      ? `+ ${moneyFmt(taxCents, currency)} GST (10%)`
      : 'No GST — overseas recipient';
    $('#invTotal').textContent = `${moneyFmt(totalCents, currency)}${isAud ? ' incl. GST' : ''}`;
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validateAndBuildPayload() {
    const isStudio = $('#invRecipientStudio').checked;
    const errors = [];

    let recipient;
    if (isStudio) {
      if (!currentContext || !currentContext.submission) {
        errors.push('No studio selected.');
      } else {
        recipient = { type: 'studio', submission_id: currentContext.submission.id };
      }
    } else {
      const email = $('#invExtEmail').value.trim().toLowerCase();
      const name = $('#invExtName').value.trim();
      const country = $('#invExtCountry').value.trim().toUpperCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid recipient email.');
      // Block side-door routing: typing Australia into an external invoice
      // is fine (we treat as AU), but a typed-out spelling shouldn't go
      // through as AU code. UI guides them to use the ISO code dropdown.
      recipient = {
        type: 'external',
        email,
        name: name || undefined,
        country: country || undefined,
      };
    }

    const currency = $('#invCurrency').value;
    if (currency !== 'AUD' && currency !== 'USD') errors.push('Currency must be AUD or USD.');

    const items = collectLineItems();
    if (items.length === 0) errors.push('Add at least one line item.');
    for (const li of items) {
      if (!li.description) errors.push('Each line item needs a description.');
      if (!Number.isInteger(li.amount_cents) || li.amount_cents <= 0) errors.push(`Line "${li.description || '(blank)'}" needs a positive amount.`);
      if (!Number.isInteger(li.quantity) || li.quantity <= 0) errors.push(`Line "${li.description || '(blank)'}" needs a positive quantity.`);
    }

    const collectionMethod = $('#invCollection').value;
    const dueInDays = collectionMethod === 'send_invoice' ? (parseInt($('#invDueDays').value, 10) || 14) : undefined;

    return {
      ok: errors.length === 0,
      errors,
      payload: errors.length === 0 ? {
        recipient,
        currency,
        line_items: items,
        collection_method: collectionMethod,
        due_in_days: dueInDays,
        description: $('#invDescription').value.trim() || undefined,
        memo: $('#invMemo').value.trim() || undefined,
      } : null,
    };
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submit() {
    $('#invErr').classList.remove('vis');
    const { ok, errors, payload } = validateAndBuildPayload();
    if (!ok) {
      $('#invErr').textContent = errors.join(' ');
      $('#invErr').classList.add('vis');
      return;
    }
    const btn = $('#invSendBtn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
      const apiBase = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url);
      const anonKey = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '';
      const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': jwt ? `Bearer ${jwt}` : '',
        'apikey': anonKey,
      };

      // Revision flow: void the original FIRST. If void fails (e.g. the
      // original got paid between opening Revise and clicking Send) we
      // abort here, leave the original alone, and surface the error. The
      // admin can cancel out and try again, or pay attention to the new
      // state of the original.
      if (currentContext && currentContext.revision && currentContext.revision.pendingVoidId) {
        btn.textContent = 'Voiding original…';
        const vResp = await fetch(apiBase + '/functions/v1/manage-invoice', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ action: 'void', invoice_id: currentContext.revision.pendingVoidId }),
        });
        const vData = await vResp.json().catch(() => ({}));
        if (!vResp.ok || !vData.ok) {
          $('#invErr').textContent = 'Could not void the original (' + (vData.error || vResp.status) + '). The original invoice has not been changed.';
          $('#invErr').classList.add('vis');
          btn.disabled = false;
          btn.textContent = orig;
          return;
        }
        btn.textContent = 'Creating revised invoice…';
      }

      const url = apiBase + '/functions/v1/create-custom-invoice';
      const resp = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        const reason = data.error || `Failed (${resp.status})`;
        $('#invErr').textContent = reason;
        $('#invErr').classList.add('vis');
        btn.disabled = false;
        btn.textContent = orig;
        return;
      }
      // Success — show the result panel with the hosted URL
      $('#invForm').hidden = true;
      const inv = data.invoice;
      $('#invSuccessNumber').textContent = inv.number || '(pending number)';
      $('#invSuccessAmount').textContent = moneyFmt(inv.total_cents, inv.currency);
      const link = $('#invSuccessLink');
      if (inv.hosted_url) {
        link.href = inv.hosted_url;
        link.hidden = false;
      } else {
        link.hidden = true;
      }
      const pdfLink = $('#invSuccessPdf');
      if (inv.pdf_url) {
        pdfLink.href = inv.pdf_url;
        pdfLink.hidden = false;
      } else {
        pdfLink.hidden = true;
      }
      $('#invSuccess').hidden = false;
      // If this was for a studio, refresh the panel underneath
      if (payload.recipient.type === 'studio') {
        refreshStudioInvoicesPanel(payload.recipient.submission_id);
      }
    } catch (err) {
      console.error('create-custom-invoice failed:', err);
      $('#invErr').textContent = String(err && err.message || err);
      $('#invErr').classList.add('vis');
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  // ── Per-studio Invoices panel ──────────────────────────────────────────────
  // Renders into #studioInvoicesHost on the detail page (the detail.js template
  // adds the section host element; we hydrate it).
  async function renderStudioInvoicesPanel(submissionId, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '<div class="adm-empty" style="padding:16px 0;">Loading invoices…</div>';
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) {
      hostEl.innerHTML = '<div class="adm-empty">Supabase client unavailable.</div>';
      return;
    }
    const { data, error } = await sb.from('invoices')
      .select('id, number, kind, status, currency, total_cents, amount_paid_cents, amount_refunded_cents, issued_at, paid_at, hosted_url, pdf_url, description, stripe_invoice_id, email_sent_at, last_resent_at, resend_count, voided_at')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false });
    if (error) {
      hostEl.innerHTML = `<div class="adm-empty">Could not load invoices: ${ESC(error.message)}</div>`;
      return;
    }
    const rows = data || [];
    if (rows.length === 0) {
      hostEl.innerHTML = '<div class="adm-empty">No invoices yet. Click <strong>+ Invoice</strong> above to issue one.</div>';
      return;
    }
    hostEl.innerHTML = `
      <table class="inv-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Send history</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => renderInvoiceRow(r)).join('')}
        </tbody>
      </table>
    `;
    bindInvoiceRowActions(hostEl, () => refreshStudioInvoicesPanel(submissionId), rows);
  }

  // Shared row renderer used by both the per-studio panel and the global
  // Invoices list screen. Surfaces the new send-history columns plus
  // Resend / Revise actions on open invoices.
  function renderInvoiceRow(r, opts) {
    const showRecipient = !!(opts && opts.showRecipient);
    const recipientCell = showRecipient
      ? `<td>
          <div>${ESC(r._recipientName || '')}</div>
          <div class="inv-list-sub">${ESC(r._recipientEmail || '')}${r._isStudio ? '' : ' · <span class="inv-list-tag">External</span>'}</div>
        </td>`
      : '';
    const sentAt = r.email_sent_at || r.issued_at;
    const sentLine = sentAt
      ? `Sent ${new Date(sentAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : '<span class="adm-empty">Not sent</span>';
    const resendLine = r.last_resent_at
      ? `<div class="inv-list-sub">Resent ${new Date(r.last_resent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}${r.resend_count > 1 ? ` (×${r.resend_count})` : ''}</div>`
      : '';
    const paidLine = r.paid_at
      ? `<div class="inv-list-sub">Paid ${new Date(r.paid_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>`
      : '';
    const voidLine = r.voided_at
      ? `<div class="inv-list-sub" style="color:#B91C1C;">Voided ${new Date(r.voided_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</div>`
      : '';
    const isOpen = r.status === 'open' || r.status === 'past_due';
    const isPaid = r.status === 'paid';
    const acts = [];
    if (r.hosted_url) acts.push(`<a class="btn-link" href="${ESC(r.hosted_url)}" target="_blank" rel="noopener">Open</a>`);
    if (r.pdf_url) acts.push(`<a class="btn-link" href="${ESC(r.pdf_url)}" target="_blank" rel="noopener">PDF</a>`);
    if (isOpen) {
      acts.push(`<a class="btn-link" href="#" data-inv-act="resend" data-inv-id="${ESC(r.id)}">Resend</a>`);
      acts.push(`<a class="btn-link" style="color:#B91C1C;" href="#" data-inv-act="revise" data-inv-id="${ESC(r.id)}">Revise</a>`);
    }
    if (showRecipient && r._isStudio) {
      acts.push(`<a class="btn-link" href="#" data-inv-open-studio="${ESC(r.submission_id)}">View studio</a>`);
    }
    return `
      <tr>
        <td>${ESC(r.number || '(draft)')}</td>
        ${recipientCell}
        <td><span class="bdg ${STATUS_CLASS[r.status] || ''}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td>${moneyFmt(r.total_cents, r.currency)}</td>
        <td style="font-size:12px;">${sentLine}${resendLine}${paidLine}${voidLine}</td>
        <td style="display:flex;gap:8px;flex-wrap:wrap;">${acts.join('')}</td>
      </tr>`;
  }

  // Delegated click handler. Binds once per host element. The rows array is
  // re-bound on each render so revise has the current snapshot to prefill.
  function bindInvoiceRowActions(hostEl, onReload, rows) {
    hostEl._invRows = rows;
    if (hostEl._invActionsBound) return;
    hostEl._invActionsBound = true;
    hostEl.addEventListener('click', async (e) => {
      const target = e.target.closest('[data-inv-act]');
      if (!target) return;
      e.preventDefault();
      const act = target.getAttribute('data-inv-act');
      const id = target.getAttribute('data-inv-id');
      const row = (hostEl._invRows || []).find((r) => r.id === id);
      if (!row) return;
      if (act === 'resend') return doResendInvoice(row, onReload);
      if (act === 'revise') return doReviseInvoice(row, onReload, hostEl._submission || null);
    });
  }

  async function doResendInvoice(row, onReload) {
    const ok = window.AdminModal
      ? await window.AdminModal.confirm({
          title: 'Resend invoice email?',
          message: `<p>Send the hosted-invoice email to the recipient again for <strong>${ESC(row.number || 'this invoice')}</strong>.</p><p style="color:var(--g6);font-size:12px;">In Stripe test mode the email goes only to your Stripe account email, not the recipient.</p>`,
          confirmLabel: 'Resend',
        })
      : confirm('Resend invoice email?');
    if (!ok) return;
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/manage-invoice';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
        body: JSON.stringify({ action: 'resend', invoice_id: row.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        await (window.AdminModal ? window.AdminModal.alert({ title: 'Resend failed', message: ESC(data.error || `Status ${resp.status}.`) }) : Promise.resolve());
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('resend failed:', err);
      await (window.AdminModal ? window.AdminModal.alert('Could not resend the invoice. Please try again.') : Promise.resolve());
    }
  }

  // Revise: open the create-invoice modal pre-filled with the original
  // line items. The Stripe void only happens later, inside submit(), iff
  // the admin actually clicks Send. Cancelling the modal leaves the
  // original invoice untouched.
  async function doReviseInvoice(row, onReload, submission) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/manage-invoice';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    let snapshot;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
        body: JSON.stringify({ action: 'get-snapshot', invoice_id: row.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok || !data.snapshot) {
        await (window.AdminModal ? window.AdminModal.alert({ title: 'Could not load invoice', message: ESC(data.error || `Status ${resp.status}.`) }) : Promise.resolve());
        return;
      }
      snapshot = data.snapshot;
    } catch (err) {
      console.error('get-snapshot failed:', err);
      await (window.AdminModal ? window.AdminModal.alert('Could not load the invoice for revision.') : Promise.resolve());
      return;
    }
    // Build the revision context that the modal + submit flow consume.
    // pendingVoidId is what tells submit() to void the original FIRST and
    // only then issue the replacement.
    const revision = {
      pendingVoidId: row.id,
      pendingVoidNumber: row.number,
      lines: snapshot.lines || [],
      description: snapshot.description || row.description || '',
      currency: snapshot.currency || row.currency || 'AUD',
      collection_method: snapshot.collection_method,
      due_days: snapshot.due_days,
      external: !submission ? {
        name: snapshot.customer_name,
        email: snapshot.customer_email,
        country: snapshot.customer_country,
      } : null,
    };
    if (submission) {
      open({ mode: 'studio', submission, revision });
    } else {
      open({ mode: 'external', revision });
    }
    // onReload deferred — nothing changed yet. submit() will trigger a
    // refresh after a successful void+create round trip.
    void onReload;
  }

  function refreshStudioInvoicesPanel(submissionId) {
    const host = $('#studioInvoicesHost');
    if (host) renderStudioInvoicesPanel(submissionId, host);
  }

  // ── Bindings ───────────────────────────────────────────────────────────────
  function bind() {
    const modal = $('#invoiceModal');
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target.matches('[data-act="close-invoice"]')) close();
      if (e.target.matches('[data-act="add-line"]')) addLineItemRow();
      if (e.target.matches('[data-act="pick-from-catalog"]')) openCatalogPicker();
      if (e.target.matches('[data-act="send"]')) submit();
    });
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'invRecipient') updateModeUI();
      if (e.target.id === 'invCurrency') updateTotalsUI();
      if (e.target.id === 'invCollection') updateModeUI();
      if (e.target.id === 'invExtCountry') onExternalCountryChange();
    });
  }

  // ── Global Invoices screen ────────────────────────────────────────────────
  // Top-level admin nav entry that lists every invoice across all studios
  // and external contacts. The per-studio panel (renderStudioInvoicesPanel)
  // stays — this is the standalone surface for issuing one-off invoices
  // and reviewing the full ledger without going through a studio profile.
  const LIST_STATUS_FILTERS = ['all', 'draft', 'open', 'paid', 'void'];
  const listState = { status: 'all', search: '', rows: [] };

  async function openListScreen() {
    const screen = ensureListScreen();
    screen.style.display = '';
    document.getElementById('listScreen').style.display = 'none';
    document.getElementById('detailScreen').style.display = 'none';
    const cat = document.getElementById('catalogScreen'); if (cat) cat.style.display = 'none';
    await loadListRows();
    renderList();
  }

  function ensureListScreen() {
    let screen = document.getElementById('invoicesScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'invoicesScreen';
    screen.className = 'inbox-screen';
    screen.innerHTML = `
      <div class="inbox-hdr">
        <div>
          <h2 class="users-title">Invoices</h2>
          <p class="users-desc">Every invoice across studios and external contacts. Open one to view it on Stripe, or create a new one for someone who isn't a studio yet.</p>
        </div>
        <button type="button" class="btn btn-p" id="invListNew">+ New invoice</button>
      </div>
      <div class="inbox-toolbar">
        <div class="adm-pills" id="invListPills" role="group" aria-label="Filter invoices">
          ${LIST_STATUS_FILTERS.map((s, i) => `
            <button type="button" class="pill${i === 0 ? ' active' : ''}" data-f="${s}" aria-pressed="${i === 0 ? 'true' : 'false'}">${s === 'all' ? 'All' : (STATUS_LABEL[s] || s)}</button>
          `).join('')}
        </div>
        <div class="adm-search" role="search">
          <label class="sr-only" for="invListSearch">Search</label>
          <input type="search" id="invListSearch" placeholder="Search number, recipient, email…">
        </div>
      </div>
      <div class="inv-list-host" id="invListBody"><div class="adm-empty" style="padding:40px 0;">Loading…</div></div>`;
    document.querySelector('main.adm-main').appendChild(screen);

    screen.querySelector('#invListNew').addEventListener('click', () => open({ mode: 'external' }));
    screen.querySelector('#invListPills').addEventListener('click', (e) => {
      const p = e.target.closest('.pill'); if (!p) return;
      listState.status = p.dataset.f;
      screen.querySelectorAll('#invListPills .pill').forEach((b) => {
        const active = b === p;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderList();
    });
    screen.querySelector('#invListSearch').addEventListener('input', (e) => {
      listState.search = (e.target.value || '').toLowerCase();
      renderList();
    });
    return screen;
  }

  async function loadListRows() {
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) { listState.rows = []; return; }
    // PostgREST FK sugar pulls the recipient label without a second round
    // trip. Studio invoices have submission_id set; external invoices have
    // external_contact_id set. We tolerate either being null.
    const { data, error } = await sb.from('invoices')
      .select(`
        id, number, kind, status, currency, total_cents,
        amount_paid_cents, amount_refunded_cents, issued_at, paid_at,
        hosted_url, pdf_url, description, submission_id, external_contact_id,
        stripe_invoice_id, email_sent_at, last_resent_at, resend_count, voided_at,
        submission:submissions(id, studio_name, contact_email),
        external_contact:external_contacts(id, name, email)
      `)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('loadListRows invoices:', error);
      listState.rows = [];
      return;
    }
    listState.rows = (data || []).map((r) => {
      const isStudio = !!r.submission_id;
      const recipientName = isStudio
        ? (r.submission?.studio_name || r.submission?.contact_email || 'Unknown studio')
        : (r.external_contact?.name || r.external_contact?.email || 'External recipient');
      const recipientEmail = isStudio ? (r.submission?.contact_email || '') : (r.external_contact?.email || '');
      return { ...r, _isStudio: isStudio, _recipientName: recipientName, _recipientEmail: recipientEmail };
    });
  }

  function renderList() {
    const host = document.getElementById('invListBody');
    if (!host) return;
    const filtered = listState.rows.filter((r) => {
      if (listState.status !== 'all' && r.status !== listState.status) return false;
      if (!listState.search) return true;
      const hay = [r.number, r._recipientName, r._recipientEmail, r.description].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(listState.search);
    });
    if (!filtered.length) {
      host.innerHTML = `<div class="adm-empty" style="padding:40px 0;">${listState.search || listState.status !== 'all' ? 'No invoices match.' : 'No invoices yet. Click + New invoice to issue one.'}</div>`;
      return;
    }
    host.innerHTML = `
      <table class="inv-table inv-list-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Recipient</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Send history</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((r) => renderInvoiceRow(r, { showRecipient: true })).join('')}
        </tbody>
      </table>`;
    bindInvoiceRowActions(host, async () => { await loadListRows(); renderList(); }, filtered);
    if (!host._invListBound) {
      host._invListBound = true;
      host.addEventListener('click', (e) => {
        const studioLink = e.target.closest('[data-inv-open-studio]');
        if (studioLink) {
          e.preventDefault();
          const id = studioLink.getAttribute('data-inv-open-studio');
          if (id && window.AdminDetail && window.AdminDetail.open) {
            window.AdminDetail.open(id, { tab: 'invoices' });
          }
        }
      });
    }
  }

  // Public surface
  window.AdminInvoice = {
    openForStudio(submission) { open({ mode: 'studio', submission }); },
    openExternal() { open({ mode: 'external' }); },
    close,
    renderStudioInvoicesPanel,
    openListScreen,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
