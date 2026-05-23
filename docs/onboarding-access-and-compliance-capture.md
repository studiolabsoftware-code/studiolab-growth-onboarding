# Onboarding Form — Access, Verification & Compliance Capture

**Status:** Plan, ready to build
**Scope:** What we need from studios so we can set up Google Business Profile, sign-in analytics, social ad surfaces, and SMS/A2P compliance on their behalf — without blocking payment and without chasing information after the fact.

---

## Design principle — the form is not the wall

Studio owners are not technical. We can't put a 40-field compliance and access wall in front of payment — they'll bail. We also can't ship setup-as-a-service without this data, because Google, Meta, TikTok, and the US carrier registry all require the studio to invite us in and hand over verified business identity before we can touch anything.

Resolution: **a three-tier capture model**.

1. **In the onboarding form (before payment)** — keep it lean. Only the identity fields we genuinely need for invoicing and for the email/SMS footer compliance that kicks in immediately. Studios breeze through.
2. **In the portal "Setup Checklist" (after payment)** — every access delegation and SMS/A2P field lives here as an outstanding item. Studios complete it at their pace; we send polite nudges; the checklist persists until done. This is the once-and-done capture for everything we need to action on their behalf.
3. **Self-serve guide (Guided plan only)** — same checklist surface, but reframed as "here's what *you* need to do" with step-by-step instructions and the bits of business info *they'll* need to have ready (EIN, ABN, privacy URL, etc.). For Guided customers we don't action anything — we just give them a clear runway.

The `setup_type` field (`dfy` | `guided`) already exists on the submission — the portal renders the same checklist in two modes.

## Two distinct capture problems

1. **Access delegation** — the studio invites us in. We capture the IDs that locate their property plus inline instructions for them to invite `studiolabsoftware@gmail.com` (or our Business Manager / MCC). Same pattern across Google, Meta, TikTok.
2. **Identity / compliance data** — for US 10DLC, Toll-Free verification, WhatsApp, and AU SPAM Act we need legal business identity, EIN/ABN, opt-in evidence, sample messages, privacy/terms URLs. Non-negotiable for any SMS sending and not inferable from URLs.

Today the form has neither — but neither needs to live *in the form*.

---

## Current form — what's already captured

Three plan variants live under [us/launch/index.html](us/launch/index.html), [us/scale/index.html](us/scale/index.html), [us/ai/index.html](us/ai/index.html). Schema in [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql).

Relevant existing fields:

- `studio_name`, `legal_name`, `studio_type`, `country`, `timezone`
- `contact_email`, `contact_phone`, `address`, `website`
- `google_business_url`, `facebook_url`, `instagram_handle`, `tiktok_handle`, `youtube_url`, `booking_url`
- `sms_type` (local / toll-free / port), `area_code`, `has_twilio`, `twilio_number`, `sms_tone`
- `lead_sources` (jsonb, Scale/AI only)

Everything related to GA4, Search Console, GTM, Google Ads, Meta Business Manager IDs, Meta partner access, A2P brand/campaign data, and business verification documents is **missing**.

---

## What we actually need to capture — by surface

### 1. Google Business Profile (GBP)

We need **Manager** access (not Owner — Owner is reserved for the studio).

| Capture | Format | Required |
|---|---|---|
| Google Maps URL | `https://maps.app.goo.gl/...` | Yes |
| Place ID | from Google's Place ID Finder | Optional |
| Verification status | Verified / Pending / Not claimed | Yes |
| "I don't have a listing yet" checkbox | boolean | Yes |

**Instructions to show studio:**
> Sign in to business.google.com → select your business → Menu → Business Profile settings → People and access → Add → enter **studiolabsoftware@gmail.com** → set role to **Manager** → Invite.
>
> *Why:* So we can update your business info, respond to reviews, and post updates. We do not request Owner — that stays with you. Listing must be verified by Google first (postcard or video). Invites expire after 3 days.

---

### 2. Google Analytics 4

