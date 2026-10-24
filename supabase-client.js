(function attachTempoSupabase() {
  let client;

  function getClient() {
    if (client) return client;
    const config = window.TEMPO_CONFIG || {};
    if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase?.createClient) return null;
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return client;
  }

  window.TempoSupabase = {
    getClient,
    isConfigured: () => Boolean(window.TEMPO_CONFIG?.supabaseUrl && window.TEMPO_CONFIG?.supabasePublishableKey),
  };
})();
