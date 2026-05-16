/* Catalog picker overlay shared by the invoice + quote modals.

   Opens a small sheet listing upgrade SKUs from public.upgrade_products,
   filtered by the recipient's currency (AU studio -> AUD, US/external ->
   USD; defaults to AUD but the admin can flip the filter). The admin
   clicks a row and the caller's onPick callback receives the row so it
   can pre-fill a line item (name as description, amount_cents converted
   to the modal's currency-major amount). */
(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;

  const CATEGORY_LABEL = {
    plan_upgrade: 'Plan upgrade',
    setup_conversion: 'Setup conversion',
    combined_upgrade: 'Combined',
    consulting: 'Consulting',
    training: 'Training',
    addon: 'Add-on',
    custom: 'Custom',
    other: 'Other',
  };

  let mounted = false;
  let state = { rows: [], currency: 'AUD', search: '', category: 'all', source: 'upgrades', onPick: null };

  function ensureMounted() {
    if (mounted) return;
    mounted = true;
    const root = document.createElement('div');
    root.id = 'catalogPicker';
    root.className = 'cat-picker';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'catalogPickerTitle');
    root.innerHTML = `
      <div class="cat-picker-backdrop" data-cp-close></div>
      <div class="cat-picker-sheet">
        <header class="cat-picker-hdr">
          <h3 id="catalogPickerTitle">Pick a product from the catalog</h3>
          <button type="button" class="btn-link" data-cp-close aria-label="Close">×</button>
        </header>
        <div class="cat-picker-sources" role="tablist" aria-label="Catalog source">
          <button type="button" class="cat-picker-source active" data-cp-source="upgrades" aria-selected="true">Upgrades</button>
          <button type="button" class="cat-picker-source" data-cp-source="general" aria-selected="false">General products</button>
        </div>
        <div class="cat-picker-tools">
          <input type="search" id="cpSearch" placeholder="Search name, scope…" autocomplete="off">
          <select id="cpCategory" aria-label="Filter by category">
            <option value="all">All categories</option>
          </select>
          <select id="cpCurrency" aria-label="Currency">
            <option value="AUD">AUD</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div class="cat-picker-body" id="cpBody">
          <div class="adm-empty" style="padding:40px 0;">Loading…</div>
        </div>
      </div>`;
    document.body.appendChild(root);

    root.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-cp-close]')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !root.hidden) close();
    });
    root.querySelector('#cpSearch').addEventListener('input', (e) => {
      state.search = (e.target.value || '').toLowerCase();
      render();
    });
    root.querySelector('#cpCategory').addEventListener('change', (e) => {
      state.category = e.target.value || 'all';
      render();
    });
    root.querySelector('#cpCurrency').addEventListener('change', (e) => {
      state.currency = e.target.value || 'AUD';
      load();
    });
    // Source toggle: Upgrades vs General products. Re-fetches the correct
    // table and refreshes the category filter options to match.
    root.querySelectorAll('[data-cp-source]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-cp-source');
        if (!next || next === state.source) return;
        state.source = next;
        state.category = 'all';
        root.querySelectorAll('[data-cp-source]').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        refreshCategoryOptions();
        load();
      });
    });
    root.querySelector('#cpBody').addEventListener('click', (e) => {
      const row = e.target.closest('[data-cp-id]');
      if (!row) return;
      const id = row.getAttribute('data-cp-id');
      const picked = state.rows.find((r) => r.id === id);
      if (picked && typeof state.onPick === 'function') {
        // Hand the caller a second `meta` arg with the source kind
        // ('upgrade' | 'general'). Callers wired to the legacy one-arg
        // signature still work — the second arg is just ignored.
        const meta = { kind: state.source === 'general' ? 'general' : 'upgrade' };
        try { state.onPick(picked, meta); } catch (err) { console.error('onPick:', err); }
      }
      close();
    });
  }

  async function load() {
    const root = document.getElementById('catalogPicker');
    if (!root) return;
    const body = root.querySelector('#cpBody');
    if (body) body.innerHTML = '<div class="adm-empty" style="padding:40px 0;">Loading…</div>';
    const client = sb();
    if (!client) {
      if (body) body.innerHTML = '<div class="adm-empty" style="padding:40px 0;">Could not connect.</div>';
      return;
    }
    const isGeneral = state.source === 'general';
    const table = isGeneral ? 'general_products' : 'upgrade_products';
    const select = isGeneral
      ? 'id, sku, category, currency, amount_cents, name, description, includes, sort_order'
      : 'id, category, from_plan, to_plan, from_setup, to_setup, currency, amount_cents, name, description, includes, sort_order';
    const { data, error } = await client
      .from(table)
      .select(select)
      .eq('active', true)
      .eq('currency', state.currency)
      .order('sort_order');
    if (error) {
      console.error('catalog-picker load:', error);
      if (body) body.innerHTML = `<div class="adm-empty" style="padding:40px 0;">Could not load: ${escapeHtml(error.message)}</div>`;
      return;
    }
    state.rows = data || [];
    refreshCategoryOptions();
    render();
  }

  // Populate the category <select> with the categories present in the
  // currently loaded source. Keeps the dropdown relevant: setup_conversion
  // shouldn't appear when General products is active, and vice versa.
  function refreshCategoryOptions() {
    const sel = document.getElementById('cpCategory');
    if (!sel) return;
    const isGeneral = state.source === 'general';
    const order = isGeneral
      ? ['consulting', 'training', 'addon', 'custom', 'other']
      : ['plan_upgrade', 'setup_conversion', 'combined_upgrade'];
    const opts = ['<option value="all">All categories</option>'];
    for (const c of order) opts.push(`<option value="${c}">${CATEGORY_LABEL[c] || c}</option>`);
    sel.innerHTML = opts.join('');
    sel.value = state.category || 'all';
  }

  function render() {
    const body = document.getElementById('cpBody');
    if (!body) return;
    const filtered = state.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!state.search) return true;
      const hay = [r.name, r.description, r.from_plan, r.to_plan, r.sku].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(state.search);
    });
    if (!filtered.length) {
      body.innerHTML = '<div class="adm-empty" style="padding:40px 0;">No matches. Adjust the search or category filter.</div>';
      return;
    }
    body.innerHTML = filtered.map((r) => {
      const amt = (r.amount_cents || 0) / 100;
      const fmt = amt.toLocaleString('en-AU', { style: 'currency', currency: r.currency, minimumFractionDigits: 2 });
      return `
        <div class="cat-picker-row" data-cp-id="${escapeAttr(r.id)}" role="button" tabindex="0">
          <div>
            <div class="cat-picker-cat">${escapeHtml(CATEGORY_LABEL[r.category] || r.category)}</div>
            <div class="cat-picker-name">${escapeHtml(r.name)}</div>
            <div class="cat-picker-desc">${escapeHtml(r.description || '')}</div>
          </div>
          <div class="cat-picker-amt">${escapeHtml(fmt)}${r.currency === 'AUD' ? '<div class="cat-upg-tax">ex GST</div>' : ''}</div>
        </div>`;
    }).join('');
  }

  function open(opts) {
    ensureMounted();
    state = {
      rows: [],
      currency: opts && opts.currency ? String(opts.currency).toUpperCase() : 'AUD',
      search: '',
      category: 'all',
      source: opts && opts.source ? opts.source : 'upgrades',
      onPick: opts && typeof opts.onPick === 'function' ? opts.onPick : null,
    };
    const root = document.getElementById('catalogPicker');
    root.hidden = false;
    root.querySelector('#cpSearch').value = '';
    root.querySelectorAll('[data-cp-source]').forEach((b) => {
      const on = b.getAttribute('data-cp-source') === state.source;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    refreshCategoryOptions();
    root.querySelector('#cpCurrency').value = state.currency;
    setTimeout(() => root.querySelector('#cpSearch')?.focus(), 0);
    load();
  }

  function close() {
    const root = document.getElementById('catalogPicker');
    if (root) root.hidden = true;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  window.AdminCatalogPicker = { open, close };
})();
