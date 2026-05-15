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
  };

  let mounted = false;
  let state = { rows: [], currency: 'AUD', search: '', category: 'all', onPick: null };

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
          <h3 id="catalogPickerTitle">Pick an upgrade from the catalog</h3>
          <button type="button" class="btn-link" data-cp-close aria-label="Close">×</button>
        </header>
        <div class="cat-picker-tools">
          <input type="search" id="cpSearch" placeholder="Search path, scope, plan…" autocomplete="off">
          <select id="cpCategory" aria-label="Filter by category">
            <option value="all">All categories</option>
            <option value="plan_upgrade">Plan upgrade</option>
            <option value="setup_conversion">Setup conversion</option>
            <option value="combined_upgrade">Combined</option>
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
    root.querySelector('#cpBody').addEventListener('click', (e) => {
      const row = e.target.closest('[data-cp-id]');
      if (!row) return;
      const id = row.getAttribute('data-cp-id');
      const picked = state.rows.find((r) => r.id === id);
      if (picked && typeof state.onPick === 'function') {
        try { state.onPick(picked); } catch (err) { console.error('onPick:', err); }
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
    const { data, error } = await client
      .from('upgrade_products')
      .select('id, category, from_plan, to_plan, from_setup, to_setup, currency, amount_cents, name, description, includes, sort_order')
      .eq('active', true)
      .eq('currency', state.currency)
      .order('sort_order');
    if (error) {
      console.error('catalog-picker load:', error);
      if (body) body.innerHTML = `<div class="adm-empty" style="padding:40px 0;">Could not load: ${escapeHtml(error.message)}</div>`;
      return;
    }
    state.rows = data || [];
    render();
  }

  function render() {
    const body = document.getElementById('cpBody');
    if (!body) return;
    const filtered = state.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (!state.search) return true;
      const hay = [r.name, r.description, r.from_plan, r.to_plan].filter(Boolean).join(' ').toLowerCase();
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
      onPick: opts && typeof opts.onPick === 'function' ? opts.onPick : null,
    };
    const root = document.getElementById('catalogPicker');
    root.hidden = false;
    root.querySelector('#cpSearch').value = '';
    root.querySelector('#cpCategory').value = 'all';
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
