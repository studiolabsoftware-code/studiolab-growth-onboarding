/* Admin Catalog: product matrix (plan × setup × currency) with inline price
   edit + reason, active toggle, Stripe sync, and price history. Plus the
   discount codes tab. Reads from Supabase directly (RLS allows authenticated
   select on products / discount_codes); writes go through manage-products
   and manage-discount-codes edge functions. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;
  const $ = (id) => document.getElementById(id);

  const PLAN_LABEL = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
  const PLAN_ORDER = ['launch', 'scale', 'ai'];
  const SETUP_LABEL = { dfy: 'Done for you', guided: 'Guided' };
  const SETUP_ORDER = ['dfy', 'guided'];

  let products = [];
  let codes = [];
  let bound = false;
  let activeTab = 'products';

  async function show() {
    bind();
    await Promise.all([loadProducts(), loadCodes(), loadMode()]);
    renderMatrix();
    renderCodes();
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('.cat-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    $('catCodeNewBtn').addEventListener('click', () => openCodeModal(null));

    // Delegated action handler for product matrix + codes table.
    document.body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-cat-action]');
      if (!a) return;
      handleAction(a);
    });
  }

  function switchTab(tab) {
    if (!tab || tab === activeTab) return;
    activeTab = tab;
    document.querySelectorAll('.cat-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('catProductsPanel').style.display = tab === 'products' ? '' : 'none';
    $('catCodesPanel').style.display = tab === 'codes' ? '' : 'none';
  }

  async function loadMode() {
    const client = sb(); if (!client) return;
    const { data } = await client.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
    const mode = data?.stripe_mode || 'test';
    const pill = $('catModePill');
    pill.textContent = mode === 'live' ? 'Live mode' : 'Test mode';
    pill.classList.toggle('cat-mode-live', mode === 'live');
  }

  async function loadProducts() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('products')
      .select('*')
      .order('plan').order('setup_type').order('currency');
    if (error) { products = []; return; }
    products = data || [];
  }

  async function loadCodes() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('discount_codes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { codes = []; return; }
    codes = data || [];
  }

  function findProduct(plan, setup, currency) {
    return products.find((p) => p.plan === plan && p.setup_type === setup && p.currency === currency);
  }

  function renderMatrix() {
    const root = $('catMatrix');
    if (!products.length) {
      root.innerHTML = '<div class="adm-empty" style="padding:40px 0;">No products yet. Run migration 009 to seed the catalog.</div>';
      return;
    }
    const rows = [];
    rows.push(`
      <div class="cat-row cat-row-head">
        <div class="cat-cell-plan">Plan</div>
        <div class="cat-cell-setup">Setup</div>
        <div class="cat-cell-price">AUD</div>
        <div class="cat-cell-price">USD</div>
        <div class="cat-cell-meta">Last change</div>
      </div>
    `);

    for (const plan of PLAN_ORDER) {
      for (const setup of SETUP_ORDER) {
        const aud = findProduct(plan, setup, 'AUD');
        const usd = findProduct(plan, setup, 'USD');
        rows.push(`
          <div class="cat-row">
            <div class="cat-cell-plan"><span class="bdg bdg-plan-${plan}">${PLAN_LABEL[plan]}</span></div>
            <div class="cat-cell-setup"><span class="bdg bdg-setup">${SETUP_LABEL[setup]}</span></div>
            <div class="cat-cell-price">${renderPriceCell(aud)}</div>
            <div class="cat-cell-price">${renderPriceCell(usd)}</div>
            <div class="cat-cell-meta">${renderMetaCell(aud, usd)}</div>
          </div>
        `);
      }
    }
    root.innerHTML = rows.join('');
  }

  function renderPriceCell(p) {
    if (!p) return '<span class="cat-empty">—</span>';
    const amt = (p.amount_cents || 0) / 100;
    const fmt = amt.toLocaleString('en-AU', { style: 'currency', currency: p.currency, minimumFractionDigits: 2 });
    const activeChip = p.active
      ? '<span class="cat-chip cat-chip-on">Active</span>'
      : '<span class="cat-chip cat-chip-off">Inactive</span>';
    const stripeChip = p.stripe_product_id
      ? `<span class="cat-chip cat-chip-sync" title="${p.stripe_product_id}">Synced</span>`
      : '<span class="cat-chip cat-chip-nosync">Not synced</span>';
    return `
      <div class="cat-price">
        <div class="cat-price-amt">${escapeHtml(fmt)}</div>
        <div class="cat-price-chips">${activeChip}${stripeChip}</div>
        <div class="cat-price-acts">
          <button class="btn-link" data-cat-action="edit-price" data-id="${p.id}">Edit price</button>
          <button class="btn-link" data-cat-action="history" data-id="${p.id}">History</button>
          <button class="btn-link" data-cat-action="toggle-active" data-id="${p.id}" data-active="${p.active}">${p.active ? 'Disable' : 'Enable'}</button>
          <button class="btn-link" data-cat-action="sync" data-id="${p.id}">${p.stripe_product_id ? 'Re-sync' : 'Sync to Stripe'}</button>
        </div>
      </div>
    `;
  }

  function renderMetaCell(aud, usd) {
    const stamps = [aud, usd].filter(Boolean).map((p) => new Date(p.updated_at)).sort((a, b) => b - a);
    if (!stamps.length) return '<span class="muted">—</span>';
    return `<span class="muted">${stamps[0].toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}</span>`;
  }

  function renderCodes() {
    const tbody = $('catCodesTbody');
    if (!codes.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="adm-empty">No discount codes yet.</td></tr>';
      return;
    }
    tbody.innerHTML = codes.map((c) => {
      const discount = c.kind === 'percentage'
        ? `${c.value}% off`
        : `${(c.value / 100).toLocaleString('en-AU', { style: 'currency', currency: c.currency || 'AUD' })} off`;
      const applies = c.applies_to_all ? 'All products' : `${c.applies_to_product_ids.length} product${c.applies_to_product_ids.length === 1 ? '' : 's'}`;
      const window = formatWindow(c);
      const used = c.max_redemptions ? `${c.redemption_count} / ${c.max_redemptions}` : `${c.redemption_count}`;
      const status = c.active
        ? '<span class="bdg bdg-active">Active</span>'
        : '<span class="bdg bdg-inactive">Inactive</span>';
      return `
        <tr>
          <td class="studio-cell"><code>${escapeHtml(c.code)}</code></td>
          <td>${escapeHtml(discount)}</td>
          <td>${applies}</td>
          <td class="muted">${escapeHtml(window)}</td>
          <td>${used}</td>
          <td>${status}</td>
          <td class="user-actions">
            <button class="btn-link" data-cat-action="edit-code" data-id="${c.id}">Edit</button>
            <button class="btn-link" data-cat-action="toggle-code" data-id="${c.id}" data-active="${c.active}">${c.active ? 'Disable' : 'Enable'}</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function formatWindow(c) {
    const from = c.valid_from ? new Date(c.valid_from).toLocaleDateString('en-AU') : null;
    const until = c.valid_until ? new Date(c.valid_until).toLocaleDateString('en-AU') : null;
    if (!from && !until) return 'Always';
    if (from && until) return `${from} → ${until}`;
    if (from) return `From ${from}`;
    return `Until ${until}`;
  }

  async function handleAction(btn) {
    const action = btn.dataset.catAction;
    const id = btn.dataset.id;
    if (action === 'edit-price') return editPrice(id);
    if (action === 'history') return showHistory(id);
    if (action === 'toggle-active') return toggleActive(id, btn.dataset.active !== 'true');
    if (action === 'sync') return syncToStripe(id, btn);
    if (action === 'edit-code') return openCodeModal(codes.find((c) => c.id === id));
    if (action === 'toggle-code') return toggleCode(id, btn.dataset.active !== 'true');
  }

  async function editPrice(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const initial = ((p.amount_cents || 0) / 100).toFixed(2);
    const body = `
      <p>Update the list price for <strong>${escapeHtml(p.name)} (${p.currency})</strong>. New checkouts pick this up immediately; submissions already at checkout keep their snapshot.</p>
      <div class="f" style="margin-top:12px;">
        <label for="catPriceInput">Amount (${p.currency})</label>
        <input type="number" id="catPriceInput" step="0.01" min="0" value="${initial}" inputmode="decimal" style="width:100%;padding:10px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;">
      </div>
      <div class="f" style="margin-top:10px;">
        <label for="catPriceReason">Reason (recorded in price history)</label>
        <input type="text" id="catPriceReason" placeholder="e.g. 2026 price update, GST review, etc." style="width:100%;padding:10px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;">
      </div>
    `;
    const ok = await window.AdminModal.confirm({ title: 'Edit price', message: body, confirmLabel: 'Save price' });
    if (!ok) return;

    const amountInput = $('catPriceInput');
    const reasonInput = $('catPriceReason');
    if (!amountInput || !reasonInput) return;
    const amount = parseFloat(amountInput.value);
    const reason = reasonInput.value.trim();
    if (!(amount >= 0)) {
      await window.AdminModal.alert('Amount must be zero or higher.');
      return;
    }
    if (!reason) {
      await window.AdminModal.alert('Please enter a reason for the price change.');
      return;
    }
    const cents = Math.round(amount * 100);
    const r = await callFn('manage-products', { action: 'update_price', id, amount_cents: cents, reason });
    if (!r.ok) { await window.AdminModal.alert({ title: 'Could not save', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    await loadProducts();
    renderMatrix();
  }

  async function showHistory(id) {
    const p = products.find((x) => x.id === id);
    const r = await callFn('manage-products', { action: 'history', id });
    if (!r.ok) { await window.AdminModal.alert({ title: 'Could not load history', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    const list = (r.data?.history || []);
    let html;
    if (!list.length) {
      html = '<p class="muted">No price changes recorded yet.</p>';
    } else {
      html = '<ul class="cat-hist-list">' + list.map((h) => {
        const when = new Date(h.changed_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
        const prev = h.previous_amount_cents != null
          ? (h.previous_amount_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: p?.currency || 'AUD' })
          : '—';
        const now = (h.amount_cents / 100).toLocaleString('en-AU', { style: 'currency', currency: p?.currency || 'AUD' });
        return `
          <li>
            <div class="cat-hist-line"><strong>${escapeHtml(prev)} → ${escapeHtml(now)}</strong></div>
            <div class="cat-hist-meta">${escapeHtml(when)} · ${escapeHtml(h.changed_by_name || '—')}</div>
            ${h.reason ? `<div class="cat-hist-reason">${escapeHtml(h.reason)}</div>` : ''}
          </li>`;
      }).join('') + '</ul>';
    }
    await window.AdminModal.alert({ title: `Price history — ${p ? p.name + ' (' + p.currency + ')' : ''}`, message: html });
  }

  async function toggleActive(id, nextActive) {
    const r = await callFn('manage-products', { action: 'set_active', id, active: nextActive });
    if (!r.ok) { await window.AdminModal.alert({ title: 'Failed', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    await loadProducts();
    renderMatrix();
  }

  async function syncToStripe(id, btn) {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Syncing…';
    const r = await callFn('manage-products', { action: 'sync_to_stripe', id });
    btn.disabled = false;
    btn.textContent = orig;
    if (!r.ok) { await window.AdminModal.alert({ title: 'Stripe sync failed', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    await loadProducts();
    renderMatrix();
  }

  async function toggleCode(id, nextActive) {
    const r = await callFn('manage-discount-codes', { action: 'set_active', id, active: nextActive });
    if (!r.ok) { await window.AdminModal.alert({ title: 'Failed', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    await loadCodes();
    renderCodes();
  }

  async function openCodeModal(existing) {
    const isEdit = !!existing;
    const productOpts = products.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.name)} (${p.currency})</option>`
    ).join('');
    const selectedIds = isEdit ? (existing.applies_to_product_ids || []) : [];
    const body = `
      <div class="cat-form">
        <div class="cat-form-row">
          <label>Code</label>
          <input type="text" id="catCodeCode" value="${escapeHtml(existing?.code || '')}" placeholder="SUMMER25" autocomplete="off" spellcheck="false">
          <p class="set-hint">2–40 chars. Letters, numbers, hyphen, underscore. Case-insensitive.</p>
        </div>
        <div class="cat-form-row">
          <label>Discount type</label>
          <select id="catCodeKind">
            <option value="percentage"${(existing?.kind || 'percentage') === 'percentage' ? ' selected' : ''}>Percentage off</option>
            <option value="fixed_amount"${existing?.kind === 'fixed_amount' ? ' selected' : ''}>Fixed amount off</option>
          </select>
        </div>
        <div class="cat-form-row">
          <label id="catCodeValueLabel">Percent off (1–100)</label>
          <input type="number" id="catCodeValue" min="1" step="1" value="${existing ? (existing.kind === 'percentage' ? existing.value : (existing.value / 100).toFixed(2)) : ''}">
        </div>
        <div class="cat-form-row" id="catCodeCurrencyRow" style="display:${existing?.kind === 'fixed_amount' ? 'block' : 'none'};">
          <label>Currency</label>
          <select id="catCodeCurrency">
            <option value="AUD"${existing?.currency === 'AUD' ? ' selected' : ''}>AUD</option>
            <option value="USD"${existing?.currency === 'USD' ? ' selected' : ''}>USD</option>
          </select>
        </div>
        <div class="cat-form-row">
          <label><input type="checkbox" id="catCodeAll"${(!existing || existing.applies_to_all) ? ' checked' : ''}> Applies to all products</label>
          <div id="catCodeProductsRow" style="display:${existing && !existing.applies_to_all ? 'block' : 'none'};margin-top:8px;">
            <select id="catCodeProducts" multiple size="6" style="width:100%;">${productOpts}</select>
            <p class="set-hint">Hold Cmd / Ctrl to select multiple. Leave applies-to-all checked for the simplest case.</p>
          </div>
        </div>
        <div class="cat-form-row cat-form-grid">
          <div>
            <label>Valid from (optional)</label>
            <input type="date" id="catCodeFrom" value="${existing?.valid_from ? existing.valid_from.slice(0, 10) : ''}">
          </div>
          <div>
            <label>Valid until (optional)</label>
            <input type="date" id="catCodeUntil" value="${existing?.valid_until ? existing.valid_until.slice(0, 10) : ''}">
          </div>
        </div>
        <div class="cat-form-row">
          <label>Max redemptions (optional)</label>
          <input type="number" id="catCodeMax" min="1" step="1" value="${existing?.max_redemptions || ''}" placeholder="Leave blank for unlimited">
        </div>
      </div>
    `;
    // We use the generic modal, then hook into its DOM after it renders.
    const open = window.AdminModal.confirm({ title: isEdit ? 'Edit discount code' : 'Create discount code', message: body, confirmLabel: isEdit ? 'Save' : 'Create' });
    // After paint, wire dynamic field visibility + preselect multi-select.
    requestAnimationFrame(() => {
      const kindSel = $('catCodeKind');
      const valueLabel = $('catCodeValueLabel');
      const currencyRow = $('catCodeCurrencyRow');
      const allChk = $('catCodeAll');
      const productsRow = $('catCodeProductsRow');
      const productsSel = $('catCodeProducts');

      function syncKind() {
        const k = kindSel.value;
        valueLabel.textContent = k === 'percentage' ? 'Percent off (1–100)' : 'Amount off in dollars';
        currencyRow.style.display = k === 'fixed_amount' ? 'block' : 'none';
      }
      kindSel.addEventListener('change', syncKind);
      allChk.addEventListener('change', () => {
        productsRow.style.display = allChk.checked ? 'none' : 'block';
      });
      if (productsSel && selectedIds.length) {
        Array.from(productsSel.options).forEach((opt) => {
          opt.selected = selectedIds.includes(opt.value);
        });
      }
    });

    const ok = await open;
    if (!ok) return;

    const code = $('catCodeCode').value.trim();
    const kind = $('catCodeKind').value;
    const rawValue = parseFloat($('catCodeValue').value);
    const valueCents = kind === 'percentage' ? Math.round(rawValue) : Math.round(rawValue * 100);
    const currency = kind === 'fixed_amount' ? $('catCodeCurrency').value : null;
    const allChecked = $('catCodeAll').checked;
    const productIds = allChecked ? [] : Array.from($('catCodeProducts').selectedOptions).map((o) => o.value);
    const validFrom = $('catCodeFrom').value || null;
    const validUntil = $('catCodeUntil').value || null;
    const maxRaw = $('catCodeMax').value;
    const maxRedemptions = maxRaw ? parseInt(maxRaw, 10) : null;

    if (!code) { await window.AdminModal.alert('Code is required.'); return; }
    if (!(rawValue > 0)) { await window.AdminModal.alert('Discount value must be greater than zero.'); return; }
    if (!allChecked && !productIds.length) {
      await window.AdminModal.alert('Select at least one product, or check "applies to all products".');
      return;
    }

    const payload = {
      code,
      kind,
      value: valueCents,
      applies_to_all: allChecked,
      applies_to_product_ids: productIds,
      currency,
      valid_from: validFrom ? new Date(validFrom).toISOString() : null,
      valid_until: validUntil ? new Date(validUntil + 'T23:59:59').toISOString() : null,
      max_redemptions: maxRedemptions,
    };

    const action = isEdit ? { action: 'update', id: existing.id, ...payload } : { action: 'create', ...payload };
    const r = await callFn('manage-discount-codes', action);
    if (!r.ok) { await window.AdminModal.alert({ title: 'Could not save', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    await loadCodes();
    renderCodes();
  }

  async function callFn(name, body) {
    const client = sb();
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data && data.ok === false) return { ok: false, error: data.error || 'Failed.', data };
    return { ok: true, data };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  window.AdminCatalog = { show, refresh: async () => { await Promise.all([loadProducts(), loadCodes(), loadMode()]); renderMatrix(); renderCodes(); } };
})();
