const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = "/Users/gary/Library/CloudStorage/Dropbox/Gary's Files/StudioLAB/Media:Graphic Design/Email Design System";
const OUT_ROOT = path.join(ROOT, "15-growth-onboarding-production-library");
const SOURCE_ROOT = path.join(ROOT, "02-source-images");
const GROWTH_LOGO = "/Users/gary/Claude_Projects/Growth - Onboarding/assets/growth-logo.svg";

const ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const GEORGIA_BOLD = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf";

const W = 1200;
const H = 736;
const LOWER_W = 1200;
const LOWER_H = 430;
const LOGO_W = 1200;
const LOGO_H = 240;

const COLORS = {
  canvas: "#faf6f1",
  surface: "#ffffff",
  ink: "#241a1d",
  body: "#3d3035",
  muted: "#706168",
  hairline: "#ebe4dd",
  blush: "#ec639e",
  cobalt: "#4a429b",
  violet: "#a65fa6",
  heroPink: "#f4a3c7",
  blushTint: "#fde8f2",
  lilacTint: "#ece8f4",
};

const EMAILS = [
  {
    id: "SLG-ON-01",
    stage: "Growth Onboarding",
    title: "Growth request received",
    trigger: "Studio submits a StudioLAB Growth access or upgrade request.",
    goal: "Confirm the request has been received, set expectations for what happens next, and keep the studio reassured while setup is reviewed.",
    subject: "We received your StudioLAB Growth request",
    preview: "Your request has been received. We will review it and let you know the next step.",
    heroEyebrow: "STUDIOLAB GROWTH",
    heroHeadline: "Growth request received.",
    heroSubline: "We have received your request and will guide you through the next step.",
    body: `Hi {{contact.first_name}},

Thanks for requesting StudioLAB Growth for {{contact.studio_name}}.

We have received your request and will review the details so we can make sure the right Growth setup is prepared for your studio.

There is nothing you need to do right now. Once your request has been reviewed, we will send the next step so you can activate your access and keep the setup moving.

If you had something specific in mind for Growth, such as inquiry follow-up, trial reminders, enrollment communication, review requests, or family engagement, just reply to this email and let us know.`,
    contextTitle: "What happens next",
    contextLabel: "Request received",
    contextText:
      "We will review your request, confirm the right Growth setup path, and send the next step once your account is ready to activate.",
    primaryCta: "Reply With Setup Notes",
    primaryUrl: "mailto:support@studiolabsoftware.com",
    secondaryLine:
      "If there is nothing extra to add, you can leave this with us. We will let you know when the next step is ready.",
    secondaryCta: "Reply with questions",
    secondaryUrl: "mailto:support@studiolabsoftware.com",
    signature: "Gary\nFounder, StudioLAB",
    heroSource: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-growth-communication-source.png"),
    lowerSource: path.join(SOURCE_ROOT, "generated-software", "studiolab-growth-communication-hub-source.png"),
  },
  {
    id: "SLG-ON-02",
    stage: "Growth Onboarding",
    title: "Growth is ready to activate",
    trigger: "StudioLAB Growth option has been enabled inside the studio's StudioLAB account, but the studio has not activated/sign-up yet.",
    goal: "Let the studio know Growth is available inside StudioLAB and send them back to their StudioLAB account to activate it from Settings.",
    subject: "StudioLAB Growth is ready to activate",
    preview: "Sign in to StudioLAB, open Settings, and activate StudioLAB Growth when you are ready.",
    heroEyebrow: "GROWTH IS READY",
    heroHeadline: "Turn on Growth from StudioLAB.",
    heroSubline: "Sign in, open Settings, and activate StudioLAB Growth.",
    body: `Hi {{contact.first_name}},

Great news, StudioLAB Growth is now available to activate inside your StudioLAB account for {{contact.studio_name}}.

When you are ready, sign in to StudioLAB and open Settings. From there, choose StudioLAB Growth and follow the prompts to activate it for your studio.

Once that step is complete, we can keep moving with your Growth setup. If anything looks unclear when you get there, reply to this email and we will help you work through it.`,
    contextTitle: "Where to find it",
    contextLabel: "Inside StudioLAB",
    contextText:
      "Sign in to StudioLAB, go to Settings, then choose StudioLAB Growth. That is where you can activate Growth for your studio and complete the sign-up step.",
    primaryCta: "Open StudioLAB Account",
    primaryUrl: "{{dashboard_url}}",
    secondaryLine:
      "If you do not see the Growth option, or you are not sure which step to choose, reply here and we will help you get it sorted.",
    secondaryCta: "Reply for help",
    secondaryUrl: "mailto:support@studiolabsoftware.com",
    signature: "Gary\nFounder, StudioLAB",
    heroSource: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-setup-collaboration-source.png"),
    lowerSource: path.join(SOURCE_ROOT, "generated-software", "studiolab-automation-follow-up-source.png"),
  },
  {
    id: "SLG-ON-03",
    stage: "Growth Onboarding",
    title: "Growth activation reminder",
    trigger: "24 hours after StudioLAB Growth is enabled in StudioLAB if the studio has not activated/sign-up yet.",
    goal: "Remind the studio that Growth can be activated from inside StudioLAB Settings and give them a support path if they are stuck.",
    subject: "Need a hand activating StudioLAB Growth?",
    preview: "Growth is available in your StudioLAB Settings. Reply if you need help turning it on.",
    heroEyebrow: "ACTIVATION REMINDER",
    heroHeadline: "Growth is ready when you are.",
    heroSubline: "Open StudioLAB Settings to activate Growth for your studio.",
    body: `Hi {{contact.first_name}},

StudioLAB Growth is available to activate inside your StudioLAB account for {{contact.studio_name}}, but it looks like it has not been turned on yet.

If now is still the right time, sign in to StudioLAB, open Settings, and choose StudioLAB Growth to activate it for your studio.

Once that step is complete, we can keep moving with your Growth setup. If you are unsure what to choose or cannot see the option, reply to this email and we will help you get it sorted.`,
    contextTitle: "Quick path back in",
    contextLabel: "Quick reminder",
    contextText:
      "Open your StudioLAB account, go to Settings, then choose StudioLAB Growth. That is the activation point before we move into the Growth account setup steps.",
    primaryCta: "Open StudioLAB Settings",
    primaryUrl: "{{dashboard_url}}",
    secondaryLine:
      "Questions before activating? Reply here and we will help you choose the right next step.",
    secondaryCta: "Reply for help",
    secondaryUrl: "mailto:support@studiolabsoftware.com",
    signature: "Gary\nFounder, StudioLAB",
    heroSource: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-support-call-source.png"),
    lowerSource: path.join(SOURCE_ROOT, "generated-software", "studiolab-growth-communication-hub-source.png"),
  },
  {
    id: "SLG-ON-04",
    stage: "Growth Onboarding",
    title: "Set up your Growth login",
    trigger: "StudioLAB Growth account has been created after activation; user has not created a password yet.",
    goal: "Get the studio owner or admin to create their Growth login password so StudioLAB can continue the Growth account setup.",
    subject: "Action needed: set up your StudioLAB Growth login",
    preview: "Create your password so we can keep your Growth setup moving.",
    heroEyebrow: "STUDIOLAB GROWTH SETUP",
    heroHeadline: "Your Growth account is ready.",
    heroSubline: "Create your password so we can keep your setup moving.",
    body: `Hi {{user.first_name}},

Your StudioLAB Growth account has been created, and we are ready to keep moving with your setup.

Before we can finish configuring your account, please sign in once and create your password. This confirms your user access and gives us the access step we need before we continue setting up the Growth tools for your studio.

Use this email address when you sign in:
{{user.email}}

Click the button below to create your password and confirm your login.`,
    contextTitle: "Your login details",
    contextLabel: "Account details",
    contextText: `First name: {{user.first_name}}
Last name: {{user.last_name}}
User email: {{user.email}}`,
    primaryCta: "Set Up My Login",
    primaryUrl: "Use the confirmed StudioLAB Growth account invite or password setup link.",
    secondaryLine:
      "Once your login is active, we can keep moving with your StudioLAB Growth setup. If anything gets stuck, reply here and we will help you get access sorted.",
    secondaryCta: "Reply for help",
    secondaryUrl: "mailto:support@studiolabsoftware.com",
    signature: "Gary\nFounder, StudioLAB",
    heroSource: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-growth-communication-source.png"),
    lowerSource: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-growth-communication-source.png"),
  },
  {
    id: "SLG-ON-05",
    stage: "Growth Onboarding",
    title: "Your Growth setup is live",
    trigger: "StudioLAB Growth setup marked complete after the account, included workflows, and launch configuration are ready.",
    goal: "Celebrate that Growth is live, explain what has been enabled in plain language, and give the studio a simple login or support path.",
    subject: "Your StudioLAB Growth setup is live",
    preview: "Your Growth setup is active and ready to start supporting your studio.",
    heroEyebrow: "STUDIOLAB GROWTH LIVE",
    heroHeadline: "You're live with Growth.",
    heroSubline: "Your setup is active and ready to start supporting your studio.",
    body: `Hi {{contact.first_name}},

Congratulations, your StudioLAB Growth setup for {{contact.studio_name}} is now live.

We have finished the setup work for the Growth tools included in your account, and your studio is ready to start using the workflows we have configured for you.

This gives your studio a stronger communication layer around inquiries, trials, enrollment follow-up, reviews, family engagement, and the other Growth automations included in your setup.

Click below to open StudioLAB Growth and take a look around.`,
    contextTitle: "Your follow-up layer is switched on",
    contextLabel: "What is now working",
    contextText:
      "StudioLAB Growth can now support the touchpoints that usually take extra admin time: new inquiries, trial reminders, enrollment nudges, review requests, and ongoing family communication based on the setup completed for your studio.",
    primaryCta: "Open StudioLAB Growth",
    primaryUrl: "Use the confirmed StudioLAB Growth app or login URL for this studio.",
    secondaryLine:
      "Want us to walk you through what has been configured? Reply to this email and we can show you where everything lives and what is now running.",
    secondaryCta: "Reply for a walkthrough",
    secondaryUrl: "mailto:support@studiolabsoftware.com",
    signature: "Gary\nFounder, StudioLAB",
    heroSource: path.join(SOURCE_ROOT, "generated-student-class", "studiolab-class-high-five-source.png"),
    lowerSource: path.join(SOURCE_ROOT, "generated-software", "studiolab-growth-communication-hub-source.png"),
  },
];

