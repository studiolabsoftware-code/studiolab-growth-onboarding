// StudioLAB Growth Onboarding: Supabase client config.
// Fill these in once the Supabase project exists. Both values are safe to expose
// in the browser. The anon key is rate-limited and gated by Row Level Security.

window.SUPABASE_CONFIG = {
  url: 'https://hiaruvsdamggenhqdvtp.supabase.co',
  anonKey: 'sb_publishable_ymvaM_o9GFa-aMjrYd2Uqw_9uw4lT6B',
  logoBucket: 'logos',
  updatePagePath: '/update.html',
};

// Admin auth bypasses supabase-js's session machinery entirely: the JWT
// from verify-admin-otp is stored under the `sl-admin-jwt` key and attached
// as a global Authorization header on every supabase-js request. This is
// reliable even when supabase-js's own session-validation path is degraded
// (which we have seen hang for minutes on this project's Auth gateway).
window.ADMIN_JWT_KEY = 'sl-admin-jwt';

// Initialise the global supabase client once the SDK loads.
window.initSupabase = function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Supabase SDK not loaded. Include https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 before this file.');
    return null;
  }
  if (!window._sbClient) {
    let adminJwt = null;
    try { adminJwt = localStorage.getItem(window.ADMIN_JWT_KEY); } catch (_) { /* ignore */ }
    const options = {
      auth: {
        // We manage the admin token ourselves; keep supabase-js out of it.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    };
    if (adminJwt) {
      options.global = { headers: { Authorization: 'Bearer ' + adminJwt } };
    }
    window._sbClient = window.supabase.createClient(
      window.SUPABASE_CONFIG.url,
      window.SUPABASE_CONFIG.anonKey,
      options,
    );
  }
  return window._sbClient;
};
