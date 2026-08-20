/* Onboarding copy accuracy fixes, 2026-08-20. Run from the repo root:
     node scripts/apply-copy-fixes.js
   Applies the audit outcomes to all six routes. Every replacement asserts its
   expected hit count, so a miss is a hard failure rather than a silent no-op.
   Idempotent: re-running after the first pass reports "already applied".

   Findings addressed here: U1 (DNS promise), U2 (SSN capture), U3 (Launch
   consent), U4 (texting promise), C1 (form duration), C2 (turnaround),
   C3 (lead sources), C4 (automations line), plus the Done For You
   repositioning Gary called for: neither setup path is hands-off. */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const PLAN_NAME = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };

// ── U2: the SSN field goes entirely. ────────────────────────────────────────
// The platform never asks us for it. A US sole proprietor verifies identity
// through Persona, in their own sub-account, in their own browser, and we
// cannot complete that for them. account.html's sms_a2p task already collects
// the pre-work that IS useful (policy URLs, vertical, opt-in, sample messages)
// and correctly never asks for an SSN. On Launch there is no texting at all.
const SSN_BLOCK = `        <div class="f" id="ssnField" hidden>
          <label for="ssnLast4">Last 4 of owner SSN </label>
          <input type="password" id="ssnLast4" placeholder="••••" inputmode="numeric" maxlength="4" autocomplete="off">
          <span class="field-note">Required by US carriers to register a Sole Proprietor SMS sender. We never see the full number.</span>
          <span class="field-err">Please enter the last 4 digits.</span>
        </div>
`;

const edits = [];
const add = (o) => edits.push(o);

// U2
add({ id: 'U2 remove SSN field', routes: 'all', count: 1, find: SSN_BLOCK, replace: '' });

// U2b: the business-details intro claimed we register their number. They do.
add({
  id: 'U2b business details intro', routes: 'all', count: 1,
  find: "which US and Australian law require, and on text-enabled plans they are also what registers your studio's texting number with the carriers. You will only enter them once.",
  replace: 'which US and Australian law require. On plans with text messaging you use them again when you register your number, which happens inside StudioLAB Growth. You will only enter them once.',
});

// U1: we cannot publish records on a domain we have no access to. Say what we
// do, say what they do, and let the answer route them toward Done For You.
add({
  id: 'U1 domain card intro', routes: 'all', count: 1,
  find: 'Sending from your own domain (e.g. @yourstudio.com) helps your emails land in the inbox instead of the spam folder. If you would like this, just tell us the domain and <strong>we set up SPF, DKIM, and DMARC for you during onboarding.</strong> There is nothing technical for you to do.',
  replace: 'Sending from your own domain (e.g. @yourstudio.com) helps your emails land in the inbox instead of the spam folder. Tell us the domain and we work out the exact records to add. <strong>Adding them changes settings on your domain, so it needs someone with access to your DNS.</strong> On Done-For-You we do it with you on a call. On Guided we send you the records and a walkthrough.',
});
add({
  id: 'U1 domain field note', routes: 'all', count: 1,
  find: 'Just the domain, not a full URL. We handle all the technical setup during onboarding, so you will not need to touch any DNS records yourself.',
  replace: 'Just the domain, not a full URL. We send you the exact SPF, DKIM and DMARC records and walk you through adding them.',
});

// U3: Launch is email only. Do not collect authorisation for a channel the
// studio has not bought. Revisit if they upgrade.
add({
  id: 'U3 consent, AU Launch', routes: ['au/launch'], count: 1,
  find: 'I authorise StudioLAB Growth to send emails and text messages to my families',
  replace: 'I authorise StudioLAB Growth to send emails to my families',
});
add({
  id: 'U3 consent, US Launch', routes: ['us/launch'], count: 1,
  find: 'I authorize StudioLAB Growth to send emails and text messages to my families',
  replace: 'I authorize StudioLAB Growth to send emails to my families',
});

