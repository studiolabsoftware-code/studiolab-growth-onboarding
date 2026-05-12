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
      desc:  'You configure your own account using our step-by-step checklist, with support available if you get stuck. Delivered within 3 to 5 business days.',
    },
    dfy_default: {
      label: 'Done-For-You',
      desc:  'Our team configures your entire account. You provide the information, we handle everything else. Delivered within 5 to 7 business days.',
    },
    dfy_ai: {
      label: 'AI Activation Pack',
      desc:  'Full Done-For-You configuration plus knowledge base build, AI chat setup, voice agent setup and testing, and a live walkthrough. Delivered within 7 to 10 business days.',
    },
  };

  const state = {
    step: 1,
    plan: PLAN,
    setup: 'dfy',
    yn: { dns: null, season: null, quotePrice: null },
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
    if (n === total) buildSummary();
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
    if (!validatePanel(state.step)) return;
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
  async function handleLogoChange(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const fn = document.getElementById('logoFn');
    const spin = document.getElementById('logoSpin');
    if (fn) fn.classList.remove('vis');
    if (spin) spin.classList.add('vis');
    state.uploading = true;

    if (!sb) {
      state.logoUrl = null;
      state.uploading = false;
      if (spin) spin.classList.remove('vis');
      if (fn) { fn.textContent = file.name + ' (upload pending Supabase config)'; fn.classList.add('vis'); }
      return;
    }

    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = crypto.randomUUID() + '.' + ext;
      const bucket = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.logoBucket) || 'logos';
      const { error } = await sb.storage.from(bucket).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      });
      if (error) throw error;
      state.logoUrl = bucket + '/' + path;
      if (fn) { fn.textContent = file.name + ' uploaded'; fn.classList.add('vis'); }
    } catch (err) {
      console.error('Logo upload failed:', err);
      state.logoUrl = null;
      if (fn) { fn.textContent = 'Upload failed, please try again.'; fn.classList.add('vis'); }
    } finally {
      state.uploading = false;
      if (spin) spin.classList.remove('vis');
    }
  }

  // ── Collectors ────────────────────────────────────────────────────────────
  function collectWorkflows() {
    const out = [];
    $$('input[data-workflow]').forEach((cb) => {
      const label = cb.closest('label');
      if (!label) return;
      if (!isVisible(label)) return;
      if (cb.checked) out.push(cb.value);
    });
    return out;
  }

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
    setSum('sv-setup', setupFeeSummaryLine());
    setSum('sv-studio', val('studioName'));
    setSum('sv-country', val('country'));
    const fn = val('firstName'), ln = val('lastName');
    setSum('sv-contact', (fn + ' ' + ln).trim() || 'Not provided');
    setSum('sv-email', val('contactEmail'));
    setSum('sv-phone', val('contactPhone'));
    setSum('sv-website', val('website'));
    setSum('sv-logo', state.logoUrl ? 'Uploaded' : 'Not provided');
    setSum('sv-col1', val('col1t'));
    setSum('sv-signoff', val('signOff'));
    setSum('sv-tone', val('tone'));
    setSum('sv-fromname', val('fromName'));
    setSum('sv-replyto', val('replyEmail'));
    const dns = state.yn.dns;
    setSum('sv-domain', dns === true ? (val('emailDomain') || 'Yes') : (dns === false ? 'No, built-in email' : 'Not provided'));
    const season = state.yn.season;
    setSum('sv-season', season === true ? (val('seasonName') || 'Yes') : (season === false ? 'Not yet' : 'Not provided'));
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
      area_code: isScalePlus ? valOrNull('areaCode') : null,
      port_number: isScalePlus ? valOrNull('portNum') : null,
      sms_tone: isScalePlus ? valOrNull('smsTone') : null,
      lead_sources: isScalePlus ? collectLeads() : null,

      season_active: state.yn.season,
      season_name: state.yn.season ? valOrNull('seasonName') : null,
      enrol_open_date: state.yn.season ? valOrNull('enrollOpenDate') : null,
      billing_start: state.yn.season ? valOrNull('billingStart') : null,
      season_end: state.yn.season ? valOrNull('seasonEnd') : null,
      active_workflows: collectWorkflows(),

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
      : '3 to 7 business days');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  async function handleSubmit(btn) {
    const hp = document.getElementById('hp-company');
    if (hp && hp.value.trim()) {
      showDone('SPAMTRAP');
      return;
    }
    if (!validatePanel(totalSteps())) return;
    if (state.uploading) {
      console.warn('Logo upload still in progress, please wait.');
      return;
    }
    const session = loadSession();
    if (!sessionValid(session)) {
      console.error('Session expired before submit.');
      showAuthGate(true);
      return;
    }

    const errEl = document.getElementById('submitErr');
    if (errEl) errEl.classList.remove('vis');

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Submitting...';

    try {
      const payload = buildPayload();
      const r = await callFn('save-draft', {
        session_token: session.token,
        payload,
        last_step_completed: state.step,
        finalize: true,
      });
      if (!r.ok || !r.data || !r.data.ok) {
        throw new Error(r.data && r.data.error ? r.data.error : 'Submit failed');
      }
      const ref = r.data.ref || (r.data.submission_id ? String(r.data.submission_id).replace(/-/g, '').substring(0, 8).toUpperCase() : '');
      clearSession();
      showDone(ref);
    } catch (err) {
      console.error('Submission failed:', err);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = originalLabel;
      if (errEl) errEl.classList.add('vis');
    }
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
      + '<div class="auth-icon" aria-hidden="true">'
      +   '<span class="sl-mark">SL</span>'
      + '</div>'
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
      'col1t','col2t','signOff','fromName','replyEmail','emailDomain',
      'smsType','portNum',
      'seasonName','enrollOpenDate','billingStart','seasonEnd',
      'kb-profile','kb-classes','kb-pricing','kb-policies','kb-events','kb-restricted','kb-tone',
      'voiceHours','voiceEscalate','extraNotes',
    ].forEach((id) => setVal(id, sub[idToColumn(id)]));
    // Lock the contact email display if it exists in the form (it does in Step 2)
    const ce = document.getElementById('contactEmail');
    if (ce && sub.contact_email) {
      ce.value = sub.contact_email;
      ce.readOnly = true;
      ce.style.background = 'var(--g1)';
    }
    // Restore setup type if present
    if (sub.setup_type) selectSetup(sub.setup_type);
    // Restore yn states
    if (sub.custom_domain != null) {
      const btn = document.querySelector('[data-yn="dns"][data-val="' + (sub.custom_domain ? 'true' : 'false') + '"]');
      if (btn) handleYn(btn);
    }
    if (sub.season_active != null) {
      const btn = document.querySelector('[data-yn="season"][data-val="' + (sub.season_active ? 'true' : 'false') + '"]');
      if (btn) handleYn(btn);
    }
    if (sub.kb_price_quoting != null) {
      const btn = document.querySelector('[data-yn="quotePrice"][data-val="' + (sub.kb_price_quoting ? 'true' : 'false') + '"]');
      if (btn) handleYn(btn);
    }
    // Restore workflow checkboxes
    if (Array.isArray(sub.active_workflows)) {
      $$('input[data-workflow]').forEach((cb) => {
        cb.checked = sub.active_workflows.indexOf(cb.value) >= 0;
        const lbl = cb.closest('.tg');
        if (lbl) lbl.classList.toggle('chk', cb.checked);
      });
    }
    if (Array.isArray(sub.lead_sources)) {
      $$('input[data-lead]').forEach((cb) => {
        cb.checked = sub.lead_sources.indexOf(cb.value) >= 0;
        const lbl = cb.closest('.tg');
        if (lbl) lbl.classList.toggle('chk', cb.checked);
      });
    }
    if (sub.logo_url) state.logoUrl = sub.logo_url;
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
      seasonName: 'season_name', enrollOpenDate: 'enrol_open_date',
      billingStart: 'billing_start', seasonEnd: 'season_end',
      'kb-profile': 'kb_profile', 'kb-classes': 'kb_classes', 'kb-pricing': 'kb_pricing',
      'kb-policies': 'kb_policies', 'kb-events': 'kb_events', 'kb-restricted': 'kb_restricted',
      'kb-tone': 'kb_tone', voiceHours: 'voice_hours', voiceEscalate: 'voice_escalate',
      extraNotes: 'extra_notes',
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
        else if (action === 'submit') handleSubmit(actionBtn);
        else if (action === 'add-faq') addFaqRow();
        else if (action === 'del-faq') delFaqRow(actionBtn);
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
      else if (t.id === 'country') applyCountryToTimezone();
    });

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches && t.matches('input, select, textarea')) clearFieldErr(t);
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
