/* Admin auth: custom 6-digit OTP via Mailgun, mirroring the studio flow.
   Edge Functions send-otp + verify-admin-otp do the heavy lifting; the latter
   mints a real Supabase Auth session so all subsequent queries run with the
   authenticated role and the existing RLS policies just work. */

(function () {
  'use strict';

  const sb = window.initSupabase ? window.initSupabase() : null;
  const SB_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '';
  const FN_BASE = SB_URL + '/functions/v1/';
  const ADMIN_JWT_KEY = window.ADMIN_JWT_KEY;
  const ADMIN_REFRESH_KEY = 'sl-admin-refresh';

  window.AdminAuth = { currentUser: null, profile: null, sb };

  // ── JWT refresh ────────────────────────────────────────────────────────
  // The Supabase access token verify-admin-otp hands out lives for one
  // hour. Without explicit refresh, the admin gets silently logged out
  // mid-session: queries start returning 401, the dashboard renders as
  // empty, and the only fix is a manual reload. We trade that for a
  // proactive refresh loop here — well before expiry we POST the stored
  // refresh_token to Supabase Auth, swap in the new access_token, and
  // null the cached supabase-js client so subsequent calls pick it up.
  let refreshTimer = null;

  async function refreshAdminSession() {
    let refresh;
    try { refresh = localStorage.getItem(ADMIN_REFRESH_KEY); } catch (_) { refresh = null; }
    if (!refresh) return false;
    try {
      const resp = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': window.SUPABASE_CONFIG.anonKey,
        },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!resp.ok) return false;
      const data = await resp.json().catch(() => null);
      if (!data || !data.access_token) return false;
      try {
        localStorage.setItem(ADMIN_JWT_KEY, data.access_token);
        if (data.refresh_token) localStorage.setItem(ADMIN_REFRESH_KEY, data.refresh_token);
      } catch (_) { /* ignore */ }
      // Force the supabase-js client to be re-built with the new JWT on
      // the next sb() call. Existing in-flight queries keep the old token
      // (Supabase still accepts it until its own expiry).
      window._sbClient = null;
      if (window.initSupabase) window.initSupabase();
      return true;
    } catch (e) {
      console.warn('admin refresh failed:', e);
      return false;
    }
  }

  function scheduleProactiveRefresh(info) {
    if (refreshTimer) clearTimeout(refreshTimer);
    const msToExp = (info.payload.exp * 1000) - Date.now();
    // Refresh five minutes before expiry, but never sooner than one
    // minute from now (avoids hammering on slow clocks).
    const delay = Math.max(60 * 1000, msToExp - 5 * 60 * 1000);
    refreshTimer = setTimeout(async () => {
      const ok = await refreshAdminSession();
      if (ok) {
        const next = readAdminJwt();
        if (next) scheduleProactiveRefresh(next);
        else showSessionExpired();
      } else {
        showSessionExpired();
      }
    }, delay);
  }

  function showSessionExpired() {
    const ex = document.getElementById('admSessionExpired');
    if (ex) ex.style.display = 'flex';
  }

  let pendingEmail = '';

  const $ = (id) => document.getElementById(id);

  function showLogin() {
    $('loginView').style.display = '';
    $('dashboardView').style.display = 'none';
    $('admUser').style.display = 'none';
    // Reset any leftover lock state from a previous verify flow so the
    // login form is fully usable on every return to this view.
    verifying = false;
    const vbtn = $('loginVerify');
    if (vbtn) { vbtn.disabled = false; vbtn.innerHTML = 'Verify and sign in'; }
    const codeInput = $('loginCode');
    if (codeInput) { codeInput.disabled = false; codeInput.value = ''; }
    const sendBtn = $('loginSend');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = 'Send my code'; }
    showStep('email');
  }

  async function showDashboard(email) {
    $('loginView').style.display = 'none';
    $('dashboardView').style.display = '';
    $('admUser').style.display = '';
    $('admUserEmail').textContent = email;

    // Load profile so the UI can role-gate.
    await loadProfile();
    applyRoleGating();

    if (window.AdminDashboard && window.AdminDashboard.init) window.AdminDashboard.init();
    if (window.AdminInbox && window.AdminInbox.init) window.AdminInbox.init();
  }

  async function loadProfile() {
    if (!sb) return;
    const { data, error } = await sb.rpc('get_admin_profile');
    if (error) { console.warn('get_admin_profile failed:', error); return; }
    const row = Array.isArray(data) ? data[0] : data;
    window.AdminAuth.profile = row || null;
  }

  function applyRoleGating() {
    const profile = window.AdminAuth.profile;
    const role = profile?.role || 'admin';
    const navEl = $('admNav');
    if (navEl) navEl.style.display = '';
    const usersTab = $('admNavUsers');
    if (usersTab) usersTab.style.display = role === 'owner' ? '' : 'none';
    const settingsTab = $('admNavSettings');
    if (settingsTab) settingsTab.style.display = role === 'owner' ? '' : 'none';

    document.body.classList.remove('role-owner', 'role-admin', 'role-va');
    document.body.classList.add('role-' + role);
  }

  function showSection(name) {
    const list = $('listScreen');
    const detail = $('detailScreen');
    const users = $('usersScreen');
    const settings = $('settingsScreen');
    const catalog = $('catalogScreen');
    const hide = (el) => { if (el) el.style.display = 'none'; };
    hide(list); hide(detail); hide(users); hide(settings); hide(catalog);
    if (name === 'users') {
      if (users) users.style.display = '';
      if (window.AdminUsers && window.AdminUsers.show) window.AdminUsers.show();
    } else if (name === 'settings') {
      if (settings) settings.style.display = '';
      if (window.AdminSettings && window.AdminSettings.show) window.AdminSettings.show();
    } else if (name === 'catalog') {
      if (catalog) catalog.style.display = '';
      if (window.AdminCatalog && window.AdminCatalog.show) window.AdminCatalog.show();
    } else if (name === 'inbox') {
      if (window.AdminInbox && window.AdminInbox.openListScreen) window.AdminInbox.openListScreen();
    } else {
      if (list) list.style.display = '';
      const inboxScreen = document.getElementById('inboxScreen');
      if (inboxScreen) inboxScreen.style.display = 'none';
    }
    document.querySelectorAll('.adm-nav-link').forEach((b) => {
      b.classList.toggle('active', b.dataset.section === name);
    });
  }
  window.AdminAuth.showSection = showSection;

  function showStep(which) {
    $('loginStep1').style.display = which === 'email' ? '' : 'none';
    $('loginStep2').style.display = which === 'code' ? '' : 'none';
    if (which === 'email') $('loginStep1').reset && $('loginStep1').reset();
  }

  function setErr(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
  }

  async function callFn(name, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const resp = await fetch(FN_BASE + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      let data = null;
      try { data = await resp.json(); } catch (_) {}
      return { ok: resp.ok, status: resp.status, data: data || {} };
    } catch (err) {
      const aborted = err && err.name === 'AbortError';
      return {
        ok: false,
        status: 0,
        data: { ok: false, error: aborted
          ? 'The server took too long to respond. Try again in a moment.'
          : (err && err.message) || 'Network error. Please try again.' },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // Decode a JWT payload without verifying its signature. We only use this
  // to read the email claim for the UI greeting. PostgREST + RLS still
  // verify the token cryptographically on every request.
  function decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decodeURIComponent(escape(json)));
    } catch (_) { return null; }
  }

  function readAdminJwt() {
    try {
      const t = localStorage.getItem(window.ADMIN_JWT_KEY);
      if (!t) return null;
      const payload = decodeJwt(t);
      if (!payload || !payload.exp) return null;
      if (payload.exp * 1000 < Date.now()) {
        try { localStorage.removeItem(window.ADMIN_JWT_KEY); } catch (_) {}
        return null;
      }
      return { token: t, payload };
    } catch (_) { return null; }
  }

  async function handleSession() {
    if (!sb) { showLogin(); return; }
    let info = readAdminJwt();
    if (!info) {
      // JWT is missing or expired — try one refresh before sending them
      // back to the login screen. If the refresh works, the user never
      // even sees a flicker.
      const refreshed = await refreshAdminSession();
      if (refreshed) info = readAdminJwt();
    }
    if (!info) { showLogin(); return; }
    const email = info.payload.email || info.payload.user_metadata?.email || '';
    if (!email) { showLogin(); return; }
    window.AdminAuth.currentUser = email;
    scheduleProactiveRefresh(info);
    showDashboard(email);
  }

  async function sendOtp() {
    const email = ($('loginEmail').value || '').trim().toLowerCase();
    const emailInput = $('loginEmail');
    setErr('loginEmailErr', '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.closest('.f').classList.add('has-error');
      setErr('loginEmailErr', 'Please enter a valid admin email.');
      emailInput.focus();
      return;
    }
    emailInput.closest('.f').classList.remove('has-error');

    // We used to pre-check the admin allowlist here via the is_admin_email
    // RPC for a faster "not authorised" message, but the RPC has been hanging
    // and the verify path already enforces the allowlist server-side. Send
    // the code unconditionally — non-admins simply won't be able to verify.

    const btn = $('loginSend');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending...';

    const r = await callFn('send-otp', { email });
    btn.disabled = false;
    btn.innerHTML = orig;

    if (!r.ok || !r.data || !r.data.ok) {
      setErr('loginEmailErr', (r.data && r.data.error) || 'Could not send the code. Please try again.');
      return;
    }

    pendingEmail = email;
    const sentEl = $('loginSentEmail');
    if (sentEl) sentEl.textContent = email;
    showStep('code');
    setTimeout(() => { const ci = $('loginCode'); if (ci) ci.focus(); }, 50);
  }

  let verifying = false;
  async function verifyOtp() {
    if (verifying) return; // Hard guard — second click or extra Enter is a no-op.
    const code = ($('loginCode').value || '').trim();
    setErr('loginCodeErr', '');
    if (!/^\d{6}$/.test(code)) {
      setErr('loginCodeErr', 'Code is 6 digits.');
      return;
    }
    const btn = $('loginVerify');
    const codeInput = $('loginCode');
    const orig = btn.innerHTML;
    verifying = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verifying…';
    if (codeInput) codeInput.disabled = true;

    try {
      const r = await callFn('verify-admin-otp', { email: pendingEmail, code });
      if (!r.ok || !r.data || !r.data.ok) {
        setErr('loginCodeErr', (r.data && r.data.error) || 'Verification failed.');
        return;
      }

      // Store the JWT under our own key. The supabase-js client (initialised
      // on the next page load via supabase-config.js) will pick it up and
      // attach it as a global Authorization header to every request.
      try {
        localStorage.setItem(window.ADMIN_JWT_KEY, r.data.access_token);
        if (r.data.refresh_token) {
          localStorage.setItem(ADMIN_REFRESH_KEY, r.data.refresh_token);
        }
      } catch (e) {
        console.error('Could not store admin JWT:', e);
        setErr('loginCodeErr', 'Your browser blocked storing the sign-in token. Please allow site data and try again.');
        return;
      }

      window.AdminAuth.currentUser = pendingEmail;
      const codeForm = $('loginVerify');
      if (codeForm) codeForm.innerHTML = '<span class="spinner"></span> Signing you in…';
      // Force a clean reload so the supabase client is constructed with the
      // Authorization header already in place. Every downstream query then
      // includes the JWT without depending on supabase-js's session manager.
      setTimeout(() => window.location.reload(), 100);
    } finally {
      // Only release locks if the session never landed (we're still on the
      // login screen). Otherwise leave them locked so the just-used code is
      // never reverified.
      const stillOnLogin = $('loginView') && $('loginView').style.display !== 'none';
      if (stillOnLogin) {
        verifying = false;
        btn.disabled = false;
        btn.innerHTML = orig;
        if (codeInput) codeInput.disabled = false;
      }
    }
  }

  function bind() {
    $('loginStep1').addEventListener('submit', (e) => { e.preventDefault(); sendOtp(); });
    $('loginVerify').addEventListener('click', verifyOtp);
    $('loginRetry').addEventListener('click', () => {
      pendingEmail = '';
      showStep('email');
      setErr('loginEmailErr', '');
      setErr('loginCodeErr', '');
      $('loginEmail').focus();
    });

    const codeInput = $('loginCode');
    if (codeInput) {
      codeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D+/g, '').slice(0, 6);
      });
      codeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); verifyOtp(); }
      });
    }

    $('admSignOut').addEventListener('click', () => {
      // Clear our admin JWT, the refresh token, and any leftover
      // supabase-js auth tokens from older builds, then reload. The fresh
      // page boot has no admin JWT attached, so the client comes up
      // unauthenticated and lands on the login screen via handleSession.
      try { localStorage.removeItem(window.ADMIN_JWT_KEY); } catch (_) {}
      try { localStorage.removeItem(ADMIN_REFRESH_KEY); } catch (_) {}
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith('sb-') && k.includes('auth-token')) localStorage.removeItem(k);
        });
      } catch (_) {}
      if (refreshTimer) clearTimeout(refreshTimer);
      window.location.reload();
    });

    // Session-expired overlay: only shown if refresh fails. The single
    // CTA reloads, which clears state and lands on the login screen.
    const expBtn = document.getElementById('admSessionExpiredBtn');
    if (expBtn) expBtn.addEventListener('click', () => window.location.reload());

    const navEl = $('admNav');
    if (navEl) {
      navEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.adm-nav-link');
        if (!btn) return;
        showSection(btn.dataset.section);
      });
    }

    // No supabase-js auth-state subscription. Our session lives in
    // localStorage and is read on every page boot via handleSession.
    handleSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
