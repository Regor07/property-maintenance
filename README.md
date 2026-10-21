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
