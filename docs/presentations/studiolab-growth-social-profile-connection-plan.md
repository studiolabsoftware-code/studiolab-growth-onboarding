# StudioLAB Growth Social Profile Connection Plan

Research snapshot: May 2026

## Purpose

StudioLAB Growth onboarding should collect public profile URLs and handles first, then have the studio owner authorise the active connections inside StudioLAB Growth using OAuth. The key point is simple: we should never collect social passwords. The studio owner signs in to each platform from their own browser, reviews the permissions, selects the correct page, profile, location, advertiser account or channel, and confirms the connection.

Customer-facing language should say StudioLAB Growth. Internal source documentation may use the underlying platform or vendor names.

## Recommended Approach

Use one master setup presentation, supported by five short platform-specific videos. This gives the client one clear onboarding path while still letting them jump to the exact platform they need.

The recommended package:

1. Master deck: "Connect Your Studio Profiles to StudioLAB Growth"
2. Short video 1: Facebook Business Page
3. Short video 2: Instagram
4. Short video 3: Google Business Profile
5. Short video 4: TikTok
6. Short video 5: YouTube
7. One setup checklist the owner can complete before their onboarding call
8. One internal verification checklist for StudioLAB

This is better than one long video because the connection paths differ. Facebook lead ads, Instagram posting, Google reviews, TikTok lead ads and YouTube publishing do not all connect from the same place.

## The Main Distinction

There are two different jobs happening.

First, the onboarding form captures public profile identifiers. These are things like Facebook page URL, Instagram handle, Google Business Profile link, TikTok handle and YouTube channel URL. These help StudioLAB confirm which public profiles belong to the studio.

Second, the studio owner authorises active platform access. This is done inside StudioLAB Growth after their account is created. Depending on the feature, they may connect through `Settings > Integrations`, `Marketing > Social Planner`, or `Reputation`.

## Access Model

For setup, give the studio owner a StudioLAB Growth login with enough access to authorise integrations. The cleanest model is a temporary "Setup Admin" or "Owner Admin" access level for the account.

Minimum access needed:

- Settings and Integrations
- Marketing and Social Planner, if publishing is included
- Reputation, if Google reviews, listings or GBP optimisation are included
- Conversations, if Facebook, Instagram or TikTok inbox features are included

After setup, keep the owner as an admin if they are actively managing the account, or reduce access to the normal owner role if StudioLAB is managing most operations. Do not have a StudioLAB team member connect from their own personal platform account unless the studio has explicitly granted that person proper access inside the social platform itself.

## Connection Matrix

| Profile | What We Capture First | Access The Studio Owner Needs | Where They Connect | What We Verify |
| --- | --- | --- | --- | --- |
| Facebook Business Page | Public Facebook business page URL | Facebook profile with admin or full control access to the Page. For lead ads, they also need appropriate Business Manager, ad account and lead access permissions. | For leads, DMs and forms: `Settings > Integrations > Facebook & Instagram > Connect`. For social posting: `Marketing > Social Planner > Settings > Connect Social > Facebook Page`. | Correct Page is connected, all requested permissions granted, lead forms mapped if ads are in scope, Messenger enabled if inbox is in scope. |
| Instagram | Public Instagram handle | Business or Creator account. For ads and inbox workflows, the Instagram account should be linked to the correct Facebook Page. | For social posting: `Marketing > Social Planner > Settings > Add Socials > Instagram`. Use Direct Instagram Integration for the simplest publishing setup. For ads and DMs: connect through `Settings > Integrations > Facebook & Instagram`. | Correct Instagram account connected, account is Business or Creator, Facebook Page linkage confirmed where needed, DMs enabled if inbox is in scope. |
| Google Business Profile | Public Google Maps or GBP link | Google account with Owner or Manager access to the verified Business Profile location. | For reviews, reputation and call tracking: `Settings > Integrations > Google Business Profile`. For GBP posts: `Marketing > Social Planner > Add New Social > Connect GBP` or `Reputation > GBP Optimisation`. | Correct location connected, review/reputation sync available, call tracking decision confirmed, GBP posting available if included. |
| TikTok | Public TikTok handle | For posting: TikTok personal or business login. For comment management: TikTok Business Profile. For lead ads: TikTok Business Account, advertiser account access and at least one Instant Form. | For posting: `Marketing > Social Planner > Settings > Add Account > TikTok`. For lead ads, DMs and comment automations: `Settings > Integrations > TikTok`. | Correct TikTok account connected, advertiser account selected if lead ads are included, form fields mapped, test lead or test comment workflow completed where relevant. |
| YouTube | Public YouTube channel URL | Google account that is the primary owner of the YouTube channel. Manager access is not enough for third-party connection. | `Marketing > Social Planner > Connect YouTube` or Google connection flow inside Social Planner. | Correct channel appears, owner account authorised the connection, publishing permissions confirmed if YouTube scheduling is included. |