We need **Administrator** at the property level so we can install tags, link Google Ads, link Search Console, and create conversions.

| Capture | Format | Required |
|---|---|---|
| GA4 Measurement ID | `G-XXXXXXXXXX` | Yes |
| GA4 Property ID | numeric, e.g. `123456789` | Yes |
| GA4 Account name | text | Optional |
| "I don't have GA4 yet" checkbox | boolean | Yes — branches to "we'll create it" |

**Instructions:**
> Go to analytics.google.com → Admin (gear, bottom left) → Property column → Property access management → click + → Add users → enter **studiolabsoftware@gmail.com** → tick **Administrator** under Direct roles → Add.
>
> *Why:* Administrator is the only role that lets us install conversion tracking and link Google Ads — Editor is not enough.

---

### 3. Google Search Console

We need **Owner** access (delegated owner is fine).

| Capture | Format | Required |
|---|---|---|
| Verified property URL | exact format matters: `https://www.studio.com` vs `https://studio.com` | Yes |
| Property type | Domain / URL-prefix | Yes |
| "I don't have GSC set up" checkbox | boolean | Yes |

**Instructions:**
> Go to search.google.com/search-console → select your property → Settings (gear) → Users and permissions → Add user → **studiolabsoftware@gmail.com** → Permission: **Owner** → Add.
>
> *Why:* So we can submit your sitemap, monitor search performance, and fix indexing issues.

---

### 4. Google Tag Manager

| Capture | Format | Required |
|---|---|---|
| GTM Container ID | `GTM-XXXXXXX` | Yes if has one |
| GTM Account ID | numeric | Optional |
| Site platform | Shopify / WordPress / Wix / Squarespace / custom | Yes |
| "I don't have GTM" checkbox | boolean | Yes — we install for them |

**Instructions:**
> tagmanager.google.com → Admin tab → Account column → User Management → + → Add new users → **studiolabsoftware@gmail.com** → Account permission: User → Container permissions: tick **Publish** → Invite.

---

### 5. Google Ads

We use an MCC (Manager) link, not a direct user invite. The studio accepts our link request from inside their account.

| Capture | Format | Required |
|---|---|---|
| Google Ads Customer ID | `XXX-XXX-XXXX` | Yes |
| Account currency | AUD / USD | Yes |
| Account time zone | dropdown | Yes |
| "No Google Ads account yet" checkbox | boolean | Yes |

**Instructions:**
> 1. Sign in to ads.google.com.
> 2. We'll send a manager link request to your Customer ID. You'll see a notification (bell, top right).
> 3. Open the notification → Accept the manager link from **StudioLAB**.
>
> *Why:* This lets us build and manage campaigns. Billing stays with you. Currency and time zone can't be changed after the account is created — confirm carefully.

---

### 6. Meta Business Manager (Facebook + Instagram)

This is the most common breakage point. Many studios run a Page from a personal profile and don't have Business Manager set up. We need Partner access to Page + Ad Account + Instagram + Pixel.

| Capture | Format | Required |
|---|---|---|
| Business Manager ID | numeric, from business.facebook.com/settings/info | Yes if exists |
| Facebook Page URL | URL | Yes |
| Facebook Page ID | numeric | Optional |
| Instagram username | `@studio` | Optional |
| Instagram is a Professional account? | Yes / No | Yes |
| Instagram linked to FB Page? | Yes / No | Yes |
| Ad Account ID | `act_XXXXXXXXX` | Optional |
| Meta Pixel / Dataset ID | numeric | Optional |
| "No Business Manager yet" checkbox | boolean | Yes — we walk them through creating one |

**Instructions:**
> 1. Go to business.facebook.com → Settings → Partners (under Users).
> 2. Click Add → "Give a partner access to your assets".
> 3. Enter our Business Manager ID: **[INSERT OUR BM ID]**.
> 4. Select your Page, Ad Account, Instagram, and Pixel → tick Manage Page, Manage Ad Account, Manage Instagram → Save.
>
> *Why:* Partner access is cleaner than adding us as a person — it stays with our agency, not an individual Gmail. Your Instagram must be a Professional (Business or Creator) account and connected to your Facebook Page before this works.

