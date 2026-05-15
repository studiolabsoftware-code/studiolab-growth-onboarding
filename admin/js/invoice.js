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
    // Reset line items to one empty row
    $('#invItems').innerHTML = '';
    addLineItemRow();
    updateModeUI();
    updateTotalsUI();
    $('#invErr').classList.remove('vis');
    $('#invSuccess').hidden = true;
    $('#invForm').hidden = false;
    $('#invSendBtn').disabled = false;
    $('#invSendBtn').textContent = 'Create and send';

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
      const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/create-custom-invoice';
      const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
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
      .select('id, number, kind, status, currency, total_cents, amount_paid_cents, amount_refunded_cents, issued_at, paid_at, hosted_url, pdf_url, description')
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
            <th>Kind</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Issued</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${ESC(r.number || '(draft)')}</td>
              <td>${ESC(KIND_LABEL[r.kind] || r.kind)}</td>
              <td><span class="bdg ${STATUS_CLASS[r.status] || ''}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
              <td>${moneyFmt(r.total_cents, r.currency)}</td>
              <td>${r.issued_at ? new Date(r.issued_at).toLocaleDateString('en-AU') : '—'}</td>
              <td>
                ${r.hosted_url ? `<a class="btn-link" href="${ESC(r.hosted_url)}" target="_blank" rel="noopener">Open</a>` : ''}
                ${r.pdf_url ? ` · <a class="btn-link" href="${ESC(r.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
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
      if (e.target.matches('[data-act="send"]')) submit();
    });
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'invRecipient') updateModeUI();
      if (e.target.id === 'invCurrency') updateTotalsUI();
      if (e.target.id === 'invCollection') updateModeUI();
      if (e.target.id === 'invExtCountry') onExternalCountryChange();
    });
  }

  // Public surface
  window.AdminInvoice = {
    openForStudio(submission) { open({ mode: 'studio', submission }); },
    openExternal() { open({ mode: 'external' }); },
    close,
    renderStudioInvoicesPanel,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
