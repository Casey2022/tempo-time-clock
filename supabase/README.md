# Tempo cloud backend scaffold

The SQL migration in `migrations/0001_initial_schema.sql` is the planned shared-data model for Supabase.

Before applying it to a remote project:

1. Create a Supabase project.
2. Choose the final production hostname before enabling passkeys.
3. Configure email/password, Google, and Apple providers in Supabase Auth.
4. Set the passkey WebAuthn relying-party ID and origins to the final hostname.
5. Apply the migration with the Supabase CLI.

The app should keep using its local-first adapter until the project URL and publishable key are configured. Never put a Supabase secret/service-role key in the browser.