---

### 7. TikTok Business Center

| Capture | Format | Required |
|---|---|---|
| TikTok Business Center ID | numeric | Yes if exists |
| TikTok Ad Account ID | numeric | Optional |
| TikTok handle | `@studio` | Optional |
| Handle switched to Business account? | Yes / No | Yes |
| "No Business Center yet" checkbox | boolean | Yes |

**Instructions:**
> business.tiktok.com → Partners → Add Partner → enter our Business Center ID: **[INSERT OUR BCID]** → assign your Ad Account, Business Account, Pixel → role: **Admin** → Confirm.

---

### 8. Business verification & SMS/A2P compliance

This is the bulk of new work. The US 10DLC registry (TCR), Toll-Free verification, AU SPAM Act, and WhatsApp Business API all need overlapping but distinct identity data. Capture once, use everywhere.

#### Always required (every studio)

| Field | Format | Notes |
|---|---|---|
| Legal Business Name | text | Must match tax/ASIC records exactly |
| Trading Name / DBA | text | If different from legal name |
| Business Type | Sole Prop / LLC / Corp / Partnership / Non-profit / Pty Ltd / Other | Drives conditional fields |
| Country of Registration | dropdown | Drives jurisdiction logic |
| Registered Business Address | structured (street/city/state/postcode/country) | Must match tax records |
| Physical Mailing Address (if different) | structured | For email footer compliance |
| Business Website URL | URL | Must be live, branded, mention contact/SMS |
| **Business Email on Business Domain** | email | NOT gmail/hotmail — TCR + Meta reject these |
| Business Phone | E.164 | |
| Authorised Contact Name | text | First + Last |
| Authorised Contact Title | text | Owner / Director / Manager |
| Authorised Contact Email | email on business domain | |
| Authorised Contact Mobile | E.164 | For sole-prop OTP verification |
| Industry Vertical | dropdown — pre-fill "Professional Services" or "Education" | TCR-aligned list |
| Business Description | text, 1–2 sentences | For WhatsApp + TCR |
| Privacy Policy URL | URL | Must mention SMS data handling — we provide a template if missing |
| Terms of Service URL | URL | Must mention message frequency + STOP/HELP |
| SMS Opt-in Method | dropdown: Web form / Paper at enrolment / Verbal / Multiple | |
| SMS Opt-in Description | text | Plain English of how consent is captured |
| Opt-in Form Screenshot | file upload OR URL | Stricter for Toll-Free, useful for 10DLC |
| Sample SMS 1 | text — pre-filled compliant template they edit | Must include brand name + STOP |
| Sample SMS 2 | text — pre-filled compliant template they edit | |
| Estimated Monthly SMS Volume | dropdown: <1k / 1k–10k / 10k–100k / 100k+ | |
| Sending "From" Name (email) | text | Already partially captured |
| Reply-To Email | already captured | |

#### Conditional — US studios

| Field | When |
|---|---|
| EIN (`XX-XXXXXXX`) | If LLC / Corp / Partnership / Non-profit |
| SSN last 4 | If Sole Proprietor — store encrypted, mask in UI immediately |
| Stock symbol + exchange | If publicly traded (rare) |

#### Conditional — AU studios

| Field | When |
|---|---|
| ABN (11 digits) | All AU studios |
| ACN (9 digits) | If Pty Ltd |
| Preferred SMS Sender ID | Alpha (max 11 chars) or "use long code" |

#### Conditional — Marketing to UK/EU contacts

| Field | When |
|---|---|
| Gate question: "Do you market to UK/EU contacts?" | All studios |
| ICO Registration Number (`ZA123456`) | UK only |
| Data Controller Name + Address | If marketing UK/EU |
| Lawful Basis | dropdown — default "Consent" |

#### Conditional — WhatsApp enabled