// U4: buying the number, the regulatory bundle and the carrier identity checks
// are the studio's to complete. We prepare what we can and sit with them.
add({
  id: 'U4 texting card, AU', routes: ['au/scale', 'au/ai'], count: 1,
  find: 'Text messaging powers your SMS automations and missed-call text-back. If you would like it, we set up your texting number and handle the carrier registration for you during onboarding. You do not need a provider or any technical setup.',
  replace: 'Text messaging powers your SMS automations and missed-call text-back. Getting it live means buying your studio&#39;s number and clearing the carrier checks every business has to clear before it can text. <strong>Some of those steps only you can complete, because they verify your identity and your business.</strong> We prepare everything we can, then walk you through the rest, on a call if you would like one.',
});
add({
  id: 'U4 texting card, US', routes: ['us/scale', 'us/ai'], count: 1,
  find: 'Text messaging powers your SMS automations and missed-call text-back. If you would like it, we set up your texting number and handle the carrier registration (A2P / 10DLC) for you during onboarding. You do not need a provider or any technical setup.',
  replace: 'Text messaging powers your SMS automations and missed-call text-back. Getting it live means buying your studio&#39;s number and clearing A2P / 10DLC registration, which every business has to clear before it can text. <strong>Some of those steps only you can complete, because they verify your identity and your business.</strong> We prepare everything we can, then walk you through the rest, on a call if you would like one.',
});

// C1 + C2: one duration and one turnaround, per plan, everywhere.
add({
  id: 'C1/C2 step 1 timing, Launch', routes: ['au/launch', 'us/launch'], count: 1,
  find: 'Takes about 10 minutes. Your account is typically ready in 3 to 7 business days.',
  replace: 'Takes about 10 minutes and it saves as you go. Most studios are live within 3 to 5 business days of finishing setup.',
});
add({
  id: 'C1/C2 step 1 timing, Scale', routes: ['au/scale', 'us/scale'], count: 1,
  find: 'Takes about 15 minutes. Your account is typically ready in 3 to 7 business days.',
  replace: 'Takes about 10 minutes and it saves as you go. Most studios are live within 3 to 5 business days of finishing setup.',
});
add({
  id: 'C1 step 1 timing, AI', routes: ['au/ai', 'us/ai'], count: 1,
  find: /This form takes about 10 minutes\. (Straight|Right) after payment/,
  replace: 'This form takes about 10 minutes and it saves as you go. $1 after payment',
});
add({
  // Superseded by the knowledge-base retirement below, which rewrote this
  // sentence again. Kept so a fresh checkout still applies both in order.
  id: 'C2 step 1 turnaround, AI', routes: ['au/ai', 'us/ai'], count: 1,
  doneWhen: 'once your AI chat and voice agents are set up and tested',
  find: 'Your account typically goes live 7 to 10 business days after we review and approve the knowledge base.',
  replace: 'Most studios are live within 7 to 10 business days, once we have reviewed and approved your knowledge base.',
});

// C3: we cannot connect lead sources from a form answer. Stop asking studios
// to prepare an answer we never collect.
add({
  id: 'C3 drop lead-source prep line', routes: ['au/scale', 'us/scale'], count: 1,
  find: '        <li>Which lead sources to connect: Facebook Lead Ads, Google Business Messages, website chat</li>\n',
  replace: '',
});
add({
  id: 'C3 step 4 title', routes: ['au/scale', 'au/ai', 'us/scale', 'us/ai'], count: 1,
  find: '<h2 class="sh-title">Text messaging and lead sources</h2>',
  replace: '<h2 class="sh-title">Text messaging and your public listing</h2>',
});
add({
  id: 'C3 step 4 description, Scale', routes: ['au/scale', 'us/scale'], count: 1,
  find: 'Optional setup for SMS automations and lead-source tracking on your Scale plan. Add what is useful and skip the rest.',
  replace: 'Both optional. Tell us whether you want text messaging, and share your Google Business listing so we can set your review requests up correctly.',
});
add({
  // Its tail sentence was rewritten again by the knowledge-base retirement
  // below, so match on the part that survived both edits.
  id: 'C3 step 4 description, AI', routes: ['au/ai', 'us/ai'], count: 1,
  doneWhen: 'share your Google Business listing so we can set your review requests up correctly',
  find: 'Optional setup for SMS automations, missed-call text-back, lead-source tracking, and AI chat on your Dominate AI plan. Add what is useful and skip the rest.',
  replace: 'Both optional. Tell us whether you want text messaging, and share your Google Business listing so we can set your review requests up correctly. Your AI chat is set up from the knowledge base you confirm after payment.',
});
add({
  id: 'C3 public listing, connecting is joint', routes: ['au/scale', 'au/ai', 'us/scale', 'us/ai'], count: 1,
  find: 'It lets your setup team see how your studio presents itself today and set your review requests up correctly. Optional, and we work from whatever you provide.',
  replace: 'It lets your setup team see how your studio presents itself today and set your review requests up correctly. Connecting it is something we do together, on a call or by following the walkthrough we send. Optional, and we work from whatever you provide.',
});

