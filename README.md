# Tempo — Personal Time Clock

Offline-ready PWA time clock shared by a small workspace, backed by Supabase and hosted on Cloudflare Workers (static assets).

Live: https://timeclock.caseycaudle.workers.dev

## Deploy

The `timeclock` worker serves this folder as static assets (see `wrangler.jsonc`; `.assetsignore` keeps config, SQL and `node_modules` out of the upload).

Every push to `main` on GitHub deploys automatically through Cloudflare Workers Builds (deploy command `npx wrangler deploy`, using the Wrangler version pinned in `package.json`). To deploy by hand instead:

```bash
npm run deploy
```

The service worker is network-first, so a deploy shows up on the next load. Bump `CACHE_NAME` in `sw.js` when the list of cached files changes.

## Supabase setup

1. Run `supabase/migrations/0001_initial_schema.sql` in the Supabase SQL Editor. It is re-runnable and resets Tempo's tables.
2. Authentication → URL Configuration: Site URL `https://timeclock.caseycaudle.workers.dev`, and add `https://timeclock.caseycaudle.workers.dev/**` and `http://localhost:8080/**` as redirect URLs.

On first sign-in the app calls `bootstrap_workspace()`, which accepts any pending invite for that email or creates a personal workspace with default jobs. The owner invites people from **Jobs & rates → People → + Invite**; the invitee gets a sign-in link by email.

## Run locally

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`. On localhost the sign-in screen also offers **Continue with local demo**, which uses sample data without Supabase.

## How sync works (`cloud-sync.js`)

- The app keeps its full state in `localStorage` and works offline.
- After each change it pushes only the rows that differ from the last-synced snapshot, then the other person's app refreshes via Supabase Realtime.
- On sign-in and on refresh it pushes pending local changes first, then pulls the workspace, so offline edits are not overwritten.
- If sync fails, the sidebar card shows the error; tap it to retry.
