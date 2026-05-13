/* StudioLAB Growth: /setup gateway. This is a gate-only page that resolves a
   studio's plan and region (either from URL params or by looking up their
   existing draft after OTP verification) and then redirects to the canonical
   per-plan form URL with their session intact. */

(function () {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const URL_PLAN = (params.get('plan') || '').toLowerCase();
  const URL_REGION = (params.get('region') || '').toUpperCase();
  const PLAN_LABELS = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
  const PLAN_MINS   = { launch: '5', scale: '10', ai: '15' };
  const ALLOWED_PLANS  = new Set(['launch', 'scale', 'ai']);
  const ALLOWED_REGIONS = new Set(['AU', 'US']);

  const SB_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '';
  const FN_BASE = SB_URL + '/functions/v1/';
  const SESSION_KEY = 'sl-growth-session';

  let otpEmail = '';

  // ── Helpers ────────────────────────────────────────────────────────────────
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  function $(id) { return document.getElementById(id); }
  function setErr(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }
  function showStep(which) {
    const e = $('authStepEmail'), c = $('authStepCode');
    if (e) e.hidden = which !== 'email';
    if (c) c.hidden = which !== 'code';
  }
  async function callFn(name, body) {
    const resp = await fetch(FN_BASE + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await resp.json(); } catch (_) {}
    return { ok: resp.ok, status: resp.status, data: data || {} };
  }
  function storeSession(token, expiresAt, email) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt, email }));
  }

  function destinationUrl(plan, region) {
    const r = String(region || 'AU').toLowerCase();
    return '/' + r + '/' + plan + '/';
  }

  // Decide where a returning studio lands after OTP. The default is the
  // per-plan setup form, but a Dominate AI studio who has already paid
  // belongs on /kb.html — the form is behind them at that point. kb.html
  // itself handles the "KB already finalised" state, so we route there
  // whether or not kb_completed_at is set.
  const PAID_STATUSES = new Set(['paid', 'authorised', 'card_saved']);
  function routeFor(submission, plan, region) {
    if (submission && plan === 'ai' && PAID_STATUSES.has(submission.payment_status)) {
      return '/kb.html';
    }
    return destinationUrl(plan, region);
  }

  // ── Gate copy: plan-aware when URL specifies a plan ──────────────────────
  function applyPlanAwareCopy() {
    if (!ALLOWED_PLANS.has(URL_PLAN)) return;
    const title = $('authTitle');
    const sub   = $('authSubhead');
    const hint  = $('authNeedsHint');
    const hdr   = $('hdrSub');
    const label = PLAN_LABELS[URL_PLAN];
    const mins  = PLAN_MINS[URL_PLAN];
    if (title) title.textContent = "Let's get you set up";
    if (sub)   sub.innerHTML = "You're setting up your <strong>" + label + "</strong> account. This takes about " + mins + " minutes and we will walk you through each step.";
    if (hint)  hint.hidden = false;
    if (hdr)   hdr.textContent = label + ' Setup';
  }

  // ── OTP send ───────────────────────────────────────────────────────────────
  async function handleSend() {
    const inp = $('authEmail');
    const btn = $('authSendBtn');
    if (!inp || !btn) return;
    const email = (inp.value || '').trim();
    if (!isEmail(email)) { setErr('authEmailErr', 'Please enter a valid email address.'); return; }
    setErr('authEmailErr', '');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Sending...';
    const r = await callFn('send-otp', { email });
    btn.disabled = false;
    btn.innerHTML = orig;
    if (!r.ok || !r.data || !r.data.ok) {
      setErr('authEmailErr', (r.data && r.data.error) || 'Could not send code. Please try again.');
      return;
    }
    otpEmail = email;
    const sentEl = $('authSentEmail');
    if (sentEl) sentEl.textContent = email;
    showStep('code');
    setTimeout(() => { const ci = $('authCode'); if (ci) ci.focus(); }, 50);
  }

  // ── OTP verify ─────────────────────────────────────────────────────────────
  async function handleVerify() {
    const inp = $('authCode');
    const btn = $('authVerifyBtn');
    if (!inp || !btn) return;
    const code = (inp.value || '').trim();
    if (!/^\d{6}$/.test(code)) { setErr('authCodeErr', 'Code is 6 digits.'); return; }
    setErr('authCodeErr', '');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Verifying...';

    const planSpecific = ALLOWED_PLANS.has(URL_PLAN) && ALLOWED_REGIONS.has(URL_REGION);
    const body = planSpecific
      ? { email: otpEmail, code, plan: URL_PLAN, region: URL_REGION }
      : { email: otpEmail, code };
    const r = await callFn('verify-otp', body);
    btn.disabled = false;
    btn.innerHTML = orig;
    if (!r.ok || !r.data || !r.data.ok) {
      setErr('authCodeErr', (r.data && r.data.error) || 'Verification failed.');
      return;
    }

    if (r.data.generic) {
      // No plan in URL — route based on existing drafts
      const drafts = r.data.drafts || [];
      if (drafts.length > 0) {
        const d = drafts[0];
        await claimAndGo(r.data.verified_token, d.plan, d.region);
      } else {
        showPicker(r.data.verified_token);
      }
      return;
    }

    // Plan-specific verify succeeded — store session and redirect
    storeSession(r.data.session_token, r.data.session_expires_at, otpEmail);
    window.location.href = routeFor(r.data.submission, URL_PLAN, URL_REGION);
  }

  async function claimAndGo(verifiedToken, plan, region) {
    const r = await callFn('claim-draft', { email: otpEmail, verified_token: verifiedToken, plan, region });
    if (!r.ok || !r.data || !r.data.ok) {
      setErr('authCodeErr', (r.data && r.data.error) || 'Could not load your account.');
      return;
    }
    storeSession(r.data.session_token, r.data.session_expires_at, otpEmail);
    window.location.href = routeFor(r.data.submission, plan, region);
  }

  // ── Plan + region picker (shown when no draft found in generic mode) ──────
  function showPicker(verifiedToken) {
    const card = document.querySelector('#authGate .auth-card');
    if (!card) return;
    card.innerHTML = ''
      + '<div class="auth-icon" aria-hidden="true">' + '<img src="/assets/growth-logo.svg" alt="StudioLAB Growth">' + '</div>'
      + '<h2 class="auth-title">Pick your plan to start</h2>'
      + '<p class="auth-desc">We could not find an existing setup for that email. Choose your plan and region to begin a fresh one.</p>'
      + '<div class="picker-group" role="radiogroup" aria-label="Region">'
      +   '<div class="picker-label">Region</div>'
      +   '<div class="picker-row">'
      +     '<label class="picker-card sel"><input type="radio" name="pickRegion" value="AU" checked><span>Australia <span style="color:var(--g4);font-weight:500;">(AUD)</span></span></label>'
      +     '<label class="picker-card"><input type="radio" name="pickRegion" value="US"><span>US / International <span style="color:var(--g4);font-weight:500;">(USD)</span></span></label>'
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
      claimAndGo(verifiedToken, plan, region);
    });
  }

  function handleResend() {
    showStep('email');
    setErr('authEmailErr', '');
    setErr('authCodeErr', '');
  }

  function bind() {
    const send = $('authSendBtn');
    const verify = $('authVerifyBtn');
    const resend = $('authResendBtn');
    if (send) send.addEventListener('click', handleSend);
    if (verify) verify.addEventListener('click', handleVerify);
    if (resend) resend.addEventListener('click', handleResend);
    const ein = $('authEmail');
    if (ein) ein.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } });
    const cin = $('authCode');
    if (cin) {
      cin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleVerify(); } });
      cin.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D+/g, '').slice(0, 6);
      });
    }
  }

  function init() {
    applyPlanAwareCopy();
    bind();

    // If user already has a session and a plan+region in URL, send them
    // straight to the destination (skip gate).
    const session = (function () {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
      catch (_) { return null; }
    })();
    if (session && session.token && session.expiresAt && new Date(session.expiresAt) > new Date()) {
      if (ALLOWED_PLANS.has(URL_PLAN) && ALLOWED_REGIONS.has(URL_REGION)) {
        window.location.href = destinationUrl(URL_PLAN, URL_REGION);
        return;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
