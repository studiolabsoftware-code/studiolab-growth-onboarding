# StudioLAB Growth Onboarding

Static onboarding form + admin dashboard for new StudioLAB Growth studios. Front-end is plain HTML/CSS/JS, backend is Supabase (Postgres + Auth + Storage + Edge Functions) and Mailgun for email.

## Live URLs (target)

- Public form: `https://setup.studiolab-crm.com/`
- Studio update flow: `https://setup.studiolab-crm.com/update.html?token=...`
- Admin dashboard: `https://setup.studiolab-crm.com/admin/`

## One-time setup

### 1. Create the Supabase project

1. Create a new project at https://supabase.com.
2. In the SQL editor, paste and run [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql). This creates all tables, RLS policies, the storage bucket, and seeds `studiolabsoftware@gmail.com` as the owner admin.
3. If the storage bucket creation fails inside the migration, create a bucket named `logos` manually under Storage. Keep it **private**.

### 2. Wire up the client config

Edit [js/supabase-config.js](js/supabase-config.js) and fill in:

- `url`: your project URL (e.g. `https://abc123.supabase.co`)
- `anonKey`: the public anon key from Project Settings → API

Both values are safe to commit. They are protected by Row Level Security.

### 3. Deploy the Edge Functions

Each function in `supabase/functions/` is Deno-based. Deploy with the Supabase CLI:

```bash
supabase functions deploy on-submission
supabase functions deploy send-change-request
supabase functions deploy validate-change-request
supabase functions deploy apply-change-request
```

Set the following secrets (Project Settings → Edge Functions → Secrets):

| Name | Example |
|---|---|
| `MAILGUN_API_KEY` | `key-xxxxxxxxxxxxxx` |
| `MAILGUN_DOMAIN` | `studiolabsoftware.com` |
| `MAILGUN_FROM` | `StudioLAB Growth <growth@studiolabsoftware.com>` |
| `APP_URL` | `https://setup.studiolab-crm.com` |
| `ADMIN_APP_URL` | `https://setup.studiolab-crm.com/admin/` |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically.

### 4. Hook the on-submission webhook

Database → Webhooks → New webhook:

- Table: `submissions`
- Events: `INSERT`
- Type: `Supabase Edge Function`
- Function: `on-submission`

This sends the confirmation email and admin notification on every new submission.

### 5. Verify Mailgun

In the Mailgun dashboard, verify the domain you put in `MAILGUN_DOMAIN`. Add the DKIM, SPF, and DMARC records to its DNS. Sending will fail until the domain shows as verified.

### 6. Point the domain

Add a CNAME for `setup` → your hosting target. The repository ships with [CNAME](CNAME) set to `setup.studiolab-crm.com`. Update it if hosting somewhere other than GitHub Pages.

### 7. Add more admins (optional)

Run in the SQL editor:

```sql
insert into admin_users (email, name, role) values ('newperson@studio.com', 'Name', 'admin');
```

Only emails in this table can sign into `/admin/`.

## Local preview

The site is fully static. Open `index.html` in a browser, or run a simple server:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000.

Without Supabase credentials filled in, the form will render but submission and logo upload will fail. The admin dashboard will be stuck on the login screen.

## Project layout

```
.
├── index.html                  Public onboarding form
├── update.html                 Magic-link update page
├── css/form.css                Form + update page styles
├── js/
│   ├── supabase-config.js      Client config + initSupabase()
│   ├── form.js                 Form behaviour, validation, submit
│   └── update.js               Update-page renderer + save
├── admin/
│   ├── index.html              Admin dashboard shell
│   ├── css/admin.css           Admin styles
│   └── js/{auth,dashboard,detail,change-request}.js
├── supabase/
│   ├── migrations/001_initial_schema.sql
│   └── functions/
│       ├── _shared/            CORS, Mailgun, templates, admin client
│       ├── on-submission/
│       ├── send-change-request/
│       ├── validate-change-request/
│       └── apply-change-request/
├── CNAME, robots.txt, .gitignore
└── README.md
```

## Plan-conditional data

The form and admin dashboard both respect the plan boundary:

- **Launch**: no SMS, no AI knowledge base. Workflow set: `ae`, `re`.
- **Scale**: adds SMS workflows (`ae_sms`, `mct`, `re_sms`), area code, lead sources.
- **Dominate AI**: adds the full AI knowledge base, FAQs, voice agent rules.

Submitted records have `NULL` for any field outside the studio's plan. The detail view shows "Not included in [Plan]" notices for non-applicable sections, and the change-request modal only offers fields relevant to the studio's plan.

## Change-request flow

1. Admin opens a submission and clicks **Request changes**.
2. Admin selects fields + writes a message + picks an expiry (24h / 72h / 7d).
3. `send-change-request` generates a random token, stores `sha256(token)`, and emails the studio a link to `/update.html?token=RAW`.
4. Studio opens the link. `validate-change-request` hashes the token, finds the row, returns the submission snapshot + the requested fields.
5. Studio fills in the fields and saves. `apply-change-request` validates again, updates the submission (scoped to allowlisted fields), marks the request `completed`, logs activity, and emails admins.

Submission status moves: `submitted` → (admin requests changes) `changes_requested` → (studio submits) `in_review` → (admin completes setup) `complete`.

## Security notes

- All HTML pages carry `<meta name="robots" content="noindex, nofollow">`.
- The form has a hidden honeypot field. Bots that fill it see a fake success screen and never reach the database.
- Anon role can only INSERT into `submissions` and `activity_log` (limited actions), and only INSERT/SELECT into the `logos` bucket. All sensitive reads/writes go through Edge Functions with the service role key.
- Change-request tokens are stored only as SHA-256 hashes. The raw token never persists server-side. Tokens are single-use (status flips to `completed`) and expire on `token_expires_at`.
- Admin auth uses Supabase OTP (magic-link). The `admin_users` allowlist is checked both before sending the OTP and on every session.

## Hard design rules

- No em dashes anywhere in UI text. Use commas, full stops, colons, or restructure.
- Buttons: Title Case, font-semibold, `rounded-full`, min 44px touch target. Magenta for primary action, indigo for navigation, never uppercase.
- Cards: white background, `var(--g2)` border, no coloured wrapper borders.
- Tables: magenta header, white uppercase column labels (11px, semibold).
- Magenta is action only, never decoration. Indigo is brand/nav/links.
