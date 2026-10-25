# Property Maintenance V1
Working mobile-friendly static prototype.
Features: Weekend dashboard, Calendar, recurring Maintenance, one-off To-Do with priority and optional weekend assignment, Shopping list, local browser persistence.
Open `index.html` to test it. `database.sql` is the starting schema for the future Supabase cloud version.
Never expose a Supabase service-role key in browser code.

## Data model (v2.1)
- `tasks` = maintenance templates (name, category, recurrence, materials, schedule basis).
- `occurrences` = one record per scheduled instance `{id, taskId, date, done, completedOn}`.
  Dragging, completing and undoing touch exactly one occurrence.
- Fixed schedules generate occurrences 12 months ahead; "based on actual completion" tasks keep one open occurrence and create the next when completed.
- Existing data migrates automatically on first load; the original is saved in localStorage under `propertyMaintenance.v2.backup-before-occurrences`.

## Running it
Open `index.html` in a browser (no build step), or host the folder as static files.

### GitHub Pages
1. Push this folder to a GitHub repo (the `main` branch).
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
3. After ~1 minute the site is live at `https://<your-username>.github.io/<repo-name>/`.
4. Every `git push` to `main` redeploys automatically.

### iPhone
Open the Pages URL in **Safari** → Share → **Add to Home Screen**. Use the home screen icon from then on.

### Moving data between devices
Data lives in each browser's own storage. Use the **Backup** tab: *Download backup* on one device, *Restore from backup* on the other.
(Automatic sync is planned with Supabase.)

## Cloud sync (Supabase) — one-time setup
The app works without this. Add it to keep your phone and computer in sync.

1. **Create the table.** Supabase dashboard → *SQL Editor* → *New query* → paste the contents of `supabase-setup.sql` → *Run*.
2. **Create your login.** *Authentication → Users → Add user → Create new user*. Enter your email and a password and tick *Auto Confirm User*.
3. **Lock out strangers.** In *Authentication* (Sign In / Providers → User Signups), turn **off** "Allow new users to sign up" so only the account you just made can sign in.
4. **Copy your keys.** *Project Settings → API Keys*: copy the **Project URL** and the **publishable (anon) key**. Never use the *secret* / *service_role* key.
5. **Paste them into `config.js`**, commit and push.
6. Open the app → **Backup** tab → **Cloud sync** → sign in. Do this first on the device that has your data; it uploads it. Then sign in on your other devices; they download it.

How it behaves:
- Edits save on the device immediately and upload a moment later; a badge under the title shows the sync state.
- Offline edits stay on the device and upload when you reconnect.
- If two devices changed things at the same time you are asked which version to keep. The version you don't keep is saved on that device (`backup-before-cloud-load` / `backup-cloud-overwritten`).
- Signing out keeps the data on the device.
- `database.sql` is an older multi-table draft kept for a possible future version; `supabase-setup.sql` is what the app uses today.
