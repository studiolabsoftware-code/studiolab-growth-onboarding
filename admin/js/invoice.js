/* StudioLAB Growth admin: one-off invoice creator + lifecycle actions.
   Opens a modal with two recipient modes (studio / external), one or more
   line items, currency, collection method, and posts to the
   create-custom-invoice edge function. Also renders the per-studio
   Invoices panel on the detail page, the global Invoices screen, and the
   row-level actions (Resend, Revise, Mark paid, Refund, Edit draft,
   Finalize draft, Delete draft, Void). */

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
    past_due: 'Past due',
    paid: 'Paid',
    voided: 'Voided',
    uncollectible: 'Uncollectible',
    refunded: 'Refunded',
    partially_refunded: 'Partial refund',
  };

  const STATUS_CLASS = {
    draft: 'bdg-st-submitted',
    open: 'bdg-st-in_review',
    past_due: 'bdg-st-changes_requested',
    paid: 'bdg-st-complete',
    voided: 'bdg-st-changes_requested',
    uncollectible: 'bdg-st-changes_requested',
    refunded: 'bdg-st-changes_requested',
    partially_refunded: 'bdg-st-changes_requested',
  };

  const PAYMENT_METHOD_LABEL = {
    cheque: 'Cheque',
    bank_transfer: 'Bank transfer / EFT',
    cash: 'Cash',
    other: 'Other',
  };

  // ── State (per-open) ───────────────────────────────────────────────────────
  let currentContext = null; // { mode, submission?, revision? }
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

  function todayIsoDate() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function shortDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function authHeaders() {
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    return {
      'Content-Type': 'application/json',
      'Authorization': jwt ? `Bearer ${jwt}` : '',
      'apikey': (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '',
    };
  }
  function apiBase() { return (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || ''; }

  // Strict country-to-currency mapping. AU recipients are always invoiced in
  // AUD with GST; everyone else is invoiced in USD without GST.
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
          ? 'AU studio: invoiced in AUD with 10% GST.'
          : 'Overseas studio: invoiced in USD with no GST.');
    } else {
      $('#invStudioName').textContent = 'No studio selected';
      $('#invStudioMeta').textContent = '';
      $('#invCurrency').value = 'AUD';
      lockCurrency(null);
    }
    $('#invExtEmail').value = '';
    $('#invExtName').value = '';
    $('#invExtCountry').value = '';
    $('#invCollection').value = 'send_invoice';
    $('#invDueDays').value = '14';
    $('#invDescription').value = '';
    $('#invMemo').value = '';
    // Phase 6.2a: "Create project on payment" — studio invoices opt-in (off
    // by default), external invoices always spawn (toggle hidden because
    // the server forces true regardless).
    const spawnBox = $('#invSpawnProject');
    if (spawnBox) spawnBox.checked = false;
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
      if (rev.external && !isStudio) {
        if (rev.external.email) $('#invExtEmail').value = rev.external.email;
        if (rev.external.name) $('#invExtName').value = rev.external.name;
        if (rev.external.country) $('#invExtCountry').value = rev.external.country;
      }
    } else if (rev) {
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
    const draftBtn = $('#invDraftBtn');
    if (draftBtn) draftBtn.disabled = false;
    // Reframe the CTAs based on whether this is a fresh invoice, a draft
    // edit, or a revision of an issued invoice.
    if (rev && rev.pendingVoidId) {
      $('#invSendBtn').textContent = 'Void original and re-issue';
      if (draftBtn) draftBtn.hidden = true;
    } else if (rev && rev.pendingDeleteDraftId) {
      $('#invSendBtn').textContent = 'Update and send';
      if (draftBtn) {
        draftBtn.hidden = false;
        draftBtn.textContent = 'Save draft';
      }
    } else {
      $('#invSendBtn').textContent = 'Create and send';
      if (draftBtn) {
        draftBtn.hidden = false;
        draftBtn.textContent = 'Save as draft';
      }
    }

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
    const send = $('#invCollection').value === 'send_invoice';
    $('#invDueDaysRow').hidden = !send;
    // Spawn-project toggle is studio-only. External invoices always spawn
    // server-side, so we hide the control rather than confusing the admin
    // with an option that has no effect.
    const spawnRow = $('#invSpawnProjectRow');
    if (spawnRow) spawnRow.hidden = !isStudio;
    if (isStudio && currentContext?.submission) {
      const c = currencyForCountry(currentContext.submission.country) || 'AUD';
      lockCurrency(c,
        c === 'AUD'
          ? 'AU studio: invoiced in AUD with 10% GST.'
          : 'Overseas studio: invoiced in USD with no GST.');
    } else {
      onExternalCountryChange();
    }
  }

  function onExternalCountryChange() {
    const country = $('#invExtCountry').value;
    const c = currencyForCountry(country);
    if (c === 'AUD') {
      lockCurrency('AUD', 'AU recipient: invoiced in AUD with 10% GST.');
    } else if (c === 'USD') {
      lockCurrency('USD', 'Overseas recipient: invoiced in USD with no GST.');
    } else {
      lockCurrency(null);
    }
    updateTotalsUI();
  }

  // ── Catalog picker (upgrade SKUs) ────────────────────────────────────────
  function openCatalogPicker() {
    if (!window.AdminCatalogPicker || typeof window.AdminCatalogPicker.open !== 'function') {
      console.warn('AdminCatalogPicker not loaded yet');
      return;
    }
    const currency = ($('#invCurrency').value || 'AUD').toUpperCase();
    window.AdminCatalogPicker.open({
      currency,
      onPick(row, meta) {
        const amount = ((row.amount_cents || 0) / 100).toFixed(2);
        const includesNote = Array.isArray(row.includes) && row.includes.length
          ? ' — ' + row.includes.join('; ')
          : '';
        // Stamp SKU kind + id onto the line row so submit() can aggregate
        // source_sku_links for the post-payment materialiser.
        addLineItemRow({
          description: row.name + (row.description ? ' · ' + row.description : '') + includesNote,
          quantity: 1,
          amount,
          source_sku_id: row.id,
          source_sku_kind: meta && meta.kind === 'general' ? 'general' : 'upgrade',
        });
        updateTotalsUI();
      },
    });
  }

  // ── Line items ─────────────────────────────────────────────────────────────
  function addLineItemRow(initial) {
    const row = document.createElement('div');
    row.className = 'inv-row';
    // Stash the catalog SKU id + kind on the row's dataset so collectSourceSkuLinks
    // can rebuild the source_sku_links array at submit time. Free-text lines
    // (no SKU picked) leave both blank and contribute nothing.
    if (initial?.source_sku_id) row.dataset.sourceSkuId = initial.source_sku_id;
    if (initial?.source_sku_kind) row.dataset.sourceSkuKind = initial.source_sku_kind;
    row.innerHTML = `
      <input type="text" data-fld="description" placeholder="Description" value="${ESC(initial?.description || '')}">
      <input type="number" data-fld="quantity" min="1" step="1" value="${ESC(initial?.quantity || 1)}" style="width:70px;">
      <input type="number" data-fld="amount" min="0" step="0.01" placeholder="0.00" value="${ESC(initial?.amount || '')}" style="width:120px;">
      <button type="button" class="btn-link" data-act="remove">Remove</button>
    `;
    row.querySelectorAll('input').forEach((i) => i.addEventListener('input', updateTotalsUI));
    row.querySelector('[data-act="remove"]').addEventListener('click', () => {
      const all = $$('#invItems .inv-row');
      if (all.length <= 1) return;
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

  // Walk the line rows and pull out their catalog-SKU stamps. Deduped per
  // (kind,id) — if the admin added the same SKU twice (e.g. quantity 2 across
  // two rows) we still only materialise one set of template deliverables.
  // Kept separate from collectLineItems so the create-custom-invoice request
  // body stays free of UI-only fields.
  function collectSourceSkuLinks() {
    const rows = $$('#invItems .inv-row');
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const id = r.dataset.sourceSkuId;
      const kind = r.dataset.sourceSkuKind;
      if (!id || (kind !== 'upgrade' && kind !== 'general')) continue;
      const key = `${kind}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, id });
    }
    return out;
  }

  function updateTotalsUI() {
    const items = collectLineItems();
    const currency = $('#invCurrency').value;
    const subtotalCents = items.reduce((s, li) => s + (li.amount_cents * li.quantity), 0);
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
  function validateAndBuildPayload(opts) {
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
        ...(opts && opts.saveAsDraft ? { save_as_draft: true } : {}),
        // Studio-only field. External invoices always spawn server-side, so
        // omit the field for clarity — the edge function infers the flag.
        ...(isStudio && $('#invSpawnProject') && $('#invSpawnProject').checked
          ? { spawn_project_on_paid: true }
          : {}),
        // Catalog SKU links per line row (deduped). Empty array when no
        // SKU was picked — the post-payment materialiser is a no-op then.
        source_sku_links: collectSourceSkuLinks(),
      } : null,
    };
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submit(opts) {
    const saveAsDraft = !!(opts && opts.saveAsDraft);
    $('#invErr').classList.remove('vis');
    const { ok, errors, payload } = validateAndBuildPayload({ saveAsDraft });
    if (!ok) {
      $('#invErr').textContent = errors.join(' ');
      $('#invErr').classList.add('vis');
      return;
    }
    const sendBtn = $('#invSendBtn');
    const draftBtn = $('#invDraftBtn');
    const activeBtn = saveAsDraft ? (draftBtn || sendBtn) : sendBtn;
    const origLabel = activeBtn.textContent;
    sendBtn.disabled = true;
    if (draftBtn) draftBtn.disabled = true;
    activeBtn.textContent = saveAsDraft ? 'Saving draft…' : 'Creating…';

    try {
      const rev = currentContext && currentContext.revision;

      if (rev && rev.pendingVoidId) {
        activeBtn.textContent = 'Voiding original…';
        const vResp = await fetch(apiBase() + '/functions/v1/manage-invoice', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ action: 'void', invoice_id: rev.pendingVoidId }),
        });
        const vData = await vResp.json().catch(() => ({}));
        if (!vResp.ok || !vData.ok) {
          $('#invErr').textContent = 'Could not void the original (' + (vData.error || vResp.status) + '). The original invoice has not been changed.';
          $('#invErr').classList.add('vis');
          sendBtn.disabled = false;
          if (draftBtn) draftBtn.disabled = false;
          activeBtn.textContent = origLabel;
          return;
        }
        activeBtn.textContent = 'Creating revised invoice…';
      } else if (rev && rev.pendingDeleteDraftId) {
        // Draft-edit flow: delete the old draft, create a new one in its
        // place. Stripe drafts can't be edited line-by-line cheaply once
        // items are attached, so we recreate.
        activeBtn.textContent = 'Replacing draft…';
        const dResp = await fetch(apiBase() + '/functions/v1/manage-invoice', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ action: 'delete-draft', invoice_id: rev.pendingDeleteDraftId }),
        });
        const dData = await dResp.json().catch(() => ({}));
        if (!dResp.ok || !dData.ok) {
          $('#invErr').textContent = 'Could not replace the old draft (' + (dData.error || dResp.status) + ').';
          $('#invErr').classList.add('vis');
          sendBtn.disabled = false;
          if (draftBtn) draftBtn.disabled = false;
          activeBtn.textContent = origLabel;
          return;
        }
      }

      const url = apiBase() + '/functions/v1/create-custom-invoice';
      const resp = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        const reason = data.error || `Failed (${resp.status})`;
        $('#invErr').textContent = reason;
        $('#invErr').classList.add('vis');
        sendBtn.disabled = false;
        if (draftBtn) draftBtn.disabled = false;
        activeBtn.textContent = origLabel;
        return;
      }
      $('#invForm').hidden = true;
      const inv = data.invoice;
      $('#invSuccessNumber').textContent = saveAsDraft
        ? 'Draft saved'
        : (inv.number || '(pending number)');
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
      if (payload.recipient.type === 'studio') {
        refreshStudioInvoicesPanel(payload.recipient.submission_id);
      }
      if (document.getElementById('invListBody')) {
        await loadListRows();
        renderList();
      }
    } catch (err) {
      console.error('create-custom-invoice failed:', err);
      $('#invErr').textContent = String(err && err.message || err);
      $('#invErr').classList.add('vis');
      sendBtn.disabled = false;
      if (draftBtn) draftBtn.disabled = false;
      activeBtn.textContent = origLabel;
    }
  }

  // ── Per-studio Invoices panel ──────────────────────────────────────────────
  async function renderStudioInvoicesPanel(submissionId, hostEl) {
    if (!hostEl) return;
    hostEl.innerHTML = '<div class="adm-empty" style="padding:16px 0;">Loading invoices…</div>';
    const sb = window.initSupabase && window.initSupabase();
    if (!sb) {
      hostEl.innerHTML = '<div class="adm-empty">Supabase client unavailable.</div>';
      return;
    }
    const { data, error } = await sb.from('invoices')
      .select('id, number, kind, status, currency, total_cents, amount_paid_cents, amount_refunded_cents, issued_at, paid_at, hosted_url, pdf_url, description, stripe_invoice_id, email_sent_at, last_resent_at, resend_count, voided_at, marked_paid_manually, manual_payment_method, manual_payment_date, manual_payment_reference, submission_id, external_contact_id, collection_method, project_id')
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
  // Invoices list screen. One primary inline action per status; everything
  // else lives in a kebab (⋮) menu that flips above or below the button
  // depending on viewport space. Keeps the row scannable when there are 5+
  // possible actions per status.
  function rowActionConfig(r, showRecipient) {
    const isDraft = r.status === 'draft';
    const isOpen = r.status === 'open' || r.status === 'past_due';
    const isPaid = r.status === 'paid' || r.status === 'partially_refunded';
    const hasProject = !!r.project_id;

    const primary = []; // 0–1 inline button — points at the next in-platform action
    const menu = [];    // everything else, inside the kebab

    // Primary action priority (Phase 6.2a):
    //   project_id set    → Open project (in-platform)
    //   draft             → Edit draft
    //   open / past_due   → Mark paid (the action that moves it forward)
    //   paid, no project  → Create project (retroactive spawn)
    //   else              → kebab-only
    if (hasProject) {
      primary.push({ label: 'Open project', act: 'open-project' });
    } else if (isDraft) {
      primary.push({ label: 'Edit draft', act: 'edit-draft' });
    } else if (isOpen) {
      primary.push({ label: 'Mark paid', act: 'mark-paid' });
    } else if (isPaid) {
      primary.push({ label: 'Create project', act: 'create-project' });
    }

    // Kebab contents — status-specific lifecycle actions, with Stripe links
    // buried at the bottom (receipt for paid, hosted invoice for open).
    if (isDraft) {
      menu.push({ label: 'Finalize and send', act: 'finalize-draft' });
      menu.push({ divider: true });
      menu.push({ label: 'Delete draft', act: 'delete-draft', destructive: true });
    } else if (isOpen) {
      menu.push({ label: 'Resend email', act: 'resend' });
      menu.push({ label: 'Revise (void + recreate)', act: 'revise' });
      if (r.hosted_url) menu.push({ label: 'View Stripe invoice', href: r.hosted_url, external: true });
      if (r.pdf_url) menu.push({ label: 'Download PDF', href: r.pdf_url, external: true });
      menu.push({ divider: true });
      menu.push({ label: 'Void invoice', act: 'void', destructive: true });
    } else if (isPaid) {
      if (r.hosted_url) menu.push({ label: 'View Stripe receipt', href: r.hosted_url, external: true });
      if (r.pdf_url) menu.push({ label: 'Download PDF', href: r.pdf_url, external: true });
      if (!r.marked_paid_manually) {
        menu.push({ divider: true });
        menu.push({ label: 'Issue refund', act: 'refund', destructive: true });
      }
    } else {
      // Voided / refunded — read-only Stripe access only.
      if (r.hosted_url) menu.push({ label: 'View on Stripe', href: r.hosted_url, external: true });
      if (r.pdf_url) menu.push({ label: 'Download PDF', href: r.pdf_url, external: true });
    }

    if (showRecipient && r._isStudio) {
      if (menu.length) menu.push({ divider: true });
      menu.push({ label: 'View studio', studioOpenId: r.submission_id });
    }

    return { primary, menu };
  }

  function renderInvoiceRow(r, opts) {
    const showRecipient = !!(opts && opts.showRecipient);
    const recipientCell = showRecipient
      ? `<td>
          <div>${ESC(r._recipientName || '')}</div>
          <div class="inv-list-sub">${ESC(r._recipientEmail || '')}${r._isStudio ? '' : ' · <span class="inv-list-tag">External</span>'}</div>
        </td>`
      : '';
    const sentAt = r.email_sent_at || r.issued_at;
    const sentLine = r.status === 'draft'
      ? '<span class="adm-empty">Draft — not sent</span>'
      : (sentAt
        ? `Sent ${shortDate(sentAt)}`
        : '<span class="adm-empty">Not sent</span>');
    const resendLine = r.last_resent_at
      ? `<div class="inv-list-sub">Resent ${shortDate(r.last_resent_at)}${r.resend_count > 1 ? ` (×${r.resend_count})` : ''}</div>`
      : '';
    const paidLine = r.paid_at
      ? `<div class="inv-list-sub">${r.marked_paid_manually ? 'Marked paid' : 'Paid'} ${shortDate(r.paid_at)}${r.marked_paid_manually && r.manual_payment_method ? ' · ' + ESC(PAYMENT_METHOD_LABEL[r.manual_payment_method] || r.manual_payment_method) : ''}</div>`
      : '';
    const voidLine = r.voided_at
      ? `<div class="inv-list-sub" style="color:#B91C1C;">Voided ${shortDate(r.voided_at)}</div>`
      : '';
    const refundedLine = (r.amount_refunded_cents || 0) > 0
      ? `<div class="inv-list-sub" style="color:#B91C1C;">Refunded ${moneyFmt(r.amount_refunded_cents, r.currency)}${r.status === 'partially_refunded' ? ' (partial)' : ''}</div>`
      : '';

    const isDraft = r.status === 'draft';
    const { primary, menu } = rowActionConfig(r, showRecipient);

    const primaryHtml = primary.map((p) => {
      if (p.href) {
        return `<a class="btn-link" href="${ESC(p.href)}" target="_blank" rel="noopener">${ESC(p.label)}</a>`;
      }
      return `<a class="btn-link" href="#" data-inv-act="${ESC(p.act)}" data-inv-id="${ESC(r.id)}">${ESC(p.label)}</a>`;
    }).join('');

    const kebabHtml = menu.length
      ? `<button type="button" class="inv-kebab" aria-haspopup="menu" aria-expanded="false" aria-label="More actions" data-inv-kebab="${ESC(r.id)}">⋮</button>`
      : '';

    return `
      <tr data-inv-row="${ESC(r.id)}" class="inv-row-clickable">
        <td><button type="button" class="inv-row-num" data-inv-open="${ESC(r.id)}">${ESC(r.number || (isDraft ? '(draft)' : '—'))}</button></td>
        ${recipientCell}
        <td><span class="bdg ${STATUS_CLASS[r.status] || ''}">${ESC(STATUS_LABEL[r.status] || r.status)}</span></td>
        <td>${moneyFmt(r.total_cents, r.currency)}</td>
        <td style="font-size:12px;">${sentLine}${resendLine}${paidLine}${voidLine}${refundedLine}</td>
        <td><div class="inv-actions">${primaryHtml}${kebabHtml}</div></td>
      </tr>`;
  }

  // Kebab popover: positioned fixed against the trigger button's bounding
  // box. Flips above when there isn't room below. One menu open at a time —
  // re-clicking the same kebab closes it; clicking outside dismisses.
  let activeMenu = null;

  function closeKebabMenu() {
    if (!activeMenu) return;
    const { el, anchor, dismiss } = activeMenu;
    document.removeEventListener('click', dismiss, true);
    document.removeEventListener('keydown', dismiss, true);
    window.removeEventListener('resize', dismiss, true);
    window.removeEventListener('scroll', dismiss, true);
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    activeMenu = null;
  }

  function openKebabMenu(anchor, items, onAction) {
    // Toggle: re-clicking the same anchor closes the open menu.
    if (activeMenu && activeMenu.anchor === anchor) {
      closeKebabMenu();
      return;
    }
    closeKebabMenu();

    const el = document.createElement('div');
    el.className = 'inv-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = items.map((it, i) => {
      if (it.divider) return '<hr class="inv-menu-div">';
      const klass = 'inv-menu-item' + (it.destructive ? ' destructive' : '');
      if (it.href) {
        return `<a class="${klass}" role="menuitem" href="${ESC(it.href)}"${it.external ? ' target="_blank" rel="noopener"' : ''}>${ESC(it.label)}</a>`;
      }
      return `<button type="button" class="${klass}" role="menuitem" data-i="${i}">${ESC(it.label)}</button>`;
    }).join('');
    document.body.appendChild(el);

    // Position. Place against the kebab's right edge, flip up if too close
    // to the viewport bottom.
    const rect = anchor.getBoundingClientRect();
    const menuRect = el.getBoundingClientRect();
    const margin = 8;
    let left = rect.right - menuRect.width;
    if (left < margin) left = margin;
    if (left + menuRect.width > window.innerWidth - margin) {
      left = window.innerWidth - menuRect.width - margin;
    }
    let top = rect.bottom + 4;
    if (top + menuRect.height + margin > window.innerHeight) {
      const flipped = rect.top - menuRect.height - 4;
      if (flipped >= margin) top = flipped;
    }
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    anchor.setAttribute('aria-expanded', 'true');

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-i'), 10);
      const item = items[idx];
      closeKebabMenu();
      if (item && typeof onAction === 'function') onAction(item);
    });
    // External-link items inside the menu — close the menu on click but
    // let the anchor's default navigation fire.
    el.addEventListener('click', (e) => {
      if (e.target.closest('a.inv-menu-item')) {
        // Allow the link to follow, then tear down on the next tick.
        setTimeout(closeKebabMenu, 0);
      }
    });

    function dismiss(e) {
      if (e.type === 'keydown' && e.key === 'Escape') {
        e.preventDefault();
        closeKebabMenu();
        return;
      }
      if (e.type === 'click' && (el.contains(e.target) || anchor.contains(e.target))) return;
      closeKebabMenu();
    }
    setTimeout(() => {
      document.addEventListener('click', dismiss, true);
      document.addEventListener('keydown', dismiss, true);
      window.addEventListener('resize', dismiss, true);
      window.addEventListener('scroll', dismiss, true);
    }, 0);

    activeMenu = { el, anchor, dismiss };
  }

  function bindInvoiceRowActions(hostEl, onReload, rows) {
    hostEl._invRows = rows;
    if (hostEl._invActionsBound) return;
    hostEl._invActionsBound = true;
    hostEl.addEventListener('click', async (e) => {
      // Row-Number click opens the detail drawer.
      const openBtn = e.target.closest('[data-inv-open]');
      if (openBtn) {
        e.preventDefault();
        const id = openBtn.getAttribute('data-inv-open');
        const row = (hostEl._invRows || []).find((r) => r.id === id);
        if (row) openInvoiceDrawer(row, () => {
          if (typeof onReload === 'function') return onReload();
        });
        return;
      }
      // Kebab opens the menu.
      const kebab = e.target.closest('[data-inv-kebab]');
      if (kebab) {
        e.preventDefault();
        const id = kebab.getAttribute('data-inv-kebab');
        const row = (hostEl._invRows || []).find((r) => r.id === id);
        if (!row) return;
        const { menu } = rowActionConfig(row, !!hostEl._showRecipient);
        openKebabMenu(kebab, menu, (item) => dispatchRowItem(item, row, onReload, hostEl));
        return;
      }
      // Direct inline action (primary).
      const target = e.target.closest('[data-inv-act]');
      if (!target) return;
      e.preventDefault();
      const act = target.getAttribute('data-inv-act');
      const id = target.getAttribute('data-inv-id');
      const row = (hostEl._invRows || []).find((r) => r.id === id);
      if (!row) return;
      dispatchRowItem({ act }, row, onReload, hostEl);
    });
  }

  function dispatchRowItem(item, row, onReload, hostEl) {
    if (item.studioOpenId) {
      if (window.AdminDetail && window.AdminDetail.open) {
        window.AdminDetail.open(item.studioOpenId, { tab: 'invoices' });
      }
      return;
    }
    const act = item.act;
    const submission = hostEl && hostEl._submission || null;
    if (act === 'resend')         return doResendInvoice(row, onReload);
    if (act === 'revise')         return doReviseInvoice(row, onReload, submission);
    if (act === 'edit-draft')     return doEditDraft(row, onReload, submission);
    if (act === 'finalize-draft') return doFinalizeDraftAction(row, onReload);
    if (act === 'delete-draft')   return doDeleteDraftAction(row, onReload);
    if (act === 'mark-paid')      return doMarkPaid(row, onReload);
    if (act === 'refund')         return doRefund(row, onReload);
    if (act === 'void')           return doVoidAction(row, onReload);
    if (act === 'open-project')   return doOpenProject(row);
    if (act === 'create-project') return doCreateProject(row, onReload);
  }

  function doOpenProject(row) {
    if (!row.project_id) return;
    if (window.AdminProjects && window.AdminProjects.openDetail) {
      if (window.AdminAuth && window.AdminAuth.showSection) {
        // Mark the Projects nav active so the breadcrumb context lines up.
        document.querySelectorAll('.adm-nav-link').forEach((b) => {
          b.classList.toggle('active', b.dataset.section === 'projects');
        });
      }
      window.AdminProjects.openDetail(row.project_id);
    } else {
      console.warn('AdminProjects not loaded');
    }
  }

  async function doCreateProject(row, onReload) {
    const ok = await showConfirm({
      title: 'Create a project for this invoice?',
      message: `<p>This invoice (<strong>${ESC(row.number || '')}</strong>) doesn't have a project yet. Creating one gives you somewhere to track deliverables, files, and review cycles for the work it funded.</p><p style="color:var(--g6);font-size:12px;">You can rename it from the project page.</p>`,
      confirmLabel: 'Create project',
    });
    if (!ok) return;
    try {
      const resp = await fetch(apiBase() + '/functions/v1/create-project', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ mode: 'from_invoice', invoice_id: row.id }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Could not create project', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
      if (window.AdminProjects && window.AdminProjects.openDetail) {
        window.AdminProjects.openDetail(data.project_id);
      }
    } catch (err) {
      console.error('create-project failed:', err);
      await showAlert('Could not create the project.');
    }
  }

  // ── manage-invoice helpers ──────────────────────────────────────────────
  async function callManage(body) {
    const resp = await fetch(apiBase() + '/functions/v1/manage-invoice', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  }

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

  async function doResendInvoice(row, onReload) {
    const ok = await showConfirm({
      title: 'Resend invoice email?',
      message: `<p>Send the hosted-invoice email to the recipient again for <strong>${ESC(row.number || 'this invoice')}</strong>.</p><p style="color:var(--g6);font-size:12px;">In Stripe test mode the email goes only to your Stripe account email, not the recipient.</p>`,
      confirmLabel: 'Resend',
    });
    if (!ok) return;
    try {
      const { resp, data } = await callManage({ action: 'resend', invoice_id: row.id });
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Resend failed', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('resend failed:', err);
      await showAlert('Could not resend the invoice. Please try again.');
    }
  }

  async function doVoidAction(row, onReload) {
    const ok = await showConfirm({
      title: 'Void this invoice?',
      message: `<p>Voiding <strong>${ESC(row.number || 'this invoice')}</strong> is permanent on Stripe — the recipient can no longer pay it. Use Revise if you want to issue a replacement.</p>`,
      confirmLabel: 'Void invoice',
      destructive: true,
    });
    if (!ok) return;
    try {
      const { resp, data } = await callManage({ action: 'void', invoice_id: row.id });
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Void failed', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('void failed:', err);
      await showAlert('Could not void the invoice.');
    }
  }

  // Revise: open the modal pre-filled. Original is voided only on Send.
  async function doReviseInvoice(row, onReload, submission) {
    const snap = await loadSnapshot(row.id);
    if (!snap) return;
    const revision = {
      pendingVoidId: row.id,
      pendingVoidNumber: row.number,
      lines: snap.lines || [],
      description: snap.description || row.description || '',
      currency: snap.currency || row.currency || 'AUD',
      collection_method: snap.collection_method,
      due_days: snap.due_days,
      external: !submission ? {
        name: snap.customer_name,
        email: snap.customer_email,
        country: snap.customer_country,
      } : null,
    };
    if (submission) {
      open({ mode: 'studio', submission, revision });
    } else {
      open({ mode: 'external', revision });
    }
    void onReload;
  }

  // Edit draft: same as Revise but for un-issued drafts. Old draft is
  // deleted (not voided) on Send.
  async function doEditDraft(row, onReload, submission) {
    if (row.status !== 'draft') {
      await showAlert({ title: 'Not a draft', message: 'This invoice has already been issued — use Revise instead.' });
      return;
    }
    const snap = await loadSnapshot(row.id);
    if (!snap) return;
    const revision = {
      pendingDeleteDraftId: row.id,
      lines: snap.lines || [],
      description: snap.description || row.description || '',
      currency: snap.currency || row.currency || 'AUD',
      collection_method: snap.collection_method,
      due_days: snap.due_days,
      external: !submission ? {
        name: snap.customer_name,
        email: snap.customer_email,
        country: snap.customer_country,
      } : null,
    };
    if (submission) {
      open({ mode: 'studio', submission, revision });
    } else {
      open({ mode: 'external', revision });
    }
    void onReload;
  }

  async function loadSnapshot(invoiceId) {
    try {
      const { resp, data } = await callManage({ action: 'get-snapshot', invoice_id: invoiceId });
      if (!resp.ok || !data.ok || !data.snapshot) {
        await showAlert({ title: 'Could not load invoice', message: ESC(data.error || `Status ${resp.status}.`) });
        return null;
      }
      return data.snapshot;
    } catch (err) {
      console.error('get-snapshot failed:', err);
      await showAlert('Could not load the invoice.');
      return null;
    }
  }

  async function doFinalizeDraftAction(row, onReload) {
    const ok = await showConfirm({
      title: 'Finalize and send this draft?',
      message: `<p>This will issue the draft as a real invoice and email it to the recipient.</p><p style="color:var(--g6);font-size:12px;">In Stripe test mode the email goes only to your Stripe account email, not the recipient.</p>`,
      confirmLabel: 'Finalize and send',
    });
    if (!ok) return;
    try {
      const { resp, data } = await callManage({ action: 'finalize-draft', invoice_id: row.id });
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Finalize failed', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('finalize-draft failed:', err);
      await showAlert('Could not finalize the draft.');
    }
  }

  async function doDeleteDraftAction(row, onReload) {
    const ok = await showConfirm({
      title: 'Delete this draft?',
      message: `<p>This permanently removes the draft on Stripe and from your records.</p>`,
      confirmLabel: 'Delete draft',
      destructive: true,
    });
    if (!ok) return;
    try {
      const { resp, data } = await callManage({ action: 'delete-draft', invoice_id: row.id });
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Delete failed', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('delete-draft failed:', err);
      await showAlert('Could not delete the draft.');
    }
  }

  // ── Mark paid / Refund: small inline form dialog ────────────────────────
  function openFormDialog({ title, intro, fields, confirmLabel, destructive }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'adm-modal';
      overlay.style.zIndex = '12000';
      overlay.hidden = false;
      overlay.innerHTML = `
        <div class="adm-modal-backdrop"></div>
        <div class="adm-modal-card" style="max-width:480px;">
          <div class="adm-modal-hdr">
            <h3 class="adm-modal-title">${ESC(title)}</h3>
          </div>
          <div class="adm-modal-body">
            ${intro ? `<p style="margin-top:0;">${intro}</p>` : ''}
            <form data-form>
              ${fields.map((f) => renderField(f)).join('')}
              <div class="form-err" data-err style="display:none;color:#B91C1C;font-size:13px;margin-top:8px;"></div>
            </form>
          </div>
          <div class="adm-modal-ftr">
            <button type="button" class="btn btn-g" data-act="cancel">Cancel</button>
            <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-p'}" data-act="ok">${ESC(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.body.classList.add('adm-modal-open');

      function teardown(result) {
        overlay.remove();
        document.body.classList.remove('adm-modal-open');
        resolve(result);
      }

      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => teardown(null));
      overlay.querySelector('.adm-modal-backdrop').addEventListener('click', () => teardown(null));
      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => {
        const form = overlay.querySelector('[data-form]');
        const values = {};
        for (const f of fields) {
          const el = form.querySelector(`[name="${f.name}"]`);
          if (!el) continue;
          if (f.type === 'select' || f.type === 'date' || f.type === 'text' || f.type === 'number') {
            values[f.name] = el.value;
          } else if (f.type === 'radio') {
            const checked = form.querySelector(`[name="${f.name}"]:checked`);
            values[f.name] = checked ? checked.value : '';
          }
        }
        const errs = [];
        for (const f of fields) {
          if (f.required && !values[f.name]) errs.push(`${f.label} is required.`);
          if (f.validate) {
            const e = f.validate(values[f.name], values);
            if (e) errs.push(e);
          }
        }
        const errEl = overlay.querySelector('[data-err]');
        if (errs.length) {
          errEl.textContent = errs.join(' ');
          errEl.style.display = '';
          return;
        }
        teardown(values);
      });

      setTimeout(() => {
        const first = overlay.querySelector('input, select');
        if (first) first.focus();
      }, 50);
    });
  }

  function renderField(f) {
    const id = `flddlg_${f.name}`;
    const labelHtml = f.label ? `<label for="${id}" style="display:block;font-size:13px;font-weight:600;margin:10px 0 4px;">${ESC(f.label)}</label>` : '';
    if (f.type === 'select') {
      const opts = (f.options || []).map((o) => `<option value="${ESC(o.value)}"${o.value === (f.value || '') ? ' selected' : ''}>${ESC(o.label)}</option>`).join('');
      return labelHtml + `<select id="${id}" name="${f.name}" style="width:100%;">${opts}</select>`;
    }
    if (f.type === 'radio') {
      return labelHtml + (f.options || []).map((o, i) => `
        <label style="display:flex;align-items:center;gap:8px;margin:4px 0;font-weight:400;">
          <input type="radio" name="${f.name}" value="${ESC(o.value)}"${(o.value === (f.value || '') || (i === 0 && !f.value)) ? ' checked' : ''}>
          <span>${ESC(o.label)}</span>
        </label>`).join('');
    }
    const type = f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text');
    const extra = (f.step ? ` step="${f.step}"` : '') + (f.min != null ? ` min="${f.min}"` : '') + (f.max != null ? ` max="${f.max}"` : '');
    return labelHtml + `<input type="${type}" id="${id}" name="${f.name}" value="${ESC(f.value || '')}" placeholder="${ESC(f.placeholder || '')}" style="width:100%;"${extra}>${f.hint ? `<div style="font-size:12px;color:var(--g6);margin-top:4px;">${ESC(f.hint)}</div>` : ''}`;
  }

  async function doMarkPaid(row, onReload) {
    if (row.status !== 'open' && row.status !== 'past_due') {
      await showAlert({ title: 'Cannot mark paid', message: `Only open invoices can be marked paid (current status: ${row.status}).` });
      return;
    }
    const values = await openFormDialog({
      title: 'Mark invoice as paid',
      intro: `<strong>${ESC(row.number || 'Invoice')}</strong> · ${moneyFmt(row.total_cents, row.currency)}<br><span style="color:var(--g6);font-size:12px;">Use this when the recipient paid outside Stripe (cheque, bank transfer, cash). Stripe will close the hosted invoice so they can't pay again.</span>`,
      fields: [
        {
          name: 'payment_method',
          label: 'Payment method',
          type: 'select',
          required: true,
          value: 'bank_transfer',
          options: [
            { value: 'bank_transfer', label: 'Bank transfer / EFT' },
            { value: 'cheque', label: 'Cheque' },
            { value: 'cash', label: 'Cash' },
            { value: 'other', label: 'Other' },
          ],
        },
        {
          name: 'payment_date',
          label: 'Payment date',
          type: 'date',
          required: true,
          value: todayIsoDate(),
        },
        {
          name: 'payment_reference',
          label: 'Reference (optional)',
          type: 'text',
          placeholder: 'Cheque number, EFT reference, …',
        },
      ],
      confirmLabel: 'Mark paid',
    });
    if (!values) return;
    try {
      const { resp, data } = await callManage({
        action: 'mark-paid',
        invoice_id: row.id,
        payment_method: values.payment_method,
        payment_date: values.payment_date,
        payment_reference: values.payment_reference,
      });
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Could not mark paid', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('mark-paid failed:', err);
      await showAlert('Could not mark the invoice as paid.');
    }
  }

  async function doRefund(row, onReload) {
    if (row.status !== 'paid' && row.status !== 'partially_refunded') {
      await showAlert({ title: 'Cannot refund', message: `Only paid invoices can be refunded (current status: ${row.status}).` });
      return;
    }
    if (row.marked_paid_manually) {
      await showAlert({ title: 'Cannot refund', message: 'This invoice was paid out-of-band — there is no Stripe charge to refund. Handle the refund through your bank.' });
      return;
    }
    const total = row.total_cents || 0;
    const already = row.amount_refunded_cents || 0;
    const cap = total - already;
    const values = await openFormDialog({
      title: 'Issue a refund',
      intro: `<strong>${ESC(row.number || 'Invoice')}</strong> · paid ${moneyFmt(total, row.currency)}${already ? ` · already refunded ${moneyFmt(already, row.currency)}` : ''}<br><span style="color:var(--g6);font-size:12px;">Refunds go through Stripe and are sent to the original payment method.</span>`,
      fields: [
        {
          name: 'refund_mode',
          label: 'Refund amount',
          type: 'radio',
          required: true,
          value: 'full',
          options: [
            { value: 'full', label: `Full refund (${moneyFmt(cap, row.currency)})` },
            { value: 'partial', label: 'Partial refund' },
          ],
        },
        {
          name: 'partial_amount',
          label: 'Amount to refund',
          type: 'number',
          step: '0.01',
          min: '0.01',
          placeholder: ((cap / 100).toFixed(2)),
          hint: `Maximum: ${moneyFmt(cap, row.currency)}`,
          validate(v, all) {
            if (all.refund_mode !== 'partial') return null;
            const cents = Math.round(parseFloat(v || '0') * 100);
            if (!Number.isInteger(cents) || cents <= 0) return 'Enter a positive partial amount.';
            if (cents > cap) return 'Partial amount exceeds the refundable balance.';
            return null;
          },
        },
        {
          name: 'reason',
          label: 'Internal reason (optional)',
          type: 'text',
          placeholder: 'Why this refund is being issued',
        },
      ],
      confirmLabel: 'Refund',
      destructive: true,
    });
    if (!values) return;
    const body = { action: 'refund', invoice_id: row.id, reason: values.reason || undefined };
    if (values.refund_mode === 'full') {
      body.refund_full = true;
    } else {
      body.refund_amount_cents = Math.round(parseFloat(values.partial_amount || '0') * 100);
    }
    try {
      const { resp, data } = await callManage(body);
      if (!resp.ok || !data.ok) {
        await showAlert({ title: 'Refund failed', message: ESC(data.error || `Status ${resp.status}.`) });
        return;
      }
      if (typeof onReload === 'function') await onReload();
    } catch (err) {
      console.error('refund failed:', err);
      await showAlert('Could not issue the refund.');
    }
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
      if (e.target.matches('[data-act="send"]')) submit({ saveAsDraft: false });
      if (e.target.matches('[data-act="save-draft"]')) submit({ saveAsDraft: true });
    });
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'invRecipient') updateModeUI();
      if (e.target.id === 'invCurrency') updateTotalsUI();
      if (e.target.id === 'invCollection') updateModeUI();
      if (e.target.id === 'invExtCountry') onExternalCountryChange();
    });
  }

  // ── Global Invoices screen ────────────────────────────────────────────────
  const LIST_STATUS_FILTERS = ['all', 'draft', 'open', 'paid', 'voided'];
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
          <p class="users-desc">Every invoice across studios and external contacts. Drafts live here too — finish or finalise them at your own pace.</p>
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
    const { data, error } = await sb.from('invoices')
      .select(`
        id, number, kind, status, currency, total_cents,
        amount_paid_cents, amount_refunded_cents, issued_at, paid_at,
        hosted_url, pdf_url, description, submission_id, external_contact_id,
        stripe_invoice_id, email_sent_at, last_resent_at, resend_count, voided_at,
        marked_paid_manually, manual_payment_method, manual_payment_date, manual_payment_reference,
        collection_method, project_id,
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
    host._showRecipient = true;
    bindInvoiceRowActions(host, async () => { await loadListRows(); renderList(); }, filtered);
  }

  // ── Invoice detail drawer (Phase 6.1b) ─────────────────────────────────
  // Side-panel summary of one invoice. Reuses the kebab action set as the
  // drawer's action surface so the row stays a clean overview and every
  // lifecycle action has a spacious home. Line items come from the Stripe
  // snapshot; activity events come from activity_log filtered to this
  // invoice (matched by stripe_invoice_id inside details, or invoice_id).
  let activeDrawer = null;
  function closeDrawer() {
    if (!activeDrawer) return;
    const { el, dismiss } = activeDrawer;
    document.removeEventListener('keydown', dismiss, true);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    document.body.classList.remove('adm-drawer-open');
    activeDrawer = null;
  }

  async function openInvoiceDrawer(row, onReload) {
    closeDrawer();
    const el = document.createElement('div');
    el.className = 'inv-drawer-wrap';
    el.innerHTML = `
      <div class="inv-drawer-backdrop"></div>
      <aside class="inv-drawer" role="dialog" aria-labelledby="invDrawerTitle">
        <header class="inv-drawer-hdr">
          <div class="inv-drawer-hdr-text">
            <div class="inv-drawer-eyebrow">${ESC(KIND_LABEL[row.kind] || 'Invoice')}</div>
            <h2 id="invDrawerTitle" class="inv-drawer-title">${ESC(row.number || (row.status === 'draft' ? 'Draft invoice' : '—'))}</h2>
            <div class="inv-drawer-sub">
              <span class="bdg ${STATUS_CLASS[row.status] || ''}">${ESC(STATUS_LABEL[row.status] || row.status)}</span>
              <span class="inv-drawer-total">${moneyFmt(row.total_cents, row.currency)}</span>
            </div>
          </div>
          <button type="button" class="inv-drawer-close" aria-label="Close" data-act="close">×</button>
        </header>
        <div class="inv-drawer-body" id="invDrawerBody">
          <div class="adm-empty" style="padding:24px 0;">Loading invoice…</div>
        </div>
      </aside>`;
    document.body.appendChild(el);
    document.body.classList.add('adm-drawer-open');

    const close = () => closeDrawer();
    el.querySelector('[data-act="close"]').addEventListener('click', close);
    el.querySelector('.inv-drawer-backdrop').addEventListener('click', close);
    const dismiss = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    document.addEventListener('keydown', dismiss, true);
    activeDrawer = { el, dismiss };

    // Body content — render twice. First with the data we already have on
    // the row (line items unknown), then once the Stripe snapshot returns,
    // re-render with line items + final totals.
    const body = el.querySelector('#invDrawerBody');
    body.innerHTML = renderDrawerBody(row, null, []);

    // Wire action buttons + kebab inside the drawer.
    bindDrawerActions(body, row, onReload);

    // Fetch the Stripe snapshot for line items.
    let snapshot = null;
    if (row.stripe_invoice_id) {
      try {
        const { resp, data } = await callManage({ action: 'get-snapshot', invoice_id: row.id });
        if (resp.ok && data.ok) snapshot = data.snapshot;
      } catch (e) { console.warn('drawer snapshot failed:', e); }
    }

    // Fetch the activity feed for this invoice.
    let activity = [];
    try {
      const sb = window.initSupabase && window.initSupabase();
      if (sb && row.stripe_invoice_id) {
        const { data } = await sb.from('activity_log')
          .select('id, action, actor, details, created_at')
          .or(`details->>invoice_id.eq.${row.stripe_invoice_id},details->>invoice_id.eq.${row.id}`)
          .order('created_at', { ascending: false })
          .limit(30);
        activity = data || [];
      }
    } catch (e) { console.warn('drawer activity failed:', e); }

    body.innerHTML = renderDrawerBody(row, snapshot, activity);
    bindDrawerActions(body, row, onReload);
  }

  function renderDrawerBody(r, snapshot, activity) {
    const lines = snapshot?.lines || [];
    const sentAt = r.email_sent_at || r.issued_at;
    const recipientLine = r._recipientName
      ? `<div><strong>${ESC(r._recipientName)}</strong>${r._recipientEmail ? ` · ${ESC(r._recipientEmail)}` : ''}${r._isStudio ? '' : ' · <span class="inv-list-tag">External</span>'}</div>`
      : '';
    const linesBlock = lines.length === 0
      ? `<div class="adm-empty" style="padding:8px 0;">Loading line items…</div>`
      : `<table class="inv-drawer-lines"><thead><tr>
          <th style="text-align:left;">Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Amount</th>
        </tr></thead><tbody>
          ${lines.map((l) => `<tr>
            <td>${ESC(l.description || '')}</td>
            <td style="text-align:right;">${l.quantity || 1}</td>
            <td style="text-align:right;">${moneyFmt((l.unit_amount_cents || 0) * (l.quantity || 1), r.currency)}</td>
          </tr>`).join('')}
        </tbody></table>`;

    const sendHistory = [
      sentAt ? `<div>Sent ${shortDate(sentAt)}</div>` : '',
      r.last_resent_at ? `<div>Resent ${shortDate(r.last_resent_at)}${r.resend_count > 1 ? ` (×${r.resend_count})` : ''}</div>` : '',
      r.paid_at ? `<div>${r.marked_paid_manually ? 'Marked paid' : 'Paid'} ${shortDate(r.paid_at)}${r.marked_paid_manually && r.manual_payment_method ? ' · ' + ESC(PAYMENT_METHOD_LABEL[r.manual_payment_method] || r.manual_payment_method) : ''}${r.manual_payment_reference ? ' · ref ' + ESC(r.manual_payment_reference) : ''}</div>` : '',
      r.voided_at ? `<div style="color:#B91C1C;">Voided ${shortDate(r.voided_at)}</div>` : '',
      (r.amount_refunded_cents || 0) > 0 ? `<div style="color:#B91C1C;">Refunded ${moneyFmt(r.amount_refunded_cents, r.currency)}</div>` : '',
    ].filter(Boolean).join('');

    const { primary, menu } = rowActionConfig(r, !!r._isStudio || !!r._recipientName);
    const allActs = [...primary, ...menu].filter((a) => !a.divider);
    const actionsHtml = allActs.map((a) => {
      if (a.studioOpenId) {
        return `<button type="button" class="btn btn-g" data-drawer-studio="${ESC(a.studioOpenId)}">${ESC(a.label)}</button>`;
      }
      if (a.href) {
        return `<a class="btn btn-g" href="${ESC(a.href)}"${a.external ? ' target="_blank" rel="noopener"' : ''}>${ESC(a.label)}</a>`;
      }
      const cls = a.destructive ? 'btn btn-danger' : 'btn btn-g';
      return `<button type="button" class="${cls}" data-drawer-act="${ESC(a.act)}">${ESC(a.label)}</button>`;
    }).join('');

    const projectBlock = r.project_id
      ? `<button type="button" class="btn btn-p" data-drawer-act="open-project">Open project →</button>`
      : `<button type="button" class="btn btn-g" data-drawer-act="create-project">Create project from this invoice</button>`;

    return `
      ${recipientLine ? `<section class="inv-drawer-sec">${recipientLine}</section>` : ''}

      <section class="inv-drawer-sec">
        <h3 class="inv-drawer-sec-title">Project</h3>
        ${projectBlock}
      </section>

      <section class="inv-drawer-sec">
        <h3 class="inv-drawer-sec-title">Line items</h3>
        ${linesBlock}
      </section>

      <section class="inv-drawer-sec">
        <h3 class="inv-drawer-sec-title">Send history</h3>
        <div class="inv-drawer-history">${sendHistory || '<span class="adm-empty">No send activity yet.</span>'}</div>
      </section>

      ${r.description ? `<section class="inv-drawer-sec">
        <h3 class="inv-drawer-sec-title">Internal note</h3>
        <p style="margin:0;color:#13102E;">${ESC(r.description)}</p>
      </section>` : ''}

      <section class="inv-drawer-sec">
        <h3 class="inv-drawer-sec-title">Actions</h3>
        <div class="inv-drawer-actions">${actionsHtml || '<span class="adm-empty">No actions available for this status.</span>'}</div>
      </section>

      <section class="inv-drawer-sec">
        <h3 class="inv-drawer-sec-title">Activity</h3>
        ${activity.length === 0
          ? '<span class="adm-empty">No activity yet.</span>'
          : `<ul class="inv-drawer-activity">${activity.map((a) => `<li>
              <span class="inv-drawer-when">${shortDate(a.created_at)}</span>
              <span class="inv-drawer-what">${ESC(a.action.replace(/_/g, ' '))}${a.actor ? ` · ${ESC(a.actor)}` : ''}</span>
            </li>`).join('')}</ul>`
        }
      </section>`;
  }

  function bindDrawerActions(body, row, onReload) {
    body.addEventListener('click', async (e) => {
      const studio = e.target.closest('[data-drawer-studio]');
      if (studio) {
        e.preventDefault();
        closeDrawer();
        if (window.AdminDetail?.open) window.AdminDetail.open(studio.getAttribute('data-drawer-studio'), { tab: 'invoices' });
        return;
      }
      const btn = e.target.closest('[data-drawer-act]');
      if (!btn) return;
      e.preventDefault();
      const act = btn.getAttribute('data-drawer-act');
      const wrappedReload = async () => {
        if (typeof onReload === 'function') await onReload();
        closeDrawer();
      };
      // Open-project and Create-project navigate away; close drawer immediately.
      if (act === 'open-project') {
        closeDrawer();
        if (window.AdminProjects?.openDetail && row.project_id) {
          window.AdminProjects.openDetail(row.project_id);
        }
        return;
      }
      // Hand off to the same dispatcher the kebab uses.
      const hostStub = { _submission: null };
      dispatchRowItem({ act }, row, wrappedReload, hostStub);
    });
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
