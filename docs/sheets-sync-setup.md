# Google Sheets Backup Sync — Setup

One-way mirror of every non-draft submission into a Google Sheet so the data is recoverable without logging into the platform. The Sheet is the source of truth for **backup only** — Supabase remains the live system. Drafts are never synced.

## Architecture

```
submissions row inserted/updated
        │
        ▼
Supabase Database Webhook ──► sync-to-sheet Edge Function ──► Apps Script Web App ──► Google Sheet
                                              │
                                              ▼
                                    stamps sheets_synced_at
```

The admin panel also exposes a manual "Sync now" button (full re-sync) and a per-submission sync button.

---

## One-time setup

### 1. Run migration `004_sheets_sync.sql`

Adds `sheets_synced_at` and `sheets_sync_error` to `submissions`. Apply via Supabase SQL editor or `supabase db push`.

### 2. Create the target Google Sheet

1. Create a new Google Sheet, name it something like **StudioLAB Growth — Submissions Backup**.
2. Note the URL — you'll share it with team members for read access.
3. Tab structure is created automatically by the script. Don't add tabs manually.

### 3. Paste the Apps Script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete the default `Code.gs` contents.
3. Paste the full contents of [`sheets-sync-apps-script.gs`](./sheets-sync-apps-script.gs).
4. Save the project (give it a name, e.g. "Submissions Sync").

### 4. Set the shared secret

A shared secret stops anyone with the web app URL from writing to your sheet.

1. Generate a long random string. Easy option: in your terminal run `openssl rand -hex 32`.
2. In the Apps Script editor: **Project Settings (cog icon) → Script Properties → Add script property**.
   - Property: `SHARED_SECRET`
   - Value: the random string from step 1.
3. Save.

Keep this secret. You'll paste it into Supabase in step 6.

### 5. Deploy as a web app

1. In Apps Script: **Deploy → New deployment**.
2. **Select type → Web app**.
3. Configure:
   - **Description**: "Submissions sync receiver"
   - **Execute as**: Me (your Google account)
   - **Who has access**: **Anyone** (the shared secret is what actually gates access)
4. **Deploy** → authorise the script when prompted.
5. Copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy.../exec`.

If you later edit the Apps Script code, use **Deploy → Manage deployments → edit → New version → Deploy** so the live URL picks up the new code.

### 6. Add Supabase secrets

In your Supabase project: **Project Settings → Edge Functions → Secrets**, add:

- `SHEETS_WEBAPP_URL` = the web app URL from step 5
- `SHEETS_SHARED_SECRET` = the random string from step 4

### 7. Deploy the edge function

From the repo root:

```bash
supabase functions deploy sync-to-sheet
```

### 8. Backfill existing submissions

After deploying, trigger a full sync once so the sheet picks up everything that's already in the database:

- Easiest: open the admin dashboard and click **↻ Sync now** in the toolbar.
- Or: call the function directly from the Supabase dashboard's Functions tab with body `{ "all": true }`.

### 9. Wire up the database webhook

In Supabase: **Database → Webhooks → Create a new hook**.

- Name: `sync-to-sheet`
- Table: `public.submissions`
- Events: **Insert**, **Update**
- Type: **Supabase Edge Functions**
- Edge Function: `sync-to-sheet`
- Method: `POST`
- Timeout: 5000 ms

Webhooks for `draft` rows are filtered inside the edge function, so you don't need a condition here. After saving, do one test edit on a non-draft row and confirm the sheet updates within a few seconds.

---

## Sheet layout

- **Dashboard** — one row per studio, all stages, sorted by most recently updated. Each row has an "Open ↗" hyperlink to that studio's detail tab.
- **Submitted / In review / Changes requested / Setup in progress / Complete** — same columns as Dashboard, filtered to that stage. A studio moves between these tabs as its status changes.
- **[Studio name]** — one tab per studio, full vertical detail grouped by section (Studio details, Contact, Branding, Email setup, SMS, AI knowledge base, etc.). Includes a back link to the Dashboard.

Stage colour-coding:
- Submitted → light indigo
- In review → amber
- Changes requested → orange
- Setup in progress → blue
- Complete → green

Plan colour-coding on each row matches the admin panel: Launch (blue), Scale (indigo), Dominate AI (pink).

---

## Sharing the backup

After setup, share the Sheet with team members at **Viewer** level (or **Editor** if you want them to be able to manually correct things). The data is read-only from the platform's perspective — anything written into the Sheet directly will be overwritten on the next sync.

---

## Troubleshooting

**"Sheet backup: last sync failed"** appears in the admin panel
- Click the warning to see the error in the tooltip
- Most common cause: web app URL changed (after redeploying) but `SHEETS_WEBAPP_URL` in Supabase secrets wasn't updated

**Per-studio tab not appearing**
- The script names tabs after `studio_name`. If two studios share a name, the second gets a short ID suffix.
- Rename collision: the script silently keeps the existing name if it can't rename.

**Sync seems stale**
- Check the database webhook is enabled and pointed at `sync-to-sheet`
- Use the manual "↻ Sync now" button to force a full backfill
