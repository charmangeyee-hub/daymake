# Daymark

A clean, black‑and‑white **Tasks · Calendar · Habits** planner. Installable PWA, offline‑capable, with accounts and cross‑device sync powered by Supabase.

## Features

- **Tasks** — quick add or a full editor (title, notes, date & time, urgent flag, tags). Filter by Today / Tomorrow / Week / Month / Custom. Overdue items surface at the top.
- **Calendar** — month **Grid**, a **Month agenda** overview, and an **Upcoming** rolling view. Events support time, reminders, a **location** (opens in Google Maps), and multi‑day **date ranges**. Filter by reminders / location.
- **Habits** — set a **weekly target** (1–7×), tick days on a week strip, adaptive **day/week streaks**, and a per‑habit **report** (current & best streak, total, completion %, last‑8‑weeks chart).
- **Accounts + cloud sync** — email/password via Supabase Auth; your data syncs across devices (dirty‑flag, server‑authoritative, pull‑on‑focus). A profile sheet shows live sync status + "last synced".
- **Reminders** — daily habit reminders and event reminders delivered by a Supabase Edge Function on a cron (Web Push), so they arrive even when the app is closed.
- **Design** — monochrome, serif display type, light/dark themes, creative B&W avatars.

## Tech

Vanilla HTML/CSS/JS (no build step) · Supabase (Auth + Postgres with RLS) · Web Push via a Supabase Edge Function · PWA (service worker + manifest).

## Run locally

```bash
python3 server.py     # serves the app at http://localhost:4599
```

`server.py` is only needed for local serving / optional local push. The app itself talks directly to Supabase, so it can also be hosted as static files.

## Deploy

Any static host works (the app talks to Supabase directly — no server or build step). A `netlify.toml` is included.

### Deploy to Netlify (auto‑deploy from GitHub)

1. Push this repo to GitHub (e.g. with **GitHub Desktop**).
2. Go to **[app.netlify.com](https://app.netlify.com)** and log in — choose **Log in with GitHub**.
3. Click **Add new site → Import an existing project → GitHub**, authorise Netlify, and pick the **daymake** repo.
4. Leave the build settings as detected — **Build command: _(empty)_**, **Publish directory: `.`** (Netlify reads `netlify.toml`). Click **Deploy**.
5. Netlify gives you a URL like `https://daymake-xxxx.netlify.app`.
6. In **Supabase → Authentication → URL Configuration**, set **Site URL** to that Netlify URL (and add it under **Redirect URLs**).

No environment variables are needed — the publishable Supabase key lives in `app.js`. After this, **every `git push` auto‑deploys** the site.

## Supabase setup

1. Run [`supabase_setup.sql`](supabase_setup.sql) — creates the `user_data` table + row‑level security.
2. (Optional, for closed‑app push) deploy [`supabase/functions/send-reminders`](supabase/functions/send-reminders), set its `VAPID_PUBLIC` / `VAPID_PRIVATE` / `CRON_SECRET` secrets, then run [`supabase_push.sql`](supabase_push.sql) (replace `PASTE_YOUR_CRON_SECRET_HERE` with your secret).

## Configuration

The Supabase **project URL** and **publishable (anon) key** are in `app.js` — these are safe for client code (protected by row‑level security). Never commit secret keys, the VAPID private key, or the cron secret.
