/* Admin auth: custom 6-digit OTP via Mailgun, mirroring the studio flow.
   Edge Functions send-otp + verify-admin-otp do the heavy lifting; the latter
   mints a real Supabase Auth session so all subsequent queries run with the
   authenticated role and the existing RLS policies just work. */

(function () {
  'use strict';

  const sb = window.initSupabase ? window.initSupabase() : null;
  const SB_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '';
  const FN_BASE = SB_URL + '/functions/v1/';

  window.AdminAuth = { currentUser: null, profile: null, sb };

  let pendingEmail = '';

  const $ = (id) => document.getElementById(id);

  function showLogin() {
    $('loginView').style.display = '';
    $('dashboardView').style.display = 'none';
    $('admUser').style.display = 'none';
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
    } else {
      if (list) list.style.display = '';
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
    const resp = await fetch(FN_BASE + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await resp.json(); } catch (_) {}
    return { ok: resp.ok, status: resp.status, data: data || {} };
  }

  async function handleSession() {
    if (!sb) { showLogin(); return; }
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if (!session?.user) { showLogin(); return; }
    window.AdminAuth.currentUser = session.user.email;
    showDashboard(session.user.email);
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

    // Pre-check the allowlist via the public RPC (security definer) so we do
    // not even attempt to send a code to a stranger.
    const { data: allowed, error: rpcErr } = await sb.rpc('is_admin_email', { p_email: email });
    if (rpcErr) {
      console.warn('is_admin_email rpc failed:', rpcErr);
    } else if (allowed !== true) {
      setErr('loginEmailErr', 'This email is not authorised as an admin.');
      return;
    }

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

  async function verifyOtp() {
    const code = ($('loginCode').value || '').trim();
    setErr('loginCodeErr', '');
    if (!/^\d{6}$/.test(code)) {
      setErr('loginCodeErr', 'Code is 6 digits.');
      return;
    }
    const btn = $('loginVerify');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Verifying...';

    const r = await callFn('verify-admin-otp', { email: pendingEmail, code });
    btn.disabled = false;
    btn.innerHTML = orig;

    if (!r.ok || !r.data || !r.data.ok) {
      setErr('loginCodeErr', (r.data && r.data.error) || 'Verification failed.');
      return;
    }

    // Hydrate the Supabase Auth session so all subsequent queries on the
    // dashboard run with the authenticated role and pass existing RLS.
    const { access_token, refresh_token } = r.data;
    const { error: setErrSb } = await sb.auth.setSession({ access_token, refresh_token });
    if (setErrSb) {
      console.error('setSession failed:', setErrSb);
      setErr('loginCodeErr', 'Sign-in failed. Please try again.');
      return;
    }

    window.AdminAuth.currentUser = pendingEmail;
    showDashboard(pendingEmail);
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

    $('admSignOut').addEventListener('click', async () => {
      await sb.auth.signOut();
      window.AdminAuth.currentUser = null;
      window.AdminAuth.profile = null;
      showLogin();
    });

    const navEl = $('admNav');
    if (navEl) {
      navEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.adm-nav-link');
        if (!btn) return;
        showSection(btn.dataset.section);
      });
    }

    if (sb) sb.auth.onAuthStateChange(() => handleSession());
    handleSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
