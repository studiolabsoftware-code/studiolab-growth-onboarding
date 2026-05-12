/* StudioLAB Growth Onboarding: public form behaviour.
   Event delegation on data-* attributes keeps the HTML declarative.
   This file owns state, validation, ARIA wiring, and the Supabase write. */

(function () {
  'use strict';

  // Plan is locked by the URL each form is served from. window.PLAN is set in
  // launch/, scale/, and ai/ before this script loads. Total step count is read
  // from the DOM so each plan-specific HTML can carry only the panels it needs.
  const PLAN = window.PLAN || 'launch';
  const totalSteps = () => document.querySelectorAll('.panel').length;

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
  }

  function prevStep() {
    if (state.step === 1) return;
    goTo(state.step - 1);
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
    setSum('sv-setup', SETUP_LABEL[state.setup] || state.setup);
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
      website: valOrNull('website'),
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
    setText('done-setup', SETUP_LABEL[state.setup] || state.setup);
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
    if (!validatePanel(8)) return;
    if (state.uploading) {
      console.warn('Logo upload still in progress, please wait.');
      return;
    }

    const errEl = document.getElementById('submitErr');
    if (errEl) errEl.classList.remove('vis');

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Submitting...';

    try {
      if (!sb) throw new Error('Supabase client not initialised. Check js/supabase-config.js.');
      const payload = buildPayload();
      const { data, error } = await sb
        .from('submissions')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      const ref = String(data.id).replace(/-/g, '').substring(0, 8).toUpperCase();
      showDone(ref);
    } catch (err) {
      console.error('Submission failed:', err);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = originalLabel;
      if (errEl) errEl.classList.add('vis');
    }
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
  function init() {
    wireFieldErrors();
    bindEvents();
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
    goTo(1);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