// U4b: the prep list promised we handle the number and carrier setup.
add({
  id: 'U4b prep list, texting line', routes: ['au/scale', 'au/ai', 'us/scale', 'us/ai'], count: 1,
  find: '<li>Whether you would like us to set up text messaging for you (we handle the number and carrier setup)</li>',
  replace: '<li>Whether you want text messaging turned on (a few of the steps need you, and we walk you through them)</li>',
});

// The Done-For-You repositioning. Gary: the goal is not hands-off. Say what
// only they can do, before they choose, so the choice is about how much we sit
// with them rather than whether they touch it at all.
add({
  id: 'DFY repositioning, setup intro', routes: 'all', count: 1,
  find: /You can have us build the whole account for you, or follow our guided checklist and configure it yourself\. Same outcome either way, so pick what fits your time and confidence\./,
  replace: 'Neither option is hands-off. A few things can only be done by you, because they need your logins, your domain, or your identity: connecting your social accounts, adding records to your domain, and verifying your business with the phone carriers. What changes is how much of the rest we do, and whether we are on the call while you do your part.',
});

add({
  id: 'Review header, honest next step', routes: 'all', count: 1,
  find: 'Check everything before submitting. Our team will review your information, contact you shortly to begin configuration.',
  replace: 'Check everything before submitting. We review what you have sent and get in touch to book your setup in.',
});

// Setup-card markup carried the old hands-off description and the old
// timings. js/form.js repaints both on load, but the markup is what a studio
// sees for the first frame, so it has to be right on its own.
const DFY_DESC = 'We do the bulk of the build, and sit with you on a call for the parts that need your logins, your domain, or your identity.';
const AI_DESC = 'Everything in Done-For-You, plus your knowledge base build, AI chat and voice agent setup and testing, and a live walkthrough.';
const GUIDED_DESC = 'You work through our checklist at your own pace. We send a walkthrough for each step that needs your own logins, and we are on hand if you get stuck.';

add({
  id: 'DFY card aria-label', routes: 'all', count: 1,
  find: 'aria-label="Done-For-You: our team configures your account, typically 5 to 7 business days"',
  replace: 'aria-label="Done-For-You: ' + DFY_DESC + '"',
});
add({
  id: 'Guided card aria-label', routes: 'all', count: 1,
  find: 'aria-label="Guided self-setup: configure your own account with our step-by-step checklist"',
  replace: 'aria-label="Guided (self-setup): ' + GUIDED_DESC + '"',
});
add({
  id: 'DFY card description (non-AI)', routes: ['au/launch', 'au/scale', 'us/launch', 'us/scale'], count: 1,
  find: 'Our team configures your entire account. You provide the information, we handle everything else. Typically 5 to 7 business days.',
  replace: DFY_DESC,
});
add({
  // Superseded by the knowledge-base retirement below. Same reason as above.
  id: 'DFY card description (AI)', routes: ['au/ai', 'us/ai'], count: 1,
  doneWhen: 'plus your AI chat and voice agent setup and testing',
  find: 'Our team configures your entire account. You provide the information, we handle everything else. Typically 5 to 7 business days.',
  replace: AI_DESC,
});
add({
  id: 'Guided card description', routes: 'all', count: 1,
  find: 'You configure your own account using our step-by-step checklist, with support available if you get stuck. Typically 3 to 5 business days.',
  replace: GUIDED_DESC,
});