## Platform Walkthrough Plans

### Facebook Business Page

Customer promise: "Connect your Facebook Page so StudioLAB Growth can support lead ads, Page messages and social posting, depending on your package."

Before they start:

- Confirm this is a Facebook Business Page, not a personal profile.
- Confirm the person connecting has Page admin or full control access.
- For lead ads, confirm they have access to the connected ad account and lead data.
- Ask them to log into the correct Facebook profile in the same browser.

Click path:

1. Log into StudioLAB Growth.
2. Open the correct studio account.
3. Go to `Settings > Integrations`.
4. Select `Facebook & Instagram`.
5. Click `Connect`.
6. Log into Facebook when the pop-up opens.
7. Approve all requested permissions.
8. Select the correct Facebook Page.
9. Click connect or continue.
10. If lead ads are included, open form field mapping and map each form.
11. If inbox is included, enable Facebook and Instagram messaging from the Facebook integration settings.

Video length: 2 to 3 minutes.

Troubleshooting slide:

- If the Page does not appear, the connecting user usually lacks Page or Business Manager permissions.
- If leads do not sync, check lead access permission and form field mapping.
- If permissions were denied, reconnect and grant all requested permissions.

### Instagram

Customer promise: "Connect Instagram so StudioLAB Growth can schedule content, support Reels and Stories where available, and manage inbox workflows when connected through Facebook."

Before they start:

- Confirm the account is Business or Creator.
- If using ads or DMs, confirm Instagram is linked to the correct Facebook Page.
- If using social posting only, use Direct Instagram Integration where available.

Click path for direct social posting:

1. Go to `Marketing > Social Planner`.
2. Click the settings gear.
3. Select `Add Socials`.
4. Choose `Instagram`.
5. Select `Direct Instagram Integration`.
6. Log into Instagram.
7. Grant permissions.
8. Select the correct Instagram Business or Creator account.

Click path for ads, DMs or Facebook-linked setup:

1. Connect the Facebook Page first through `Settings > Integrations > Facebook & Instagram`.
2. Make sure the Instagram account is linked to that Page in Facebook.
3. Enable Instagram messages if inbox features are included.
4. If needed, add Instagram inside `Marketing > Social Planner`.

Video length: 2 minutes.

Troubleshooting slide:

- Personal Instagram accounts cannot be used for the main publishing integration.
- If Instagram is not visible, check whether it is linked to the right Facebook Page or Business Portfolio.
- If the client only wants posting, Direct Instagram Integration is the simpler route.

### Google Business Profile

Customer promise: "Connect Google Business Profile so StudioLAB Growth can support reviews, reputation workflows, local profile visibility and GBP posts where included."

Before they start:

- Confirm the studio has a verified Google Business Profile.
- Confirm the connecting Google account has Owner or Manager access to the location.
- Decide whether GBP call tracking should be enabled.

Click path:

1. Log into StudioLAB Growth.
2. Go to `Settings > Integrations`.
3. Select `Google Business Profile`.
4. Sign in with the Google account that manages the location.
5. Approve requested permissions.
6. Select the correct business location.
7. Choose whether to enable call tracking.
8. Click `Connect`.
9. If GBP posting is included, confirm the profile is available in `Marketing > Social Planner`.

Video length: 2 minutes.

Troubleshooting slide:

- The profile must be verified before connection.
- Owner or Manager access is required.
- Google Business Profile messaging changed in 2024, so do not promise native Google chat. Use connected SMS, WhatsApp or other available messaging paths where configured.

### TikTok

Customer promise: "Connect TikTok so StudioLAB Growth can support TikTok posting, lead ads or comment and DM automations where included."

Before they start:

- Confirm whether the goal is posting only, lead ads, or DMs/comment automations.
- For posting, a TikTok personal or business account can be connected.
- For comment management and stronger business features, use a TikTok Business Profile.
- For lead ads, the studio needs TikTok Business Account or Ads Manager access, advertiser account access, and at least one Instant Form.

Click path for posting:

1. Go to `Marketing > Social Planner`.
2. Click the settings gear.
3. Click `Add Account`.
4. Select TikTok personal or business account.
5. Log into TikTok.
6. Select the correct TikTok account.
7. Confirm it appears in Social Planner.