| Field | When |
|---|---|
| WhatsApp Display Name | If enabling |
| WhatsApp Business Category | Meta's fixed list |
| Business Verification Document | File upload — incorporation cert / ABN extract / utility bill in business name |

---

## Where each thing lives

### Tier 1 — in the onboarding form (before payment)

Light touch only. Studios should complete the form in under 10 minutes. We add a small **Business details** step (one screen, ~6 fields) that captures what we genuinely need before payment:

- Legal Business Name
- Trading Name (if different)
- Business Type (Sole Prop / LLC / Corp / Pty Ltd / Other)
- Registered Business Address (we already collect `address` — extend to structured fields)
- EIN (US, conditional) **or** ABN (AU, conditional)
- Business Email (with a soft warning if it's gmail/hotmail — not a block)

This unblocks invoicing, Stripe tax handling, and the email-footer compliance that's legally required from message one. Everything else moves to Tier 2.

The existing branding / voice / SMS preference fields stay where they are. We keep the form flow as Studio → Business details (new) → Contact → Voice & email → (SMS preference for Scale/AI) → Review. Total cost: one extra screen.

### Tier 2 — Setup Checklist in the portal (after payment, DFY plan)

This is the home of all access delegation and SMS/A2P capture. After payment the studio lands on a dashboard tile: **"Set up your accounts — 0 of 9 complete"**. Each tile is one surface (GBP, GA4, Search Console, GTM, Google Ads, Meta, TikTok, SMS compliance, WhatsApp).

Each tile shows three things in non-technical language:

1. **What we'll do for you** — one sentence. *"We'll manage your Google Business listing — update info, respond to reviews, and post updates."*
2. **What we need from you** — the inline invite instructions, with our identifier (email / BM ID / MCC ID) shown with a copy button, plus the fields we want them to paste in (Maps URL, Customer ID, etc.).
3. **"I don't have this yet"** — branches to a "we'll create it for you" task. No dead ends.

Behaviour:

- The checklist is **not a blocker** — studio uses the rest of the portal freely. The tile is persistent and shows progress on every login.
- **Outstanding items** generate gentle email nudges on a schedule (e.g. day 2, day 5, day 10, then weekly). Wording is "here's what's left, here's why we need it" — never demanding.
- The admin side shows the same checklist so we know what's blocking us. When something arrives we get a notification (reusing the existing admin inbox pattern from migration 037).
- Completing a tile triggers our actual setup work — that's the handoff point.

### Tier 3 — Self-serve guide in the portal (Guided plan only)

Same surface, different framing. The Guided customer is doing all the setup themselves; we're not actioning anything for them. Each tile shows:

1. **What this is for** — *"Google Business Profile is how customers find you in Maps and search."*
2. **What you'll need before you start** — a clear checklist of business info (legal name, address, EIN/ABN, privacy policy URL, sample SMS messages, etc.) so they're not stopping mid-task to dig things up.
3. **Step-by-step instructions** — the same click-by-click as DFY, but written so they're doing it for *themselves*, not inviting us.
4. **"How to know it's working"** — a single sanity check (e.g. "your listing shows in Google search when you type your studio name").

The Guided path needs an extra block per surface — **what info to have ready** — that DFY doesn't strictly need (because we'd already have it from the form). This is the "guide of what we're looking for" that lets them complete it themselves without bouncing back and forth.

A clear, persistent banner at the top of the portal sets expectation: **"You chose the Guided plan — here's everything to set up yourself. We're here if you get stuck."** vs DFY: **"You chose the Done-For-You plan — we'll handle setup. Please complete the items below so we can get started."**

### Three principles that will save us pain

**Pre-fill compliant sample SMS.** Studios will write "we send class reminders" and get rejected by TCR. Pre-fill two compliant samples with brand name + STOP language baked in and let them edit. This change alone will cut A2P rejection rates dramatically.

