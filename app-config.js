// Public browser configuration. The publishable key is designed for client-side use;
// authorization is enforced by Supabase Auth and database row-level security.
window.TEMPO_CONFIG = Object.freeze({
  supabaseUrl: 'https://akhkjwtuirawrqfskqtd.supabase.co',
  supabasePublishableKey: 'sb_publishable_-79Yf9qCyjXixzN_OjXLQw_25Jb722t',
  timezone: 'America/New_York',
  // Turn these on only after enabling the provider in Supabase → Authentication → Providers.
  signInOptions: Object.freeze({ google: false, passkey: false }),
});
