/* Admin auth: magic-link OTP via Supabase Auth.
   Checks the admin_users allowlist on session change. */

(function () {
  'use strict';

  const sb = window.initSupabase ? window.initSupabase() : null;
  window.AdminAuth = { currentUser: null, sb };

  const $ = (id) => document.getElementById(id);

  function showLogin() {
    $('loginView').style.display = '';
    $('dashboardView').style.display = 'none';
    $('admUser').style.display = 'none';
  }

  function showDashboard(email) {
    $('loginView').style.display = 'none';
    $('dashboardView').style.display = '';
    $('admUser').style.display = '';
    $('admUserEmail').textContent = email;
    if (window.AdminDashboard && window.AdminDashboard.init) window.AdminDashboard.init();
  }

  async function isAllowedAdmin(email) {
    const { data } = await sb.from('admin_users').select('email, is_active').eq('email', email).eq('is_active', true).maybeSingle();
    return !!data;
  }

  async function handleSession() {
    if (!sb) { showLogin(); return; }
    const { data } = await sb.auth.getSession();
    const session = data?.session;
    if (!session?.user) { showLogin(); return; }
    const email = session.user.email;
    const ok = await isAllowedAdmin(email);
    if (!ok) {
      await sb.auth.signOut();
      $('loginErr').textContent = 'This email is not authorised as an admin.';
      $('loginErr').classList.add('vis');
      showLogin();
      return;
    }
    window.AdminAuth.currentUser = email;
    showDashboard(email);
  }

  async function sendOtp() {
    const email = ($('loginEmail').value || '').trim().toLowerCase();
    const errEl = $('loginErr');
    const emailInput = $('loginEmail');
    errEl.classList.remove('vis');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.closest('.f').classList.add('has-error');
      emailInput.setAttribute('aria-invalid', 'true');
      emailInput.focus();
      return;
    }
    emailInput.setAttribute('aria-invalid', 'false');
    // Pre-check the allowlist so we don't ask Supabase to mint a token for a stranger.
    const ok = await isAllowedAdmin(email);
    if (!ok) {
      errEl.textContent = 'This email is not authorised as an admin.';
      errEl.classList.add('vis');
      return;
    }
    const btn = $('loginSend');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending...';
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      $('loginStep1').style.display = 'none';
      $('loginStep2').style.display = '';
    } catch (err) {
      console.error('OTP send failed:', err);
      errEl.textContent = 'We could not send the link. Please check the email and try again.';
      errEl.classList.add('vis');
    } finally {
      btn.disabled = false; btn.innerHTML = 'Send sign-in link';
    }
  }

  function bind() {
    const form = $('loginStep1');
    form.addEventListener('submit', (e) => { e.preventDefault(); sendOtp(); });
    $('loginRetry').addEventListener('click', () => {
      $('loginStep1').style.display = '';
      $('loginStep2').style.display = 'none';
      $('loginEmail').focus();
    });
    $('admSignOut').addEventListener('click', async () => {
      await sb.auth.signOut();
      window.AdminAuth.currentUser = null;
      showLogin();
    });

    if (sb) {
      sb.auth.onAuthStateChange(() => handleSession());
    }
    handleSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
