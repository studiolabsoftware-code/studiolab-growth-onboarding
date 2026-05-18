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

  // Decide where a returning studio lands after OTP.
  //
  // The rule is "if they've moved past the form, do not throw them back
  // into the form." Before this fix, a paid + fully submitted studio
  // who signed in from the home page was routed straight back to the
  // per-plan wizard, which then refused to save their edits because
  // save-draft locks post-submit -- a dead-end experience.
  //
  // Order matters:
  //   1. Active / complete -> account.html (their handover landing).
  //   2. AI + paid, KB not finished -> kb.html (the one place where the
  //      form-style flow still has work to do post-payment).
  //   3. Any non-draft status -> account.html (the canonical portal for
  //      submitted studios, paid or not; renderNotPaidYet handles the
  //      "still need to pay" case inside the page).
  //   4. Otherwise -> per-plan form (genuine new draft).
  const PAID_STATUSES = new Set(['paid', 'authorised', 'card_saved']);
  const POST_SUBMIT_STATUSES = new Set([
    'submitted', 'in_review', 'changes_requested', 'setup_in_progress',
    'complete', 'active',
  ]);
  function routeFor(submission, plan, region) {
    if (!submission) return destinationUrl(plan, region);
    const status = submission.status || 'draft';
    if (status === 'active' || status === 'complete') return '/account.html';
    if (
      plan === 'ai'
      && PAID_STATUSES.has(submission.payment_status)
      && !submission.kb_completed_at
    ) {
      return '/kb.html';
    }
    if (POST_SUBMIT_STATUSES.has(status)) return '/account.html';
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

    // If the user already has a live session, route them based on what
    // the server says about their submission -- not on URL params. Prior
    // behaviour skipped the gate and dumped them straight into the form
    // even when status was already submitted/paid, which felt like
    // restarting from scratch. account.html is the canonical surface
    // for any returning studio; it owns the "pick up where you left off"
    // copy for unpaid drafts and the full portal for paid/submitted.
    const session = (function () {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
      catch (_) { return null; }
    })();
    if (session && session.token && session.expiresAt && new Date(session.expiresAt) > new Date()) {
      (async () => {
        try {
          const r = await callFn('get-studio-account', { session_token: session.token });
          if (r.ok && r.data && r.data.ok && r.data.submission) {
            window.location.href = routeFor(r.data.submission, r.data.submission.plan, r.data.submission.region);
            return;
          }
        } catch (_) { /* fall through to gate */ }
        // get-studio-account failed (likely session no longer matches a
        // submission): leave them on the gate so they can re-OTP.
      })();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