// The AI knowledge base is no longer ours. StudioLAB Growth builds and
// populates it itself, facts and rules both, from the studio's own data. We do
// not capture it, scrape for it, or hand it over, so every promise about
// building it with them comes out.
add({
  id: 'KB retired: AI intro line', routes: ['au/ai', 'us/ai'], count: 1,
  find: "Both answer from a knowledge base you'll build with us, so the AI never invents anything about your studio.",
  replace: 'Both answer from your own studio data, already in StudioLAB, so the AI never invents anything about your studio.',
});
add({
  id: 'KB retired: AI form-length line', routes: ['au/ai', 'us/ai'], count: 1,
  find: /This form takes about 10 minutes and it saves as you go\. (Straight|Right) after payment we scan your website and pre-fill your AI knowledge base for you, then you confirm it, tweak anything that isn't quite right, and you're done\./,
  replace: "This form takes about 10 minutes and it saves as you go. There is nothing to fill in afterwards: your AI already knows your studio from your StudioLAB data.",
});
add({
  id: 'KB retired: AI turnaround line', routes: ['au/ai', 'us/ai'], count: 1,
  find: 'Most studios are live within 7 to 10 business days, once we have reviewed and approved your knowledge base.',
  replace: 'Most studios are live within 7 to 10 business days, once your AI chat and voice agents are set up and tested.',
});
add({
  id: 'KB retired: AI prep-list website line', routes: ['au/ai', 'us/ai'], count: 1,
  find: "        <li>Your studio's website URL, which we scan the moment you pay and pre-fill your AI knowledge base from it. No website yet? You can still add one on the next screen, or fill the knowledge base in by hand.</li>\n",
  replace: "        <li>Your studio's website URL, so your setup team can see how you present yourself today</li>\n",
});
add({
  id: 'KB retired: AI card heading', routes: ['au/ai', 'us/ai'], count: 1,
  find: 'Your AI knowledge base, pre-filled from your website',
  replace: 'Your AI already knows your studio',
});
add({
  id: 'KB retired: AI card body 1', routes: ['au/ai', 'us/ai'], count: 1,
  find: 'The most important part of Dominate AI is your knowledge base. Class info, pricing, policies, FAQs, voice agent rules: everything the AI is allowed to say to your families.',
  replace: 'Your class info, pricing, policies and schedule already live in StudioLAB, and that is where your AI reads them from. It stays current on its own as your timetable and fees change.',
});
add({
  id: 'KB retired: AI card body 2', routes: ['au/ai', 'us/ai'], count: 1,
  find: 'The moment you hit pay we scan your website and pre-fill the whole thing for you. You review the result on the next screen, edit anything we got wrong, and confirm. Five to ten focused minutes instead of an hour. Setup begins as soon as you pay; the AI chat widget and voice agent activate once we\'ve reviewed your confirmed knowledge base.',
  replace: 'It also holds its own rules about what it will and will not say, including never confirming pricing to a family. There is nothing for you to write or approve. Setup begins as soon as you pay, and your AI chat widget and voice agent activate once they are configured and tested.',
});
add({
  id: 'KB retired: AI done-screen copy', routes: ['au/ai', 'us/ai'], count: 1,
  find: "We've got everything we need to get your Dominate AI setup underway. Our team will review your knowledge base, send you a summary for approval, then activate your AI chat and voice agents.",
  replace: "We've got everything we need to get your Dominate AI setup underway. Our team will configure and test your AI chat and voice agents, then let you know the moment they are live.",
});
add({
  id: 'KB retired: AI setup card desc', routes: ['au/ai', 'us/ai'], count: 1,
  find: 'Everything in Done-For-You, plus your knowledge base build, AI chat and voice agent setup and testing, and a live walkthrough.',
  replace: 'Everything in Done-For-You, plus your AI chat and voice agent setup and testing, and a live walkthrough.',
});

add({
  id: 'KB retired: step 4 AI tail', routes: ['au/ai', 'us/ai'], count: 1,
  doneWhen: 'set up from your StudioLAB data, so there is nothing to confirm',
  find: ' Your AI chat is set up from the knowledge base you confirm after payment.',
  replace: ' Your AI chat is set up from your StudioLAB data, so there is nothing to confirm afterwards.',
});

// The business email is not the sign-in email, and studios were not told that.
// The account was created with whichever address signed up; this is the address
// the studio actually wants families and the platform to use. Gary flagged the
// two are often different, so the field now says so rather than leaving a
// studio to assume we already have it.
add({
  id: 'Business email: say why we are asking', routes: 'all', count: 1,
  find: '<span class="field-note" id="businessEmailNote">Used on your business profile, invoices, and SMS sender registration.</span>',
  replace: '<span class="field-note" id="businessEmailNote">Your studio&#39;s main contact address, which is often not the one you signed up with. It goes on your invoices and your business profile, and on text-enabled plans it is used to register your number.</span>',
});

