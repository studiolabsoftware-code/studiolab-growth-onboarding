/* StudioLAB Growth admin: quote creator + per-studio Quotes panel.
   Mirrors invoice.js. Opens a modal with two recipient modes (studio /
   external), one or more line items, currency, acceptance mode, expiry,
   cover note, and internal description; posts to the create-quote edge
   function. Also renders the per-studio Quotes panel on the detail page. */

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

  const STATUS_LABEL = {
    draft: 'Draft',
    sent: 'Sent',
    viewed: 'Viewed',
    accepted: 'Accepted',
    declined: 'Declined',
    expired: 'Expired',
    cancelled: 'Cancelled',
    revised: 'Revised',
  };

  // Maps quote.status → CSS class for the pill. Aligned with the new
  // status-specific pill colours in admin.css so terminal states are
  // visually distinct (cancelled/declined red, expired neutral grey,
  // revised muted, accepted green, sent/viewed blue).
  const STATUS_CLASS = {
    draft: 'bdg-st-submitted',
    sent: 'bdg-st-sent',
    viewed: 'bdg-st-viewed',
    accepted: 'bdg-st-accepted',
    declined: 'bdg-st-declined',
    expired: 'bdg-st-expired',
    cancelled: 'bdg-st-cancelled',
    revised: 'bdg-st-revised',
  };

  let currentContext = null;
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

  // Thin wrappers so we can use AdminModal.alert / .confirm where loaded,
  // and fall back to the native dialogs in older bundles. Mirrors the
  // helpers in invoice.js.
  async function showAlert(opts) {
    if (window.AdminModal && window.AdminModal.alert) {
      return window.AdminModal.alert(opts);
    }
    const msg = typeof opts === 'string' ? opts : (opts.message || opts.title || 'Action failed');
    alert(msg.replace(/<[^>]+>/g, ''));
    return Promise.resolve();
  }
  async function showConfirm(opts) {
    if (window.AdminModal && window.AdminModal.confirm) {
      return window.AdminModal.confirm(opts);
    }
    return confirm(typeof opts === 'string' ? opts : (opts.message || opts.title || 'Confirm?'));
  }

  // Strict country-to-currency mapping. AU recipients are always invoiced in
  // AUD with GST; everyone else is invoiced in USD without GST. This is
  // load-bearing for tax handling — quoting an AU recipient in USD would
  // skip the GST line, and quoting an overseas recipient in AUD would
  // add GST that shouldn't apply. We enforce this in the UI by locking the
  // currency selector once a country is known.
  function currencyForCountry(c) {
    if (!c) return null;
    const u = c.trim().toUpperCase();
    if (u === 'AU' || u === 'AUS' || u === 'AUSTRALIA') return 'AUD';
    return 'USD';
  }

  function lockCurrency(currency, reason) {
    const sel = $('#qCurrency');
    if (!sel) return;
    const hint = $('#qCurrencyLockHint');
    if (currency) {
      sel.value = currency;
      sel.disabled = true;
      sel.title = reason || '';
      if (hint) {
        hint.textContent = reason || '';
        hint.classList.toggle('vis', !!reason);
      }
    } else {
      sel.disabled = false;
      sel.title = '';
      if (hint) {
        hint.textContent = '';
        hint.classList.remove('vis');
      }
    }
  }

  function daysUntil(iso) {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - Date.now();
    return Math.ceil(ms / (24 * 60 * 60 * 1000));
  }

  // ── Modal: open / close ────────────────────────────────────────────────────
  function open(ctx) {
    currentContext = ctx;
    const modal = $('#quoteModal');
    if (!modal) {
      console.error('quoteModal markup missing from admin/index.html');
      return;
    }
    const isStudio = ctx && ctx.mode === 'studio' && ctx.submission;
    $('#qRecipientStudio').checked = isStudio;
    $('#qRecipientExternal').checked = !isStudio;
    if (isStudio) {
      $('#qStudioName').textContent = ctx.submission.studio_name || ctx.submission.contact_email || '—';
      $('#qStudioMeta').textContent = [
        ctx.submission.contact_email,
        COUNTRY_LABEL[(ctx.submission.country || '').toUpperCase()] || ctx.submission.country,
      ].filter(Boolean).join(' · ');
      // Studio's country determines currency; admin can't override because
      // AU → AUD/GST and overseas → USD/no-GST is a hard tax rule.
      const studioCurrency = currencyForCountry(ctx.submission.country) || 'AUD';
      lockCurrency(studioCurrency,
        studioCurrency === 'AUD'
          ? 'AU studio: quoted in AUD with 10% GST.'
          : 'Overseas studio: quoted in USD with no GST.');
    } else {
      $('#qStudioName').textContent = 'No studio selected';
      $('#qStudioMeta').textContent = '';
      // External recipient — currency unlocks until the admin picks a
      // country, then re-locks based on that choice.
      $('#qCurrency').value = 'AUD';
      lockCurrency(null);
    }
    $('#qExtEmail').value = '';
    $('#qExtName').value = '';
    $('#qExtCountry').value = '';
    $('#qAcceptPayOnAccept').checked = true;
    $('#qExpiresIn').value = '30';
    $('#qCoverNote').value = '';
    $('#qDescription').value = '';
    $('#qItems').innerHTML = '';
    // Revision pre-fill. The revising flag triggers two extra behaviours on
    // submit: parent_quote_id is sent in the payload, and the parent quote
    // is cancelled on successful create.
    const rev = ctx && ctx.revision;
    if (rev && rev.lineItems) {
      rev.lineItems.forEach((li) => addLineItemRow(li));
      if (rev.acceptanceMode === 'pay_on_invoice') $('#qAcceptPayOnInvoice').checked = true;
      if (rev.coverNote) $('#qCoverNote').value = rev.coverNote;
      // Modal title hint so the admin sees this is a revision.
      const titleEl = $('#quoteTitle');
      if (titleEl) titleEl.textContent = `Revise quote${rev.parentQuoteId ? '' : ''}`;
    } else {
      const titleEl = $('#quoteTitle');
      if (titleEl) titleEl.textContent = 'New quote';
      addLineItemRow();
    }
    updateModeUI();
    updateTotalsUI();
    $('#qErr').classList.remove('vis');
    $('#qSuccess').hidden = true;
    $('#qForm').hidden = false;
    $('#qSendBtn').disabled = false;
    $('#qSendBtn').hidden = false;
    $('#qSendBtn').textContent = 'Create and send';

    modal.hidden = false;
    document.body.classList.add('adm-modal-open');
    // ESC, focus trap, and focus restore via the shared helper. Replaces
    // the bare setTimeout(focus, 50) — keyboard users now Tab inside the
    // dialog and ESC closes; closing returns focus to the triggering
    // button (+ Quote / + New quote / Revise).
    if (window.AdminModal && window.AdminModal.attachDialogHygiene) {
      detachHygiene = window.AdminModal.attachDialogHygiene(modal, {
        onEscape: close,
        initialFocus: () => isStudio
          ? $('#qItems input[data-fld="description"]')
          : $('#qExtEmail'),
      });
    } else {
      setTimeout(() => {
        const target = isStudio ? $('#qItems input[data-fld="description"]') : $('#qExtEmail');
        if (target) target.focus();
      }, 50);
    }
  }

  function close() {
    const modal = $('#quoteModal');
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
    const isStudio = $('#qRecipientStudio').checked;
    $('#qStudioBlock').hidden = !isStudio;
    $('#qExternalBlock').hidden = isStudio;
    // Re-evaluate the currency lock whenever the recipient mode toggles —
    // studio mode re-locks to the submission's country, external mode
    // unlocks until a country is chosen.
    if (isStudio && currentContext?.submission) {
      const c = currencyForCountry(currentContext.submission.country) || 'AUD';
      lockCurrency(c,
        c === 'AUD'
          ? 'AU studio: quoted in AUD with 10% GST.'
          : 'Overseas studio: quoted in USD with no GST.');
    } else {
      // External: re-evaluate based on the country dropdown.
      onExternalCountryChange();
    }
  }

  function onExternalCountryChange() {
    const country = $('#qExtCountry').value;
    const c = currencyForCountry(country);
    if (c === 'AUD') {
      lockCurrency('AUD', 'AU recipient: quoted in AUD with 10% GST.');
    } else if (c === 'USD') {
      lockCurrency('USD', 'Overseas recipient: quoted in USD with no GST.');
    } else {
      lockCurrency(null);
    }
    updateTotalsUI();
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  // ── Catalog picker (upgrade SKUs) ────────────────────────────────────────
  // Same shape as invoice.js: shared AdminCatalogPicker opens, the picked
  // SKU appends a pre-filled line item. Manual "+ Add line" rows are
  // unaffected, and any picked row can still be edited or removed.
  function openCatalogPicker() {
    if (!window.AdminCatalogPicker || typeof window.AdminCatalogPicker.open !== 'function') {
      console.warn('AdminCatalogPicker not loaded yet');
      return;
    }
    const currency = ($('#qCurrency').value || 'AUD').toUpperCase();
    window.AdminCatalogPicker.open({
      currency,
      onPick(row) {
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

  function addLineItemRow(initial) {
    const row = document.createElement('div');
    row.className = 'inv-row';
    row.innerHTML = `
      <input type="text" data-fld="description" placeholder="Description" value="${ESC(initial?.description || '')}">
      <input type="number" data-fld="quantity" min="1" step="1" value="${ESC(initial?.quantity || 1)}" style="width:70px;">
      <input type="number" data-fld="amount" min="0" step="0.01" placeholder="0.00" value="${ESC(initial?.amount || '')}" style="width:120px;">
      <button type="button" class="btn-link" data-act="remove-q-line">Remove</button>
    `;
    row.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateTotalsUI));
    row.querySelector('[data-act="remove-q-line"]').addEventListener('click', () => {
      const all = $$('#qItems .inv-row');
      if (all.length <= 1) return;
      row.remove();
      updateTotalsUI();
    });
    $('#qItems').appendChild(row);
  }

  function collectLineItems() {
    const rows = $$('#qItems .inv-row');
    return rows.map((r) => ({
      description: r.querySelector('[data-fld="description"]').value.trim(),
      quantity: parseInt(r.querySelector('[data-fld="quantity"]').value, 10) || 1,
      amount_cents: Math.round(parseFloat(r.querySelector('[data-fld="amount"]').value || '0') * 100),
    }));
  }

  function updateTotalsUI() {
    const items = collectLineItems();
    const currency = $('#qCurrency').value;
    const subtotalCents = items.reduce((s, li) => s + (li.amount_cents * li.quantity), 0);
    const isAud = currency === 'AUD';
    const taxCents = isAud ? Math.round(subtotalCents * 0.10) : 0;
    const totalCents = subtotalCents + taxCents;
    $('#qSubtotal').textContent = moneyFmt(subtotalCents, currency);
    $('#qTax').textContent = isAud
      ? `+ ${moneyFmt(taxCents, currency)} GST (10%)`
      : 'No GST — overseas recipient';
    $('#qTotal').textContent = `${moneyFmt(totalCents, currency)}${isAud ? ' incl. GST' : ''}`;
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validateAndBuildPayload() {
    const isStudio = $('#qRecipientStudio').checked;
    const errors = [];

    let recipient;
    if (isStudio) {
      if (!currentContext || !currentContext.submission) {
        errors.push('No studio selected.');
      } else {
        recipient = { type: 'studio', submission_id: currentContext.submission.id };
      }
    } else {
      const email = $('#qExtEmail').value.trim().toLowerCase();
      const name = $('#qExtName').value.trim();
      const country = $('#qExtCountry').value.trim().toUpperCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid recipient email.');
      recipient = {
        type: 'external',
        email,
        name: name || undefined,
        country: country || undefined,
      };
    }

    const currency = $('#qCurrency').value;
    if (currency !== 'AUD' && currency !== 'USD') errors.push('Currency must be AUD or USD.');

    const items = collectLineItems();
    if (items.length === 0) errors.push('Add at least one line item.');
    for (const li of items) {
      if (!li.description) errors.push('Each line item needs a description.');
      if (!Number.isInteger(li.amount_cents) || li.amount_cents <= 0) errors.push(`Line "${li.description || '(blank)'}" needs a positive amount.`);
      if (!Number.isInteger(li.quantity) || li.quantity <= 0) errors.push(`Line "${li.description || '(blank)'}" needs a positive quantity.`);
    }

    const acceptanceMode = document.querySelector('input[name="qAcceptanceMode"]:checked')?.value || 'pay_on_accept';
    const expiresInDays = parseInt($('#qExpiresIn').value, 10) || 30;

    const parentQuoteId = currentContext?.revision?.parentQuoteId || undefined;

    return {
      ok: errors.length === 0,
      errors,
      payload: errors.length === 0 ? {
        recipient,
        currency,
        line_items: items,
        acceptance_mode: acceptanceMode,
        expires_in_days: expiresInDays,
        cover_note: $('#qCoverNote').value.trim() || undefined,
        description: $('#qDescription').value.trim() || undefined,
        parent_quote_id: parentQuoteId,
      } : null,
      parentQuoteId,
    };
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submit() {
    $('#qErr').classList.remove('vis');
    const { ok, errors, payload, parentQuoteId } = validateAndBuildPayload();
    if (!ok) {
      $('#qErr').textContent = errors.join(' ');
      $('#qErr').classList.add('vis');
      return;
    }
    const btn = $('#qSendBtn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/create-quote';
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
        $('#qErr').textContent = reason;
        $('#qErr').classList.add('vis');
        btn.disabled = false;
        btn.textContent = orig;
        return;
      }
      $('#qForm').hidden = true;
      const q = data.quote;
      $('#qSuccessNumber').textContent = q.number || '(pending number)';
      $('#qSuccessAmount').textContent = moneyFmt(q.total_cents, q.currency);
      $('#qSuccess').hidden = false;
      // Hide the footer Send button once the success screen renders. The
      // in-panel "View in panel" / "Send another" buttons take over from
      // here. The footer Close stays so keyboard users can still tab to a
      // dismiss control.
      const sendBtn = $('#qSendBtn');
      if (sendBtn) sendBtn.hidden = true;

      // Parent-cancellation on revise is now handled server-side inside
      // create-quote (atomically, before the parent is marked 'revised').
      // No client-side cancel call needed.

      if (payload.recipient.type === 'studio') {
        refreshStudioQuotesPanel(payload.recipient.submission_id);
      }
    } catch (err) {
      console.error('create-quote failed:', err);
      $('#qErr').textContent = String(err && err.message || err);
      $('#qErr').classList.add('vis');
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  // ── Per-studio Quotes panel ────────────────────────────────────────────────
  async function renderStudioQuotesPanel(submissionId, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '<div class="adm-empty" style="padding:16px 0;">Loading quotes…</div>';
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) {
      hostEl.innerHTML = '<div class="adm-empty">Supabase client unavailable.</div>';
      return;
    }
    const { data, error } = await sb.from('quotes')
      .select('id, number, status, acceptance_mode, currency, subtotal_cents, total_cents, expires_at, sent_at, accepted_at, hosted_url, pdf_url, cover_note, resulting_invoice_id, stripe_quote_id, submission_id')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false });
    if (error) {
      hostEl.innerHTML = `<div class="adm-empty">Could not load quotes: ${ESC(error.message)}</div>`;
      return;
    }
    const rows = data || [];
    if (rows.length === 0) {
      hostEl.innerHTML = '<div class="adm-empty">No quotes yet. Click <strong>+ Quote</strong> above to issue one.</div>';
      return;
    }
    hostEl.innerHTML = `
      <table class="inv-table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Acceptance</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, idx) => {
            const days = daysUntil(r.expires_at);
            const expiryText = !r.expires_at ? '—'
              : (r.status === 'accepted' || r.status === 'declined' || r.status === 'expired' || r.status === 'cancelled') ? new Date(r.expires_at).toLocaleDateString('en-AU')
              : (days != null && days <= 0) ? 'Expired'
              : (days === 1) ? '1 day left'
              : `${days} days left`;
            const isLive = r.status === 'draft' || r.status === 'sent' || r.status === 'viewed';
            const isAccepted = r.status === 'accepted';
            const actions = [];
            actions.push(`<a class="btn-link" href="#" data-q-act="pdf" data-q-idx="${idx}">PDF</a>`);
            if (isLive) {
              actions.push(`<a class="btn-link" href="#" data-q-act="revise" data-q-idx="${idx}">Revise</a>`);
              actions.push(`<a class="btn-link btn-link-danger" href="#" data-q-act="cancel" data-q-idx="${idx}">Cancel</a>`);
            }
            if (isAccepted && r.resulting_invoice_id) {
              actions.push(`<span style="color:var(--g6);font-size:12px;">Invoice raised</span>`);
            }
            return `
              <tr>
                <td>${ESC(r.number || '(draft)')}</td>
                <td><span class="bdg ${STATUS_CLASS[r.status] || ''}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
                <td>${moneyFmt(r.total_cents, r.currency)}</td>
                <td style="font-size:12px;color:var(--g6);">${r.acceptance_mode === 'pay_on_invoice' ? 'Pay on invoice' : 'Pay on accept'}</td>
                <td>${ESC(expiryText)}</td>
                <td style="display:flex;gap:8px;flex-wrap:wrap;">${actions.join('')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
    // Stash rows on the host element for the action handlers to read.
    hostEl._quoteRows = rows;
    hostEl._quoteSubmissionId = submissionId;
    if (!hostEl._quoteActionsBound) {
      hostEl._quoteActionsBound = true;
      hostEl.addEventListener('click', async (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const act = target.getAttribute('data-q-act');
        if (!act) return;
        e.preventDefault();
        const idx = parseInt(target.getAttribute('data-q-idx') || '-1', 10);
        const r = (hostEl._quoteRows || [])[idx];
        if (!r) return;
        if (act === 'pdf') {
          downloadPdf(r);
        } else if (act === 'cancel') {
          cancelQuote(r, hostEl._quoteSubmissionId);
        } else if (act === 'revise') {
          // detail.js stashes the submission on the host element when
          // rendering the panel, so the Revise flow has the studio context
          // without depending on dashboard state.
          reviseQuote(r, hostEl._submission || null);
        }
      });
    }
  }

  function refreshStudioQuotesPanel(submissionId) {
    const host = $('#studioQuotesHost');
    if (host) renderStudioQuotesPanel(submissionId, host);
  }

  // ── Row actions: PDF download, Cancel, Revise ──────────────────────────────
  async function downloadPdf(quote) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/get-quote-pdf';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
        body: JSON.stringify({ quote_id: quote.id }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        await showAlert({ title: 'Could not download PDF', message: ESC(j.error || `Status ${resp.status}.`) });
        return;
      }
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = (quote.number || `quote-${quote.id}`) + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch (err) {
      console.error('PDF download failed:', err);
      await showAlert({ title: 'Could not download PDF', message: ESC((err && err.message) || String(err)) });
    }
  }

  async function cancelQuote(quote, submissionIdForRefresh) {
    const label = quote.number || quote.id;
    const ok = await showConfirm({
      title: `Cancel quote ${label}?`,
      message: `<p>This withdraws the quote from the recipient and can't be undone.</p>`,
      confirmLabel: 'Cancel quote',
      destructive: true,
      danger: true,
    });
    if (!ok) return;
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/cancel-quote';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
        },
        body: JSON.stringify({ quote_id: quote.id, reason: 'admin_cancelled' }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Could not cancel quote', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      // The Stripe webhook updates the ledger row to 'cancelled'/'declined'.
      // Reload the panel to show the new state.
      if (submissionIdForRefresh) refreshStudioQuotesPanel(submissionIdForRefresh);
    } catch (err) {
      console.error('cancel-quote failed:', err);
      await showAlert({ title: 'Could not cancel quote', message: ESC((err && err.message) || String(err)) });
    }
  }

  async function reviseQuote(quote, submission) {
    // Revise = create a new quote pre-filled from the existing one, then
    // cancel the original once the new one is sent. We open the modal with
    // a "revising" flag; on successful create we cancel the parent.
    if (!submission) {
      await showAlert({ title: 'Revise needs studio context', message: '<p>Open the quote from a studio page to revise it.</p>' });
      return;
    }
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) {
      await showAlert({ title: 'Supabase unavailable', message: '<p>The Supabase client failed to load. Refresh the page and try again.</p>' });
      return;
    }
    // public.quotes doesn't store individual line items, so we pre-fill one
    // row at the source quote's EX-GST SUBTOTAL. Using total_cents would
    // double-count GST for AUD quotes (the total is already GST-inclusive,
    // and the manual GST tax_rate gets re-attached when the new quote is
    // created — recipient would be billed ~21% over scope). Admin can split
    // this single row into multiple lines before sending.
    const subtotalCents = Number.isFinite(quote.subtotal_cents)
      ? quote.subtotal_cents
      : (quote.currency === 'AUD' ? Math.round(quote.total_cents / 1.1) : quote.total_cents);
    const initial = {
      lineItems: [{
        description: 'Revised version of ' + (quote.number || 'previous quote'),
        quantity: 1,
        amount: (subtotalCents / 100).toFixed(2),
      }],
      acceptanceMode: quote.acceptance_mode || 'pay_on_accept',
      coverNote: quote.cover_note || '',
      parentQuoteId: quote.id,
      parentStripeQuoteId: quote.stripe_quote_id || null,
    };
    open({ mode: 'studio', submission, revision: initial });
  }

  // ── Bindings ───────────────────────────────────────────────────────────────
  function bind() {
    const modal = $('#quoteModal');
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target.matches('[data-act="close-quote"]')) close();
      if (e.target.matches('[data-act="add-q-line"]')) addLineItemRow();
      if (e.target.matches('[data-act="pick-from-catalog-q"]')) openCatalogPicker();
      if (e.target.matches('[data-act="send-quote"]')) submit();
      // Success-screen actions. "View in panel" just dismisses the modal
      // so the newly-issued quote (already added to the panel below) is
      // visible. "Send another" resets the form for a fresh quote within
      // the same context (same studio if studio-mode, otherwise external).
      if (e.target.matches('[data-act="view-quote-in-panel"]')) close();
      if (e.target.matches('[data-act="send-another-quote"]')) {
        const ctx = currentContext;
        close();
        open(ctx || { mode: 'external' });
      }
    });
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'qRecipient') updateModeUI();
      if (e.target.id === 'qCurrency') updateTotalsUI();
      if (e.target.id === 'qExtCountry') onExternalCountryChange();
    });
  }

  // ── Global Quotes screen ──────────────────────────────────────────────────
  // Top-level admin nav entry that lists every quote across all studios and
  // external contacts. Mirrors invoice.js openListScreen so the two ledgers
  // share a consistent shape.
  const QLIST_STATUS_FILTERS = ['all', 'draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'];
  const qListState = { status: 'all', search: '', rows: [] };

  async function openListScreen() {
    const screen = ensureQuoteListScreen();
    screen.style.display = '';
    document.getElementById('listScreen').style.display = 'none';
    document.getElementById('detailScreen').style.display = 'none';
    const cat = document.getElementById('catalogScreen'); if (cat) cat.style.display = 'none';
    await loadQuoteListRows();
    renderQuoteList();
  }

  function ensureQuoteListScreen() {
    let screen = document.getElementById('quotesScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'quotesScreen';
    screen.className = 'inbox-screen';
    screen.innerHTML = `
      <div class="inbox-hdr">
        <div>
          <h2 class="users-title">Quotes</h2>
          <p class="users-desc">Every quote across studios and external contacts. Open one to view the hosted page, or create a new one for someone who isn't a studio yet.</p>
        </div>
        <button type="button" class="btn btn-p" id="qListNew">+ New quote</button>
      </div>
      <div class="inbox-toolbar">
        <div class="adm-pills" id="qListPills" role="group" aria-label="Filter quotes">
          ${QLIST_STATUS_FILTERS.map((s, i) => `
            <button type="button" class="pill${i === 0 ? ' active' : ''}" data-f="${s}" aria-pressed="${i === 0 ? 'true' : 'false'}">${s === 'all' ? 'All' : (STATUS_LABEL[s] || s)}</button>
          `).join('')}
        </div>
        <div class="adm-search" role="search">
          <label class="sr-only" for="qListSearch">Search</label>
          <input type="search" id="qListSearch" placeholder="Search number, recipient, email…">
        </div>
      </div>
      <div class="inv-list-host" id="qListBody"><div class="adm-empty" style="padding:40px 0;">Loading…</div></div>`;
    document.querySelector('main.adm-main').appendChild(screen);

    screen.querySelector('#qListNew').addEventListener('click', () => open({ mode: 'external' }));
    screen.querySelector('#qListPills').addEventListener('click', (e) => {
      const p = e.target.closest('.pill'); if (!p) return;
      qListState.status = p.dataset.f;
      screen.querySelectorAll('#qListPills .pill').forEach((b) => {
        const active = b === p;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderQuoteList();
    });
    screen.querySelector('#qListSearch').addEventListener('input', (e) => {
      qListState.search = (e.target.value || '').toLowerCase();
      renderQuoteList();
    });
    return screen;
  }

  async function loadQuoteListRows() {
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) { qListState.rows = []; return; }
    const { data, error } = await sb.from('quotes')
      .select(`
        id, number, status, acceptance_mode, currency, subtotal_cents, total_cents,
        expires_at, sent_at, accepted_at, hosted_url, pdf_url, cover_note,
        resulting_invoice_id, stripe_quote_id, submission_id, external_contact_id,
        submission:submissions(id, studio_name, contact_email),
        external_contact:external_contacts(id, name, email)
      `)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error('loadQuoteListRows:', error);
      qListState.rows = [];
      return;
    }
    qListState.rows = (data || []).map((r) => {
      const isStudio = !!r.submission_id;
      const recipientName = isStudio
        ? (r.submission?.studio_name || r.submission?.contact_email || 'Unknown studio')
        : (r.external_contact?.name || r.external_contact?.email || 'External recipient');
      const recipientEmail = isStudio ? (r.submission?.contact_email || '') : (r.external_contact?.email || '');
      return { ...r, _isStudio: isStudio, _recipientName: recipientName, _recipientEmail: recipientEmail };
    });
  }

  function renderQuoteList() {
    const host = document.getElementById('qListBody');
    if (!host) return;
    const filtered = qListState.rows.filter((r) => {
      if (qListState.status !== 'all' && r.status !== qListState.status) return false;
      if (!qListState.search) return true;
      const hay = [r.number, r._recipientName, r._recipientEmail, r.cover_note].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(qListState.search);
    });
    if (!filtered.length) {
      host.innerHTML = `<div class="adm-empty" style="padding:40px 0;">${qListState.search || qListState.status !== 'all' ? 'No quotes match.' : 'No quotes yet. Click + New quote to issue one.'}</div>`;
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
            <th>Acceptance</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((r) => {
            const days = daysUntil(r.expires_at);
            const expiryText = !r.expires_at ? '—'
              : (r.status === 'accepted' || r.status === 'declined' || r.status === 'expired' || r.status === 'cancelled') ? new Date(r.expires_at).toLocaleDateString('en-AU')
              : (days != null && days <= 0) ? 'Expired'
              : (days === 1) ? '1 day left'
              : `${days} days left`;
            return `
              <tr>
                <td>${ESC(r.number || '(draft)')}</td>
                <td>
                  <div>${ESC(r._recipientName)}</div>
                  <div class="inv-list-sub">${ESC(r._recipientEmail || '')}${r._isStudio ? '' : ' · <span class="inv-list-tag">External</span>'}</div>
                </td>
                <td><span class="bdg ${STATUS_CLASS[r.status] || ''}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
                <td>${moneyFmt(r.total_cents, r.currency)}</td>
                <td style="font-size:12px;color:var(--g6);">${r.acceptance_mode === 'pay_on_invoice' ? 'Pay on invoice' : 'Pay on accept'}</td>
                <td style="font-size:12px;">${ESC(expiryText)}</td>
                <td style="display:flex;gap:8px;flex-wrap:wrap;">
                  ${r.hosted_url ? `<a class="btn-link" href="${ESC(r.hosted_url)}" target="_blank" rel="noopener">Open</a>` : ''}
                  ${r.pdf_url ? `<a class="btn-link" href="${ESC(r.pdf_url)}" target="_blank" rel="noopener">PDF</a>` : ''}
                  ${r._isStudio ? `<a class="btn-link" href="#" data-q-open-studio="${ESC(r.submission_id)}">View studio</a>` : ''}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>`;
    if (!host._qListBound) {
      host._qListBound = true;
      host.addEventListener('click', (e) => {
        const studioLink = e.target.closest('[data-q-open-studio]');
        if (studioLink) {
          e.preventDefault();
          const id = studioLink.getAttribute('data-q-open-studio');
          if (id && window.AdminDetail && window.AdminDetail.open) {
            window.AdminDetail.open(id, { tab: 'quotes' });
          }
        }
      });
    }
  }

  window.AdminQuote = {
    openForStudio(submission) { open({ mode: 'studio', submission }); },
    openExternal() { open({ mode: 'external' }); },
    close,
    renderStudioQuotesPanel,
    openListScreen,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
