/* Replaces the cold auth-gate card in the six onboarding routes with the
   welcome door (step 0). Run from the repo root:  node scripts/build-welcome-door.js
   Idempotent: it targets the <section id="authGate"> block whichever version
   is currently in the file, so re-running after a copy edit is safe.

   The door keeps every id the auth flow binds to (authGate, authStepEmail,
   authStepCode, authEmail, authSendBtn, authEmailErr, authCode, authVerifyBtn,
   authCodeErr, authSentEmail, authResendBtn) so js/form.js needs no rewiring. */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PLANS = {
  launch: { name: 'Launch',      label: 'Launch',      mins: '5'  },
  scale:  { name: 'Scale',       label: 'Scale',       mins: '10' },
  ai:     { name: 'Dominate AI', label: 'Dominate AI', mins: '15' },
};

const REGIONS = {
  au: { enquiry: 'enquiry', enquiries: 'enquiries', evening: '9.41pm', missed: '5.42pm' },
  us: { enquiry: 'inquiry', enquiries: 'inquiries', evening: '9:41 pm', missed: '5:42 pm' },
};

// Icons are inlined rather than sprited: six static pages, no shared JS bundle,
// and a sprite would be a second network round trip for ~1 kB of paths.
const ICONS = {
  check:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6.5L9.2 17.3 4 12.1"/></svg>',
  doc:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.2 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V7.8z"/><path d="M15 3v5h5"/><path d="M8.6 13.2h6.8"/><path d="M8.6 17h4"/></svg>',
  paths:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h4.5"/><path d="M8.5 12l5-5.5H20"/><path d="M8.5 12l5 5.5H20"/><path d="M17.4 3.8L20 6.5l-2.6 2.7"/><path d="M17.4 14.8L20 17.5l-2.6 2.7"/></svg>',
  spark:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.3 5.6 5.7 2.2-5.7 2.2L12 18.8l-2.3-5.6L4 11l5.7-2.2z"/></svg>',
  clock:  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  tickSm: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  bolt:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z"/></svg>',
  phone:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.7a2 2 0 01-.4 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.5 2.7.6a2 2 0 011.9 2.2z"/></svg>',
  chart:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
};