// D1: the done screen is reachable only by the spam honeypot and by "save for
// later", and both rewrite its text. Align the defaults anyway and say so in
// the markup, so the next reader does not chase a contradiction that no studio
// can see. (This session nearly filed it as a live defect.)
add({
  id: 'D1 done-screen note + timeline (non-AI)', routes: ['au/launch', 'au/scale', 'us/launch', 'us/scale'], count: 1,
  find: '<span class="done-detail-val" id="done-timeline">Typically 3 to 5 business days</span>',
  replace: '<span class="done-detail-val" id="done-timeline">Most studios are live within 3 to 5 business days</span>',
});
add({
  id: 'D1 done-screen note + timeline (AI)', routes: ['au/ai', 'us/ai'], count: 1,
  find: '<span class="done-detail-val" id="done-timeline">Typically 5 to 10 business days</span>',
  replace: '<span class="done-detail-val" id="done-timeline">Most studios are live within 7 to 10 business days</span>',
});
add({
  // The find string is a substring of the replacement, so an `includes` check
  // can never tell "already applied" from "not yet". Anchor on the preceding
  // markup instead, which the replacement removes, making the match one-shot.
  id: 'D1 done-screen provenance comment', routes: 'all', count: 1,
  find: '\n<div class="done-screen" id="doneScreen"',
  replace: [
    '',
    '<!-- Reached only by js/form.js showDone() (spam-honeypot branch) and',
    '     showSavedForLater(). BOTH rewrite the title, description and timeline',
    '     below, so this text is a fallback that no studio sees on the normal',
    '     path (step 5 goes to Stripe, then to account.html). Keep it truthful',
    '     anyway; do not treat it as the live success copy. -->',
    '<div class="done-screen" id="doneScreen"',
  ].join('\n'),
  // Marks this edit as done without relying on the replacement text.
  doneWhen: 'Reached only by js/form.js showDone()',
});

// C4: the automations line is now driven by the setup choice in js/form.js.
// The markup keeps a sensible default for the pre-selection paint.
for (const [key, name] of Object.entries(PLAN_NAME)) {
  add({
    id: `C4 automations default (${key})`,
    routes: [`au/${key}`, `us/${key}`], count: 1,
    find: `<div class="sum-v" id="sv-automations">All ${name} automations will be activated during setup</div>`,
    replace: `<div class="sum-v" id="sv-automations">We switch on all ${name} automations for you</div>`,
  });
}

// ── Apply ───────────────────────────────────────────────────────────────────
const ALL = ['au/launch', 'au/scale', 'au/ai', 'us/launch', 'us/scale', 'us/ai'];
let applied = 0, skipped = 0, failed = 0;

for (const route of ALL) {
  const file = path.join(ROOT, route, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  for (const e of edits) {
    const routes = e.routes === 'all' ? ALL : e.routes;
    if (!routes.includes(route)) continue;

    // Some edits leave their own find string intact (a comment inserted above
    // the markup it anchors on), so matching is not proof of "not yet done".
    // doneWhen is the authoritative signal where one is given.
    if (e.doneWhen && html.includes(e.doneWhen)) { skipped++; continue; }

    const isRe = e.find instanceof RegExp;
    const hits = isRe
      ? (html.match(new RegExp(e.find.source, 'g')) || []).length
      : html.split(e.find).length - 1;

    if (hits === 0) {
      // Already applied? A deletion leaves nothing to look for, and a regex
      // replacement carrying $1 cannot be matched literally, so both are
      // treated as done once the original text is gone. Everything else has
      // to show its replacement before we call it applied.
      const isDeletion = e.replace === '';
      const hasBackref = typeof e.replace === 'string' && /\$\d/.test(e.replace);
      const done = isDeletion || hasBackref || html.includes(e.replace);
      if (done) { skipped++; continue; }
      console.error(`  FAIL ${route}: "${e.id}" matched 0 times and the replacement is absent`);
      failed++;
      continue;
    }
    if (hits !== e.count) {
      console.error(`  FAIL ${route}: "${e.id}" matched ${hits} times, expected ${e.count}`);
      failed++;
      continue;
    }
    html = isRe
      ? html.replace(new RegExp(e.find.source, 'g'), e.replace)
      : html.split(e.find).join(e.replace);
    if (process.env.VERBOSE) console.log(`    applied ${route}: ${e.id}`);
    applied++;
  }

  if (html !== before) {
    fs.writeFileSync(file, html);
    console.log(`  wrote ${route}/index.html`);
  } else {
    console.log(`  ${route}/index.html unchanged`);
  }
}

console.log(`\n${applied} edits applied, ${skipped} already in place, ${failed} failed`);
if (failed) process.exit(1);