function runMagick(args) {
  execFileSync("magick", args, { stdio: "pipe" });
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clean(value) {
  return String(value || "")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function folderName(email, index) {
  return `${String(index + 1).padStart(2, "0")}-${email.id.toLowerCase()}-${slugify(email.title)}`;
}

function wrapText(text, maxChars) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function heroTextLayout(email) {
  const headlineLines = wrapText(email.heroHeadline, 24).slice(0, 3);
  const sublineLines = wrapText(email.heroSubline, 46).slice(0, 3);
  const eyebrowSize = 24;
  const headlineSize = 80;
  const headlineLineHeight = 86;
  const sublineSize = 32;
  const sublineLineHeight = 42;
  const totalHeight = 30 + 24 + headlineLines.length * headlineLineHeight + 22 + sublineLines.length * sublineLineHeight;
  const y = Math.max(222, H - 72 - totalHeight);
  return {
    x: 68,
    y,
    eyebrowSize,
    headlineSize,
    headlineLineHeight,
    sublineSize,
    sublineLineHeight,
    headlineLines,
    sublineLines,
    eyebrowBaseline: y + eyebrowSize,
    headlineBaselines: headlineLines.map((_, i) => y + 30 + 24 + i * headlineLineHeight + headlineSize * 0.82),
    sublineBaselines: sublineLines.map((_, i) => {
      const sublineTop = y + 30 + 24 + headlineLines.length * headlineLineHeight + 22;
      return sublineTop + i * sublineLineHeight + sublineSize * 0.82;
    }),
  };
}

function renderGrowthLogo(dest, width) {
  const tempDir = path.dirname(dest);
  const tempSvg = path.join(tempDir, "_growth-logo-no-live-text.svg");
  const tempBase = path.join(tempDir, "_growth-logo-base.png");
  const scale = width / 330;
  const svg = fs.readFileSync(GROWTH_LOGO, "utf8").replace(/<text id="Growth"[\s\S]*?<\/text>/, "");

  fs.writeFileSync(tempSvg, svg);
  runMagick(["-density", "600", "-background", "none", tempSvg, "-resize", `${width}x`, tempBase]);
  runMagick([
    tempBase,
    "-font",
    ARIAL_BOLD,
    "-pointsize",
    String(Math.round(20 * scale)),
    "-fill",
    COLORS.ink,
    "-kerning",
    String(3.3 * scale),
    "-annotate",
    `+${Math.round(144 * scale)}+${Math.round(70 * scale)}`,
    "GROWTH",
    dest,
  ]);

  [tempSvg, tempBase].forEach((file) => fs.rmSync(file, { force: true }));
}

function createTopLogo(dest) {
  const tempLogo = path.join(path.dirname(dest), "_growth-logo-top.png");
  renderGrowthLogo(tempLogo, 640);
  runMagick([
    "-size",
    `${LOGO_W}x${LOGO_H}`,
    `xc:${COLORS.surface}`,
    tempLogo,
    "-gravity",
    "center",
    "-geometry",
    "+0-24",
    "-composite",
    "-gravity",
    "south",
    "-font",
    ARIAL_BOLD,
    "-pointsize",
    "28",
    "-fill",
    COLORS.ink,
    "-annotate",
    "+0+28",
    "Marketing and automation for dance studios",
    dest,
  ]);
  fs.rmSync(tempLogo, { force: true });
}

function createHero(email, dest) {
  const tempBase = path.join(path.dirname(dest), "_hero-base.png");
  const tempBottom = path.join(path.dirname(dest), "_hero-bottom-gradient.png");
  const tempLeft = path.join(path.dirname(dest), "_hero-left-gradient.png");
  const tempText = path.join(path.dirname(dest), "_hero-text.png");
  const layout = heroTextLayout(email);

  runMagick([email.heroSource, "-resize", `${W}x${H}^`, "-gravity", "center", "-extent", `${W}x${H}`, tempBase]);
  runMagick(["-size", `${W}x${H}`, "gradient:rgba(36,26,29,0)-rgba(36,26,29,0.74)", tempBottom]);
  runMagick(["-size", `${H}x${W}`, "gradient:rgba(36,26,29,0.64)-rgba(36,26,29,0)", "-rotate", "90", "-resize", `${W}x${H}!`, tempLeft]);
  runMagick([tempBase, tempBottom, "-compose", "over", "-composite", tempBase]);
  runMagick([tempBase, tempLeft, "-compose", "over", "-composite", tempBase]);

  const textArgs = ["-size", `${W}x${H}`, "xc:none"];
  textArgs.push("-font", ARIAL_BOLD, "-pointsize", String(layout.eyebrowSize), "-fill", COLORS.heroPink, "-kerning", "2.8");
  textArgs.push("-annotate", `+${layout.x}+${Math.round(layout.eyebrowBaseline)}`, clean(email.heroEyebrow).toUpperCase());
  textArgs.push("-kerning", "0", "-font", GEORGIA_BOLD, "-pointsize", String(layout.headlineSize), "-fill", COLORS.surface);
  layout.headlineLines.forEach((line, i) => {
    textArgs.push("-annotate", `+${layout.x}+${Math.round(layout.headlineBaselines[i])}`, clean(line));
  });
  textArgs.push("-font", ARIAL_BOLD, "-pointsize", String(layout.sublineSize), "-fill", "rgba(255,255,255,0.94)");
  layout.sublineLines.forEach((line, i) => {
    textArgs.push("-annotate", `+${layout.x}+${Math.round(layout.sublineBaselines[i])}`, clean(line));
  });
  textArgs.push(tempText);
  runMagick(textArgs);
  runMagick([tempBase, tempText, "-compose", "over", "-composite", "-sampling-factor", "4:4:4", "-quality", "92", "-strip", dest]);

  [tempBase, tempBottom, tempLeft, tempText].forEach((file) => fs.rmSync(file, { force: true }));
  return layout;
}

function createLower(email, dest) {
  const tempBase = path.join(path.dirname(dest), "_lower-base.png");
  const tempOverlay = path.join(path.dirname(dest), "_lower-overlay.png");
  const tempLogo = path.join(path.dirname(dest), "_growth-logo-lower.png");

  runMagick([email.lowerSource, "-resize", `${LOWER_W}x${LOWER_H}^`, "-gravity", "center", "-extent", `${LOWER_W}x${LOWER_H}`, tempBase]);
  runMagick(["-size", `${LOWER_W}x${LOWER_H}`, "xc:rgba(255,255,255,0.58)", tempOverlay]);
  runMagick([tempBase, tempOverlay, "-compose", "over", "-composite", tempBase]);
  renderGrowthLogo(tempLogo, 650);
  runMagick([
    tempBase,
    tempLogo,
    "-gravity",
    "center",
    "-geometry",
    "+0+4",
    "-compose",
    "over",
    "-composite",
    "-sampling-factor",
    "4:4:4",
    "-quality",
    "96",
    "-strip",
    dest,
  ]);

  [tempBase, tempOverlay, tempLogo].forEach((file) => fs.rmSync(file, { force: true }));
}

function plainCopySheet(email) {
  return `Email ID: ${email.id}
Title: ${clean(email.title)}
Stage: ${clean(email.stage)}
Trigger: ${clean(email.trigger)}
Goal: ${clean(email.goal)}

Subject line:
${clean(email.subject)}

Preview text:
${clean(email.preview)}

Hero image text:
${clean(email.heroEyebrow).toUpperCase()}
${clean(email.heroHeadline)}
${clean(email.heroSubline)}

Body copy:
${clean(email.body)}

Primary CTA label:
${clean(email.primaryCta)}

Primary CTA URL:
${clean(email.primaryUrl)}

Context block title:
${clean(email.contextTitle)}

Context block label:
${clean(email.contextLabel || "Account details")}

Context block copy:
${clean(email.contextText)}

Secondary CTA label:
${clean(email.secondaryCta)}

Secondary CTA URL:
${clean(email.secondaryUrl)}

Secondary line copy:
${clean(email.secondaryLine)}

Signature:
${clean(email.signature)}
`;
}

function assetSpec(email, index, layout) {
  const dir = path.join(OUT_ROOT, folderName(email, index));
  return `StudioLAB Growth onboarding email asset spec

Email: ${email.id} - ${clean(email.title)}

Use these files for upload:

1. 01-top-logo-1200x240.png
2. 02-hero-final-1200x736.jpg
3. 03-lower-image-1200x430.jpg

Display guidance:
- Upload the 1200px-wide images from this local folder.
- Display them at 600px wide in the StudioLAB Growth email builder.
- The hero text is baked into the image because the builder cannot reliably overlay text.

Local folder:
${dir}

Primary button note:
Use the Primary CTA URL shown in email-copy.txt for this email. If the URL is a placeholder, replace it only with the confirmed workflow URL for that exact step.

Hero typography:
- Eyebrow export font: Arial Bold
- Headline export font: Georgia Bold
- Subline export font: Arial Bold
- Eyebrow color: ${COLORS.heroPink}
- Headline color: ${COLORS.surface}
- Subline color: ${COLORS.surface}
- Headline export size: ${layout.headlineSize}px

Core colors:
- Warm canvas: ${COLORS.canvas}
- White surface: ${COLORS.surface}
- Ink: ${COLORS.ink}
- Body text: ${COLORS.body}
- Muted text: ${COLORS.muted}
- Hairline: ${COLORS.hairline}
- Primary CTA blush: ${COLORS.blush}
- Cobalt: ${COLORS.cobalt}
- Blush tint: ${COLORS.blushTint}
`;
}

function paragraphs(value) {
  return clean(value)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

function swatchTextColor(hex) {
  return ["#faf6f1", "#ffffff", "#fde8f2", "#ece8f4", "#ebe4dd"].includes(String(hex).toLowerCase())
    ? COLORS.ink
    : COLORS.surface;
}

function miniSwatch(name, hex) {
  return `<button type="button" class="mini-swatch" data-copy="${hex}" style="--swatch:${hex};--swatch-text:${swatchTextColor(hex)}"><span>${escapeHtml(name)}</span><strong>${hex}</strong></button>`;
}

function copyField(id, label, value, rows = 2, swatches = []) {
  const swatchHtml = swatches.length
    ? `<div class="field-swatches">${swatches.map((swatch) => miniSwatch(swatch[0], swatch[1])).join("")}</div>`
    : "";
  return `<div class="copy-field"><div class="field-head"><label for="${id}">${escapeHtml(label)}</label>${swatchHtml}</div><textarea id="${id}" readonly rows="${rows}">${escapeHtml(value).replace(/<br>/g, "\n")}</textarea><button type="button" data-copy-target="${id}">Copy</button></div>`;
}

function copyPanel(email, prefix = "copy") {
  const fields = [
    { label: "Subject line", value: email.subject, rows: 2, swatches: [["Inbox text", COLORS.ink]] },
    { label: "Preview text", value: email.preview, rows: 2, swatches: [["Muted text", COLORS.muted]] },
    {
      label: "Hero text",
      value: `${clean(email.heroEyebrow).toUpperCase()}\n${clean(email.heroHeadline)}\n${clean(email.heroSubline)}`,
      rows: 4,
      swatches: [["Eyebrow", COLORS.heroPink], ["Headline", COLORS.surface], ["Subline", COLORS.surface], ["Overlay", COLORS.ink]],
    },
    { label: "Body copy", value: email.body, rows: 8, swatches: [["Surface", COLORS.surface], ["Body", COLORS.body]] },
    { label: "Primary CTA label", value: email.primaryCta, rows: 1, swatches: [["Button", COLORS.blush], ["Text", COLORS.surface]] },
    { label: "Primary CTA URL", value: email.primaryUrl, rows: 2, swatches: [["Button", COLORS.blush]] },
    { label: "Context title", value: email.contextTitle, rows: 2, swatches: [["Band bg", COLORS.blushTint], ["Title", COLORS.ink]] },
    { label: "Context copy", value: email.contextText, rows: 4, swatches: [["Band bg", COLORS.blushTint], ["Body", COLORS.body]] },
    { label: "Secondary line copy", value: email.secondaryLine, rows: 3, swatches: [["Secondary line", COLORS.muted], ["Link emphasis", COLORS.cobalt]] },
    { label: "Secondary CTA label", value: email.secondaryCta, rows: 1, swatches: [["Link", COLORS.cobalt]] },
    { label: "Secondary CTA URL", value: email.secondaryUrl, rows: 1, swatches: [["Link", COLORS.cobalt]] },
    { label: "Signature", value: email.signature, rows: 3, swatches: [["Name", COLORS.ink], ["Role", COLORS.muted]] },
  ];
  return `<div class="copy-panel">${fields
    .map((field, index) => copyField(`${prefix}-${slugify(email.id)}-${index}`, field.label, clean(field.value), field.rows, field.swatches))
    .join("")}</div>`;
}

function renderPreview(email, index) {
  const secondaryHtml = email.secondaryLine ? `<div class="secondary-line">${escapeHtml(email.secondaryLine)}</div>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(email.id)} - Finished Email Preview</title>
<style>
body{margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.body}}.wrap{max-width:760px;margin:0 auto;padding:34px 18px 56px}.email{max-width:600px;margin:0 auto;background:${COLORS.surface};overflow:hidden}img{display:block;width:100%;height:auto;border:0}.body{padding:42px 46px 18px;background:${COLORS.surface}}.body p{font-size:19px;line-height:1.46;margin:0 0 22px}.button-row{padding:8px 46px 38px;text-align:center;background:${COLORS.surface}}.button{display:inline-block;background:${COLORS.blush};color:white;text-decoration:none;border-radius:999px;padding:14px 34px;font-weight:700;font-size:17px}.context{padding:30px 46px;background:${COLORS.blushTint};border-top:1px solid #f6c4da;border-bottom:1px solid #f6c4da}.context .label{font-size:13px;line-height:1.1;text-transform:uppercase;letter-spacing:1.2px;color:${COLORS.blush};font-weight:800;margin:0 0 14px}.context h2{font-family:Georgia,serif;font-size:30px;line-height:1.08;margin:0 0 14px;color:${COLORS.ink}}.context p{font-size:18px;line-height:1.48;margin:0;color:${COLORS.body}}.secondary-line{padding:26px 46px;text-align:center;background:${COLORS.surface};color:${COLORS.muted};font-size:14px;line-height:1.5}.sig{padding:34px 38px;text-align:center;background:${COLORS.surface}}.sig .name{font-size:28px;font-weight:800;color:${COLORS.ink};margin:0}.sig .role{font-size:16px;color:${COLORS.muted};margin:6px 0 0}.footer{padding:24px 34px 32px;text-align:center;background:${COLORS.lilacTint};font-size:12px;color:${COLORS.muted};line-height:1.5}
</style></head><body>
<div class="wrap"><div class="email">
<img src="01-top-logo-1200x240.png" alt="StudioLAB Growth">
<img src="02-hero-final-1200x736.jpg" alt="${escapeHtml(email.heroHeadline)}">
<div class="body">${paragraphs(email.body)}</div>
<div class="button-row"><a class="button" href="#">${escapeHtml(email.primaryCta)}</a></div>
<div class="context"><p class="label">${escapeHtml(email.contextLabel || "Account details")}</p><h2>${escapeHtml(email.contextTitle)}</h2><p>${escapeHtml(email.contextText)}</p></div>
${secondaryHtml}
<img src="03-lower-image-1200x430.jpg" alt="StudioLAB Growth lower visual">
<div class="sig"><p class="name">Gary</p><p class="role">Founder, StudioLAB</p></div>
<div class="footer">Copyright (c) {{right_now.year}} StudioLAB Software. All rights reserved.<br>support@studiolabsoftware.com<br>You can unsubscribe from this list or manage your preferences.</div>
</div></div>
</body></html>`;
}

function renderIndex(emails) {
  const records = emails.map((email, index) => ({
    index,
    number: String(index + 1).padStart(2, "0"),
    id: clean(email.id),
    stage: clean(email.stage),
    title: clean(email.title),
    trigger: clean(email.trigger),
    goal: clean(email.goal),
    subject: clean(email.subject),
    preview: clean(email.preview),
    heroEyebrow: clean(email.heroEyebrow).toUpperCase(),
    heroHeadline: clean(email.heroHeadline),
    heroSubline: clean(email.heroSubline),
    body: clean(email.body),
    contextTitle: clean(email.contextTitle),
    contextLabel: clean(email.contextLabel || "Account details"),
    contextText: clean(email.contextText),
    primaryCta: clean(email.primaryCta),
    primaryUrl: clean(email.primaryUrl),
    secondaryLine: clean(email.secondaryLine),
    secondaryCta: clean(email.secondaryCta),
    secondaryUrl: clean(email.secondaryUrl),
    signature: clean(email.signature),
    folder: folderName(email, index),
  }));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StudioLAB Growth Onboarding Email Library</title>
<style>
*{box-sizing:border-box}body{margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.body};min-width:1320px}.app{display:grid;grid-template-columns:294px 648px minmax(380px,1fr);gap:24px;max-width:1680px;margin:0 auto;padding:22px}.rail,.panel{position:sticky;top:22px;align-self:start;max-height:calc(100vh - 44px);overflow:auto;background:${COLORS.surface};border:1px solid ${COLORS.hairline};box-shadow:0 12px 34px rgba(36,26,29,.05)}.rail{padding:16px}.brand h1{font-family:Georgia,serif;color:${COLORS.ink};font-size:25px;line-height:1.05;margin:0 0 6px}.brand p{color:${COLORS.muted};font-size:13px;line-height:1.35;margin:0 0 14px}.menu{display:grid;gap:7px}.menu button{width:100%;text-align:left;border:1px solid ${COLORS.hairline};border-left:4px solid transparent;background:${COLORS.canvas};padding:9px 10px;cursor:pointer}.menu button.active{background:${COLORS.blushTint};border-left-color:${COLORS.blush}}.menu span{display:block;color:${COLORS.blush};font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase}.menu strong{display:block;color:${COLORS.ink};font-size:13px;line-height:1.2;margin-top:3px}.menu em{display:block;color:${COLORS.muted};font-size:11px;font-style:normal;margin-top:3px}.status{background:${COLORS.surface};border:1px solid ${COLORS.hairline};padding:14px 16px;margin:0 0 16px;box-shadow:0 12px 34px rgba(36,26,29,.04)}.status .meta{color:${COLORS.blush};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.1px;margin:0 0 6px}.status h2{font-family:Georgia,serif;color:${COLORS.ink};font-size:31px;line-height:1.05;margin:0 0 7px}.status p{margin:0 0 6px;color:${COLORS.muted};font-size:14px;line-height:1.4}.email-frame{width:600px;background:${COLORS.surface};margin:0 auto;overflow:hidden}.email-frame img{display:block;width:600px;height:auto;border:0}.body{padding:42px 46px 18px;background:${COLORS.surface}}.body p{font-size:19px;line-height:1.46;margin:0 0 22px}.button-row{padding:8px 46px 38px;text-align:center;background:${COLORS.surface}}.btn{display:inline-block;max-width:100%;background:${COLORS.blush};color:${COLORS.surface};text-decoration:none;border-radius:999px;padding:14px 34px;font-weight:700;font-size:17px;text-align:center}.context{background:${COLORS.blushTint};padding:30px 46px;border-top:1px solid #f6c4da;border-bottom:1px solid #f6c4da}.context .label{font-size:13px;line-height:1.1;color:${COLORS.blush};font-weight:800;letter-spacing:1.2px;text-transform:uppercase;margin:0 0 14px}.context h3{font-family:Georgia,serif;color:${COLORS.ink};font-size:30px;line-height:1.08;margin:0 0 14px}.context p{font-size:18px;line-height:1.48;margin:0;color:${COLORS.body}}.secondary-line{padding:26px 46px;text-align:center;background:${COLORS.surface};color:${COLORS.muted};font-size:14px;line-height:1.5}.sig{padding:34px 38px;text-align:center;background:${COLORS.surface}}.sig strong{font-size:28px;color:${COLORS.ink}}.sig span{display:block;margin-top:6px;color:${COLORS.muted};font-size:16px}.foot{background:${COLORS.lilacTint};padding:24px 34px 32px;text-align:center;font-size:12px;color:${COLORS.muted};line-height:1.5}.panel{padding:18px}.panel h2{font-family:Georgia,serif;color:${COLORS.ink};font-size:27px;line-height:1.05;margin:0 0 8px}.panel-note{color:${COLORS.muted};font-size:13px;line-height:1.35;margin:0 0 14px}.section{border-top:1px solid ${COLORS.hairline};padding-top:15px;margin-top:16px}.section h3{margin:0 0 10px;color:${COLORS.ink};font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.asset-grid{display:grid;gap:8px}.asset{border:1px solid ${COLORS.hairline};background:${COLORS.canvas};padding:10px}.asset strong{display:block;color:${COLORS.ink};font-size:12px;text-transform:uppercase;letter-spacing:.7px;margin-bottom:7px}.asset-thumb{display:block;width:100%;height:84px;object-fit:contain;background:${COLORS.surface};border:1px solid ${COLORS.hairline};margin:0 0 8px}.asset code{display:block;color:${COLORS.body};font-size:12px;line-height:1.35;word-break:break-word}.asset a,.asset button{display:inline-block;margin-top:7px;margin-right:7px;color:${COLORS.cobalt};font-size:12px;font-weight:800}.asset button{background:transparent;border:0;padding:0;text-decoration:underline;cursor:pointer}.field{display:grid;gap:7px;margin-bottom:12px}.field-head{display:flex;gap:7px;align-items:flex-end;justify-content:space-between}.field label{color:${COLORS.blush};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.field textarea{width:100%;resize:vertical;border:1px solid ${COLORS.hairline};background:${COLORS.canvas};padding:10px;font:14px/1.42 Arial,Helvetica,sans-serif;color:${COLORS.body}}.copy-btn,.hex{border:0;cursor:pointer}.copy-btn{justify-self:start;background:${COLORS.cobalt};color:${COLORS.surface};font-size:12px;font-weight:800;padding:8px 12px}.swatches,.field-swatches{display:flex;flex-wrap:wrap;gap:6px}.hex,.mini-swatch{background:var(--swatch);color:var(--swatch-text);border:1px solid rgba(36,26,29,.14);padding:6px 7px;text-align:left;font-size:10px;font-weight:800;line-height:1.05}.hex span,.hex strong,.mini-swatch span,.mini-swatch strong{display:block}.hex span,.mini-swatch span{text-transform:uppercase;letter-spacing:.5px}.palette{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.copy-panel{display:grid;gap:12px}.toast{position:fixed;right:20px;bottom:20px;background:${COLORS.ink};color:${COLORS.surface};padding:10px 14px;font-size:13px;font-weight:800;opacity:0;transform:translateY(8px);transition:.18s}.toast.show{opacity:1;transform:translateY(0)}
</style></head><body>
<div class="app">
<aside class="rail"><div class="brand"><h1>StudioLAB Growth Email Workbench</h1><p>Growth onboarding emails live here separately from the core StudioLAB lifecycle set.</p></div><nav class="menu" id="menu"></nav></aside>
<main class="preview-zone"><section class="status" id="status"></section><section id="emailPreview"></section></main>
<aside class="panel"><h2>Builder Resources</h2><p class="panel-note">Upload images from the local folder paths shown here. The browser preview is only for checking the finished structure.</p><div id="resourcePanel"></div></aside>
</div><div class="toast" id="toast">Copied</div>
<script>
const EMAILS=${JSON.stringify(records)};
const ROOT=${JSON.stringify(OUT_ROOT)};
const COLORS=${JSON.stringify(COLORS)};
function esc(value){return String(value||"").replace(/[&<>"]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch];});}
function paragraphs(value){return String(value||"").split(/\\n{2,}/).map(function(p){return "<p>"+esc(p).replace(/\\n/g,"<br>")+"</p>";}).join("");}
function swatchText(hex){return ["#faf6f1","#ffffff","#fde8f2","#ece8f4","#ebe4dd"].includes(String(hex).toLowerCase())?COLORS.ink:COLORS.surface;}
function swatches(items){return '<div class="swatches">'+items.map(function(item){return '<button class="hex" data-copy="'+esc(item[1])+'" style="--swatch:'+esc(item[1])+';--swatch-text:'+swatchText(item[1])+'"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></button>';}).join("")+'</div>';}
function copyField(key,label,value,rows,swatchItems){return '<div class="field"><div class="field-head"><label for="'+key+'">'+esc(label)+'</label>'+swatches(swatchItems||[])+'</div><textarea id="'+key+'" readonly rows="'+rows+'">'+esc(value)+'</textarea><button class="copy-btn" data-copy-target="'+key+'">Copy '+esc(label)+'</button></div>';}
function assetCard(label,folder,file){const rel=folder+"/"+file;const abs=ROOT+"/"+rel;return '<div class="asset"><strong>'+esc(label)+'</strong><img class="asset-thumb" src="'+esc(rel)+'" alt="'+esc(label)+'"><code>'+esc(file)+'</code><code>'+esc(abs)+'</code><a href="'+esc(rel)+'" target="_blank">Open image</a><button type="button" data-copy="'+esc(abs)+'">Copy path</button></div>';}
function setActive(index){const email=EMAILS[index]||EMAILS[0];location.hash=email.id;render(email);}
function renderMenu(active){document.getElementById("menu").innerHTML=EMAILS.map(function(email,i){return '<button type="button" class="'+(email.id===active.id?'active':'')+'" data-email-index="'+i+'"><span>'+email.number+' '+esc(email.id)+'</span><strong>'+esc(email.title)+'</strong><em>'+esc(email.stage)+'</em></button>';}).join("");}
function render(email){renderMenu(email);document.getElementById("status").innerHTML='<p class="meta">'+email.number+' / '+esc(email.id)+' / '+esc(email.stage)+'</p><h2>'+esc(email.title)+'</h2><p><strong>Trigger:</strong> '+esc(email.trigger)+'</p><p><strong>Goal:</strong> '+esc(email.goal)+'</p>';document.getElementById("emailPreview").innerHTML='<div class="email-frame"><img src="'+esc(email.folder+'/01-top-logo-1200x240.png')+'" alt="StudioLAB Growth top logo"><img src="'+esc(email.folder+'/02-hero-final-1200x736.jpg')+'" alt="'+esc(email.heroHeadline)+'"><div class="body">'+paragraphs(email.body)+'</div><div class="button-row"><a class="btn" href="#">'+esc(email.primaryCta)+'</a></div><div class="context"><p class="label">'+esc(email.contextLabel||"Account details")+'</p><h3>'+esc(email.contextTitle)+'</h3><p>'+esc(email.contextText).replace(/\\n/g,"<br>")+'</p></div><div class="secondary-line">'+esc(email.secondaryLine)+'</div><img src="'+esc(email.folder+'/03-lower-image-1200x430.jpg')+'" alt="StudioLAB Growth lower image"><div class="sig"><strong>Gary</strong><span>Founder, StudioLAB</span></div><div class="foot">Copyright (c) {{right_now.year}} StudioLAB Software. All rights reserved.<br>support@studiolabsoftware.com<br>You can unsubscribe from this list or manage your preferences.</div></div>';renderResources(email);}
function renderResources(email){const heroText=email.heroEyebrow+"\\n"+email.heroHeadline+"\\n"+email.heroSubline;document.getElementById("resourcePanel").innerHTML='<div class="section"><h3>Local upload images</h3><div class="asset-grid">'+assetCard("Top logo image",email.folder,"01-top-logo-1200x240.png")+assetCard("Hero/header image with baked text",email.folder,"02-hero-final-1200x736.jpg")+assetCard("Lower reference image",email.folder,"03-lower-image-1200x430.jpg")+'</div></div><div class="section"><h3>Inbox and hero copy</h3>'+copyField("subject","Subject line",email.subject,2,[["Inbox text",COLORS.ink]])+copyField("preview","Preview text",email.preview,2,[["Muted text",COLORS.muted]])+copyField("heroText","Hero text baked into image",heroText,4,[["Eyebrow",COLORS.heroPink],["Headline",COLORS.surface],["Subline",COLORS.surface]])+'</div><div class="section"><h3>Email builder copy</h3>'+copyField("bodyCopy","Body copy",email.body,9,[["Surface",COLORS.surface],["Body",COLORS.body]])+copyField("primaryCta","Primary CTA label",email.primaryCta,1,[["Button",COLORS.blush],["Text",COLORS.surface]])+copyField("primaryUrl","Primary CTA URL",email.primaryUrl,2,[["Button",COLORS.blush]])+copyField("contextLabel","Context label",email.contextLabel||"Account details",1,[["Label",COLORS.blush]])+copyField("contextTitle","Context title",email.contextTitle,2,[["Band bg",COLORS.blushTint],["Title",COLORS.ink]])+copyField("contextCopy","Context copy",email.contextText,4,[["Band bg",COLORS.blushTint],["Body",COLORS.body]])+copyField("secondaryLine","Secondary line copy",email.secondaryLine,3,[["Secondary line",COLORS.muted],["Link emphasis",COLORS.cobalt]])+copyField("secondaryCta","Secondary CTA label",email.secondaryCta,1,[["Link",COLORS.cobalt]])+copyField("secondaryUrl","Secondary CTA URL",email.secondaryUrl,1,[["Link",COLORS.cobalt]])+copyField("signature","Signature",email.signature,3,[["Name",COLORS.ink],["Role",COLORS.muted]])+'</div><div class="section"><h3>Core palette</h3><div class="palette">'+Object.entries({Canvas:COLORS.canvas,Surface:COLORS.surface,Ink:COLORS.ink,Body:COLORS.body,Muted:COLORS.muted,Hairline:COLORS.hairline,CTA:COLORS.blush,Cobalt:COLORS.cobalt,BlushTint:COLORS.blushTint,LilacTint:COLORS.lilacTint,HeroPink:COLORS.heroPink}).map(function(pair){return '<button class="hex" data-copy="'+esc(pair[1])+'" style="--swatch:'+esc(pair[1])+';--swatch-text:'+swatchText(pair[1])+'"><span>'+esc(pair[0])+'</span><strong>'+esc(pair[1])+'</strong></button>';}).join("")+'</div></div>';}
document.addEventListener("click",function(event){const menu=event.target.closest("[data-email-index]");if(menu){setActive(Number(menu.getAttribute("data-email-index")));return;}const hex=event.target.closest("[data-copy]");if(hex){navigator.clipboard.writeText(hex.getAttribute("data-copy")).then(showToast);return;}const btn=event.target.closest("[data-copy-target]");if(!btn)return;const field=document.getElementById(btn.getAttribute("data-copy-target"));if(field)navigator.clipboard.writeText(field.value).then(showToast);});
function showToast(){const toast=document.getElementById("toast");toast.classList.add("show");setTimeout(function(){toast.classList.remove("show")},900);}
const hash=decodeURIComponent(location.hash.replace(/^#/,""));const initial=Math.max(0,EMAILS.findIndex(function(email){return email.id===hash;}));render(EMAILS[initial]||EMAILS[0]);
</script></body></html>`;
}

function uploadAssetIndex(emails) {
  const lines = [
    "StudioLAB Growth onboarding local upload asset index",
    "",
    "Use this folder for StudioLAB Growth onboarding email templates.",
    "Upload the actual image files from each numbered local folder.",
    "",
    `Library root: ${OUT_ROOT}`,
    "",
  ];
  emails.forEach((email, index) => {
    const folder = folderName(email, index);
    const dir = path.join(OUT_ROOT, folder);
    lines.push(`${String(index + 1).padStart(2, "0")} ${clean(email.id)} - ${clean(email.title)}`);
    lines.push(`Folder: ${dir}`);
    lines.push(`Top logo image: ${path.join(dir, "01-top-logo-1200x240.png")}`);
    lines.push(`Hero/header image with baked text: ${path.join(dir, "02-hero-final-1200x736.jpg")}`);
    lines.push(`Lower/footer brand image: ${path.join(dir, "03-lower-image-1200x430.jpg")}`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

function contentAudit(emails) {
  const lines = ["StudioLAB Growth onboarding content audit", ""];
  emails.forEach((email, index) => {
    lines.push(`${String(index + 1).padStart(2, "0")} ${clean(email.id)} - ${clean(email.title)}`);
    lines.push(`  Stage: ${clean(email.stage)}`);
    lines.push(`  Trigger: ${clean(email.trigger)}`);
    lines.push(`  Goal: ${clean(email.goal)}`);
    lines.push(`  Primary CTA: ${clean(email.primaryCta)} -> ${clean(email.primaryUrl)}`);
    lines.push(`  Secondary CTA: ${clean(email.secondaryCta)} -> ${clean(email.secondaryUrl)}`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

function heroAudit(emails) {
  const lines = ["StudioLAB Growth onboarding hero asset audit", ""];
  emails.forEach((email, index) => {
    const folder = folderName(email, index);
    lines.push(`${String(index + 1).padStart(2, "0")} ${clean(email.id)} - ${clean(email.title)}`);
    lines.push(`  Folder: ${folder}`);
    lines.push("  Hero text:");
    lines.push(`    ${clean(email.heroEyebrow).toUpperCase()}`);
    lines.push(`    ${clean(email.heroHeadline)}`);
    lines.push(`    ${clean(email.heroSubline)}`);
    lines.push(`  Hero image file: ${path.join(OUT_ROOT, folder, "02-hero-final-1200x736.jpg")}`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

function main() {
  ensure(OUT_ROOT);
  const shared = path.join(OUT_ROOT, "00-shared-assets");
  ensure(shared);
  fs.copyFileSync(GROWTH_LOGO, path.join(shared, "studiolab-growth-logo.svg"));

  for (const entry of fs.readdirSync(OUT_ROOT, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d{2}-slg-on-/.test(entry.name)) {
      fs.rmSync(path.join(OUT_ROOT, entry.name), { recursive: true, force: true });
    }
  }

  EMAILS.forEach((email, index) => {
    const dir = path.join(OUT_ROOT, folderName(email, index));
    ensure(dir);
    createTopLogo(path.join(dir, "01-top-logo-1200x240.png"));
    const layout = createHero(email, path.join(dir, "02-hero-final-1200x736.jpg"));
    createLower(email, path.join(dir, "03-lower-image-1200x430.jpg"));
    fs.writeFileSync(path.join(dir, "email-copy.txt"), plainCopySheet(email));
    fs.writeFileSync(path.join(dir, "asset-spec.txt"), assetSpec(email, index, layout));
    fs.writeFileSync(path.join(dir, "full-email-preview.html"), renderPreview(email, index));
  });

  fs.writeFileSync(path.join(OUT_ROOT, "index.html"), renderIndex(EMAILS));
  fs.writeFileSync(path.join(OUT_ROOT, "00-UPLOAD-ASSET-INDEX.txt"), uploadAssetIndex(EMAILS));
  fs.writeFileSync(path.join(OUT_ROOT, "00-CONTENT-STRUCTURE-AUDIT.txt"), contentAudit(EMAILS));
  fs.writeFileSync(path.join(OUT_ROOT, "00-HERO-ASSET-CONSISTENCY-AUDIT.txt"), heroAudit(EMAILS));
  fs.writeFileSync(
    path.join(OUT_ROOT, "00-READ-ME-GROWTH-ONBOARDING.txt"),
    `StudioLAB Growth onboarding email production library

This folder is separate from the core StudioLAB lifecycle library.

Use this for StudioLAB Growth onboarding emails after a studio signs up and their Growth account is being configured.

Open the workbench:
${path.join(OUT_ROOT, "index.html")}

Upload the actual image files from each numbered email folder:
1. 01-top-logo-1200x240.png
2. 02-hero-final-1200x736.jpg
3. 03-lower-image-1200x430.jpg

Display each image at 600px wide inside the email builder.
`
  );

  console.log(OUT_ROOT);
  console.log(`${EMAILS.length} Growth onboarding email folder generated.`);
}

main();