function door(planKey, regionKey) {
  const p = PLANS[planKey];
  const r = REGIONS[regionKey];

  // Launch has no lead-source connections, so the example enquiry carries no
  // source chip there. Naming Facebook on Launch would imply a capability the
  // plan does not include. Removing the claim is safe on every plan.
  const srcChip = planKey === 'launch'
    ? ''
    : `\n            <span class="dr-src">New ${r.enquiry}, Facebook</span>`;

  return `<section class="dr" id="authGate" aria-labelledby="drTitle">

  <div class="dr-hero">
    <div class="dr-hero-photo" aria-hidden="true"></div>
    <span class="dr-hero-grid" aria-hidden="true"></span>
    <svg class="dr-hero-noise" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <filter id="drNoise"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/></filter>
      <rect width="100" height="100" filter="url(#drNoise)" opacity="0.6"/>
    </svg>

    <div class="dr-hero-inner">
      <p class="dr-badge">${ICONS.tickSm}<span>Account created</span></p>
      <h2 id="drTitle">Welcome to StudioLAB Growth<span class="dr-accent">Let's get you set up</span></h2>
      <p class="dr-lede">You're on <b>${p.name}</b>. There are a few things only you can tell us: your studio's details, your branding, and how you'd like families to hear from you. At the end you choose how much of the setup you'd like us to handle.</p>

      <div class="dr-auth">
        <div class="dr-step-auth" id="authStepEmail">
          <label class="dr-lbl" for="authEmail">Your studio email address</label>
          <div class="dr-row">
            <input class="dr-inp" type="email" id="authEmail" placeholder="sarah@yourstudio.com" autocomplete="email" required>
            <button type="button" class="dr-btn" id="authSendBtn">Get started</button>
          </div>
          <p class="dr-err" id="authEmailErr" role="alert"></p>
        </div>

        <div class="dr-step-auth" id="authStepCode" hidden>
          <p class="dr-sent">We've sent a code to <strong id="authSentEmail"></strong>. If it hasn't arrived in a minute, check your spam folder.</p>
          <label class="dr-lbl" for="authCode">Your 6-digit code</label>
          <div class="dr-row">
            <input class="dr-inp dr-code" type="text" id="authCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456">
            <button type="button" class="dr-btn" id="authVerifyBtn">Verify and start</button>
          </div>
          <p class="dr-err" id="authCodeErr" role="alert"></p>
          <button type="button" class="dr-resend" id="authResendBtn">Use a different email or send a new code</button>
        </div>
      </div>

      <p class="dr-micro">${ICONS.clock}About ${p.mins} minutes, and it saves as you go</p>
    </div>
  </div>

  <div class="dr-track">
    <div class="dr-in">
      <p class="dr-eye">Your setup</p>
      <h3 class="dr-h3">Here's where you're up to</h3>
      <ol class="dr-journey">
        <li class="dr-step dr-done">
          <span class="dr-dot">${ICONS.check}</span>
          <div class="dr-txt"><span class="dr-slbl">Done</span><h4>Account created</h4></div>
        </li>
        <li class="dr-step dr-now" aria-current="step">
          <span class="dr-dot">${ICONS.doc}</span>
          <div class="dr-txt"><span class="dr-slbl">You are here</span><h4>Tell us about your studio</h4></div>
        </li>
        <li class="dr-step dr-next">
          <span class="dr-dot">${ICONS.paths}</span>
          <div class="dr-txt"><span class="dr-slbl">Next</span><h4>Choose your setup and pay</h4></div>
        </li>
        <li class="dr-step dr-end">
          <span class="dr-dot">${ICONS.spark}</span>
          <div class="dr-txt"><span class="dr-slbl">Then</span><h4>Your studio goes live</h4></div>
        </li>
      </ol>
    </div>
  </div>

  <div class="dr-show">
    <div class="dr-in">
      <p class="dr-eye">Once you're live</p>
      <h3>This starts happening on its own</h3>
      <p class="dr-show-sub">Every ${r.enquiry} gets answered straight away, day or night, in your studio's name.</p>

      <div class="dr-cluster">
        <div class="dr-conv">
          <div class="dr-conv-top">
            <span class="dr-pulse" aria-hidden="true"></span>
            <span class="dr-live">Live</span>${srcChip}
            <span class="dr-ago">${r.evening}</span>
          </div>
          <div class="dr-conv-body">
            <div class="dr-msg">
              <span class="dr-av" aria-hidden="true">SC</span>
              <div>
                <div class="dr-who">Sarah Chen</div>
                <div class="dr-bub">Hi, do you have beginner ballet for a 6 year old?</div>
              </div>
            </div>
            <div class="dr-msg dr-out">
              <span class="dr-av" aria-hidden="true">SL</span>
              <div>
                <div class="dr-bub">
                  <span class="dr-auto">${ICONS.bolt}Sent automatically</span>
                  Hi Sarah, we do. Junior Ballet runs Tuesdays at 4pm and the first class is free. Would you like me to save a spot?
                </div>
              </div>
            </div>
          </div>
          <div class="dr-conv-foot">
            <span class="dr-tick" aria-hidden="true">${ICONS.tickSm}</span>
            <span class="dr-ft">Trial booked for Tuesday</span>
            <span class="dr-fm">You did nothing</span>
          </div>
        </div>

        <div class="dr-floats">
          <div class="dr-float dr-f-call">
            <span class="dr-ic" aria-hidden="true">${ICONS.phone}</span>
            <span><b>Missed call, ${r.missed}</b><small>Text sent automatically</small></span>
          </div>
          <div class="dr-float dr-f-week">
            <span class="dr-ic" aria-hidden="true">${ICONS.chart}</span>
            <span><b>14 ${r.enquiries} this week</b><small>9 trials booked</small></span>
          </div>
        </div>
      </div>

      <p class="dr-plan-note">What you get varies by plan. The conversational reply above comes with <b>Dominate AI</b>, and missed-call text-back starts on <b>Scale</b>. On <b>Launch</b>, every ${r.enquiry} still gets an automatic email follow-up.</p>
    </div>
  </div>

</section>`;
}

const ROUTES = [];
for (const region of ['au', 'us']) {
  for (const plan of ['launch', 'scale', 'ai']) {
    ROUTES.push({ region, plan, file: path.join(ROOT, region, plan, 'index.html') });
  }
}

const CSS_LINK = '<link rel="stylesheet" href="/css/door.css?v=20260820a">';
let changed = 0;

for (const route of ROUTES) {
  let html = fs.readFileSync(route.file, 'utf8');
  const before = html;

  // 1. Swap the gate block for the door. Matches the current markup whichever
  //    version it is, anchored on the id rather than the class.
  const gateRe = /<section class="[^"]*" id="authGate"[\s\S]*?\n<\/section>/;
  if (!gateRe.test(html)) {
    console.error('  ! no authGate section found in ' + route.file);
    process.exit(1);
  }
  html = html.replace(gateRe, () => door(route.plan, route.region));

  // 2. Make sure door.css is linked, right after form.css so it can rely on
  //    the base reset without fighting it.
  if (!html.includes('/css/door.css')) {
    html = html.replace(/(<link rel="stylesheet" href="\/css\/form\.css[^>]*>)/,
      '$1\n' + CSS_LINK);
  } else {
    html = html.replace(/<link rel="stylesheet" href="\/css\/door\.css[^>]*>/, CSS_LINK);
  }

  // 3. The door is what renders before any JS runs, so the body starts in the
  //    door state. js/form.js removes the class the moment it hides the gate
  //    (existing session, or preview mode). Without this the first paint shows
  //    the form's cool-grey ground and its progress bar behind the door.
  html = html.replace(/<body(?:\s+class="[^"]*")?>/, '<body class="door-open">');

  if (html !== before) {
    fs.writeFileSync(route.file, html);
    changed++;
    console.log('  updated ' + path.relative(ROOT, route.file));
  } else {
    console.log('  unchanged ' + path.relative(ROOT, route.file));
  }
}
console.log(changed + ' of ' + ROUTES.length + ' routes updated');
