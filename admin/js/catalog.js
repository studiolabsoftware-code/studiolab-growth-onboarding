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

  // Sign-up URLs are scoped per region × plan (setup type is picked inside
  // the form, so it doesn't appear in the URL). AUD pricebox → AU URL,
  // USD pricebox → US URL. Used by the per-card "Copy URL" action so VAs
  // can grab the right link for snapshot/onboarding emails without typing.
  const SIGNUP_BASE = 'https://app.studiolabgrowth.com';
  function signupUrlFor(currency, plan) {
    const region = currency === 'AUD' ? 'au' : 'us';
    return `${SIGNUP_BASE}/${region}/${plan}/`;
  }

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
    const cards = [];
    for (const plan of PLAN_ORDER) {
      for (const setup of SETUP_ORDER) {
        const aud = findProduct(plan, setup, 'AUD');
        const usd = findProduct(plan, setup, 'USD');
        cards.push(renderProductCard(plan, setup, aud, usd));
      }
    }
    root.innerHTML = `<div class="cat-grid">${cards.join('')}</div>`;
  }

  function renderProductCard(plan, setup, aud, usd) {
    // The pair shares name/description/tax_code conceptually. We treat the
    // AUD row as the source of truth for display and "Edit details" pushes
    // any change to both rows via two consecutive update_details calls.
    const head = aud || usd;
    if (!head) return '';
    const stamps = [aud, usd].filter(Boolean).map((p) => new Date(p.updated_at)).sort((a, b) => b - a);
    const lastChange = stamps.length
      ? stamps[0].toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';
    return `
      <article class="cat-card">
        <header class="cat-card-hdr">
          <div class="cat-card-tags">
            <span class="bdg bdg-plan-${plan}">${PLAN_LABEL[plan]}</span>
            <span class="bdg bdg-setup">${SETUP_LABEL[setup]}</span>
          </div>
          <button class="btn-link cat-card-edit" data-cat-action="edit-details" data-plan="${plan}" data-setup="${setup}">✎ Edit details</button>
        </header>
        <h3 class="cat-card-name">${escapeHtml(head.name)}</h3>
        <p class="cat-card-desc">${escapeHtml(head.description || 'No description set.')}</p>
        <div class="cat-card-prices">
          ${renderPriceBox(aud, plan, setup)}
          ${renderPriceBox(usd, plan, setup)}
        </div>
        <footer class="cat-card-foot">
          <span class="cat-card-meta">Last change: ${escapeHtml(lastChange)}</span>
        </footer>
      </article>
    `;
  }

  function renderPriceBox(p, plan, setup) {
    if (!p) {
      return `<div class="cat-pricebox cat-pricebox-empty"><div class="cat-pricebox-cur">—</div><div class="cat-pricebox-empty-msg">Missing row</div></div>`;
    }
    const amt = (p.amount_cents || 0) / 100;
    const fmt = amt.toLocaleString('en-AU', { style: 'currency', currency: p.currency, minimumFractionDigits: 2 });
    const taxNote = p.currency === 'AUD'
      ? `<div class="cat-pricebox-tax">ex GST · ${(amt * 1.1).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} inc GST</div>`
      : '';
    const activeChip = p.active
      ? '<span class="cat-chip cat-chip-on">Active</span>'
      : '<span class="cat-chip cat-chip-off">Inactive</span>';
    const stripeChip = p.stripe_product_id
      ? `<span class="cat-chip cat-chip-sync" title="${escapeHtml(p.stripe_product_id)}">Synced</span>`
      : '<span class="cat-chip cat-chip-nosync">Not synced</span>';
    return `
      <div class="cat-pricebox">
        <div class="cat-pricebox-row">
          <div class="cat-pricebox-cur">${p.currency}</div>
          <button class="cat-pricebox-edit" data-cat-action="edit-price" data-id="${p.id}" title="Edit price"><span aria-hidden="true">✎</span></button>
        </div>
        <div class="cat-pricebox-amt">${escapeHtml(fmt)}</div>
        ${taxNote}
        <div class="cat-pricebox-chips">${activeChip}${stripeChip}</div>
        <div class="cat-pricebox-acts">
          <button class="btn-link" data-cat-action="copy-url" data-url="${escapeHtml(signupUrlFor(p.currency, plan))}" title="Copy sign-up URL for ${p.currency === 'AUD' ? 'AU' : 'US/Intl'} ${PLAN_LABEL[plan]}">Copy URL</button>
          <button class="btn-link" data-cat-action="toggle-active" data-id="${p.id}" data-active="${p.active}">${p.active ? 'Disable' : 'Enable'}</button>
          <button class="btn-link" data-cat-action="sync" data-id="${p.id}">${p.stripe_product_id ? 'Re-sync' : 'Sync to Stripe'}</button>
          <button class="btn-link" data-cat-action="history" data-id="${p.id}">History</button>
        </div>
      </div>
    `;
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
    if (action === 'edit-details') return editDetails(btn.dataset.plan, btn.dataset.setup);
    if (action === 'history') return showHistory(id);
    if (action === 'toggle-active') return toggleActive(id, btn.dataset.active !== 'true');
    if (action === 'sync') return syncToStripe(id, btn);
    if (action === 'copy-url') return copyUrl(btn);
    if (action === 'edit-code') return openCodeModal(codes.find((c) => c.id === id));
    if (action === 'toggle-code') return toggleCode(id, btn.dataset.active !== 'true');
  }

  // Copies the sign-up URL to the clipboard and gives the button a brief
  // "Copied!" state so the VA gets visual confirmation. Falls back to a
  // hidden textarea + execCommand for environments where the modern
  // clipboard API is unavailable (e.g. older Safari, http://localhost).
  async function copyUrl(btn) {
    const url = btn.dataset.url || '';
    if (!url) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      }
    } catch (e) {
      console.error('copy-url failed:', e);
    }
    const orig = btn.textContent;
    btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 1400);
  }

  async function editDetails(plan, setup) {
    const aud = findProduct(plan, setup, 'AUD');
    const usd = findProduct(plan, setup, 'USD');
    const head = aud || usd;
    if (!head) return;
    const body = `
      <p>Update the product details. Changes apply to both the AUD and USD rows so they stay in sync, and are pushed to Stripe on the next Sync.</p>
      <div class="cat-form" style="margin-top:12px;">
        <div class="cat-form-row">
          <label for="catDetName">Product name</label>
          <input type="text" id="catDetName" value="${escapeHtml(head.name)}" maxlength="120">
        </div>
        <div class="cat-form-row">
          <label for="catDetDesc">Description</label>
          <textarea id="catDetDesc" rows="3" style="width:100%;padding:9px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--g8);">${escapeHtml(head.description || '')}</textarea>
          <p class="set-hint">Shown on the Stripe Checkout page and in the Stripe dashboard.</p>
        </div>
        <div class="cat-form-row">
          <label for="catDetTax">Stripe tax code</label>
          <input type="text" id="catDetTax" value="${escapeHtml(head.tax_code || 'txcd_10000000')}" placeholder="txcd_10000000">
          <p class="set-hint">Default <code>txcd_10000000</code> (general services). Change only if Stripe support has advised a different code for this product.</p>
        </div>
      </div>
    `;
    const ok = await window.AdminModal.confirm({ title: 'Edit product details', message: body, confirmLabel: 'Save details' });
    if (!ok) return;

    const name = $('catDetName').value.trim();
    const description = $('catDetDesc').value.trim();
    const taxCode = $('catDetTax').value.trim();
    if (!name) { await window.AdminModal.alert('Name cannot be blank.'); return; }
    if (!/^txcd_[0-9a-z]+$/.test(taxCode)) { await window.AdminModal.alert('Tax code must look like txcd_… (lowercase letters/numbers).'); return; }

    const patch = { name, description, tax_code: taxCode };
    const targets = [aud, usd].filter(Boolean);
    for (const t of targets) {
      const r = await callFn('manage-products', { action: 'update_details', id: t.id, ...patch });
      if (!r.ok) { await window.AdminModal.alert({ title: 'Could not save', message: escapeHtml(r.error || 'Unknown error.') }); return; }
    }
    await loadProducts();
    renderMatrix();
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
