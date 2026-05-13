/* StudioLAB Growth Onboarding: public form behaviour.
   Event delegation on data-* attributes keeps the HTML declarative.
   This file owns state, validation, ARIA wiring, and the Supabase write. */

(function () {
  'use strict';

  // Plan and region resolution order:
  //   1. URL query params (?plan=launch&region=au) — new canonical pattern
  //   2. window.PLAN / window.REGION inline scripts — legacy folder URLs
  //   3. Defaults (launch + AU) for the generic /setup entry point pre-OTP
  const _params = new URLSearchParams(window.location.search);
  const _urlPlan = (_params.get('plan') || '').toLowerCase();
  const _urlRegion = (_params.get('region') || '').toUpperCase();
  const PLAN = _urlPlan || window.PLAN || 'launch';
  const REGION = _urlRegion || window.REGION || 'AU';
  // GENERIC_MODE means we landed without plan info in URL or inline scripts —
  // the gate is shown without a plan-specific subheading, and after OTP we
  // either look up the studio's existing draft or prompt for plan + region.
  const GENERIC_MODE = !_urlPlan && !window.PLAN;
  // PREVIEW_MODE allows admins to walk through the entire form without OTP,
  // auto-save, or submission. Used from the admin dashboard's preview link.
  const PREVIEW_MODE = _params.get('preview') === '1';
  const totalSteps = () => document.querySelectorAll('.panel').length;

  // Edge Function endpoints.
  const SB_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '';
  const FN_BASE = SB_URL + '/functions/v1/';
  // Single session key per browser. The studio is the studio regardless of
  // which plan URL they last visited; the session row itself encodes plan +
  // region. Switching plans requires re-verification, which is rare.
  const SESSION_KEY = 'sl-growth-session';

  async function callFn(name, body) {
    const resp = await fetch(FN_BASE + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await resp.json(); } catch (_) { /* non-JSON response */ }
    return { ok: resp.ok, status: resp.status, data: data || {} };
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function storeSession(token, expiresAt, email) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt, email }));
  }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }
  function sessionValid(s) {
    return Boolean(s && s.token && s.expiresAt && new Date(s.expiresAt) > new Date());
  }

  // Setup fee pricing per master reference doc (May 2026).
  // AU prices show ex-GST headline with inc-GST hint. US shows single USD.
  // Dominate AI: the dfy slot is renamed to AI Activation Pack at render time.
  const PRICING = {
    launch: {
      AU: {
        guided: { amount: '$99', currency: 'AUD', tax: 'ex GST · $109 inc GST' },
        dfy:    { amount: '$400', currency: 'AUD', tax: 'ex GST · $440 inc GST' },
      },
      US: {
        guided: { amount: '$79', currency: 'USD', tax: '' },
        dfy:    { amount: '$299', currency: 'USD', tax: '' },
      },
    },
    scale: {
      AU: {
        guided: { amount: '$99', currency: 'AUD', tax: 'ex GST · $109 inc GST' },
        dfy:    { amount: '$400', currency: 'AUD', tax: 'ex GST · $440 inc GST' },
      },
      US: {
        guided: { amount: '$79', currency: 'USD', tax: '' },
        dfy:    { amount: '$299', currency: 'USD', tax: '' },
      },
    },
    ai: {
      AU: {
        guided: { amount: '$99',  currency: 'AUD', tax: 'ex GST · $109 inc GST' },
        dfy:    { amount: '$699', currency: 'AUD', tax: 'ex GST · $769 inc GST' },
      },
      US: {
        guided: { amount: '$79',  currency: 'USD', tax: '' },
        dfy:    { amount: '$549', currency: 'USD', tax: '' },
      },
    },
  };

  // Display label for each setup type, plan-aware. The DFY card on Dominate AI
  // is rebadged as AI Activation Pack with a richer description.
  const SETUP_DISPLAY = {
    guided: {
      label: 'Guided (self-setup)',
      desc:  'You configure your own account using our step-by-step checklist, with support available if you get stuck. Typically 3 to 5 business days.',
    },
    dfy_default: {
      label: 'Done-For-You',
      desc:  'Our team configures your entire account. You provide the information, we handle everything else. Typically 5 to 7 business days.',
    },
    dfy_ai: {
      label: 'AI Activation Pack',
      desc:  'Full Done-For-You configuration plus knowledge base build, AI chat setup, voice agent setup and testing, and a live walkthrough. Typically 7 to 10 business days.',
    },
  };

  const state = {
    step: 1,
    plan: PLAN,
    setup: 'dfy',
    yn: { dns: null, quotePrice: null },
    logoUrl: null,
    uploading: false,
  };

  const sb = window.initSupabase ? window.initSupabase() : null;

  // ── Element refs ──────────────────────────────────────────────────────────
  const panels = () => document.querySelectorAll('.panel');
  const stepPills = () => document.querySelectorAll('.sp');
  const panel = (n) => document.getElementById('s' + n);
  const progFill = document.getElementById('pf');
  const progBar = () => document.querySelector('.prog');

  // ── Helpers ───────────────────────────────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? (el.value || '').trim() : '';
  };
  const valOrNull = (id) => val(id) || null;
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isUrl = (v) => {
    try { new URL(v); return true; } catch (e) { return false; }
  };
  const isHex = (v) => /^#[0-9A-Fa-f]{6}$/.test(v);

  // ── Pricing rendering ─────────────────────────────────────────────────────
  function priceFor(setupType) {
    const planTable = PRICING[PLAN] || PRICING.launch;
    const regionTable = planTable[REGION] || planTable.AU;
    return regionTable[setupType] || regionTable.dfy;
  }

  function setupLabelFor(setupType) {
    if (setupType === 'guided') return SETUP_DISPLAY.guided;
    return PLAN === 'ai' ? SETUP_DISPLAY.dfy_ai : SETUP_DISPLAY.dfy_default;
  }

  function renderSetupCards() {
    document.querySelectorAll('.setup-card').forEach((card) => {
      const setupType = card.dataset.setup;
      if (!setupType) return;
      const display = setupLabelFor(setupType);
      const nameEl = card.querySelector('.setup-name');
      const descEl = card.querySelector('.setup-desc');
      const priceSlot = card.querySelector('[data-price-slot]');
      if (nameEl) nameEl.textContent = display.label;
      if (descEl) descEl.textContent = display.desc;
      if (priceSlot) {
        const p = priceFor(setupType);
        priceSlot.innerHTML =
          '<span class="setup-price-amt">' + p.amount + ' ' + p.currency + '</span>' +
          (p.tax ? '<span class="setup-price-tax">' + p.tax + '</span>' : '');
      }
    });
  }

  function setupFeeSummaryLine() {
    const p = priceFor(state.setup);
    const label = setupLabelFor(state.setup).label;
    const taxNote = p.tax ? ' (' + p.tax + ')' : '';
    return label + ' · ' + p.amount + ' ' + p.currency + taxNote;
  }

  // HTML-aware variant for the Review summary so the tax note can be
  // styled smaller and lighter without dragging the headline value down.
  function setupFeeSummaryHtml() {
    const p = priceFor(state.setup);
    const label = setupLabelFor(state.setup).label;
    const head = escapeForHtml(`${label} · ${p.amount} ${p.currency}`);
    if (!p.tax) return head;
    return `${head} <span class="sum-v-meta">${escapeForHtml(p.tax)}</span>`;
  }
  function escapeForHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── Country and timezone smart defaults ───────────────────────────────────
  // The URL determines the studio's region. Pre-select country accordingly and
  // filter the timezone select so only that country's options appear. Studios
  // can change country to switch the timezone list.
  const COUNTRY_TO_REGION = { AU: 'AU', US: 'US', CA: 'US', UK: 'US' };
  const REGION_DEFAULT_COUNTRY = { AU: 'AU', US: 'US' };

  function applyCountryToTimezone() {
    const cSel = document.getElementById('country');
    const tSel = document.getElementById('timezone');
    if (!cSel || !tSel) return;
    const country = cSel.value || REGION_DEFAULT_COUNTRY[REGION] || 'AU';
    const groupLabelByCountry = {
      AU: 'Australia',
      US: 'United States',
      CA: 'Canada',
      UK: 'United Kingdom',
    };
    const wantedLabel = groupLabelByCountry[country];
    let firstVisibleValue = '';
    Array.from(tSel.querySelectorAll('optgroup')).forEach((og) => {
      const show = og.label === wantedLabel;
      og.style.display = show ? '' : 'none';
      og.disabled = !show;
      if (show && !firstVisibleValue) {
        const opt = og.querySelector('option');
        if (opt) firstVisibleValue = opt.value;
      }
    });
    // If current selection is from a hidden group, snap to first visible option
    const selectedOpt = tSel.options[tSel.selectedIndex];
    if (!selectedOpt || (selectedOpt.parentElement && selectedOpt.parentElement.style.display === 'none')) {
      tSel.value = firstVisibleValue;
    }
  }

  function applyRegionDefaults() {
    // Pre-select the country dropdown to the URL's region default.
    const cSel = document.getElementById('country');
    if (cSel && !cSel.value) {
      const def = REGION_DEFAULT_COUNTRY[REGION] || 'AU';
      cSel.value = def;
    }
    applyCountryToTimezone();
    applyRegionalCopy();
  }

  // ── Regional copy ─────────────────────────────────────────────────────────
  // AU keeps single-l spelling ('enrolment'), AU-style phone example, and the
  // Melbourne studio example. Every other region (US, NZ, UK, CA) flips to
  // US English spelling, US phone example, and a generic studio name.
  function applyRegionalCopy() {
    const isAU = REGION === 'AU';

    // Phone placeholder
    const phone = document.getElementById('contactPhone');
    if (phone) phone.placeholder = isAU ? '+61 4XX XXX XXX' : '+1 (555) 555-0123';

    // Studio name placeholder
    const studioName = document.getElementById('studioName');
    if (studioName) studioName.placeholder = isAU ? 'e.g. Dance Academy Melbourne' : 'e.g. Dance Academy';

    // From-name placeholder
    const fromName = document.getElementById('fromName');
    if (fromName) fromName.placeholder = isAU ? 'e.g. Sarah at Dance Academy' : 'e.g. Sarah at Dance Academy';

    // Sign-off placeholder uses an AU studio example; swap for non-AU
    const signOff = document.getElementById('signOff');
    if (signOff && !isAU) signOff.placeholder = signOff.placeholder.replace('Melbourne', '');

    // Single-l → double-l spelling everywhere except AU
    if (!isAU) {
      swapSpelling(document.body);
    }
  }

  // Recursive case-preserving swap of 'enrol' family words across text nodes,
  // placeholder attributes, and aria-labels. Skips inputs/script/style/textareas
  // that already contain user input.
  function swapSpelling(root) {
    const SWAPS = [
      [/Enrolment/g, 'Enrollment'],
      [/enrolment/g, 'enrollment'],
      [/Enrol(?!l)/g, 'Enroll'],
      [/enrol(?!l)/g, 'enroll'],
    ];
    function apply(text) {
      if (!text) return text;
      let out = text;
      for (const [re, rep] of SWAPS) out = out.replace(re, rep);
      return out;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const swapped = apply(node.nodeValue);
      if (swapped !== node.nodeValue) node.nodeValue = swapped;
    }
    root.querySelectorAll('[placeholder]').forEach((el) => {
      const v = el.getAttribute('placeholder');
      const s = apply(v);
      if (s !== v) el.setAttribute('placeholder', s);
    });
    root.querySelectorAll('[aria-label]').forEach((el) => {
      const v = el.getAttribute('aria-label');
      const s = apply(v);
      if (s !== v) el.setAttribute('aria-label', s);
    });
  }

  // ── Website URL normalisation ─────────────────────────────────────────────
  // Studios can type "yourstudio.com" without protocol. We add https:// at
  // submit time. Validation accepts a domain-shaped string with at least one dot.
  function looksLikeDomain(v) {
    const cleaned = String(v).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(cleaned);
  }
  function normaliseUrl(v) {
    const s = String(v).trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    return 'https://' + s.replace(/^\/+/, '');
  }

  // ── Step navigation ───────────────────────────────────────────────────────
  function goTo(n) {
    const total = totalSteps();
    if (n < 1 || n > total) return;
    state.step = n;
    panels().forEach((p) => p.classList.remove('active'));
    panel(n).classList.add('active');
    stepPills().forEach((sp) => {
      const s = parseInt(sp.dataset.s, 10);
      sp.classList.remove('active', 'done');
      sp.removeAttribute('aria-current');
      if (s === n) {
        sp.classList.add('active');
        sp.setAttribute('aria-current', 'step');
        sp.disabled = false;
      } else if (s < n) {
        sp.classList.add('done');
        sp.disabled = false;
      } else {
        sp.disabled = true;
      }
    });
    const pct = Math.round((n / total) * 100);
    if (progFill) progFill.style.width = pct + '%';
    const bar = progBar();
    if (bar) {
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-valuetext', 'Step ' + n + ' of ' + total);
    }
    if (n === total) {
      buildSummary();
      ensurePaymentBlock();
      refreshPricing();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Move focus to the panel heading for screen-reader users.
    const heading = panel(n).querySelector('.sh-title');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      // Defer so scroll completes first, no layout fight.
      setTimeout(() => heading.focus({ preventScroll: true }), 50);
    }
  }

  function nextStep() {
    // Preview mode: admin walkthrough, skip validation so the reviewer can
    // see every step without filling in required fields.
    if (!PREVIEW_MODE && !validatePanel(state.step)) return;
    const target = state.step + 1;
    if (target > totalSteps()) return;
    goTo(target);
    autoSave();
  }

  function prevStep() {
    if (state.step === 1) return;
    goTo(state.step - 1);
    autoSave();
  }

  // ── Plan & setup selection ────────────────────────────────────────────────
  function selectPlan(planName) {
    state.plan = planName;
    $$('.plan-card').forEach((c) => {
      const isSel = c.dataset.plan === planName;
      c.classList.toggle('sel', isSel);
      const radio = c.querySelector('input[type="radio"]');
      if (radio) radio.checked = isSel;
    });
    applyPlanVisibility();
  }

  function selectSetup(setupName) {
    state.setup = setupName;
    $$('.setup-card').forEach((c) => {
      const isSel = c.dataset.setup === setupName;
      c.classList.toggle('sel', isSel);
      const radio = c.querySelector('input[type="radio"]');
      if (radio) radio.checked = isSel;
    });
    // Setup-conditional UI: elements with .dfy-only are only visible when
    // Done-For-You is selected. Mirrored on the body so CSS can target it.
    document.body.classList.toggle('setup-dfy', setupName === 'dfy');
    document.body.classList.toggle('setup-guided', setupName === 'guided');
  }

  // Show/hide plan-conditional sections.
  function applyPlanVisibility() {
    const p = state.plan;
    const isScalePlus = p === 'scale' || p === 'ai';
    const isAi = p === 'ai';

    show('s5-desc-launch', p === 'launch');
    show('s5-desc-scale', p === 'scale');
    show('s5-desc-ai', isAi);

    show('s5-launch-notice', !isScalePlus);
    show('s5-full', isScalePlus);

    show('wf-sms-ae', isScalePlus);
    show('wf-mct', isScalePlus);
    show('wf-re-sms', isScalePlus);

    show('s7-notai', !isAi);
    show('s7-isai', isAi);

    show('s7-skip-notice', !isAi);
    show('s7-full', isAi);
  }

  function show(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  // ── Yes/No buttons (role="radio" in a radiogroup) ─────────────────────────
  function handleYn(btn) {
    const key = btn.dataset.yn;
    const v = btn.dataset.val === 'true';
    state.yn[key] = v;
    const group = btn.parentElement;
    $$('.yn-b', group).forEach((b) => {
      const bv = b.dataset.val === 'true';
      const isThis = b === btn;
      b.classList.remove('sy', 'sn');
      if (isThis) b.classList.add(v ? 'sy' : 'sn');
      b.setAttribute('aria-checked', isThis ? 'true' : 'false');
      // Roving tabindex: only the checked button is in the tab order.
      b.tabIndex = isThis ? 0 : -1;
    });
    const cond = document.getElementById(key + 'Cond');
    if (cond) cond.classList.toggle('vis', v === true);
  }

  // Arrow-key navigation inside a radiogroup of yn-b buttons.
  function handleYnKey(e) {
    const btn = e.target.closest('.yn-b');
    if (!btn) return;
    const group = btn.parentElement;
    const buttons = $$('.yn-b', group);
    let idx = buttons.indexOf(btn);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') idx = (idx + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') idx = (idx - 1 + buttons.length) % buttons.length;
    else return;
    e.preventDefault();
    const target = buttons[idx];
    target.focus();
    handleYn(target);
  }

  // ── Colour sync ───────────────────────────────────────────────────────────
  function bindColourSync(pickerId, textId) {
    const picker = document.getElementById(pickerId);
    const text = document.getElementById(textId);
    if (!picker || !text) return;
    picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); clearFieldErr(text); });
    text.addEventListener('input', () => {
      const v = text.value.trim();
      if (isHex(v)) { picker.value = v; clearFieldErr(text); }
    });
  }

  // ── FAQ repeater ──────────────────────────────────────────────────────────
  function addFaqRow() {
    const list = document.getElementById('faqList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'faq-item';
    row.innerHTML =
      '<input type="text" placeholder="Question" class="faq-q" aria-label="FAQ question">' +
      '<input type="text" placeholder="Answer" class="faq-a" aria-label="FAQ answer">' +
      '<button type="button" class="faq-del" data-action="del-faq" aria-label="Remove this question and answer"><span aria-hidden="true">&times;</span></button>';
    list.appendChild(row);
  }

  function delFaqRow(btn) {
    const list = document.getElementById('faqList');
    if (!list) return;
    const rows = list.querySelectorAll('.faq-item');
    if (rows.length <= 1) return;
    const row = btn.closest('.faq-item');
    if (row) row.remove();
  }

  // ── Validation ────────────────────────────────────────────────────────────
  // ── Auto-fill / smart defaults ────────────────────────────────────────────
  // When a studio enters their first name + studio name we propose a sensible
  // "From name" and email sign-off. Once they've entered their contact email
  // we propose the same address as their reply-to. All proposals are visibly
  // editable; the first manual edit on a target field locks it (marked with
  // data-user-edited) so we don't keep overwriting their intent.

  const AUTOFILL_SOURCES = new Set(['firstName', 'lastName', 'studioName', 'contactEmail', 'signOffLine1', 'signOffLine2']);
  const AUTOFILL_TARGETS = new Set(['fromName', 'signOffLine1', 'signOffLine2', 'replyEmail']);

  function setIfAuto(targetId, value) {
    const el = document.getElementById(targetId);
    if (!el) return;
    if (el.dataset.userEdited === '1') return;
    if (el.value && el.dataset.autofill !== '1') return; // existing value not authored by us
    if (el.value === value) return;
    el.value = value;
    el.dataset.autofill = '1';
    clearFieldErr(el);
  }

  function syncSignOff() {
    // Combine the two signature lines into the hidden #signOff field that
    // buildPayload reads. Also refresh the visible preview.
    const l1 = (val('signOffLine1') || '').trim();
    const l2 = (val('signOffLine2') || '').trim();
    const combined = [l1, l2].filter(Boolean).join('\n');
    const hidden = document.getElementById('signOff');
    if (hidden) hidden.value = combined;
    const preview = document.getElementById('signOffPreview');
    if (preview) preview.textContent = combined || '—';
  }

  function refreshAutoFill() {
    const first = (val('firstName') || '').trim();
    const last = (val('lastName') || '').trim();
    const studio = (val('studioName') || '').trim();
    const email = (val('contactEmail') || '').trim();

    if (first && studio) setIfAuto('fromName', `${first} at ${studio}`);
    if (first) setIfAuto('signOffLine1', last ? `${first} ${last}` : first);
    if (studio) setIfAuto('signOffLine2', studio);
    if (email) setIfAuto('replyEmail', email);
    syncSignOff();
  }

  function setFieldErr(input, on) {
    const wrap = input.closest('.f');
    if (!wrap) return;
    wrap.classList.toggle('has-error', !!on);
    input.setAttribute('aria-invalid', on ? 'true' : 'false');
  }
  function clearFieldErr(input) { setFieldErr(input, false); }

  function validatePanel(stepNum) {
    const p = panel(stepNum);
    if (!p) return true;
    let ok = true;
    let firstBad = null;

    const requireds = $$('[data-required]', p).filter((el) => isVisible(el));

    requireds.forEach((el) => {
      const v = (el.value || '').trim();
      let bad = !v;
      if (!bad) {
        if (el.type === 'email') bad = !isEmail(v);
        else if (el.type === 'url') bad = !isUrl(v);
        else if (el.id === 'website') bad = !looksLikeDomain(v);
        else if (el.id === 'col1t') bad = !isHex(v);
      }
      setFieldErr(el, bad);
      if (bad) {
        ok = false;
        if (!firstBad) firstBad = el;
      }
    });

    if (stepNum === 7 && state.plan === 'ai') {
      const faqPairs = collectFaqs();
      if (faqPairs.length < 10) {
        ok = false;
        const list = document.getElementById('faqList');
        if (list && !firstBad) firstBad = list;
      }
    }

    if (firstBad && firstBad.scrollIntoView) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (firstBad.focus) firstBad.focus({ preventScroll: true });
    }
    return ok;
  }

  function isVisible(el) {
    let node = el;
    while (node && node !== document.body) {
      const cs = window.getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    return true;
  }

  // ── Logo upload ───────────────────────────────────────────────────────────
  // ── Logo upload ───────────────────────────────────────────────────────────
  // GHL's sub-account business logo is the canonical target: PNG (transparent
  // background recommended), JPG, or GIF, proposed 350x180 px, max 2.5 MB.
  // SVG is rejected because GHL's email builder doesn't accept it. Files
  // above 2.5 MB are auto-scaled and re-encoded client-side so the upload
  // succeeds without bouncing back to the studio.

  const LOGO_MAX_BYTES = 2.5 * 1024 * 1024;
  const LOGO_TARGET_WIDTH = 1400; // 4x recommended width — high-DPI safe, file stays small
  const LOGO_ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif']);

  function bytesToHuman(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function readFileAsImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ img, url }); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')); };
      img.src = url;
    });
  }

  async function compressIfNeeded(file) {
    if (file.size <= LOGO_MAX_BYTES && file.type !== 'image/gif') {
      // Under cap, return as-is. GIFs are always passed through (animation
      // would be lost via canvas re-encode).
      return file;
    }
    if (file.type === 'image/gif') return file; // never re-encode GIFs
    const { img, url } = await readFileAsImage(file);
    try {
      const ratio = Math.min(1, LOGO_TARGET_WIDTH / img.naturalWidth);
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // Always emit PNG so transparency is preserved.
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) return file;
      // If PNG is still too big (rare on photo-heavy logos), bail back to the
      // original — admin can advise on a smaller source.
      if (blob.size > LOGO_MAX_BYTES) return file;
      return new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'logo') + '.png', { type: 'image/png' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function setLogoError(msg) {
    const err = document.getElementById('logoErr');
    if (!err) return;
    if (msg) { err.textContent = msg; err.hidden = false; }
    else { err.textContent = ''; err.hidden = true; }
  }

  function showLogoPreview(file, objectUrl) {
    const empty = document.getElementById('logoEmpty');
    const img = document.getElementById('logoPreviewImg');
    const fn = document.getElementById('logoFn');
    const removeBtn = document.getElementById('logoRemoveBtn');
    if (empty) empty.hidden = true;
    if (img) { img.src = objectUrl; img.hidden = false; }
    if (fn) fn.textContent = `${file.name} · ${bytesToHuman(file.size)}`;
    if (removeBtn) removeBtn.hidden = false;
  }

  function resetLogoView() {
    const empty = document.getElementById('logoEmpty');
    const img = document.getElementById('logoPreviewImg');
    const fn = document.getElementById('logoFn');
    const removeBtn = document.getElementById('logoRemoveBtn');
    if (empty) empty.hidden = false;
    if (img) { img.hidden = true; img.removeAttribute('src'); }
    if (fn) fn.textContent = '';
    if (removeBtn) removeBtn.hidden = true;
    const input = document.getElementById('logoFile');
    if (input) input.value = '';
    state.logoUrl = null;
    setLogoError('');
  }

  async function handleLogoFile(rawFile) {
    if (!rawFile) return;
    setLogoError('');

    // Reject SVG explicitly (GHL email builder won't accept it).
    if (rawFile.type === 'image/svg+xml' || /\.svg$/i.test(rawFile.name)) {
      setLogoError('SVG files are not supported. Please upload a PNG, JPG, or GIF.');
      return;
    }
    if (!LOGO_ACCEPTED_MIME.has(rawFile.type)) {
      setLogoError('Please upload a PNG, JPG, or GIF.');
      return;
    }

    const spin = document.getElementById('logoSpin');
    if (spin) spin.hidden = false;
    state.uploading = true;

    try {
      const file = await compressIfNeeded(rawFile);
      if (file.size > LOGO_MAX_BYTES) {
        setLogoError(`That file is ${bytesToHuman(file.size)}. We could not get it under 2.5 MB automatically. Please try a smaller source image.`);
        return;
      }

      if (!sb) {
        state.logoUrl = null;
        showLogoPreview(file, URL.createObjectURL(file));
        setLogoError('Upload pending: Supabase is not configured.');
        return;
      }

      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'gif';
      const path = crypto.randomUUID() + '.' + ext;
      const bucket = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.logoBucket) || 'logos';
      const { error } = await sb.storage.from(bucket).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      state.logoUrl = bucket + '/' + path;
      showLogoPreview(file, URL.createObjectURL(file));
    } catch (err) {
      console.error('Logo upload failed:', err);
      state.logoUrl = null;
      setLogoError('Upload failed. Please try again, or use a smaller file.');
    } finally {
      state.uploading = false;
      if (spin) spin.hidden = true;
    }
  }

  function handleLogoChange(input) {
    return handleLogoFile(input.files && input.files[0]);
  }

  // ── Brand reference image (optional) ──────────────────────────────────────
  // Companion to the brand-colour pickers: studios that don't know their hex
  // codes drop a screenshot here and the team matches the colours from it.

  const BRAND_REF_MAX_BYTES = 5 * 1024 * 1024;
  const BRAND_REF_MIME = new Set(['image/png', 'image/jpeg']);

  function setBrandRefError(msg) {
    const err = document.getElementById('brandRefErr');
    if (!err) return;
    if (msg) { err.textContent = msg; err.hidden = false; }
    else { err.textContent = ''; err.hidden = true; }
  }

  function showBrandRefPreview(file, objectUrl) {
    const empty = document.getElementById('brandRefEmpty');
    const prev = document.getElementById('brandRefPreview');
    const img = document.getElementById('brandRefImg');
    const name = document.getElementById('brandRefName');
    if (empty) empty.hidden = true;
    if (prev) prev.hidden = false;
    if (img) img.src = objectUrl;
    if (name) name.textContent = `${file.name} · ${bytesToHuman(file.size)}`;
  }

  function resetBrandRefView() {
    const empty = document.getElementById('brandRefEmpty');
    const prev = document.getElementById('brandRefPreview');
    const img = document.getElementById('brandRefImg');
    if (empty) empty.hidden = false;
    if (prev) prev.hidden = true;
    if (img) { img.removeAttribute('src'); }
    const input = document.getElementById('brandRefFile');
    if (input) input.value = '';
    state.brandReferenceUrl = null;
    setBrandRefError('');
  }

  async function handleBrandRefFile(rawFile) {
    if (!rawFile) return;
    setBrandRefError('');
    if (!BRAND_REF_MIME.has(rawFile.type)) {
      setBrandRefError('Please upload a PNG or JPG screenshot.');
      return;
    }
    if (rawFile.size > BRAND_REF_MAX_BYTES) {
      setBrandRefError(`That file is ${bytesToHuman(rawFile.size)}. Please keep brand references under 5 MB.`);
      return;
    }
    const spin = document.getElementById('brandRefSpin');
    if (spin) spin.hidden = false;
    state.uploading = true;
    try {
      if (!sb) {
        state.brandReferenceUrl = null;
        showBrandRefPreview(rawFile, URL.createObjectURL(rawFile));
        setBrandRefError('Upload pending: Supabase is not configured.');
        return;
      }
      const ext = rawFile.type === 'image/png' ? 'png' : 'jpg';
      const path = 'brand-ref/' + crypto.randomUUID() + '.' + ext;
      const bucket = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.logoBucket) || 'logos';
      const { error } = await sb.storage.from(bucket).upload(path, rawFile, {
        cacheControl: '3600',
        upsert: false,
        contentType: rawFile.type || undefined,
      });
      if (error) throw error;
      state.brandReferenceUrl = bucket + '/' + path;
      showBrandRefPreview(rawFile, URL.createObjectURL(rawFile));
    } catch (err) {
      console.error('Brand ref upload failed:', err);
      state.brandReferenceUrl = null;
      setBrandRefError('Upload failed. Please try again.');
    } finally {
      state.uploading = false;
      if (spin) spin.hidden = true;
    }
  }

  function bindBrandRefZone() {
    const zone = document.getElementById('brandRefZone');
    const input = document.getElementById('brandRefFile');
    const removeBtn = document.getElementById('brandRefRemove');
    if (!zone || !input || zone.dataset.bound === '1') return;
    zone.dataset.bound = '1';

    zone.addEventListener('click', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.target && e.target.closest && e.target.closest('#brandRefRemove')) return;
      input.click();
    });
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragenter','dragover'].forEach((ev) => {
      zone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('brand-ref-drag'); });
    });
    ['dragleave','drop'].forEach((ev) => {
      zone.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('brand-ref-drag'); });
    });
    zone.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleBrandRefFile(f);
    });
    input.addEventListener('change', () => handleBrandRefFile(input.files && input.files[0]));
    if (removeBtn) removeBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); resetBrandRefView();
    });
  }

  function bindLogoZone() {
    const zone = document.getElementById('logoZone');
    const input = document.getElementById('logoFile');
    const uploadBtn = document.getElementById('logoUploadBtn');
    const removeBtn = document.getElementById('logoRemoveBtn');
    if (!zone || !input || zone.dataset.bound === '1') return;
    zone.dataset.bound = '1';

    // Thumbnail click and keyboard activation both open the file picker.
    zone.addEventListener('click', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      input.click();
    });
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });

    // Drag and drop onto the thumbnail.
    ['dragenter','dragover'].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.add('logo-thumb-drag');
      });
    });
    ['dragleave','drop'].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault(); e.stopPropagation();
        zone.classList.remove('logo-thumb-drag');
      });
    });
    zone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleLogoFile(file);
    });

    if (uploadBtn) {
      uploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        input.click();
      });
    }
    if (removeBtn) {
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        resetLogoView();
      });
    }
  }

  // ── Collectors ────────────────────────────────────────────────────────────
  function collectLeads() {
    const out = [];
    $$('input[data-lead]').forEach((cb) => {
      const label = cb.closest('label');
      if (!label || !isVisible(label)) return;
      if (cb.checked) out.push(cb.value);
    });
    return out;
  }

  function collectFaqs() {
    const rows = $$('#faqList .faq-item');
    const out = [];
    rows.forEach((r) => {
      const q = (r.querySelector('.faq-q')?.value || '').trim();
      const a = (r.querySelector('.faq-a')?.value || '').trim();
      if (q && a) out.push({ question: q, answer: a });
    });
    return out;
  }

  // ── Summary build ─────────────────────────────────────────────────────────
  const PLAN_LABEL = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
  const SETUP_LABEL = { dfy: 'Done-For-You', guided: 'Guided (self-setup)' };

  function setSum(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v && String(v).trim() ? v : 'Not provided';
  }

  function buildSummary() {
    setSum('sv-plan', PLAN_LABEL[state.plan] || state.plan);
    // sv-setup uses innerHTML so the tax note can be styled smaller / lighter.
    const svSetup = document.getElementById('sv-setup');
    if (svSetup) svSetup.innerHTML = setupFeeSummaryHtml();
    setSum('sv-studio', val('studioName'));
    setSum('sv-country', val('country'));
    const fn = val('firstName'), ln = val('lastName');
    setSum('sv-contact', (fn + ' ' + ln).trim() || 'Not provided');
    setSum('sv-email', val('contactEmail'));
    setSum('sv-phone', val('contactPhone'));
    setSum('sv-website', val('website'));
    setSum('sv-logo', state.logoUrl ? 'Uploaded' : 'Not provided');
    // Primary and Secondary colours: inline swatch beside the hex so the
    // studio can visually confirm the colours they picked.
    function paintSwatch(elId, hex) {
      const el = document.getElementById(elId);
      if (!el) return;
      const v = (hex || '').trim();
      if (v) {
        el.innerHTML = `<span class="sum-swatch" style="background:${escapeForHtml(v)}" aria-hidden="true"></span><span>${escapeForHtml(v.toUpperCase())}</span>`;
      } else {
        el.textContent = 'Not provided';
      }
    }
    paintSwatch('sv-col1', val('col1t'));
    paintSwatch('sv-col2', val('col2t'));
    // Brand reference screenshot: status only — bucket is private and we
    // don't round-trip a signed URL just for the summary.
    setSum('sv-brandref', state.brandReferenceUrl ? 'Screenshot uploaded' : 'None');
    setSum('sv-signoff', val('signOff'));
    // Tone field was removed when Branding and Email merged into Voice
    // and email; the Review section no longer renders it.
    setSum('sv-fromname', val('fromName'));
    setSum('sv-replyto', val('replyEmail'));
    const dns = state.yn.dns;
    setSum('sv-domain', dns === true ? (val('emailDomain') || 'Yes') : (dns === false ? 'No, built-in email' : 'Not provided'));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function buildPayload() {
    const isScalePlus = state.plan === 'scale' || state.plan === 'ai';
    const isAi = state.plan === 'ai';

    return {
      plan: state.plan,
      setup_type: state.setup,
      studio_name: val('studioName'),
      legal_name: valOrNull('legalName'),
      country: valOrNull('country'),
      timezone: valOrNull('timezone'),
      studio_type: valOrNull('studioType'),
      address: valOrNull('address'),
      website: val('website') ? normaliseUrl(val('website')) : null,
      support_url: valOrNull('supportUrl'),

      first_name: valOrNull('firstName'),
      last_name: valOrNull('lastName'),
      contact_email: val('contactEmail'),
      contact_phone: valOrNull('contactPhone'),
      role: valOrNull('contactRole'),
      studiolab_email: valOrNull('slEmail'),

      logo_url: state.logoUrl,
      primary_colour: valOrNull('col1t'),
      secondary_colour: valOrNull('col2t'),
      sign_off: valOrNull('signOff'),
      email_tone: valOrNull('tone'),
      footer_notes: valOrNull('footerNotes'),
      studio_description: valOrNull('studioDesc'),

      from_name: valOrNull('fromName'),
      reply_email: valOrNull('replyEmail'),
      custom_domain: state.yn.dns,
      email_domain: state.yn.dns ? valOrNull('emailDomain') : null,
      dns_access: state.yn.dns ? valOrNull('dnsAccess') : null,

      sms_type: isScalePlus ? valOrNull('smsType') : null,
      has_twilio: isScalePlus ? !!(document.getElementById('hasTwilio') && document.getElementById('hasTwilio').checked) : null,
      twilio_number: isScalePlus ? valOrNull('twilioNumber') : null,

      // Social and business handles. Launch collects these in the optional
      // future-proof expander; Scale and AI collect them in the SMS step as
      // first-class inputs. Form skips silently if the inputs don't exist.
      tiktok_handle: valOrNull('tiktokHandle'),
      youtube_url:   valOrNull('youtubeUrl'),
      area_code: isScalePlus ? valOrNull('areaCode') : null,
      port_number: isScalePlus ? valOrNull('portNum') : null,
      sms_tone: isScalePlus ? valOrNull('smsTone') : null,
      lead_sources: isScalePlus ? collectLeads() : null,

      kb_profile: isAi ? valOrNull('kb-profile') : null,
      kb_classes: isAi ? valOrNull('kb-classes') : null,
      kb_pricing: isAi ? valOrNull('kb-pricing') : null,
      kb_price_quoting: isAi ? state.yn.quotePrice : null,
      kb_policies: isAi ? valOrNull('kb-policies') : null,
      kb_events: isAi ? valOrNull('kb-events') : null,
      kb_faqs: isAi ? collectFaqs() : null,
      kb_restricted: isAi ? valOrNull('kb-restricted') : null,
      kb_tone: isAi ? valOrNull('kb-tone') : null,
      voice_hours: isAi ? valOrNull('voiceHours') : null,
      voice_escalate: isAi ? valOrNull('voiceEscalate') : null,

      extra_notes: valOrNull('extraNotes'),

      // Optional future-proof URLs (Launch only). Form skips them silently
      // if the inputs don't exist on the current plan.
      google_business_url: valOrNull('googleBusinessUrl'),
      facebook_url:        valOrNull('facebookUrl'),
      instagram_handle:    valOrNull('instagramHandle'),
      booking_url:         valOrNull('bookingUrl'),

      // Optional brand-reference screenshot for hex matching.
      brand_reference_url: state.brandReferenceUrl || null,
    };
  }

  function showDone(ref) {
    const fmain = document.getElementById('fmain');
    const snav = document.querySelector('.snav');
    const done = document.getElementById('doneScreen');
    if (fmain) fmain.style.display = 'none';
    if (snav) snav.style.display = 'none';
    if (done) {
      done.classList.add('vis');
      done.focus();
    }
    setText('done-ref', ref);
    setText('done-studio', val('studioName') || 'Not provided');
    setText('done-plan', PLAN_LABEL[state.plan] || state.plan);
    setText('done-setup', setupFeeSummaryLine());
    setText('done-timeline', state.setup === 'guided'
      ? 'You complete setup at your own pace'
      : 'Typically 3 to 7 business days');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // ── Payment UI (final step) ───────────────────────────────────────────────
  // A sticky pay bar at the top of the final-step panel shows the total and
  // a single Pay CTA. The body underneath is purely a review of what the
  // studio is buying. Clicking Pay opens an overlay modal with the line
  // items, an optional discount field (shown only when at least one active
  // code exists in the catalog), and the Pay / Save-draft actions. The
  // legacy submit button is hidden but kept in DOM so existing prev-nav and
  // step-pill wiring stay intact.

  let pricingState = { discountCode: '', pricing: null, fetching: false };

  function paymentPanel() {
    return panels()[totalSteps() - 1];
  }

  function ensurePaymentBlock() {
    const p = paymentPanel();
    if (!p) return;

    if (!p.querySelector('#payBar')) {
      const bar = document.createElement('div');
      bar.id = 'payBar';
      bar.className = 'paybar';
      bar.innerHTML = ''
        + '<div class="paybar-info">'
        +   '<div class="paybar-label">Setup fee</div>'
        +   '<div class="paybar-amt" id="paybar-amt">—</div>'
        +   '<div class="paybar-sub" id="paybar-sub"></div>'
        + '</div>'
        + '<div class="paybar-actions">'
        +   '<button type="button" class="btn btn-ok paybar-pay" id="payBtn">Pay now</button>'
        +   '<button type="button" class="btn-link paybar-later" id="payLaterBtn">Save draft, pay later</button>'
        + '</div>';
      const reviewHeading = p.querySelector('.sh-title');
      if (reviewHeading && reviewHeading.parentNode) {
        reviewHeading.parentNode.insertBefore(bar, reviewHeading.nextSibling);
      } else {
        p.insertBefore(bar, p.firstChild);
      }
    }

    if (!document.getElementById('payModal')) {
      const modal = document.createElement('div');
      modal.id = 'payModal';
      modal.className = 'pay-modal';
      modal.hidden = true;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'payModalTitle');
      modal.innerHTML = ''
        + '<div class="pay-modal-backdrop" data-pay-close></div>'
        + '<div class="pay-modal-card">'
        +   '<header class="pay-modal-hdr">'
        +     '<div class="pay-modal-eyebrow">Complete your payment</div>'
        +     '<h2 id="payModalTitle" class="pay-modal-title">Your setup fee</h2>'
        +     '<button type="button" class="pay-modal-close" data-pay-close aria-label="Close">×</button>'
        +   '</header>'
        +   '<div class="pay-modal-body">'
        +     '<div class="pay-modal-product">'
        +       '<div class="pay-modal-product-name" id="pay-prod-name">—</div>'
        +       '<div class="pay-modal-product-desc" id="pay-prod-desc"></div>'
        +     '</div>'
        +     '<div class="pay-modal-rows" id="payblock-rows">'
        +       '<div class="pay-modal-row"><span class="pay-modal-k">Subtotal</span><span class="pay-modal-v" id="pay-subtotal">—</span></div>'
        +       '<div class="pay-modal-row" id="pay-discount-row" hidden><span class="pay-modal-k" id="pay-discount-k">Discount</span><span class="pay-modal-v" id="pay-discount">—</span></div>'
        +       '<div class="pay-modal-row" id="pay-tax-row" hidden><span class="pay-modal-k" id="pay-tax-k">GST</span><span class="pay-modal-v" id="pay-tax">—</span></div>'
        +       '<div class="pay-modal-row pay-modal-total"><span class="pay-modal-k">Total today</span><span class="pay-modal-v" id="pay-total">—</span></div>'
        +     '</div>'
        +     '<div class="pay-modal-discount" id="pay-discount-block" hidden>'
        +       '<label for="pay-code">Have a discount code?</label>'
        +       '<div class="pay-modal-discount-row">'
        +         '<input type="text" id="pay-code" autocomplete="off" spellcheck="false" placeholder="Enter code">'
        +         '<button type="button" class="btn btn-g pay-modal-apply" id="pay-code-apply">Apply</button>'
        +       '</div>'
        +       '<span class="pay-modal-discount-msg" id="pay-code-msg" aria-live="polite"></span>'
        +     '</div>'
        +   '</div>'
        +   '<footer class="pay-modal-ftr">'
        +     '<button type="button" class="btn-link pay-modal-secondary" id="payModalLaterBtn">Save draft, pay later</button>'
        +     '<button type="button" class="btn btn-ok pay-modal-pay" id="payModalPayBtn">Pay with Stripe</button>'
        +   '</footer>'
        +   '<p class="pay-modal-foot">You will be redirected to Stripe to complete payment securely. Your details are saved either way.</p>'
        + '</div>';
      document.body.appendChild(modal);

      modal.querySelector('#pay-code-apply').addEventListener('click', applyDiscount);
      modal.querySelector('#pay-code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyDiscount(); }
      });
      modal.querySelector('#payModalPayBtn').addEventListener('click', (e) => handlePayAndSubmit(e.currentTarget));
      modal.querySelector('#payModalLaterBtn').addEventListener('click', (e) => { closePayModal(); handleSaveLater(e.currentTarget); });
      modal.addEventListener('click', (e) => { if (e.target && e.target.matches('[data-pay-close]')) closePayModal(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closePayModal(); });
    }

    // Hide the legacy submit button — paybar has its own. Keep it in DOM
    // so prev-nav/step-pill logic that references it doesn't break.
    const legacy = p.querySelector('#submitBtn');
    if (legacy) legacy.style.display = 'none';
    const sctr = p.querySelector('.sctr');
    if (sctr) sctr.style.display = 'none';

    const payBtn = p.querySelector('#payBtn');
    const payLater = p.querySelector('#payLaterBtn');
    if (payBtn && !payBtn.dataset.bound) {
      payBtn.dataset.bound = '1';
      payBtn.addEventListener('click', openPayModal);
    }
    if (payLater && !payLater.dataset.bound) {
      payLater.dataset.bound = '1';
      payLater.addEventListener('click', (e) => handleSaveLater(e.currentTarget));
    }
  }

  function openPayModal() {
    const modal = document.getElementById('payModal');
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('pay-modal-open');
    refreshPricing();
    // Focus the primary action so Enter on keyboard fires Pay.
    setTimeout(() => {
      const pay = document.getElementById('payModalPayBtn');
      if (pay) pay.focus();
    }, 30);
  }

  function closePayModal() {
    const modal = document.getElementById('payModal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('pay-modal-open');
  }

  function formatMoney(cents, currency) {
    return ((cents || 0) / 100).toLocaleString('en-AU', {
      style: 'currency',
      currency: currency || 'AUD',
      minimumFractionDigits: 2,
    });
  }

  async function refreshPricing() {
    if (!state.plan || !state.setup) return;
    if (pricingState.fetching) return;
    pricingState.fetching = true;
    try {
      const r = await callFn('resolve-pricing', {
        plan: state.plan,
        setup_type: state.setup,
        country: val('country') || (REGION === 'AU' ? 'AU' : ''),
        discount_code: pricingState.discountCode || null,
      });
      pricingState.fetching = false;
      const data = r.data || {};
      if (!r.ok || data.ok === false) {
        // Distinguish a discount-code error (still show base price) from a
        // missing-product hard error.
        if (data.code && data.code.startsWith('discount_')) {
          setDiscountMsg(data.error || 'Could not apply discount.', true);
          pricingState.discountCode = '';
          await refreshPricing();
        } else {
          setPriceBlockError(data.error || 'Could not load the price for this plan.');
        }
        return;
      }
      pricingState.pricing = data;
      renderPricing(data);
    } catch (err) {
      pricingState.fetching = false;
      console.error('refreshPricing failed:', err);
      setPriceBlockError('Could not load the price. Please try again in a moment.');
    }
  }

  function renderPricing(p) {
    const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const setRow = (id, show) => { const el = document.getElementById(id); if (el) el.hidden = !show; };

    // Top sticky bar: headline total only.
    setT('paybar-amt', formatMoney(p.total_with_tax_cents, p.currency));
    const sub = p.currency === 'AUD' && p.tax_amount_cents
      ? `Includes ${formatMoney(p.tax_amount_cents, p.currency)} GST`
      : `${p.currency} · one-off setup fee`;
    setT('paybar-sub', sub);

    // Modal: product, line items, total.
    setT('pay-prod-name', p.product_name || '');
    setT('pay-prod-desc', p.product_description || '');
    setT('pay-subtotal', formatMoney(p.list_amount_cents, p.currency));
    if (p.discount_amount_cents && p.discount_amount_cents > 0) {
      setRow('pay-discount-row', true);
      setT('pay-discount-k', `Discount${p.discount_code ? ' (' + p.discount_code + ')' : ''}`);
      setT('pay-discount', '− ' + formatMoney(p.discount_amount_cents, p.currency));
    } else {
      setRow('pay-discount-row', false);
    }
    if (p.tax_amount_cents && p.tax_amount_cents > 0) {
      setRow('pay-tax-row', true);
      setT('pay-tax-k', `GST (${p.tax_rate_percent}%)`);
      setT('pay-tax', formatMoney(p.tax_amount_cents, p.currency));
    } else {
      setRow('pay-tax-row', false);
    }
    setT('pay-total', formatMoney(p.total_with_tax_cents, p.currency));

    // Discount block only renders if the catalog has at least one usable
    // active code. Keeps the modal calm when no campaigns are running.
    const discountBlock = document.getElementById('pay-discount-block');
    if (discountBlock) discountBlock.hidden = !p.has_active_discounts;

    const codeIn = document.getElementById('pay-code');
    if (codeIn && pricingState.discountCode && codeIn.value.trim().toUpperCase() !== pricingState.discountCode) {
      codeIn.value = pricingState.discountCode;
    }
    if (p.discount_code) setDiscountMsg(`Discount applied: ${formatMoney(p.discount_amount_cents, p.currency)} off.`, false);
  }

  function setPriceBlockError(msg) {
    const rows = document.getElementById('payblock-rows');
    if (rows) rows.innerHTML = `<div class="payblock-row payblock-error">${escapeHtml(msg)}</div>`;
  }

  function setDiscountMsg(msg, isError) {
    const el = document.getElementById('pay-code-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('payblock-discount-err', !!isError);
    el.classList.toggle('payblock-discount-ok', !!msg && !isError);
  }

  async function applyDiscount() {
    const input = document.getElementById('pay-code');
    if (!input) return;
    const v = input.value.trim();
    setDiscountMsg('', false);
    pricingState.discountCode = v ? v.toUpperCase() : '';
    await refreshPricing();
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  async function handlePayAndSubmit(btn) {
    if (PREVIEW_MODE) {
      runPreviewPayFlow();
      return;
    }
    const hp = document.getElementById('hp-company');
    if (hp && hp.value.trim()) { showDone('SPAMTRAP'); return; }
    if (!validatePanel(totalSteps())) return;
    if (state.uploading) { console.warn('Logo upload in progress'); return; }
    const session = loadSession();
    if (!sessionValid(session)) { showAuthGate(true); return; }

    const errEl = document.getElementById('submitErr');
    if (errEl) errEl.classList.remove('vis');

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Redirecting to Stripe…';

    try {
      const payload = buildPayload();
      const saveR = await callFn('save-draft', {
        session_token: session.token,
        payload,
        last_step_completed: state.step,
        finalize: false,
      });
      if (!saveR.ok || !saveR.data || saveR.data.ok === false) {
        throw new Error((saveR.data && saveR.data.error) || 'Could not save before payment.');
      }
      // Dominate AI: kick off the website scrape + KB pre-fill in parallel
      // with the Stripe checkout-session creation. Fire-and-forget — the
      // function flips kb_scrape_status to 'pending' immediately so the
      // post-payment KB page can show a "Reading your website…" state and
      // poll until results land. Studios without a website on file are
      // tolerated server-side (status -> 'skipped'); they get an "Add your
      // website" callout on the KB page instead.
      if (PLAN === 'ai') {
        try {
          callFn('scrape-and-extract', { session_token: session.token })
            .catch((e) => console.warn('scrape dispatch failed (non-blocking):', e));
        } catch (e) { console.warn('scrape dispatch failed (non-blocking):', e); }
      }

      const co = await callFn('create-checkout-session', {
        session_token: session.token,
        discount_code: pricingState.discountCode || null,
        return_origin: window.location.origin,
        cancel_path: window.location.pathname,
      });
      if (!co.ok || !co.data || co.data.ok === false || !co.data.url) {
        throw new Error((co.data && co.data.error) || 'Could not create payment session.');
      }
      // Hand off to Stripe. Session stays valid so a cancel-return lands the
      // studio back on this step with all their data intact.
      window.location.href = co.data.url;
      return;
    } catch (err) {
      console.error('Submission failed:', err);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = originalLabel;
      if (errEl) errEl.classList.add('vis');
    }
  }

  // Preview-mode simulation of the Stripe handoff. Admins walking the form
  // with ?preview=1 have no submission row to attach a real checkout session
  // to, so we mock the full sequence — "Redirecting…", a Stripe-styled
  // checkout panel with a pre-filled test card, processing, then success —
  // entirely inside the existing pay modal. Nothing leaves the browser.
  function runPreviewPayFlow() {
    const modal = document.getElementById('payModal');
    if (!modal) return;
    const card = modal.querySelector('.pay-modal-card');
    if (!card) return;
    const originalHTML = card.innerHTML;

    const pricing = pricingState.pricing || {};
    const total = formatMoney(pricing.total_with_tax_cents || 0, pricing.currency || 'AUD');
    const productName = pricing.product_name || 'StudioLAB Growth setup';
    const postPayCopy = PLAN === 'ai'
      ? 'You would now be redirected to /kb.html to set up your AI knowledge base.'
      : 'Your setup would be queued and our team would email you shortly with next steps.';

    const restore = () => {
      card.innerHTML = originalHTML;
      // Existing handlers were bound to the original elements; re-bind them on
      // the restored DOM so the modal stays interactive.
      const applyBtn = card.querySelector('#pay-code-apply');
      const codeIn = card.querySelector('#pay-code');
      const payBtn = card.querySelector('#payModalPayBtn');
      const laterBtn = card.querySelector('#payModalLaterBtn');
      if (applyBtn) applyBtn.addEventListener('click', applyDiscount);
      if (codeIn) codeIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); applyDiscount(); }
      });
      if (payBtn) payBtn.addEventListener('click', (e) => handlePayAndSubmit(e.currentTarget));
      if (laterBtn) laterBtn.addEventListener('click', (e) => { closePayModal(); handleSaveLater(e.currentTarget); });
      card.querySelectorAll('[data-pay-close]').forEach((el) => {
        el.addEventListener('click', () => closePayModal());
      });
      refreshPricing();
    };

    const stageRedirecting = () => {
      card.innerHTML = ''
        + '<header class="pay-modal-hdr">'
        +   '<div class="pay-modal-eyebrow pay-preview-eyebrow">Preview mode</div>'
        +   '<h2 class="pay-modal-title">Redirecting to Stripe…</h2>'
        + '</header>'
        + '<div class="pay-modal-body pay-preview-center">'
        +   '<div class="pay-preview-spinner" aria-hidden="true"></div>'
        +   '<p class="pay-preview-note">In production this is where the browser navigates to Stripe Checkout.</p>'
        + '</div>';
      setTimeout(stageCheckout, 900);
    };

    const stageCheckout = () => {
      card.innerHTML = ''
        + '<header class="pay-modal-hdr">'
        +   '<div class="pay-modal-eyebrow pay-preview-eyebrow">Preview mode · simulated Stripe Checkout</div>'
        +   '<h2 class="pay-modal-title">' + escapeHtml(productName) + '</h2>'
        +   '<button type="button" class="pay-modal-close" data-preview-cancel aria-label="Close">×</button>'
        + '</header>'
        + '<div class="pay-modal-body">'
        +   '<div class="pay-preview-amount">'
        +     '<span class="pay-preview-amount-k">Pay StudioLAB</span>'
        +     '<span class="pay-preview-amount-v">' + escapeHtml(total) + '</span>'
        +   '</div>'
        +   '<div class="pay-preview-fields">'
        +     '<label class="pay-preview-field">'
        +       '<span class="pay-preview-label">Email</span>'
        +       '<input type="text" value="preview@studiolabgrowth.com" readonly>'
        +     '</label>'
        +     '<label class="pay-preview-field">'
        +       '<span class="pay-preview-label">Card number</span>'
        +       '<input type="text" value="4242 4242 4242 4242" readonly>'
        +     '</label>'
        +     '<div class="pay-preview-field-row">'
        +       '<label class="pay-preview-field">'
        +         '<span class="pay-preview-label">Expiry</span>'
        +         '<input type="text" value="12 / 34" readonly>'
        +       '</label>'
        +       '<label class="pay-preview-field">'
        +         '<span class="pay-preview-label">CVC</span>'
        +         '<input type="text" value="123" readonly>'
        +       '</label>'
        +     '</div>'
        +     '<label class="pay-preview-field">'
        +       '<span class="pay-preview-label">Name on card</span>'
        +       '<input type="text" value="StudioLAB Preview" readonly>'
        +     '</label>'
        +   '</div>'
        + '</div>'
        + '<footer class="pay-modal-ftr">'
        +   '<button type="button" class="btn-link pay-modal-secondary" data-preview-cancel>Cancel</button>'
        +   '<button type="button" class="btn btn-ok pay-modal-pay" data-preview-pay>Pay ' + escapeHtml(total) + '</button>'
        + '</footer>'
        + '<p class="pay-modal-foot">Powered by Stripe · Test card pre-filled · No real charge.</p>';
      card.querySelectorAll('[data-preview-cancel]').forEach((el) => {
        el.addEventListener('click', restore);
      });
      const payBtn = card.querySelector('[data-preview-pay]');
      if (payBtn) payBtn.addEventListener('click', stageProcessing);
    };

    const stageProcessing = () => {
      card.innerHTML = ''
        + '<header class="pay-modal-hdr">'
        +   '<div class="pay-modal-eyebrow pay-preview-eyebrow">Preview mode</div>'
        +   '<h2 class="pay-modal-title">Processing payment…</h2>'
        + '</header>'
        + '<div class="pay-modal-body pay-preview-center">'
        +   '<div class="pay-preview-spinner" aria-hidden="true"></div>'
        +   '<p class="pay-preview-note">Stripe is confirming the charge. The webhook would now stamp the submission as paid.</p>'
        + '</div>';
      setTimeout(stageSuccess, 1100);
    };

    const stageSuccess = () => {
      const continueHTML = PLAN === 'ai'
        ? '<button type="button" class="btn btn-ok pay-modal-pay" data-preview-continue>Continue to knowledge base</button>'
        : '<button type="button" class="btn btn-ok pay-modal-pay" data-preview-done>Close preview</button>';
      card.innerHTML = ''
        + '<header class="pay-modal-hdr">'
        +   '<div class="pay-modal-eyebrow pay-preview-eyebrow">Preview mode</div>'
        +   '<h2 class="pay-modal-title">Payment received</h2>'
        + '</header>'
        + '<div class="pay-modal-body pay-preview-center">'
        +   '<div class="pay-preview-tick" aria-hidden="true">✓</div>'
        +   '<p class="pay-preview-success">' + escapeHtml(total) + ' charged to the test card.</p>'
        +   '<p class="pay-preview-note">' + escapeHtml(postPayCopy) + '</p>'
        + '</div>'
        + '<footer class="pay-modal-ftr pay-preview-ftr-single">'
        +   continueHTML
        + '</footer>';
      const done = card.querySelector('[data-preview-done]');
      if (done) done.addEventListener('click', () => { restore(); closePayModal(); });
      const cont = card.querySelector('[data-preview-continue]');
      if (cont) cont.addEventListener('click', () => { window.location.href = '/kb.html?preview=1'; });
    };

    stageRedirecting();
  }

  async function handleSaveLater(btn) {
    if (PREVIEW_MODE) {
      window.alert('Preview mode: save is disabled.');
      return;
    }
    if (!validatePanel(totalSteps())) return;
    if (state.uploading) { console.warn('Logo upload in progress'); return; }
    const session = loadSession();
    if (!sessionValid(session)) { showAuthGate(true); return; }

    const errEl = document.getElementById('submitErr');
    if (errEl) errEl.classList.remove('vis');

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Saving…';

    try {
      const payload = buildPayload();
      const r = await callFn('save-draft', {
        session_token: session.token,
        payload,
        last_step_completed: state.step,
        finalize: false,
      });
      if (!r.ok || !r.data || r.data.ok === false) {
        throw new Error((r.data && r.data.error) || 'Could not save draft.');
      }
      const subId = (r.data.submission && r.data.submission.id) || '';
      const ref = subId ? String(subId).replace(/-/g, '').substring(0, 8).toUpperCase() : '';
      showSavedForLater(ref);
    } catch (err) {
      console.error('Save-for-later failed:', err);
      btn.disabled = false;
      btn.innerHTML = originalLabel;
      if (errEl) errEl.classList.add('vis');
    }
  }

  function showSavedForLater(ref) {
    const done = document.getElementById('doneScreen');
    if (!done) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const fmain = document.querySelector('.fmain') || document.querySelector('main') || document.body;
    fmain.style.display = 'none';
    done.style.display = '';
    done.setAttribute('tabindex', '-1');
    setText('done-ref', ref);
    setText('done-studio', val('studioName') || 'Not provided');
    setText('done-plan', (PLAN_LABEL[state.plan] || state.plan));
    setText('done-setup', setupFeeSummaryLine());
    const titleEl = done.querySelector('.done-title');
    const descEl = done.querySelector('.done-desc');
    const timelineEl = document.getElementById('done-timeline');
    if (titleEl) titleEl.textContent = 'Draft saved. Pay when you’re ready.';
    if (descEl) descEl.textContent = 'Your setup details are saved. When you’re ready to pay, we’ll send you a secure payment link. Setup begins once payment is complete.';
    if (timelineEl) timelineEl.textContent = 'Awaiting payment';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (done.focus) done.focus();
  }

  // ── Auto-save (silent, per step nav) ──────────────────────────────────────
  let saveSeq = 0;
  function setSaveIndicator(state) {
    const el = document.getElementById('saveInd');
    if (!el) return;
    el.classList.remove('saving', 'saved', 'error', 'vis');
    if (state === 'saving') { el.textContent = 'Saving...'; el.classList.add('vis', 'saving'); }
    else if (state === 'saved') { el.textContent = 'Saved'; el.classList.add('vis', 'saved'); }
    else if (state === 'error') { el.textContent = 'Save failed'; el.classList.add('vis', 'error'); }
  }

  async function autoSave() {
    if (PREVIEW_MODE) return;  // never save in preview
    const session = loadSession();
    if (!sessionValid(session)) return;  // silent no-op if not authed yet
    const seq = ++saveSeq;
    setSaveIndicator('saving');
    try {
      const payload = buildPayload();
      const r = await callFn('save-draft', {
        session_token: session.token,
        payload,
        last_step_completed: state.step,
        finalize: false,
      });
      if (seq !== saveSeq) return;  // a newer save started, ignore this result
      if (r.status === 401) {
        clearSession();
        setSaveIndicator('error');
        showAuthGate(true);
        return;
      }
      if (!r.ok || !r.data || !r.data.ok) {
        setSaveIndicator('error');
        return;
      }
      setSaveIndicator('saved');
      // Fade after 1.5s
      setTimeout(() => {
        const el = document.getElementById('saveInd');
        if (el) el.classList.remove('vis');
      }, 1500);
    } catch (e) {
      console.warn('autoSave error:', e);
      setSaveIndicator('error');
    }
  }

  // ── Email gate (OTP) ──────────────────────────────────────────────────────
  let otpEmail = '';

  function showAuthGate(visible) {
    const gate = document.getElementById('authGate');
    const wrap = document.getElementById('formWrap');
    const signoutRow = document.getElementById('signoutRow');
    if (gate) gate.style.display = visible ? 'block' : 'none';
    if (wrap) wrap.classList.toggle('form-hidden', visible);
    if (signoutRow) signoutRow.style.display = visible ? 'none' : '';
  }

  function injectPreviewBanner() {
    if (document.getElementById('previewBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'previewBanner';
    banner.className = 'preview-banner';
    banner.innerHTML = '<strong>Preview mode</strong> · Walking through the form as a studio would see it. Nothing on this page is saved. <a href="/admin/" style="margin-left:8px;color:#fff;text-decoration:underline;">Back to admin</a>';
    document.body.insertBefore(banner, document.body.firstChild);
  }

  function ensureSignoutRow() {
    if (document.getElementById('signoutRow')) return;
    const session = loadSession();
    const email = (session && session.email) || '';
    const row = document.createElement('div');
    row.id = 'signoutRow';
    row.className = 'signout-row';
    row.style.display = 'none';
    row.innerHTML = 'Signed in as <strong style="color:var(--g6);">' + (email || '') + '</strong> · <button type="button" id="signoutBtn">Not you? Sign out</button>';
    const wrap = document.getElementById('formWrap');
    if (wrap && wrap.parentNode) wrap.parentNode.insertBefore(row, wrap);
    const btn = row.querySelector('#signoutBtn');
    if (btn) btn.addEventListener('click', signOut);
  }

  function signOut() {
    clearSession();
    // Reset form fields and reload the gate flow
    location.reload();
  }

  function showAuthStep(which) {
    const sEmail = document.getElementById('authStepEmail');
    const sCode  = document.getElementById('authStepCode');
    if (sEmail) sEmail.hidden = which !== 'email';
    if (sCode)  sCode.hidden  = which !== 'code';
  }

  function setAuthError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  async function handleSendOtp() {
    const inp = document.getElementById('authEmail');
    const btn = document.getElementById('authSendBtn');
    if (!inp || !btn) return;
    const email = (inp.value || '').trim();
    if (!isEmail(email)) { setAuthError('authEmailErr', 'Please enter a valid email address.'); return; }
    setAuthError('authEmailErr', '');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Sending...';
    const r = await callFn('send-otp', { email });
    btn.disabled = false;
    btn.innerHTML = orig;
    if (!r.ok || !r.data || !r.data.ok) {
      setAuthError('authEmailErr', (r.data && r.data.error) || 'Could not send code. Please try again.');
      return;
    }
    otpEmail = email;
    const sentEl = document.getElementById('authSentEmail');
    if (sentEl) sentEl.textContent = email;
    showAuthStep('code');
    setTimeout(() => {
      const codeInp = document.getElementById('authCode');
      if (codeInp) codeInp.focus();
    }, 50);
  }

  async function handleVerifyOtp() {
    const inp = document.getElementById('authCode');
    const btn = document.getElementById('authVerifyBtn');
    if (!inp || !btn) return;
    const code = (inp.value || '').trim();
    if (!/^\d{6}$/.test(code)) { setAuthError('authCodeErr', 'Code is 6 digits.'); return; }
    setAuthError('authCodeErr', '');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Verifying...';

    // In generic mode, omit plan and region so the server returns existing
    // drafts and a verified_token we can exchange for a session after the
    // studio picks a plan.
    const body = GENERIC_MODE
      ? { email: otpEmail, code }
      : { email: otpEmail, code, plan: PLAN, region: REGION };
    const r = await callFn('verify-otp', body);
    btn.disabled = false;
    btn.innerHTML = orig;
    if (!r.ok || !r.data || !r.data.ok) {
      setAuthError('authCodeErr', (r.data && r.data.error) || 'Verification failed.');
      return;
    }

    if (r.data.generic) {
      handleGenericVerified(r.data.verified_token, r.data.drafts || []);
      return;
    }

    storeSession(r.data.session_token, r.data.session_expires_at, otpEmail);
    enterForm(r.data.submission, Boolean(r.data.is_returning));
  }

  // Generic-mode after-OTP routing:
  //   - Existing draft(s) found → redirect to its plan/region URL with session
  //   - No draft → show plan + region picker; on selection, claim a session
  function handleGenericVerified(verifiedToken, drafts) {
    if (drafts.length > 0) {
      // Take the most-recent draft (server already sorted desc by last_saved_at)
      const d = drafts[0];
      claimAndRedirect(verifiedToken, d.plan, d.region);
      return;
    }
    showPlanPicker(verifiedToken);
  }

  async function claimAndRedirect(verifiedToken, plan, region) {
    const r = await callFn('claim-draft', { email: otpEmail, verified_token: verifiedToken, plan, region });
    if (!r.ok || !r.data || !r.data.ok) {
      setAuthError('authCodeErr', (r.data && r.data.error) || 'Could not load your account.');
      return;
    }
    storeSession(r.data.session_token, r.data.session_expires_at, otpEmail);
    // Redirect to canonical URL for that plan + region
    const target = '/setup/?plan=' + encodeURIComponent(plan) + '&region=' + encodeURIComponent(region);
    if (window.location.pathname.startsWith('/setup') && _urlPlan === plan && _urlRegion === region) {
      // Already on the right page, just hide gate and reveal form
      enterForm(r.data.submission, true);
    } else {
      window.location.href = target;
    }
  }

  function showPlanPicker(verifiedToken) {
    const card = document.querySelector('#authGate .auth-card');
    if (!card) return;
    card.innerHTML = ''
      + '<div class="auth-icon" aria-hidden="true">' + '<img src="/assets/growth-logo.svg" alt="StudioLAB Growth">' + '</div>'
      + '<h2 class="auth-title">Pick your plan</h2>'
      + '<p class="auth-desc">We could not find an existing setup for that email. Choose your plan and region to begin a fresh one. You can always change plans later.</p>'
      + '<div class="picker-group" role="radiogroup" aria-label="Region">'
      +   '<div class="picker-label">Region</div>'
      +   '<div class="picker-row">'
      +     '<label class="picker-card sel"><input type="radio" name="pickRegion" value="AU" checked><span>Australia (AUD)</span></label>'
      +     '<label class="picker-card"><input type="radio" name="pickRegion" value="US"><span>US / International (USD)</span></label>'
      +   '</div>'
      + '</div>'
      + '<div class="picker-group" role="radiogroup" aria-label="Plan">'
      +   '<div class="picker-label">Plan</div>'
      +   '<div class="picker-row picker-stack">'
      +     '<label class="picker-card sel"><input type="radio" name="pickPlan" value="launch" checked><span><strong>Launch</strong> · Email automation</span></label>'
      +     '<label class="picker-card"><input type="radio" name="pickPlan" value="scale"><span><strong>Scale</strong> · Email + SMS + lead tracking</span></label>'
      +     '<label class="picker-card"><input type="radio" name="pickPlan" value="ai"><span><strong>Dominate AI</strong> · Everything plus AI chat and voice</span></label>'
      +   '</div>'
      + '</div>'
      + '<button type="button" class="btn btn-p auth-btn" id="pickerContinueBtn">Continue</button>';
    // Wire selection styling
    card.querySelectorAll('.picker-card input[type="radio"]').forEach((rb) => {
      rb.addEventListener('change', (e) => {
        const name = e.target.name;
        card.querySelectorAll('input[name="' + name + '"]').forEach((other) => {
          const lbl = other.closest('.picker-card');
          if (lbl) lbl.classList.toggle('sel', other.checked);
        });
      });
    });
    const cont = card.querySelector('#pickerContinueBtn');
    if (cont) cont.addEventListener('click', () => {
      const plan = card.querySelector('input[name="pickPlan"]:checked').value;
      const region = card.querySelector('input[name="pickRegion"]:checked').value;
      cont.disabled = true;
      cont.innerHTML = '<span class="spinner" aria-hidden="true"></span> Loading...';
      claimAndRedirect(verifiedToken, plan, region);
    });
  }

  function handleResendOrChange() {
    showAuthStep('email');
    setAuthError('authEmailErr', '');
    setAuthError('authCodeErr', '');
  }

  function applyGatePlanName() {
    const el = document.getElementById('authPlanName');
    if (!el) return;
    const map = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
    el.textContent = map[PLAN] || 'Growth';
  }

  function bindAuthGate() {
    applyGatePlanName();
    const send = document.getElementById('authSendBtn');
    const verify = document.getElementById('authVerifyBtn');
    const resend = document.getElementById('authResendBtn');
    if (send) send.addEventListener('click', handleSendOtp);
    if (verify) verify.addEventListener('click', handleVerifyOtp);
    if (resend) resend.addEventListener('click', handleResendOrChange);
    // Submit-on-enter for both forms
    const ein = document.getElementById('authEmail');
    if (ein) ein.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendOtp(); } });
    const cin = document.getElementById('authCode');
    if (cin) {
      cin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleVerifyOtp(); } });
      cin.addEventListener('input', (e) => {
        // Strip non-digits, max 6
        e.target.value = e.target.value.replace(/\D+/g, '').slice(0, 6);
      });
    }
  }

  // ── Hydrate form from saved draft and reveal ──────────────────────────────
  function hydrateFromSubmission(sub) {
    if (!sub) return;
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (el && v != null && v !== '') el.value = v;
    };
    [
      'studioName','legalName','country','timezone','studioType','address','website',
      'firstName','lastName','contactPhone','contactRole',
      'col1t','col2t','fromName','replyEmail','emailDomain',
      'smsType','portNum','twilioNumber',
      'googleBusinessUrl','facebookUrl','instagramHandle','bookingUrl',
      'tiktokHandle','youtubeUrl',
      'kb-profile','kb-classes','kb-pricing','kb-policies','kb-events','kb-restricted','kb-tone',
      'voiceHours','voiceEscalate','extraNotes',
    ].forEach((id) => setVal(id, sub[idToColumn(id)]));
    // Two-line signature: split the legacy single-string column on newline so
    // older drafts hydrate cleanly into the new UI.
    if (sub.sign_off) {
      const lines = String(sub.sign_off).split(/\r?\n/);
      setVal('signOffLine1', lines[0] || '');
      setVal('signOffLine2', lines.slice(1).join(' ').trim());
    }
    // Lock the contact email display if it exists in the form (it does in Step 2)
    const ce = document.getElementById('contactEmail');
    if (ce && sub.contact_email) {
      ce.value = sub.contact_email;
      ce.readOnly = true;
      ce.style.background = 'var(--g1)';
    }
    // Hydrating a draft programmatically doesn't fire input events, so trigger
    // the autofill chain manually to populate from-name / sign-off / reply-to
    // if those were left blank.
    refreshAutoFill();
    syncSignOff();
    // Restore setup type if present
    if (sub.setup_type) selectSetup(sub.setup_type);
    // Restore yn states
    if (sub.custom_domain != null) {
      const btn = document.querySelector('[data-yn="dns"][data-val="' + (sub.custom_domain ? 'true' : 'false') + '"]');
      if (btn) handleYn(btn);
    }
    if (sub.kb_price_quoting != null) {
      const btn = document.querySelector('[data-yn="quotePrice"][data-val="' + (sub.kb_price_quoting ? 'true' : 'false') + '"]');
      if (btn) handleYn(btn);
    }
    if (sub.has_twilio != null) {
      const cb = document.getElementById('hasTwilio');
      if (cb) {
        cb.checked = !!sub.has_twilio;
        const row = document.getElementById('twilioRow');
        if (row) row.style.display = cb.checked ? '' : 'none';
      }
    }
    if (Array.isArray(sub.lead_sources)) {
      $$('input[data-lead]').forEach((cb) => {
        cb.checked = sub.lead_sources.indexOf(cb.value) >= 0;
        const lbl = cb.closest('.tg');
        if (lbl) lbl.classList.toggle('chk', cb.checked);
      });
    }
    if (sub.logo_url) {
      state.logoUrl = sub.logo_url;
      // Surface that we have a logo on file. We don't have a public URL to
      // render the thumbnail without a signed-URL round trip, so just show
      // the filename hint and reveal the Remove button.
      const fn = document.getElementById('logoFn');
      const removeBtn = document.getElementById('logoRemoveBtn');
      if (fn) fn.textContent = 'Logo on file. Upload a new one to replace.';
      if (removeBtn) removeBtn.hidden = false;
    }
    applyCountryToTimezone();
  }

  // Mapping JS field IDs (camelCase) to DB column names (snake_case)
  function idToColumn(id) {
    const map = {
      studioName: 'studio_name', legalName: 'legal_name', studioType: 'studio_type',
      firstName: 'first_name', lastName: 'last_name', contactPhone: 'contact_phone',
      contactRole: 'role', col1t: 'primary_colour', col2t: 'secondary_colour',
      signOff: 'sign_off', fromName: 'from_name', replyEmail: 'reply_email',
      emailDomain: 'email_domain', smsType: 'sms_type', portNum: 'port_number',
      twilioNumber: 'twilio_number',
      'kb-profile': 'kb_profile', 'kb-classes': 'kb_classes', 'kb-pricing': 'kb_pricing',
      'kb-policies': 'kb_policies', 'kb-events': 'kb_events', 'kb-restricted': 'kb_restricted',
      'kb-tone': 'kb_tone', voiceHours: 'voice_hours', voiceEscalate: 'voice_escalate',
      extraNotes: 'extra_notes',
      googleBusinessUrl: 'google_business_url', facebookUrl: 'facebook_url',
      instagramHandle: 'instagram_handle', bookingUrl: 'booking_url',
      tiktokHandle: 'tiktok_handle', youtubeUrl: 'youtube_url',
    };
    return map[id] || id;
  }

  function enterForm(submission, isReturning) {
    // Hide gate, reveal form
    showAuthGate(false);
    if (submission) hydrateFromSubmission(submission);
    if (isReturning) {
      const banner = document.getElementById('restoredBanner');
      if (banner) banner.classList.add('vis');
    }
    // Jump to last completed step (or 1 for new)
    const target = Math.max(1, Math.min(totalSteps(), (submission && submission.last_step_completed) || 1));
    goTo(target);
  }

  // ── ARIA wiring for field-level errors ────────────────────────────────────
  // For every .f containing an input and a .field-err, give the error span an
  // id and point aria-describedby at it. Inputs start with aria-invalid="false".
  function wireFieldErrors() {
    let n = 0;
    $$('.f').forEach((wrap) => {
      const err = wrap.querySelector('.field-err');
      if (!err) return;
      if (!err.id) err.id = 'ferr-' + (++n);
      $$('input, select, textarea', wrap).forEach((inp) => {
        if (inp.type === 'hidden') return;
        const existing = inp.getAttribute('aria-describedby') || '';
        if (!existing.split(/\s+/).includes(err.id)) {
          inp.setAttribute('aria-describedby', (existing + ' ' + err.id).trim());
        }
        if (!inp.hasAttribute('aria-invalid')) inp.setAttribute('aria-invalid', 'false');
      });
    });
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  function bindEvents() {
    document.addEventListener('click', (e) => {
      // Plan & setup label clicks: the label[for] mechanism fires the radio's
      // change event, so we route selection through that. We still need to
      // intercept label clicks when the click landed on a child element so the
      // current visual state syncs immediately on mouse-up.
      const planCard = e.target.closest('.plan-card');
      if (planCard) { selectPlan(planCard.dataset.plan); return; }

      const setupCard = e.target.closest('.setup-card');
      if (setupCard) { selectSetup(setupCard.dataset.setup); return; }

      const yn = e.target.closest('.yn-b');
      if (yn) { handleYn(yn); return; }

      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.dataset.action;
        if (action === 'next') nextStep();
        else if (action === 'prev') prevStep();
        else if (action === 'submit') handlePayAndSubmit(actionBtn);
        else if (action === 'add-faq') addFaqRow();
        else if (action === 'del-faq') delFaqRow(actionBtn);
        return;
      }

      // Review-step Edit buttons jump back to the matching step.
      const editBtn = e.target.closest('[data-edit-step]');
      if (editBtn) {
        const target = parseInt(editBtn.dataset.editStep, 10);
        if (target && target >= 1 && target <= totalSteps()) goTo(target);
        return;
      }

      const stepPill = e.target.closest('.sp');
      if (stepPill && !stepPill.disabled) {
        const target = parseInt(stepPill.dataset.s, 10);
        if (target && target <= state.step) goTo(target);
        return;
      }
    });

    // Change events catch keyboard activation on radios and checkboxes.
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('input[name="plan"]')) selectPlan(t.value);
      else if (t.matches('input[name="setup"]')) selectSetup(t.value);
      else if (t.matches('.tg input[type="checkbox"]')) {
        const label = t.closest('.tg');
        if (label) label.classList.toggle('chk', t.checked);
      } else if (t.id === 'logoFile') handleLogoChange(t);
      else if (t.id === 'smsType') {
        const row = document.getElementById('portRow');
        if (row) row.style.display = t.value === 'existing' ? '' : 'none';
      }
      else if (t.id === 'hasTwilio') {
        const row = document.getElementById('twilioRow');
        if (row) row.style.display = t.checked ? '' : 'none';
      }
      else if (t.id === 'country') applyCountryToTimezone();
    });

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches && t.matches('input, select, textarea')) clearFieldErr(t);
      // Mark a target field as user-edited the first time the studio types
      // in it directly. Auto-fill stops touching it from that point on.
      if (t && t.id && AUTOFILL_TARGETS.has(t.id) && !t.dataset.autofill) {
        t.dataset.userEdited = '1';
      }
      // Source fields drive derived defaults on every keystroke. Cheap.
      if (t && t.id && AUTOFILL_SOURCES.has(t.id)) refreshAutoFill();
      // Sign-off preview reflects either line edit.
      if (t && (t.id === 'signOffLine1' || t.id === 'signOffLine2')) syncSignOff();
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('.yn-b')) handleYnKey(e);
    });

    bindColourSync('col1p', 'col1t');
    bindColourSync('col2p', 'col2t');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    wireFieldErrors();
    renderSetupCards();
    applyRegionDefaults();
    bindEvents();
    bindAuthGate();
    bindLogoZone();
    bindBrandRefZone();
    // Plan is locked by the URL the form is served from. No selectPlan call here.
    selectSetup('dfy');
    const c1 = document.getElementById('col1t');
    if (c1 && !c1.value) c1.value = document.getElementById('col1p').value.toUpperCase();
    const c2 = document.getElementById('col2t');
    if (c2 && !c2.value) c2.value = document.getElementById('col2p').value.toUpperCase();
    // Seed yn-b roving tabindex: first button in each group is tabbable.
    $$('.yn').forEach((group) => {
      const btns = $$('.yn-b', group);
      btns.forEach((b, i) => { b.tabIndex = i === 0 ? 0 : -1; });
    });

    ensureSignoutRow();

    // Preview mode: admin walkthrough. Skip gate entirely, drop a banner up
    // top, disable auto-save and submit. Used from the admin dashboard's
    // 'Preview a studio form' link.
    if (PREVIEW_MODE) {
      showAuthGate(false);
      injectPreviewBanner();
      goTo(1);
      return;
    }

    // Auth check: existing session in localStorage? Synchronous check first,
    // then async validation against save-draft (which now returns the row so
    // we can hydrate fields and jump to last completed step).
    const session = loadSession();
    if (sessionValid(session)) {
      // Optimistically reveal the form so there's no gate flicker.
      showAuthGate(false);
      const r = await callFn('save-draft', {
        session_token: session.token,
        payload: {},
        last_step_completed: undefined,
        finalize: false,
      });
      if (r.ok && r.data && r.data.ok && r.data.submission) {
        hydrateFromSubmission(r.data.submission);
        const target = Math.max(1, Math.min(totalSteps(), r.data.submission.last_step_completed || 1));
        goTo(target);
        return;
      } else if (r.status === 401) {
        clearSession();
        showAuthGate(true);
        showAuthStep('email');
        goTo(1);
        return;
      }
      // Network or unknown error: assume session valid but couldn't hydrate.
      // Show form at step 1 and let auto-save take over from here.
      goTo(1);
      return;
    }

    // No valid session: show gate, hide form
    showAuthGate(true);
    showAuthStep('email');
    goTo(1); // ready underneath the gate
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