Click path for lead ads or automations:

1. Go to `Settings > Integrations`.
2. Select the TikTok card.
3. Log into the TikTok Business Account.
4. Confirm all requested permissions.
5. Select the advertiser account if more than one is available.
6. Open TikTok form mapping.
7. Map form fields to StudioLAB Growth fields.
8. Submit a test lead or test automation trigger.

Video length: 2 to 3 minutes.

Troubleshooting slide:

- A TikTok handle alone does not connect lead ads.
- If there are no pages or forms, create at least one Instant Form in TikTok Ads Manager.
- If the advertiser account is not visible, check Business Center and ad account permissions.

### YouTube

Customer promise: "Connect YouTube only if StudioLAB Growth will schedule or publish YouTube videos or Shorts for the studio."

Before they start:

- Confirm the public YouTube channel URL.
- Confirm who is the primary owner of the YouTube channel.
- The primary owner must authorise the connection. Manager access is not enough for third-party connection.

Click path:

1. Go to `Marketing > Social Planner`.
2. Choose the YouTube connection option.
3. Sign in with the Google account that is the primary owner of the YouTube channel.
4. Approve the requested permissions.
5. Select the correct YouTube channel.
6. Confirm the channel appears in connected social accounts.

Video length: 90 seconds to 2 minutes.

Troubleshooting slide:

- If the person has Manager access only, ask the primary owner to complete the connection.
- If the channel does not appear, check that the owner is logged into the correct Google account.
- YouTube is not needed for most lead, review or inbox workflows. It is mainly relevant for publishing and reporting.

## Presentation Structure

### Master Deck

Slide 1: Connect Your Studio Profiles to StudioLAB Growth

Slide 2: Why we ask for profile links first

Explain that links and handles identify the correct public profiles. They do not give StudioLAB access.

Slide 3: No passwords, ever

Explain that the studio owner signs in directly with Facebook, Instagram, Google, TikTok or YouTube, and StudioLAB Growth receives permission through a secure authorisation screen.

Slide 4: What to have ready

List the platform admin logins, two-factor authentication device, correct browser, pop-up blocker disabled, and the studio owner or primary account owner available.

Slide 5: Where connections happen

Show the three connection areas:

- `Settings > Integrations`
- `Marketing > Social Planner`
- `Reputation`

Slide 6: Connection order

Recommended order:

1. Facebook Page
2. Instagram
3. Google Business Profile
4. TikTok
5. YouTube

Slide 7: Facebook walkthrough

Embed or link to the Facebook video.

Slide 8: Instagram walkthrough

Embed or link to the Instagram video.

Slide 9: Google Business Profile walkthrough

Embed or link to the Google video.

Slide 10: TikTok walkthrough

Embed or link to the TikTok video.

Slide 11: YouTube walkthrough

Embed or link to the YouTube video.

Slide 12: How to know it worked

Show connected statuses, connected pages or profiles, and the internal StudioLAB verification checklist.

Slide 13: What to do if something is missing

Explain that missing assets usually mean the wrong login or insufficient platform permissions.

Slide 14: Finished

Ask the studio to message StudioLAB when all relevant accounts show as connected.

### Individual Mini Decks

Each platform mini deck should use the same structure:

1. What this connection allows
2. What access you need before starting
3. Where to click in StudioLAB Growth
4. What the platform authorisation screen looks like
5. Which page, profile, location, advertiser account or channel to select
6. How to confirm it worked
7. What to do if the account does not appear

## Delivery Options

### Option A: Master Deck Plus Five Short Videos

This is the recommended option.

Best for: scalable onboarding, low maintenance and client self-service.

Pros:

- Clear for clients.
- Easy to update one platform video when Meta, Google or TikTok changes a screen.
- Keeps the main onboarding deck stable.
- Works for both self-serve clients and assisted onboarding calls.

Cons:

- Requires a little more production setup at the start.

### Option B: Five Separate Presentations

Best for: sending a client only the platform they need.

Pros:

- Very specific.
- Easy to attach to support replies.

Cons:

- More documents to maintain.
- More likely to drift over time.
- Clients connecting multiple profiles have to jump between files.

### Option C: Live Assisted Setup Plus Leave-Behind Checklist

Best for: higher-touch onboarding.

Pros:

- Highest completion rate.
- Best for clients with messy Meta or Google access.
- Lets StudioLAB catch permission issues immediately.

Cons:

- Less scalable.
- Needs scheduling.
- Still needs the same written/video assets for repeatability.

