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
  let upgrades = [];
  let generals = [];
  let codes = [];
  let bound = false;
  let activeTab = 'products';

  const UPGRADE_CATEGORY_LABEL = {
    plan_upgrade: 'Plan upgrade',
    setup_conversion: 'Setup conversion',
    combined_upgrade: 'Combined',
  };
  const UPGRADE_CATEGORY_ORDER = ['plan_upgrade', 'setup_conversion', 'combined_upgrade'];

  const GENERAL_CATEGORY_LABEL = {
    consulting: 'Consulting',
    training: 'Training',
    addon: 'Add-on',
    custom: 'Custom',
    other: 'Other',
  };
  const GENERAL_CATEGORY_ORDER = ['consulting', 'training', 'addon', 'custom', 'other'];

  async function show() {
    bind();
    await Promise.all([loadProducts(), loadUpgrades(), loadGenerals(), loadCodes(), loadMode()]);
    renderMatrix();
    renderUpgrades();
    renderGenerals();
    renderCodes();
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('.cat-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    $('catCodeNewBtn').addEventListener('click', () => openCodeModal(null));
    const genBtn = $('catGeneralNewBtn');
    if (genBtn) genBtn.addEventListener('click', () => openGeneralEditor(null));

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
    $('catUpgradesPanel').style.display = tab === 'upgrades' ? '' : 'none';
    $('catGeneralPanel').style.display = tab === 'general' ? '' : 'none';
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

  async function loadUpgrades() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('upgrade_products')
      .select('id, category, from_plan, to_plan, from_setup, to_setup, currency, amount_cents, name, description, includes, active, sort_order')
      .eq('active', true)
      .order('sort_order')
      .order('currency');
    if (error) { upgrades = []; return; }
    upgrades = data || [];
  }

  // Group AUD + USD rows of the same path together so the table reads "one
  // path per line" with two price cells. Pairing key is the path tuple.
  function groupedUpgrades() {
    const map = new Map();
    for (const u of upgrades) {
      const key = `${u.from_plan}|${u.to_plan}|${u.from_setup}|${u.to_setup}`;
      if (!map.has(key)) map.set(key, { aud: null, usd: null, head: u });
      const row = map.get(key);
      if (u.currency === 'AUD') row.aud = u;
      if (u.currency === 'USD') row.usd = u;
    }
    return Array.from(map.values()).sort((a, b) => (a.head.sort_order || 0) - (b.head.sort_order || 0));
  }

  function renderUpgrades() {
    const tbody = $('catUpgradesTbody');
    if (!tbody) return;
    // Inject the Add-upgrade button into the panel header once.
    const panel = $('catUpgradesPanel');
    if (panel && !panel.querySelector('#catUpgradeNewBtn')) {
      const hdr = panel.querySelector('.cat-codes-hdr');
      if (hdr) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-p';
        btn.id = 'catUpgradeNewBtn';
        btn.textContent = '+ Add upgrade';
        btn.addEventListener('click', () => openUpgradeEditor(null));
        hdr.appendChild(btn);
      }
    }
    if (!upgrades.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="adm-empty">No upgrade products. Run migration 021 to seed, or click <strong>+ Add upgrade</strong>.</td></tr>';
      return;
    }
    const rows = groupedUpgrades();
    let lastCategory = null;
    const html = [];
    for (const r of rows) {
      const cat = r.head.category;
      if (cat !== lastCategory) {
        html.push(`<tr class="cat-upg-cat"><td colspan="5"><strong>${escapeHtml(UPGRADE_CATEGORY_LABEL[cat] || cat)}</strong></td></tr>`);
        lastCategory = cat;
      }
      const pathLabel = escapeHtml(r.head.name);
      const audCell = renderUpgradePriceCell(r.aud);
      const usdCell = renderUpgradePriceCell(r.usd);
      const editKey = `${r.head.from_plan}|${r.head.to_plan}|${r.head.from_setup}|${r.head.to_setup}`;
      const activeChip = (r.aud && r.aud.active) || (r.usd && r.usd.active)
        ? ''
        : ' <span class="cat-chip cat-chip-off" style="margin-left:6px;">Inactive</span>';
      html.push(`
        <tr>
          <td>
            <div class="cat-upg-name">${pathLabel}${activeChip}</div>
            <div class="cat-upg-scope">${escapeHtml(r.head.description || '')}</div>
          </td>
          <td><span class="bdg bdg-setup">${escapeHtml(UPGRADE_CATEGORY_LABEL[cat] || cat)}</span></td>
          <td>${audCell}</td>
          <td>${usdCell}</td>
          <td><button class="btn-link" data-cat-action="edit-upgrade-details" data-key="${escapeHtml(editKey)}">Edit details</button></td>
        </tr>`);
    }
    tbody.innerHTML = html.join('');
  }

  function renderUpgradePriceCell(p) {
    if (!p) return '<span class="adm-empty">—</span>';
    const amt = (p.amount_cents || 0) / 100;
    const fmt = amt.toLocaleString('en-AU', { style: 'currency', currency: p.currency, minimumFractionDigits: 2 });
    const taxNote = p.currency === 'AUD'
      ? `<div class="cat-upg-tax">${(amt * 1.1).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })} inc GST</div>`
      : '';
    return `
      <div class="cat-upg-price">
        <button class="cat-upg-edit" data-cat-action="edit-upgrade-price" data-id="${p.id}" title="Edit price">${escapeHtml(fmt)} <span aria-hidden="true">✎</span></button>
        ${taxNote}
      </div>`;
  }

  async function handleEditUpgradePrice(id) {
    // The price cell renderer is shared between Upgrades and General, so a
    // click here might target either table. Resolve which one owns the id.
    const upgradeRow = upgrades.find((u) => u.id === id);
    const generalRow = !upgradeRow ? generals.find((g) => g.id === id) : null;
    const row = upgradeRow || generalRow;
    if (!row) return;
    const tableName = upgradeRow ? 'upgrade_products' : 'general_products';
    const current = (row.amount_cents / 100).toFixed(2);
    const raw = window.prompt(
      `New price for ${row.name} (${row.currency}, ex GST).\nCurrent: ${current}`,
      current
    );
    if (raw === null) return;
    const parsed = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    if (!isFinite(parsed) || parsed < 0) {
      await (window.AdminModal ? window.AdminModal.alert({ title: 'Invalid price', message: 'Enter a positive number.' }) : Promise.resolve());
      return;
    }
    const newCents = Math.round(parsed * 100);
    if (newCents === row.amount_cents) return;
    const client = sb();
    const { error } = await client.from(tableName).update({ amount_cents: newCents }).eq('id', id);
    if (error) {
      await (window.AdminModal ? window.AdminModal.alert({ title: 'Update failed', message: escapeHtml(error.message) }) : Promise.resolve());
      return;
    }
    if (upgradeRow) { await loadUpgrades(); renderUpgrades(); }
    else            { await loadGenerals(); renderGenerals(); }
  }

  // ── Deliverables template (shared by upgrade + general editors) ────────
  // Renders a small list editor below the catalog editor body. Each row =
  // one deliverable that will be auto-created on the spawned project when
  // an invoice picking this SKU is paid. Read back via readDeliverableTemplate().
  function renderDeliverableTemplateSection(template, idPrefix) {
    const items = Array.isArray(template) ? template : [];
    return `
      <div class="cat-form-row" style="margin-top:14px;border-top:1px solid var(--g2);padding-top:14px;">
        <label style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <span>Deliverables template</span>
          <button type="button" class="btn-link" data-cat-dt-act="add" data-target="${idPrefix}List">+ Add deliverable</button>
        </label>
        <p class="set-hint" style="margin-top:4px;">When an invoice picks this SKU and gets paid, each row below is auto-created as a deliverable on the spawned project.</p>
        <div id="${idPrefix}List" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
          ${items.length ? items.map((r) => renderDeliverableTemplateRow(r)).join('') : `<div class="adm-empty" data-empty>No template — invoices for this SKU will spawn a project with no auto-deliverables.</div>`}
        </div>
      </div>`;
  }

  function renderDeliverableTemplateRow(r) {
    const title = r?.title || '';
    const desc = r?.description || '';
    const vis = r?.visibility === 'internal' ? 'internal' : 'client';
    const offset = (r && r.default_due_offset_days != null) ? r.default_due_offset_days : '';
    return `
      <div class="cat-dt-row" style="border:1px solid var(--g2);border-radius:8px;padding:10px;background:#fff;">
        <div style="display:grid;grid-template-columns:2fr 1fr auto;gap:8px;align-items:end;">
          <div>
            <label style="font-size:11px;color:var(--g6);">Title</label>
            <input type="text" data-dt="title" value="${escapeHtml(title)}" placeholder="e.g. Website draft v1" maxlength="200">
          </div>
          <div>
            <label style="font-size:11px;color:var(--g6);">Visibility</label>
            <select data-dt="visibility">
              <option value="client"${vis==='client'?' selected':''}>Client visible</option>
              <option value="internal"${vis==='internal'?' selected':''}>Internal only</option>
            </select>
          </div>
          <button type="button" class="btn-link" data-cat-dt-act="del" title="Remove" style="white-space:nowrap;">Remove</button>
        </div>
        <div style="margin-top:8px;display:grid;grid-template-columns:3fr 1fr;gap:8px;align-items:end;">
          <div>
            <label style="font-size:11px;color:var(--g6);">Description (optional)</label>
            <textarea data-dt="description" rows="2" style="width:100%;padding:8px 10px;border:1px solid var(--g2);border-radius:6px;font-size:13px;font-family:inherit;background:#fff;color:var(--g8);">${escapeHtml(desc)}</textarea>
          </div>
          <div>
            <label style="font-size:11px;color:var(--g6);">Due in (days)</label>
            <input type="number" data-dt="offset" min="0" step="1" value="${offset === '' ? '' : escapeHtml(offset)}" placeholder="blank = no due">
          </div>
        </div>
      </div>`;
  }

  // Delegated click handler for add/remove rows. Returns the listener so the
  // caller can detach it after the modal closes.
  function bindDeliverableTemplateHandlers() {
    const handler = (e) => {
      const addBtn = e.target.closest('[data-cat-dt-act="add"]');
      if (addBtn) {
        e.preventDefault();
        const list = document.getElementById(addBtn.dataset.target);
        if (!list) return;
        const empty = list.querySelector('[data-empty]');
        if (empty) empty.remove();
        list.insertAdjacentHTML('beforeend', renderDeliverableTemplateRow({}));
        return;
      }
      const delBtn = e.target.closest('[data-cat-dt-act="del"]');
      if (delBtn) {
        e.preventDefault();
        const row = delBtn.closest('.cat-dt-row');
        if (row) row.remove();
      }
    };
    document.addEventListener('click', handler);
    return handler;
  }

  function readDeliverableTemplate(listId) {
    const list = document.getElementById(listId);
    if (!list) return [];
    const rows = list.querySelectorAll('.cat-dt-row');
    const out = [];
    rows.forEach((row) => {
      const title = row.querySelector('[data-dt="title"]').value.trim();
      if (!title) return;
      const description = row.querySelector('[data-dt="description"]').value.trim();
      const visibility = row.querySelector('[data-dt="visibility"]').value === 'internal' ? 'internal' : 'client';
      const offsetRaw = row.querySelector('[data-dt="offset"]').value.trim();
      const offset = offsetRaw === '' ? null : parseInt(offsetRaw, 10);
      out.push({
        title: title.slice(0, 200),
        description: description.slice(0, 4000),
        visibility,
        default_due_offset_days: Number.isFinite(offset) && offset >= 0 ? offset : null,
      });
    });
    return out;
  }

  // Full edit modal for an upgrade SKU (or a fresh new path). Pass `null`
  // to open the editor in "new upgrade" mode; pass a {from_plan,to_plan,
  // from_setup,to_setup} key to edit an existing path.
  async function openUpgradeEditor(key) {
    const isNew = !key;
    let aud = null, usd = null, head = null;
    if (!isNew) {
      // Re-fetch with deliverable_template (the cached `upgrades` array is
      // loaded without it to keep the table render lean). Falls back to the
      // cached row if the fresh fetch fails.
      const parts = key.split('|');
      const [fp, tp, fs, ts] = parts;
      const client = sb();
      if (client) {
        const { data } = await client
          .from('upgrade_products')
          .select('id, category, from_plan, to_plan, from_setup, to_setup, currency, amount_cents, name, description, includes, active, sort_order, deliverable_template')
          .eq('from_plan', fp).eq('to_plan', tp).eq('from_setup', fs).eq('to_setup', ts);
        if (Array.isArray(data) && data.length) {
          aud = data.find((u) => u.currency === 'AUD') || null;
          usd = data.find((u) => u.currency === 'USD') || null;
        }
      }
      if (!aud && !usd) {
        const matches = upgrades.filter((u) => u.from_plan===fp && u.to_plan===tp && u.from_setup===fs && u.to_setup===ts);
        aud = matches.find((u) => u.currency === 'AUD') || null;
        usd = matches.find((u) => u.currency === 'USD') || null;
      }
      head = aud || usd;
      if (!head) return;
    }
    const draft = head || { category: 'plan_upgrade', from_plan: 'launch', to_plan: 'scale', from_setup: 'guided', to_setup: 'guided', name: '', description: '', includes: [], active: true, sort_order: 100, deliverable_template: [] };
    const includesText = (draft.includes || []).join('\n');
    const audAmt = aud ? ((aud.amount_cents||0)/100).toFixed(2) : '';
    const usdAmt = usd ? ((usd.amount_cents||0)/100).toFixed(2) : '';
    const body = `
      <p>${isNew ? 'Define a new upgrade path. Both AUD and USD rows are created.' : 'Edit this upgrade. Changes apply to both AUD and USD rows so they stay in sync.'}</p>
      <div class="cat-form" style="margin-top:12px;">
        <div class="cat-form-row">
          <label for="catUpName">Path name</label>
          <input type="text" id="catUpName" value="${escapeHtml(draft.name)}" placeholder="e.g. Launch → Scale (Guided)" maxlength="160">
        </div>
        <div class="cat-form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label for="catUpCategory">Category</label>
            <select id="catUpCategory">
              <option value="plan_upgrade"${draft.category==='plan_upgrade'?' selected':''}>Plan upgrade</option>
              <option value="setup_conversion"${draft.category==='setup_conversion'?' selected':''}>Setup conversion</option>
              <option value="combined_upgrade"${draft.category==='combined_upgrade'?' selected':''}>Combined</option>
            </select>
          </div>
          <div>
            <label for="catUpSort">Sort order</label>
            <input type="number" id="catUpSort" min="0" step="10" value="${draft.sort_order || 100}">
          </div>
        </div>
        <div class="cat-form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label for="catUpFromPlan">From plan</label>
            <select id="catUpFromPlan">
              <option value="launch"${draft.from_plan==='launch'?' selected':''}>Launch</option>
              <option value="scale"${draft.from_plan==='scale'?' selected':''}>Scale</option>
              <option value="ai"${draft.from_plan==='ai'?' selected':''}>Dominate AI</option>
            </select>
          </div>
          <div>
            <label for="catUpToPlan">To plan</label>
            <select id="catUpToPlan">
              <option value="launch"${draft.to_plan==='launch'?' selected':''}>Launch</option>
              <option value="scale"${draft.to_plan==='scale'?' selected':''}>Scale</option>
              <option value="ai"${draft.to_plan==='ai'?' selected':''}>Dominate AI</option>
            </select>
          </div>
        </div>
        <div class="cat-form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label for="catUpFromSetup">From setup</label>
            <select id="catUpFromSetup">
              <option value="guided"${draft.from_setup==='guided'?' selected':''}>Guided</option>
              <option value="dfy"${draft.from_setup==='dfy'?' selected':''}>Done-For-You</option>
            </select>
          </div>
          <div>
            <label for="catUpToSetup">To setup</label>
            <select id="catUpToSetup">
              <option value="guided"${draft.to_setup==='guided'?' selected':''}>Guided</option>
              <option value="dfy"${draft.to_setup==='dfy'?' selected':''}>Done-For-You</option>
            </select>
          </div>
        </div>
        <div class="cat-form-row">
          <label for="catUpDesc">Scope / description</label>
          <textarea id="catUpDesc" rows="2" style="width:100%;padding:9px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--g8);">${escapeHtml(draft.description || '')}</textarea>
          <p class="set-hint">One sentence that appears on the invoice line description.</p>
        </div>
        <div class="cat-form-row">
          <label for="catUpIncl">Inclusions (one per line)</label>
          <textarea id="catUpIncl" rows="5" style="width:100%;padding:9px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--g8);">${escapeHtml(includesText)}</textarea>
        </div>
        <div class="cat-form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label for="catUpAud">AUD price (ex GST)</label>
            <input type="number" id="catUpAud" min="0" step="0.01" placeholder="0.00" value="${audAmt}">
          </div>
          <div>
            <label for="catUpUsd">USD price</label>
            <input type="number" id="catUpUsd" min="0" step="0.01" placeholder="0.00" value="${usdAmt}">
          </div>
        </div>
        <div class="cat-form-row">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="catUpActive"${(isNew || (aud&&aud.active) || (usd&&usd.active)) ? ' checked' : ''}> Active (visible in picker)
          </label>
        </div>
        ${renderDeliverableTemplateSection(draft.deliverable_template, 'catUpDt')}
      </div>`;
    const dtHandler = bindDeliverableTemplateHandlers();
    let ok;
    try {
      ok = await window.AdminModal.confirm({ title: isNew ? 'Add upgrade' : 'Edit upgrade', message: body, confirmLabel: 'Save', size: 'wide' });
    } finally {
      document.removeEventListener('click', dtHandler);
    }
    if (!ok) return;

    const patch = {
      name: $('catUpName').value.trim(),
      category: $('catUpCategory').value,
      from_plan: $('catUpFromPlan').value,
      to_plan: $('catUpToPlan').value,
      from_setup: $('catUpFromSetup').value,
      to_setup: $('catUpToSetup').value,
      description: $('catUpDesc').value.trim(),
      includes: $('catUpIncl').value.split('\n').map((s) => s.trim()).filter(Boolean),
      sort_order: parseInt($('catUpSort').value, 10) || 100,
      active: $('catUpActive').checked,
      deliverable_template: readDeliverableTemplate('catUpDtList'),
    };
    const audCents = Math.round((parseFloat($('catUpAud').value) || 0) * 100);
    const usdCents = Math.round((parseFloat($('catUpUsd').value) || 0) * 100);
    if (!patch.name) { await window.AdminModal.alert('Path name cannot be blank.'); return; }
    if (!patch.description) { await window.AdminModal.alert('Scope/description cannot be blank.'); return; }

    const client = sb();
    if (isNew) {
      const { error } = await client.from('upgrade_products').insert([
        { ...patch, currency: 'AUD', amount_cents: audCents },
        { ...patch, currency: 'USD', amount_cents: usdCents },
      ]);
      if (error) { await window.AdminModal.alert({ title: 'Could not add', message: escapeHtml(error.message) }); return; }
    } else {
      const ops = [];
      if (aud) ops.push(client.from('upgrade_products').update({ ...patch, amount_cents: audCents }).eq('id', aud.id));
      else     ops.push(client.from('upgrade_products').insert({ ...patch, currency: 'AUD', amount_cents: audCents }));
      if (usd) ops.push(client.from('upgrade_products').update({ ...patch, amount_cents: usdCents }).eq('id', usd.id));
      else     ops.push(client.from('upgrade_products').insert({ ...patch, currency: 'USD', amount_cents: usdCents }));
      const results = await Promise.all(ops);
      const failed = results.find((r) => r.error);
      if (failed) { await window.AdminModal.alert({ title: 'Could not save', message: escapeHtml(failed.error.message) }); return; }
    }
    await loadUpgrades();
    renderUpgrades();
  }

  // ── General products ─────────────────────────────────────────────────────
  async function loadGenerals() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('general_products')
      .select('id, sku, category, currency, amount_cents, tax_code, name, description, includes, active, sort_order, updated_at')
      .order('sort_order')
      .order('sku')
      .order('currency');
    if (error) { generals = []; return; }
    generals = data || [];
  }

  function groupedGenerals() {
    const map = new Map();
    for (const g of generals) {
      if (!map.has(g.sku)) map.set(g.sku, { aud: null, usd: null, head: g });
      const row = map.get(g.sku);
      if (g.currency === 'AUD') row.aud = g;
      if (g.currency === 'USD') row.usd = g;
      row.head = row.aud || row.usd || row.head;
    }
    return Array.from(map.values()).sort((a, b) => {
      const sa = a.head.sort_order || 0, sb = b.head.sort_order || 0;
      if (sa !== sb) return sa - sb;
      return (a.head.sku || '').localeCompare(b.head.sku || '');
    });
  }

  function renderGenerals() {
    const tbody = $('catGeneralTbody');
    if (!tbody) return;
    if (!generals.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="adm-empty">No general products yet. Click <strong>+ Add product</strong> to create one.</td></tr>';
      return;
    }
    const rows = groupedGenerals();
    let lastCategory = null;
    const html = [];
    for (const r of rows) {
      const cat = r.head.category || 'other';
      if (cat !== lastCategory) {
        html.push(`<tr class="cat-upg-cat"><td colspan="5"><strong>${escapeHtml(GENERAL_CATEGORY_LABEL[cat] || cat)}</strong></td></tr>`);
        lastCategory = cat;
      }
      const audCell = renderUpgradePriceCell(r.aud);
      const usdCell = renderUpgradePriceCell(r.usd);
      const activeChip = (r.aud && r.aud.active) || (r.usd && r.usd.active)
        ? ''
        : ' <span class="cat-chip cat-chip-off" style="margin-left:6px;">Inactive</span>';
      html.push(`
        <tr>
          <td>
            <div class="cat-upg-name">${escapeHtml(r.head.name)}${activeChip}</div>
            <div class="cat-upg-scope">${escapeHtml(r.head.description || '')}</div>
          </td>
          <td><span class="bdg bdg-setup">${escapeHtml(GENERAL_CATEGORY_LABEL[cat] || cat)}</span></td>
          <td>${audCell}</td>
          <td>${usdCell}</td>
          <td><button class="btn-link" data-cat-action="edit-general" data-sku="${escapeHtml(r.head.sku)}">Edit details</button></td>
        </tr>`);
    }
    tbody.innerHTML = html.join('');
  }

  // Inline price edit for both upgrade and general products (the price cell
  // is rendered by the same helper for visual consistency).
  async function handleEditGeneralPrice(id) {
    const row = generals.find((g) => g.id === id);
    if (!row) return;
    const current = (row.amount_cents / 100).toFixed(2);
    const raw = window.prompt(`New price for ${row.name} (${row.currency}, ex GST).\nCurrent: ${current}`, current);
    if (raw === null) return;
    const parsed = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    if (!isFinite(parsed) || parsed < 0) {
      await (window.AdminModal ? window.AdminModal.alert({ title: 'Invalid price', message: 'Enter a positive number.' }) : Promise.resolve());
      return;
    }
    const newCents = Math.round(parsed * 100);
    if (newCents === row.amount_cents) return;
    const client = sb();
    const { error } = await client.from('general_products').update({ amount_cents: newCents }).eq('id', id);
    if (error) { await window.AdminModal.alert({ title: 'Update failed', message: escapeHtml(error.message) }); return; }
    await loadGenerals();
    renderGenerals();
  }

  // Build a SKU from a name without showing it to the admin. The handle is
  // structural (pairs the AUD + USD currency rows of the same product) but
  // the team doesn't need to manage it. Suffix is 4 hex chars from
  // crypto.getRandomValues so duplicate-named products don't collide on the
  // (sku, currency) unique constraint.
  function generateGeneralSku(name) {
    const slug = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'product';
    const bytes = new Uint8Array(2);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    const suffix = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${slug}-${suffix}`;
  }

  async function openGeneralEditor(sku) {
    const isNew = !sku;
    let aud = null, usd = null, head = null;
    if (!isNew) {
      // Re-fetch with deliverable_template (cached `generals` is loaded
      // without it). Falls back to the cached row if the fresh fetch fails.
      const client = sb();
      if (client) {
        const { data } = await client
          .from('general_products')
          .select('id, sku, category, currency, amount_cents, tax_code, name, description, includes, active, sort_order, updated_at, deliverable_template')
          .eq('sku', sku);
        if (Array.isArray(data) && data.length) {
          aud = data.find((g) => g.currency === 'AUD') || null;
          usd = data.find((g) => g.currency === 'USD') || null;
        }
      }
      if (!aud && !usd) {
        const matches = generals.filter((g) => g.sku === sku);
        aud = matches.find((g) => g.currency === 'AUD') || null;
        usd = matches.find((g) => g.currency === 'USD') || null;
      }
      head = aud || usd;
      if (!head) return;
    }
    const draft = head || { sku: '', category: 'consulting', name: '', description: '', includes: [], active: true, sort_order: 100, deliverable_template: [] };
    const includesText = (draft.includes || []).join('\n');
    const audAmt = aud ? ((aud.amount_cents||0)/100).toFixed(2) : '';
    const usdAmt = usd ? ((usd.amount_cents||0)/100).toFixed(2) : '';
    const body = `
      <p>${isNew ? 'Add a new general product. Both AUD and USD prices can be set.' : 'Edit this product. Changes apply to both AUD and USD rows.'}</p>
      <div class="cat-form" style="margin-top:12px;">
        <div class="cat-form-row" style="display:grid;grid-template-columns:2fr 1fr;gap:10px;">
          <div>
            <label for="catGpName">Product name</label>
            <input type="text" id="catGpName" value="${escapeHtml(draft.name)}" placeholder="Strategy consulting (1 hour)" maxlength="160">
          </div>
          <div>
            <label for="catGpCategory">Category</label>
            <select id="catGpCategory">
              ${GENERAL_CATEGORY_ORDER.map((c) => `<option value="${c}"${draft.category===c?' selected':''}>${GENERAL_CATEGORY_LABEL[c]}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cat-form-row">
          <label for="catGpDesc">Description</label>
          <textarea id="catGpDesc" rows="2" style="width:100%;padding:9px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--g8);">${escapeHtml(draft.description || '')}</textarea>
        </div>
        <div class="cat-form-row">
          <label for="catGpIncl">Inclusions (one per line)</label>
          <textarea id="catGpIncl" rows="4" style="width:100%;padding:9px 12px;border:1px solid var(--g2);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--g8);">${escapeHtml(includesText)}</textarea>
        </div>
        <div class="cat-form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div>
            <label for="catGpAud">AUD price (ex GST)</label>
            <input type="number" id="catGpAud" min="0" step="0.01" placeholder="0.00" value="${audAmt}">
          </div>
          <div>
            <label for="catGpUsd">USD price</label>
            <input type="number" id="catGpUsd" min="0" step="0.01" placeholder="0.00" value="${usdAmt}">
          </div>
          <div>
            <label for="catGpSort">Sort order</label>
            <input type="number" id="catGpSort" min="0" step="10" value="${draft.sort_order || 100}">
          </div>
        </div>
        <div class="cat-form-row">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="catGpActive"${(isNew || (aud&&aud.active) || (usd&&usd.active)) ? ' checked' : ''}> Active (visible in picker)
          </label>
        </div>
        ${renderDeliverableTemplateSection(draft.deliverable_template, 'catGpDt')}
      </div>`;
    const dtHandler = bindDeliverableTemplateHandlers();
    let ok;
    try {
      ok = await window.AdminModal.confirm({ title: isNew ? 'Add general product' : 'Edit product', message: body, confirmLabel: 'Save', size: 'wide' });
    } finally {
      document.removeEventListener('click', dtHandler);
    }
    if (!ok) return;

    const nameVal = $('catGpName').value.trim();
    if (!nameVal) { await window.AdminModal.alert('Name cannot be blank.'); return; }
    // SKU is no longer admin-facing. For new products we derive it from
    // the name + a short hex suffix so duplicate names can coexist; for
    // edits we keep the existing sku unchanged.
    const skuVal = isNew ? generateGeneralSku(nameVal) : draft.sku;
    const patch = {
      sku: skuVal,
      category: $('catGpCategory').value,
      name: nameVal,
      description: $('catGpDesc').value.trim(),
      includes: $('catGpIncl').value.split('\n').map((s) => s.trim()).filter(Boolean),
      sort_order: parseInt($('catGpSort').value, 10) || 100,
      active: $('catGpActive').checked,
      deliverable_template: readDeliverableTemplate('catGpDtList'),
    };
    const audCents = Math.round((parseFloat($('catGpAud').value) || 0) * 100);
    const usdCents = Math.round((parseFloat($('catGpUsd').value) || 0) * 100);
    if (!audCents && !usdCents) { await window.AdminModal.alert('Set at least one price (AUD or USD).'); return; }

    const client = sb();
    const ops = [];
    // Upsert each currency row independently so partial-currency setups
    // ("AUD only") work without forcing a $0 USD row.
    for (const [cur, cents] of [['AUD', audCents], ['USD', usdCents]]) {
      const existing = cur === 'AUD' ? aud : usd;
      if (cents > 0) {
        if (existing) {
          ops.push(client.from('general_products').update({ ...patch, amount_cents: cents }).eq('id', existing.id));
        } else {
          ops.push(client.from('general_products').insert({ ...patch, currency: cur, amount_cents: cents }));
        }
      } else if (existing) {
        // Zero amount + existing row: deactivate rather than delete, so
        // history of prior invoices that reference this row stays intact.
        ops.push(client.from('general_products').update({ active: false }).eq('id', existing.id));
      }
    }
    const results = await Promise.all(ops);
    const failed = results.find((r) => r.error);
    if (failed) { await window.AdminModal.alert({ title: 'Could not save', message: escapeHtml(failed.error.message) }); return; }
    await loadGenerals();
    renderGenerals();
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
          <td class="studio-cell">
            <button type="button" class="cat-code-copy" data-cat-action="copy-code" data-code="${escapeHtml(c.code)}" title="Click to copy">
              <code>${escapeHtml(c.code)}</code>
              <span class="cat-code-copy-icon" aria-hidden="true">⧉</span>
            </button>
          </td>
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
    if (action === 'edit-upgrade-price') return handleEditUpgradePrice(id);
    if (action === 'edit-upgrade-details') return openUpgradeEditor(btn.dataset.key);
    if (action === 'edit-general') return openGeneralEditor(btn.dataset.sku);
    if (action === 'edit-details') return editDetails(btn.dataset.plan, btn.dataset.setup);
    if (action === 'history') return showHistory(id);
    if (action === 'toggle-active') return toggleActive(id, btn.dataset.active !== 'true');
    if (action === 'sync') return syncToStripe(id, btn);
    if (action === 'copy-url') return copyUrl(btn);
    if (action === 'copy-code') return copyToClipboard(btn, btn.dataset.code || '', 'Copied ✓');
    if (action === 'edit-code') return openCodeModal(codes.find((c) => c.id === id));
    if (action === 'toggle-code') return toggleCode(id, btn.dataset.active !== 'true');
  }

  // Generic clipboard helper. Used by both Copy URL and Copy Code actions.
  // Briefly flips the button label to a confirmation state so the VA sees
  // the copy succeeded. Falls back to a hidden textarea + execCommand for
  // environments where the modern clipboard API is unavailable.
  async function copyToClipboard(btn, text, successLabel) {
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      }
    } catch (e) { console.error('copy failed:', e); }
    // Save full original HTML (the chip button has an icon + code inside)
    // so we can restore it after the flash.
    const origHtml = btn.innerHTML;
    btn.innerHTML = ok ? `<span style="font-weight:600;">${successLabel}</span>` : '<span>Copy failed</span>';
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.disabled = false;
    }, 1400);
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
          <input type="text" id="catCodeCode" value="${escapeHtml(existing?.code || '')}" placeholder="SUMMER25" autocomplete="off" spellcheck="false" maxlength="60">
          <p class="set-hint">1–60 characters. Letters, numbers, and <code>-</code> <code>_</code> <code>.</code> <code>+</code>. Spaces convert to hyphens. Case-insensitive at checkout.</p>
          <p class="set-hint" id="catCodeLivePreview" style="display:none;color:var(--g6);font-size:11px;margin-top:4px;"></p>
          <p class="set-hint" id="catCodeLiveError" style="display:none;color:var(--rd);font-size:11px;margin-top:4px;font-weight:600;"></p>
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

      // Live preview + validation hint as the admin types the code.
      // Mirrors normaliseCode in manage-discount-codes/index.ts (trim,
      // uppercase, collapse whitespace runs to a single hyphen) so the
      // admin sees exactly what gets stored before they hit Create.
      const codeInput = $('catCodeCode');
      const preview = $('catCodeLivePreview');
      const liveErr = $('catCodeLiveError');
      const ALLOWED = /^[A-Z0-9_.+\-]{1,60}$/;
      function previewCode() {
        const raw = codeInput.value || '';
        const normalised = raw.trim().toUpperCase().replace(/\s+/g, '-');
        if (!normalised) {
          preview.style.display = 'none';
          liveErr.style.display = 'none';
          return;
        }
        const changed = normalised !== raw;
        preview.style.display = changed ? 'block' : 'none';
        if (changed) preview.textContent = `Will be saved as: ${normalised}`;
        if (!ALLOWED.test(normalised)) {
          liveErr.style.display = 'block';
          const bad = (normalised.match(/[^A-Z0-9_.+\-]/g) || []).slice(0, 5).join(' ');
          liveErr.textContent = bad
            ? `Not allowed: ${bad} — use only letters, numbers, hyphen, underscore, period, or plus.`
            : 'Code must be 1–60 characters.';
        } else {
          liveErr.style.display = 'none';
        }
      }
      codeInput.addEventListener('input', previewCode);
      previewCode();
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
    if (error) {
      // supabase-js wraps non-2xx responses as `error` with a generic
      // "Edge Function returned a non-2xx status code" message and no
      // body. The actual response body lives on error.context (a Response
      // object). Pull it out so the UI shows our real error string
      // instead of the generic one.
      let realError = error.message || String(error);
      try {
        if (error.context && typeof error.context.json === 'function') {
          const body = await error.context.json();
          if (body && body.error) realError = String(body.error);
        }
      } catch (_) { /* fall through with the generic message */ }
      return { ok: false, error: realError };
    }
    if (data && data.ok === false) return { ok: false, error: data.error || 'Failed.', data };
    return { ok: true, data };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  window.AdminCatalog = { show, refresh: async () => { await Promise.all([loadProducts(), loadCodes(), loadMode()]); renderMatrix(); renderCodes(); } };
})();