**Soft-warn (don't block) on gmail business email.** TCR and Meta reject gmail.com as the business contact. Flag it in the form with a one-line explainer and an "I'll fix this later" option — don't gate payment on it. The portal checklist surfaces it as an outstanding item.

**"I don't have this yet" is a first-class branch on every tile.** Most studios won't have GTM, GA4, or a Business Manager. The branch routes into a "we'll create it for you" (DFY) or "here's how to create one" (Guided) workflow. Without this the checklist becomes the wall we just avoided in the form.

---

## What changes in the data model

New columns on `submissions` (proposed names):

```
-- Identity (always)
legal_business_name          (replaces / canonicalises legal_name)
business_type                 enum
trading_name                  text
ein                           text encrypted
ssn_last4                     text encrypted, sole prop only
abn                           text
acn                           text
authorised_contact_name       text
authorised_contact_title      text
authorised_contact_email      text
authorised_contact_mobile     text
industry_vertical             text
business_description          text
privacy_policy_url            text
terms_url                     text

-- Google access
gbp_maps_url                  (already have google_business_url; keep)
gbp_place_id                  text
gbp_status                    enum
ga4_measurement_id            text
ga4_property_id               text
gsc_property_url              text
gsc_property_type             enum
gtm_container_id              text
gtm_account_id                text
google_ads_customer_id        text
google_ads_currency           text
google_ads_timezone           text

-- Meta / TikTok
meta_business_manager_id      text
meta_page_id                  text
meta_ad_account_id            text
meta_pixel_id                 text
instagram_is_professional     boolean
instagram_linked_to_page      boolean
tiktok_business_center_id     text
tiktok_ad_account_id          text
tiktok_handle_is_business     boolean

-- "Don't have yet" flags
needs_gbp_setup               boolean
needs_ga4_setup               boolean
needs_gsc_setup               boolean
needs_gtm_setup               boolean
needs_google_ads_setup        boolean
needs_meta_bm_setup           boolean
needs_tiktok_bc_setup         boolean

-- SMS / A2P
sms_optin_method              enum
sms_optin_description         text
sms_optin_screenshot_url      text
sms_sample_1                  text
sms_sample_2                  text
sms_estimated_volume          enum
sms_sender_id                 text  -- AU alpha sender
markets_to_uk_eu              boolean
ico_registration_number       text
data_controller_name          text
data_controller_address       text
gdpr_lawful_basis             enum

-- WhatsApp
whatsapp_enabled              boolean
whatsapp_display_name         text
whatsapp_category             text
whatsapp_verification_doc_url text
```

Sensitive fields (EIN, SSN last 4) need encryption at rest and masked display in the admin UI. The existing `submissions` table doesn't have field-level encryption — this is a small but real piece of work.

---

## Recommendation on sequencing

Three shippable phases. The form change is small; the portal checklist is the bulk of the work.

**Phase 1 — Business details step in the form.** One new screen in [us/launch/index.html](us/launch/index.html), [us/scale/index.html](us/scale/index.html), [us/ai/index.html](us/ai/index.html) and the matching AU forms. New columns on `submissions` for legal name, business type, EIN/ABN, structured address. Soft warning on non-business email. ~2 days.

**Phase 2 — Setup Checklist (DFY mode) in the portal.** New tab in the portal with one tile per surface. Backed by a new `setup_tasks` table that tracks per-tile state (`pending` | `submitted_by_studio` | `actioned_by_us` | `complete`). Admin inbox notification when a studio submits a tile. Nudge email schedule (day 2, 5, 10, then weekly). Pre-filled compliant SMS samples as portal content. ~6 days — this is the biggest piece.

**Phase 3 — Self-serve guide (Guided mode) layer on the same tiles.** Same tile components, conditional content blocks for "what to have ready" and "how to know it's working". Banner copy split DFY vs Guided. ~2 days assuming Phase 2 is well-componentised.

**Out of scope for now, to flag:** the actual setup-action workflow on the admin side (us claiming a tile, doing the work, marking complete, notifying the studio). That's the natural Phase 4 but it doesn't block the data capture.

Want me to start Phase 1 — the lean Business details step in the form — and have the portal checklist follow as Phase 2?
