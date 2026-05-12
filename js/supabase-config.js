// StudioLAB Growth Onboarding: Supabase client config.
// Fill these in once the Supabase project exists. Both values are safe to expose
// in the browser. The anon key is rate-limited and gated by Row Level Security.

window.SUPABASE_CONFIG = {
  url: 'https://hiaruvsdamggenhqdvtp.supabase.co',
  anonKey: 'sb_publishable_ymvaM_o9GFa-aMjrYd2Uqw_9uw4lT6B',
  logoBucket: 'logos',
  updatePagePath: '/update.html',
};

// Initialise the global supabase client once the SDK loads.
window.initSupabase = function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Supabase SDK not loaded. Include https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 before this file.');
    return null;
  }
  if (!window._sbClient) {
    window._sbClient = window.supabase.createClient(
      window.SUPABASE_CONFIG.url,
      window.SUPABASE_CONFIG.anonKey,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    );
  }
  return window._sbClient;
};