### Recommended Final Model

Use Option A as the core system, then offer Option C for clients who get stuck or who have complex Facebook, TikTok or Google ownership issues.

## Internal Verification Checklist

After the studio completes setup, StudioLAB should verify:

- Facebook Page appears as connected.
- Facebook lead forms are mapped if lead ads are included.
- Facebook Messenger is enabled if inbox is included.
- Instagram account appears as connected.
- Instagram is Business or Creator.
- Instagram DMs are enabled if inbox is included.
- Google Business Profile location appears as connected.
- Reputation or review sync is active.
- GBP posting is available if content scheduling is included.
- TikTok account appears in Social Planner if posting is included.
- TikTok advertiser account and form mapping are complete if lead ads are included.
- TikTok DM or comment automation can see the account if automation is included.
- YouTube channel appears only if YouTube publishing is included.
- Studio owner access is reduced or left in place according to the account plan.

## Open Decisions For StudioLAB

1. Is TikTok lead ads support part of launch scope, or should the onboarding form say "TikTok handle, optional for future ads"?
2. Do we want every Growth client to connect Social Planner, or only clients on a content management package?
3. Should YouTube be treated as optional profile storage unless video publishing is included?
4. Should the setup user role be temporary, permanent owner admin, or a limited integration-only role?
5. Will StudioLAB offer a 15-minute connection call by default, or only when self-serve setup fails?

## Production Notes

Record the StudioLAB Growth sections in a clean demo account. Use test pages and blur any personal information. For external platform screens, use short up-to-date screen recordings instead of static screenshots where possible, because Meta, Google and TikTok change interface labels often.

Keep every video under three minutes. The client should be able to complete one platform, pause, then move to the next.

## Source Links

- Vendor support: User access and sub-account staff permissions, https://help.gohighlevel.com/support/solutions/articles/48000982600-user-access
- Vendor support: Sub-account roles and permissions, https://help.gohighlevel.com/support/solutions/articles/155000002544-user-roles-permissions-and-assigned-data-subaccount
- Vendor support: OAuth permission transparency, https://help.gohighlevel.com/support/solutions/articles/155000005002-api-security-oauth-consent-for-marketplace-apps
- Vendor support: Facebook integration setup, https://help.gohighlevel.com/support/solutions/articles/48001157632-step-by-step-guide-to-facebook-integration-in-highlevel
- Vendor support: Facebook multi-page lead ads integration, https://help.gohighlevel.com/support/solutions/articles/155000004537-facebook-multi-page-lead-ads-integration
- Vendor support: Facebook Page publishing setup, https://help.gohighlevel.com/support/solutions/articles/48001210327-how-to-connect-to-your-facebook-page-s-
- Vendor support: Facebook and Instagram Messenger setup, https://help.gohighlevel.com/support/solutions/articles/155000005068-getting-started-setup-facebook-and-instagram-messenger
- Vendor support: Instagram direct and Facebook-linked integration, https://help.gohighlevel.com/support/solutions/articles/48001213003-connect-instagram-facebook-linked-vs-direct-instagram-integration
- Vendor support: Google Business Profile integration, https://help.gohighlevel.com/support/solutions/articles/48001222899
- Vendor support: Google Business Profile post scheduler, https://help.gohighlevel.com/support/solutions/articles/155000007212-google-business-profile-gbp-post-scheduler-in-highlevel
- Google support: Manage Business Profile owners and managers, https://support.google.com/business/answer/3403100
- Vendor support: TikTok Social Planner connection, https://help.gohighlevel.com/support/solutions/articles/48001227317-connect-tiktok-in-social-planner
- Vendor support: TikTok lead ads integration, https://help.gohighlevel.com/support/solutions/articles/48001223558-how-to-integrate-tiktok-lead-ads
- Vendor support: TikTok DMs and comment automations, https://help.gohighlevel.com/support/solutions/articles/155000006703-tiktok-dms-comment-automations
- TikTok For Business support: Account and asset permissions, https://ads.tiktok.com/help/article/about-assets-and-asset-level-permissions
- TikTok For Business support: Manage TikTok accounts in Business Center, https://ads.tiktok.com/help/article/manage-tiktok-accounts-business-center
- Vendor support: YouTube scheduling in Social Planner, https://help.gohighlevel.com/support/solutions/articles/155000002838-schedule-your-youtube-shorts-and-videos-in-social-planner
- Google YouTube support: Channel permissions and Brand Account delegation limitations, https://support.google.com/youtube/answer/9367690
