const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = "/Users/gary/Library/CloudStorage/Dropbox/Gary's Files/StudioLAB/Media:Graphic Design/Email Design System";
const GUIDE_HTML = path.join(ROOT, "12-lifecycle-template-guides", "studiolab-lifecycle-email-full-preview-tabs-v2.html");
const SOURCE_ROOT = path.join(ROOT, "02-source-images");
const BUILDER_ASSETS = path.join(ROOT, "07-builder-ready-assets");
const HEADER_1200 = path.join(ROOT, "03-header-images", "1200x720-source");
const HEADER_600X368 = path.join(ROOT, "03-header-images", "600x368-builder");
const HEADER_600X300 = path.join(ROOT, "03-header-images", "600x300-builder");
const PORTRAIT_SUPPORT = path.join(ROOT, "03-header-images", "portrait-support");
const LOWER_1200 = path.join(ROOT, "04-lower-brand-strips", "1200x430-source");
const LOWER_600 = path.join(ROOT, "04-lower-brand-strips", "600x215-builder");
const V1_ROOT = path.join(ROOT, "13-email-production-library");
const V2_ROOT = path.join(ROOT, "13-email-production-library-v2-retina");
const WEBSITE_LOGO = "/Users/gary/Claude_Projects/StudioLAB-Builds/studiolab-website/public/brand/studiolab-logo.svg";

const ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const GEORGIA_BOLD = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf";
const GUIDES_ONLY = process.argv.includes("--guides-only");
const LOWER_ONLY = process.argv.includes("--lower-only");
const HERO_ONLY = process.argv.includes("--hero-only");

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
  lilacTint: "#ece8f4",
  blushTint: "#fde8f2",
};

// Layout lock:
// Gary is actively building these as modular StudioLAB Growth blocks. Future
// asset refreshes must not change the email structure, block order, secondary
// text treatment, or footer/header rhythm. Only image assignments and image
// resolution should change unless the layout is explicitly redesigned.

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

function readEmails() {
  const html = fs.readFileSync(GUIDE_HTML, "utf8");
  const start = html.indexOf("const emails = ");
  const arrayStart = html.indexOf("[", start);
  const arrayEnd = html.indexOf("];", arrayStart) + 1;
  if (start < 0 || arrayStart < 0 || arrayEnd < 1) throw new Error("Email data not found.");
  return vm.runInNewContext(html.slice(arrayStart, arrayEnd));
}

function folderName(email, index) {
  return `${String(index + 1).padStart(2, "0")}-${email.id.toLowerCase()}-${slugify(email.title)}`;
}

function imageFamily(fileName) {
  return clean(fileName)
    .replace(/-(header|banner)-(clean|gradient-bottom)-600x(368|300)\.jpg$/i, "")
    .replace(/-lower-logo-safe-600x215\.jpg$/i, "");
}

function sourceFor(fileName) {
  const family = imageFamily(fileName);
  const directCandidates = [
    path.join(HEADER_1200, fileName.replace(/-600x(368|300)\.jpg$/i, "-1200x720.jpg")),
    path.join(HEADER_600X368, fileName),
    path.join(HEADER_600X300, fileName),
    path.join(PORTRAIT_SUPPORT, fileName),
    path.join(LOWER_1200, fileName.replace(/-600x215\.jpg$/i, "-1200x430.jpg")),
    path.join(LOWER_600, fileName),
    path.join(BUILDER_ASSETS, fileName),
  ];
  for (const candidate of directCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const candidates = [
    path.join(SOURCE_ROOT, "generated-student-class", `${family}-source.png`),
    path.join(SOURCE_ROOT, "generated-lifecycle", `${family}-source.png`),
    path.join(SOURCE_ROOT, "website-lifestyle", `${family}.png`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing high-res source image for ${fileName}`);
}

function safeLogoSvg(dest) {
  const svg = fs
    .readFileSync(WEBSITE_LOGO, "utf8")
    // The source lockup has an extremely tight right edge. Give it a small
    // vector-safe canvas before raster export so the final B cannot clip.
    .replace(/viewBox="0 0 203 47\.9"/, 'viewBox="-3 -2 212 52"');
  fs.writeFileSync(dest, svg);
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

function heroType(headline) {
  const len = clean(headline).length;
  if (len > 46) return { size: 68, lineHeight: 76, maxChars: 28 };
  if (len > 31) return { size: 76, lineHeight: 82, maxChars: 25 };
  return { size: 84, lineHeight: 88, maxChars: 23 };
}

function heroTextLayout(email) {
  const h = heroType(email.heroHeadline);
  const eyebrowSize = 24;
  const eyebrowLineHeight = 30;
  const headlineLines = wrapText(email.heroHeadline, h.maxChars).slice(0, 3);
  const sublineLines = wrapText(email.heroSubline, 54).slice(0, 3);
  const sublineSize = 32;
  const sublineLineHeight = 44;
  const totalHeight =
    eyebrowLineHeight +
    26 +
    headlineLines.length * h.lineHeight +
    24 +
    sublineLines.length * sublineLineHeight;
  let y = H - 68 - totalHeight;
  if (y < 224) y = 224;
  return {
    x: 68,
    y,
    eyebrowSize,
    eyebrowBaseline: y + eyebrowSize,
    eyebrowTracking: 2.8,
    headlineSize: h.size,
    headlineLineHeight: h.lineHeight,
    headlineLines,
    headlineBaselines: headlineLines.map((_, i) => y + eyebrowLineHeight + 26 + i * h.lineHeight + h.size * 0.82),
    sublineSize,
    sublineLineHeight,
    sublineLines,
    sublineBaselines: sublineLines.map((_, i) => {
      const sublineTop = y + eyebrowLineHeight + 26 + headlineLines.length * h.lineHeight + 24;
      return sublineTop + i * sublineLineHeight + sublineSize * 0.82;
    }),
  };
}

function createTopLogo(dest) {
  const tempSvg = path.join(path.dirname(dest), "_logo-safe.svg");
  const tempLogo = path.join(path.dirname(dest), "_logo-640w.png");
  safeLogoSvg(tempSvg);
  runMagick(["-density", "600", "-background", "none", tempSvg, "-resize", "640x", tempLogo]);
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
    "30",
    "-fill",
    COLORS.ink,
    "-annotate",
    "+0+28",
    "Dance software that performs",
    dest,
  ]);
  fs.rmSync(tempSvg, { force: true });
  fs.rmSync(tempLogo, { force: true });
}

function createHero(email, dest) {
  const source = sourceFor(email.image);
  const tempBase = path.join(path.dirname(dest), "_hero-base.png");
  const tempGradient = path.join(path.dirname(dest), "_hero-gradient.png");
  const tempText = path.join(path.dirname(dest), "_hero-text.png");
  const layout = heroTextLayout(email);

  runMagick([source, "-resize", `${W}x${H}^`, "-gravity", "center", "-extent", `${W}x${H}`, tempBase]);
  runMagick(["-size", `${W}x${H}`, "gradient:rgba(36,26,29,0)-rgba(36,26,29,0.72)", tempGradient]);
  runMagick([tempBase, tempGradient, "-compose", "over", "-composite", tempBase]);

  const textArgs = ["-size", `${W}x${H}`, "xc:none"];
  textArgs.push("-font", ARIAL_BOLD, "-pointsize", String(layout.eyebrowSize));
  textArgs.push("-fill", COLORS.heroPink, "-kerning", String(layout.eyebrowTracking));
  textArgs.push("-annotate", `+${layout.x}+${Math.round(layout.eyebrowBaseline)}`, clean(email.heroEyebrow).toUpperCase());
  textArgs.push("-kerning", "0");
  textArgs.push("-font", GEORGIA_BOLD, "-pointsize", String(layout.headlineSize), "-fill", COLORS.surface);
  layout.headlineLines.forEach((line, i) => {
    textArgs.push("-annotate", `+${layout.x}+${Math.round(layout.headlineBaselines[i])}`, clean(line));
  });
  textArgs.push("-font", ARIAL_BOLD, "-pointsize", String(layout.sublineSize), "-fill", "rgba(255,255,255,0.93)");
  layout.sublineLines.forEach((line, i) => {
    textArgs.push("-annotate", `+${layout.x}+${Math.round(layout.sublineBaselines[i])}`, clean(line));
  });
  textArgs.push(tempText);
  runMagick(textArgs);

  runMagick([
    tempBase,
    tempText,
    "-compose",
    "over",
    "-composite",
    "-sampling-factor",
    "4:4:4",
    "-quality",
    "92",
    "-strip",
    dest,
  ]);
  fs.rmSync(tempBase, { force: true });
  fs.rmSync(tempGradient, { force: true });
  fs.rmSync(tempText, { force: true });
  return layout;
}

function createLower(email, dest) {
  const source = sourceFor(email.lowerImage);
  const tempBase = path.join(path.dirname(dest), "_lower-base.png");
  runMagick([source, "-resize", `${LOWER_W}x${LOWER_H}^`, "-gravity", "center", "-extent", `${LOWER_W}x${LOWER_H}`, tempBase]);
  runMagick([
    tempBase,
    "-sampling-factor",
    "4:4:4",
    "-quality",
    "96",
    "-strip",
    dest,
  ]);
  fs.rmSync(tempBase, { force: true });
}

function plainCopySheet(email) {
  const secondaryText = secondaryLineText(email);
  const automationRules = Array.isArray(email.automationRules) && email.automationRules.length
    ? `Automation rules:\n${email.automationRules.map((rule) => clean(rule)).join("\n")}\n\n`
    : "";
  const secondary = email.secondaryCta
    ? `Secondary CTA label: ${clean(email.secondaryCta)}\nSecondary CTA URL: ${clean(email.secondaryUrl)}\nSecondary line copy:\n${clean(secondaryText)}\n`
    : "";
  return `Email ID: ${email.id}
Title: ${clean(email.title)}
Stage: ${clean(email.stage)}
Trigger: ${clean(email.trigger)}
Goal: ${clean(email.goal)}

${automationRules}
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

${secondary}Context block title:
${clean(email.contextTitle)}

Context block copy:
${clean(email.contextText)}

Signature:
Gary
Founder, StudioLAB
`;
}

function secondaryLineText(email) {
  const map = {
    "SL-IQ-01": "Prefer to talk it through first? Book a walkthrough and we will help you work out the best next step.",
    "SL-IQ-02": "Want to talk before you start? Book a demo and we will answer your questions first.",
    "SL-IQ-03": "Not sure where to start? Reply with your question and we will point you in the right direction.",
    "SL-DEMO-01": "Want us to talk through your real studio setup on the call? Start your trial before we meet.",
    "SL-DEMO-02": "Need to move the time? Reply to this email and we will help you reschedule.",
    "SL-DEMO-03": "Have a follow-up question from the walkthrough? Reply to this email and we will help you work through it.",
    "SL-DEMO-04": "Prefer to get started instead? Start a free trial and we will help from your real setup.",
    "SL-TR-01": "Want us to walk through the first steps with you? Book a setup call and we will help you get oriented.",
    "SL-TR-02": "Prefer to keep moving on your own for now? Open the setup guide and follow the first steps.",
    "SL-TR-03": "Not sure how your Season should work? Book a setup call and we will help you structure it properly.",
    "SL-TR-04": "Want us to check your class structure? Reply with what you have built and we will take a look.",
    "SL-TR-05": "Want another set of eyes on the family flow? Book a setup review and we will check it with you.",
    "SL-TR-GR-01": "Curious where Growth could fit later? Reply here and we will talk through the practical use cases.",
    "SL-TR-06": "Not ready to book a call? Reply with what feels confusing and we will point you to the next step.",
    "SL-TR-07": "Want us to review the setup before you go further? Book a quick setup review.",
    "SL-CV-01": "Want us to check where you are up to before you activate? Book a setup call and we will walk through it with you.",
    "SL-CV-02": "Still deciding? Book a setup call and we will help you work through the decision before the trial wraps up.",
    "SL-CV-03": "Want to talk through what held you back? Reply here and we will help you work out the easiest next step.",
    "SL-PD-01": "Want another set of eyes on your setup? Book a setup review and we will check the flow with you.",
    "SL-PD-02": "Prefer to walk through it with us? Book a setup call and we will review the essentials together.",
    "SL-PD-03": "Something look off? Reply to this email and we will help you work out what needs adjusting.",
    "SL-PD-04": "Want a final check before families use it? Book a final setup review.",
    "SL-PD-GR-01": "Want to see if Growth is a fit? Book a Growth walkthrough and we will talk through real use cases.",
    "SL-HC-01": "If something still feels unfinished, reply here and we will help you decide what to clean up first.",
    "SL-HC-02": "Want to talk through setup or Growth next steps? Book a call and we will help you choose the right focus.",
    "SL-CAN-01": "Prefer to talk it through instead? Book a quick call and we will listen, help where we can, or close things out cleanly.",
    "SL-CAN-02": "If a quick conversation would be easier than email, book a call and we will talk it through without pressure.",
    "SL-CAN-03": "If you would rather restart directly later, use the restart link and we will help you get moving again.",
  };
  return map[email.id] || email.secondaryCta || "";
}

function copyTextFiles(email, index, dir, layout) {
  const v1Dir = path.join(V1_ROOT, folderName(email, index));
  const copySrc = path.join(v1Dir, "email-copy.txt");
  const referenceDest = path.join(dir, "email-copy-v1-reference.txt");
  if (fs.existsSync(referenceDest)) fs.rmSync(referenceDest, { force: true });
  if (fs.existsSync(copySrc) && email.id !== "SL-CV-01") fs.copyFileSync(copySrc, referenceDest);
  fs.writeFileSync(path.join(dir, "email-copy.txt"), plainCopySheet(email));
  const spec = `StudioLAB retina email asset spec

Email: ${email.id} - ${clean(email.title)}

Use these files for upload:

1. 01-top-logo-1200x240.png
2. 02-hero-final-1200x736.jpg
3. 03-lower-image-1200x430.jpg

Display guidance:
- Upload the 1200px-wide images.
- Display them in the email builder at 600px wide.
- This gives a 2x retina source while keeping the visual email width the same.

Hero canvas:
- Export size: 1200 x 736
- Intended display size: 600 x 368

Hero typography:
- Eyebrow intended font: Inter Bold
- Eyebrow export fallback: Arial Bold
- Eyebrow size: ${layout.eyebrowSize}px export / 12px display
- Eyebrow color: ${COLORS.heroPink}
- Headline intended font: Fraunces Medium
- Headline export fallback: Georgia Bold
- Headline size: ${layout.headlineSize}px export / ${layout.headlineSize / 2}px display
- Headline color: ${COLORS.surface}
- Subline intended font: Inter Semibold
- Subline export fallback: Arial Bold
- Subline size: ${layout.sublineSize}px export / 16px display
- Subline color: ${COLORS.surface} at 93% opacity

Hero text:
${clean(email.heroEyebrow).toUpperCase()}
${clean(email.heroHeadline)}
${clean(email.heroSubline)}

Core colors:
- Warm canvas: ${COLORS.canvas}
- White surface: ${COLORS.surface}
- Ink: ${COLORS.ink}
- Body text: ${COLORS.body}
- Muted text: ${COLORS.muted}
- Hairline: ${COLORS.hairline}
- Primary CTA blush: ${COLORS.blush}
- Cobalt: ${COLORS.cobalt}
- Violet: ${COLORS.violet}
`;
  fs.writeFileSync(path.join(dir, "asset-spec.txt"), spec);
}

function swatchTextColor(hex) {
  return ["#faf6f1", "#ffffff", "#fde8f2", "#ece8f4", "#ebe4dd", "#f3e6f3"].includes(
    String(hex).toLowerCase()
  )
    ? COLORS.ink
    : COLORS.surface;
}

function miniSwatch(name, hex) {
  return `<button type="button" class="mini-swatch" data-copy="${hex}" style="--swatch:${hex};--swatch-text:${swatchTextColor(hex)}" title="${escapeHtml(name)} ${hex}"><span>${escapeHtml(name)}</span><strong>${hex}</strong></button>`;
}

function emailMenu(emails, activeIndex, mode) {
  const links = emails
    .map((email, index) => {
      const href =
        mode === "preview"
          ? `../${folderName(email, index)}/full-email-preview.html`
          : `#${email.id}`;
      const active = index === activeIndex ? " active" : "";
      return `<a class="email-menu-item${active}" href="${href}"><span>${String(index + 1).padStart(2, "0")} ${escapeHtml(email.id)}</span><strong>${escapeHtml(email.title)}</strong><em>${escapeHtml(email.stage)}</em></a>`;
    })
    .join("");
  return `<aside class="email-menu"><h2>Email Menu</h2><p>Jump directly to any template.</p><nav>${links}</nav></aside>`;
}

function copyField(id, label, value, rows = 2, swatches = []) {
  const swatchHtml = swatches.length
    ? `<div class="field-swatches">${swatches.map((swatch) => miniSwatch(swatch[0], swatch[1])).join("")}</div>`
    : "";
  return `<div class="copy-field">
<div class="field-head"><label for="${id}">${escapeHtml(label)}</label>${swatchHtml}</div>
<textarea id="${id}" readonly rows="${rows}">${escapeHtml(value).replace(/<br>/g, "\n")}</textarea>
<button type="button" data-copy-target="${id}">Copy</button>
</div>`;
}

function copyPanel(email, prefix = "copy") {
  const fields = [
    { label: "Subject line", value: email.subject, rows: 2, swatches: [["Inbox text", COLORS.ink]] },
    { label: "Preview text", value: email.preview, rows: 2, swatches: [["Muted text", COLORS.muted]] },
    {
      label: "Hero text",
      value: `${clean(email.heroEyebrow).toUpperCase()}\n${clean(email.heroHeadline)}\n${clean(email.heroSubline)}`,
      rows: 4,
      swatches: [
        ["Eyebrow", COLORS.heroPink],
        ["Headline", COLORS.surface],
        ["Subline", COLORS.surface],
        ["Overlay", COLORS.ink],
      ],
    },
    {
      label: "Body copy",
      value: email.body,
      rows: 8,
      swatches: [
        ["Surface", COLORS.surface],
        ["Body", COLORS.body],
      ],
    },
    {
      label: "Context title",
      value: email.contextTitle,
      rows: 2,
      swatches: [
        ["Band bg", COLORS.blushTint],
        ["Title", COLORS.ink],
      ],
    },
    {
      label: "Context copy",
      value: email.contextText,
      rows: 4,
      swatches: [
        ["Band bg", COLORS.blushTint],
        ["Body", COLORS.body],
      ],
    },
    {
      label: "Primary CTA label",
      value: email.primaryCta,
      rows: 1,
      swatches: [
        ["Button", COLORS.blush],
        ["Text", COLORS.surface],
      ],
    },
    { label: "Primary CTA URL", value: email.primaryUrl, rows: 1, swatches: [["Button", COLORS.blush]] },
  ];
  if (email.secondaryCta) {
    fields.push({
      label: "Secondary line copy",
      value: secondaryLineText(email),
      rows: 2,
      swatches: [["Secondary line", COLORS.muted], ["Link emphasis", COLORS.cobalt]],
    });
    fields.push({
      label: "Secondary CTA label",
      value: email.secondaryCta,
      rows: 1,
      swatches: [["Link", COLORS.cobalt]],
    });
    fields.push({ label: "Secondary CTA URL", value: email.secondaryUrl, rows: 1, swatches: [["Link", COLORS.cobalt]] });
  }
  fields.push({
    label: "Signature",
    value: "Gary\nFounder, StudioLAB",
    rows: 3,
    swatches: [
      ["Name", COLORS.ink],
      ["Role", COLORS.muted],
    ],
  });
  return `<div class="copy-panel">
${fields
  .map((field, index) =>
    copyField(`${prefix}-${slugify(email.id)}-${index}`, field.label, clean(field.value), field.rows, field.swatches)
  )
  .join("")}
</div>`;
}

function renderPreview(email, index, emails) {
  const bodyParas = clean(email.body)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
  const secondaryHtml = email.secondaryCta
    ? `<div class="secondary-line">${escapeHtml(secondaryLineText(email))}</div>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(email.id)} - Finished Email Preview</title>
<style>
  body{margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.body};}
  .wrap{max-width:760px;margin:0 auto;padding:34px 18px 56px;}
  .email{max-width:600px;margin:0 auto;background:${COLORS.surface};overflow:hidden;}
  img{display:block;width:100%;height:auto;border:0;}
  .body{padding:42px 46px 18px;background:${COLORS.surface};}
  .body p{font-size:19px;line-height:1.46;margin:0 0 22px;}
  .button-row{padding:8px 46px 38px;text-align:center;background:${COLORS.surface};}
  .button{display:inline-block;background:${COLORS.blush};color:white;text-decoration:none;border-radius:999px;padding:14px 34px;font-weight:700;font-size:17px;}
  .context{padding:30px 46px;background:${COLORS.blushTint};border-top:1px solid #f6c4da;border-bottom:1px solid #f6c4da;}
  .context .label{font-size:13px;line-height:1.1;text-transform:uppercase;letter-spacing:1.2px;color:${COLORS.blush};font-weight:800;margin:0 0 14px;}
  .context h2{font-family:Georgia,serif;font-size:30px;line-height:1.08;margin:0 0 14px;color:${COLORS.ink};}
  .context p{font-size:18px;line-height:1.48;margin:0;color:${COLORS.body};}
  .secondary-line{padding:26px 46px;text-align:center;background:${COLORS.surface};color:${COLORS.muted};font-size:14px;line-height:1.5;}
  .sig{padding:34px 38px;text-align:center;background:${COLORS.surface};}
  .sig .name{font-size:28px;font-weight:800;color:${COLORS.ink};margin:0;}
  .sig .role{font-size:16px;color:${COLORS.muted};margin:6px 0 0;}
  .footer{padding:24px 34px 32px;text-align:center;background:${COLORS.lilacTint};font-size:12px;color:${COLORS.muted};line-height:1.5;}
</style></head><body>
<div class="wrap"><div class="email">
<img src="01-top-logo-1200x240.png" alt="StudioLAB">
<img src="02-hero-final-1200x736.jpg" alt="${escapeHtml(email.heroHeadline)}">
<div class="body">${bodyParas}</div>
<div class="button-row"><a class="button" href="${escapeHtml(email.primaryUrl)}">${escapeHtml(email.primaryCta)}</a></div>
<div class="context"><p class="label">Why this helps</p><h2>${escapeHtml(email.contextTitle)}</h2><p>${escapeHtml(email.contextText)}</p></div>
${secondaryHtml}
<img src="03-lower-image-1200x430.jpg" alt="StudioLAB lower visual">
<div class="sig"><p class="name">Gary</p><p class="role">Founder, StudioLAB</p></div>
<div class="footer">Copyright (c) {{right_now.year}} StudioLAB Software. All rights reserved.<br>support@studiolabsoftware.com<br>You can unsubscribe from this list or manage your preferences.</div>
</div></div>
</body></html>`;
}

function colorCard(name, hex) {
  const light = ["#faf6f1", "#ffffff", "#fde8f2", "#ece8f4", "#ebe4dd"].includes(hex.toLowerCase());
  return `<button class="swatch" data-copy="${hex}" style="background:${hex};color:${light ? COLORS.ink : COLORS.surface}"><span>${name}</span><strong>${hex}</strong></button>`;
}

function renderIndex(emails) {
  const cards = emails
    .map((email, i) => {
      const folder = folderName(email, i);
      const automationRules = Array.isArray(email.automationRules) && email.automationRules.length
        ? `<p><strong>Automation rules:</strong><br>${email.automationRules.map((rule) => escapeHtml(rule)).join("<br>")}</p>`
        : "";
      return `<section class="card" id="${escapeHtml(email.id)}">
<div class="preview"><a href="${folder}/full-email-preview.html"><img src="${folder}/02-hero-final-1200x736.jpg" alt="${escapeHtml(email.heroHeadline)}"></a></div>
<div class="info">
<p class="meta">${String(i + 1).padStart(2, "0")} / ${escapeHtml(email.id)} / ${escapeHtml(email.stage)}</p>
<h2>${escapeHtml(email.title)}</h2>
<p><strong>Trigger:</strong> ${escapeHtml(email.trigger)}</p>
<p><strong>Goal:</strong> ${escapeHtml(email.goal)}</p>
${automationRules}
<div class="links"><a href="${folder}/" target="_blank">Open Folder</a><a href="${folder}/full-email-preview.html" target="_blank">Preview</a><a href="${folder}/email-copy.txt" target="_blank">Copy</a><a href="${folder}/asset-spec.txt" target="_blank">Specs</a></div>
<div class="files"><code>01-top-logo-1200x240.png</code><code>02-hero-final-1200x736.jpg</code><code>03-lower-image-1200x430.jpg</code></div>
<details open><summary>Copy builder blocks</summary>${copyPanel(email, "index")}</details>
</div>
</section>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StudioLAB Retina Email Production Library</title>
<style>
*{box-sizing:border-box}body{margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.body}}.library-shell{display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px;max-width:1540px;margin:0 auto;padding:30px 24px 64px}.library-content{min-width:0}main,header{max-width:1240px;margin:0 auto}header{padding:6px 0 36px}main{padding:0}h1{font-family:Georgia,serif;color:${COLORS.ink};font-size:48px;line-height:1.03;margin:0 0 14px}header p{font-size:18px;line-height:1.48;color:${COLORS.muted};max-width:800px}.email-menu{position:sticky;top:30px;align-self:start;max-height:calc(100vh - 60px);overflow:auto;background:${COLORS.surface};border:1px solid ${COLORS.hairline};padding:16px;box-shadow:0 12px 34px rgba(36,26,29,.05)}.email-menu h2{font-family:Georgia,serif;color:${COLORS.ink};font-size:25px;line-height:1.05;margin:0 0 6px}.email-menu p{font-size:13px;line-height:1.35;color:${COLORS.muted};margin:0 0 12px}.email-menu nav{display:grid;gap:7px}.email-menu-item{display:block;background:${COLORS.surface};border:1px solid ${COLORS.hairline};border-left:4px solid transparent;color:${COLORS.body};padding:9px 10px;text-decoration:none}.email-menu-item span{display:block;color:${COLORS.blush};font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase}.email-menu-item strong{display:block;color:${COLORS.ink};font-size:13px;line-height:1.2;margin-top:3px}.email-menu-item em{display:block;color:${COLORS.muted};font-size:11px;font-style:normal;margin-top:3px}.email-menu-item:hover{background:${COLORS.blushTint};border-left-color:${COLORS.blush}}.palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin-top:22px}.swatch{border:1px solid rgba(36,26,29,.14);border-radius:0;padding:14px;text-align:left;cursor:pointer}.swatch span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800;margin-bottom:8px}.swatch strong{font-size:17px}.card{display:grid;grid-template-columns:minmax(360px,560px) 1fr;gap:30px;border-top:1px solid ${COLORS.hairline};padding:32px 0;align-items:start}.preview img{width:100%;height:auto;display:block;box-shadow:0 16px 44px rgba(36,26,29,.08)}.meta{color:${COLORS.blush};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin:0 0 9px}h2{font-family:Georgia,serif;color:${COLORS.ink};font-size:34px;line-height:1.08;margin:0 0 12px}.info p{font-size:16px;line-height:1.46;color:${COLORS.muted};margin:0 0 9px}.links{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.links a{background:#fff;border:1px solid ${COLORS.hairline};padding:10px 13px;color:${COLORS.cobalt};font-weight:800;text-decoration:none;font-size:13px}.files{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin:0 0 18px}.files code{background:#fff;border:1px solid ${COLORS.hairline};padding:10px;font-size:13px;color:${COLORS.ink};word-break:break-word}details{background:#fff;border:1px solid ${COLORS.hairline};padding:16px}summary{cursor:pointer;color:${COLORS.ink};font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.copy-panel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.copy-field{display:grid;gap:7px}.copy-field:nth-child(4){grid-column:1/-1}.field-head{display:grid;gap:7px}.copy-field label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:${COLORS.blush}}.field-swatches{display:flex;flex-wrap:wrap;gap:6px}.mini-swatch{border:1px solid rgba(36,26,29,.14);background:var(--swatch);color:var(--swatch-text);font-size:10px;font-weight:800;line-height:1.05;padding:6px 7px;cursor:pointer;text-align:left}.mini-swatch span{display:block;text-transform:uppercase;letter-spacing:.5px}.mini-swatch strong{display:block;margin-top:2px}.copy-field textarea{width:100%;resize:vertical;border:1px solid ${COLORS.hairline};background:${COLORS.canvas};padding:10px;font:14px/1.4 Arial,Helvetica,sans-serif;color:${COLORS.body}}.copy-field>button{justify-self:start;border:0;background:${COLORS.cobalt};color:#fff;font-size:12px;font-weight:800;padding:8px 12px;cursor:pointer}.toast{position:fixed;right:18px;bottom:18px;background:${COLORS.ink};color:#fff;padding:10px 14px;font-size:13px;font-weight:800;opacity:0;transform:translateY(8px);transition:.18s}.toast.show{opacity:1;transform:translateY(0)}@media(max-width:1120px){.library-shell{grid-template-columns:1fr}.email-menu{position:static;max-height:none}.card{grid-template-columns:1fr}h1{font-size:39px}.copy-panel{grid-template-columns:1fr}}
</style></head><body>
<div class="library-shell">
${emailMenu(emails, -1, "index")}
<div class="library-content">
<header><h1>StudioLAB Retina Email Production Library</h1><p>Use this v2 library for upload testing. Each hero is exported at 1200px wide and should be displayed at 600px wide in the email builder for sharper image and text rendering. The browser pages are visual previews only. Upload the actual PNG/JPG files from each numbered email folder on your computer.</p><div class="links"><a href="00-UPLOAD-ASSET-INDEX.txt" target="_blank">Upload Asset Index</a><a href="00-HERO-ASSET-CONSISTENCY-AUDIT.txt" target="_blank">Hero Consistency Audit</a><a href="00-CONTENT-STRUCTURE-AUDIT.txt" target="_blank">Content Structure Audit</a><a href="00-READ-ME-V2-RETINA.txt" target="_blank">Upload Notes</a></div><div class="palette">${colorCard("Canvas", COLORS.canvas)}${colorCard("Surface", COLORS.surface)}${colorCard("Ink", COLORS.ink)}${colorCard("Body", COLORS.body)}${colorCard("Muted", COLORS.muted)}${colorCard("CTA", COLORS.blush)}${colorCard("Cobalt", COLORS.cobalt)}${colorCard("Hero Pink", COLORS.heroPink)}</div></header>
<main>${cards}</main>
</div>
</div><div class="toast" id="toast">Copied</div>
<script>
document.addEventListener('click',function(event){
  const swatch=event.target.closest('[data-copy]');
  if(swatch){navigator.clipboard.writeText(swatch.getAttribute('data-copy')).then(function(){showToast();});return;}
  const btn=event.target.closest('[data-copy-target]');
  if(!btn)return;
  const el=document.getElementById(btn.getAttribute('data-copy-target'));
  if(!el)return;
  navigator.clipboard.writeText(el.value).then(function(){showToast();});
});
function showToast(){const toast=document.getElementById('toast');toast.classList.add('show');setTimeout(function(){toast.classList.remove('show')},900);}
</script>
</body></html>`;
}

function renderWorkbench(emails) {
  const records = emails.map((email, index) => ({
    index,
    number: String(index + 1).padStart(2, "0"),
    id: clean(email.id),
    stage: clean(email.stage),
    title: clean(email.title),
    trigger: clean(email.trigger),
    goal: clean(email.goal),
    automationRules: Array.isArray(email.automationRules) ? email.automationRules.map(clean) : [],
    subject: clean(email.subject),
    preview: clean(email.preview),
    heroEyebrow: clean(email.heroEyebrow).toUpperCase(),
    heroHeadline: clean(email.heroHeadline),
    heroSubline: clean(email.heroSubline),
    body: clean(email.body),
    contextTitle: clean(email.contextTitle),
    contextText: clean(email.contextText),
    primaryCta: clean(email.primaryCta),
    primaryUrl: clean(email.primaryUrl),
    secondaryLine: clean(secondaryLineText(email)),
    secondaryCta: clean(email.secondaryCta),
    secondaryUrl: clean(email.secondaryUrl),
    signature: "Gary\nFounder, StudioLAB",
    folder: folderName(email, index),
    assets: {
      topLogo: "01-top-logo-1200x240.png",
      hero: "02-hero-final-1200x736.jpg",
      lower: "03-lower-image-1200x430.jpg",
    },
  }));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StudioLAB Email Builder Workbench</title>
<style>
*{box-sizing:border-box}body{margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.body};min-width:1320px}.app{display:grid;grid-template-columns:294px 648px minmax(380px,1fr);gap:24px;max-width:1680px;margin:0 auto;padding:22px}.rail,.panel{position:sticky;top:22px;align-self:start;max-height:calc(100vh - 44px);overflow:auto;background:${COLORS.surface};border:1px solid ${COLORS.hairline};box-shadow:0 12px 34px rgba(36,26,29,.05)}.rail{padding:16px}.brand h1{font-family:Georgia,serif;color:${COLORS.ink};font-size:25px;line-height:1.05;margin:0 0 6px}.brand p{color:${COLORS.muted};font-size:13px;line-height:1.35;margin:0 0 14px}.workflow-tabs{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:0 0 14px}.workflow-tabs button{border:1px solid ${COLORS.hairline};background:${COLORS.surface};color:${COLORS.cobalt};padding:8px 7px;font-size:11px;font-weight:800;line-height:1.1;text-align:left;cursor:pointer}.workflow-tabs button.active{background:${COLORS.blushTint};border-color:#f3b0cf;color:${COLORS.blush}}.stage-label{margin:13px 2px 6px;color:${COLORS.muted};font-size:11px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.menu{display:grid;gap:7px}.menu button{width:100%;text-align:left;border:1px solid ${COLORS.hairline};border-left:4px solid transparent;background:${COLORS.canvas};padding:9px 10px;cursor:pointer}.menu button.active{background:${COLORS.blushTint};border-left-color:${COLORS.blush}}.menu span{display:block;color:${COLORS.blush};font-size:11px;font-weight:800;letter-spacing:.8px;text-transform:uppercase}.menu strong{display:block;color:${COLORS.ink};font-size:13px;line-height:1.2;margin-top:3px}.menu em{display:block;color:${COLORS.muted};font-size:11px;font-style:normal;margin-top:3px}.preview-zone{min-width:0}.status{background:${COLORS.surface};border:1px solid ${COLORS.hairline};padding:14px 16px;margin:0 0 16px;box-shadow:0 12px 34px rgba(36,26,29,.04)}.status .meta{color:${COLORS.blush};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.1px;margin:0 0 6px}.status h2{font-family:Georgia,serif;color:${COLORS.ink};font-size:31px;line-height:1.05;margin:0 0 7px}.status p{margin:0 0 7px;color:${COLORS.muted};font-size:14px;line-height:1.4}.rules{margin-top:8px;padding-top:8px;border-top:1px solid ${COLORS.hairline}}.email-frame{width:600px;background:${COLORS.surface};margin:0 auto;overflow:hidden}.email-frame img{display:block;width:600px;height:auto;border:0}.body{padding:42px 46px 18px;background:${COLORS.surface}}.body p{font-size:19px;line-height:1.46;margin:0 0 22px}.button-row{padding:8px 46px 38px;text-align:center;background:${COLORS.surface}}.btn{display:inline-block;max-width:100%;background:${COLORS.blush};color:${COLORS.surface};text-decoration:none;border-radius:999px;padding:14px 34px;font-weight:700;font-size:17px;text-align:center}.context{background:${COLORS.blushTint};padding:30px 46px;border-top:1px solid #f6c4da;border-bottom:1px solid #f6c4da}.context .label{font-size:13px;line-height:1.1;color:${COLORS.blush};font-weight:800;letter-spacing:1.2px;text-transform:uppercase;margin:0 0 14px}.context h3{font-family:Georgia,serif;color:${COLORS.ink};font-size:30px;line-height:1.08;margin:0 0 14px}.context p{font-size:18px;line-height:1.48;margin:0;color:${COLORS.body}}.secondary-line{padding:26px 46px;text-align:center;background:${COLORS.surface};color:${COLORS.muted};font-size:14px;line-height:1.5}.sig{padding:34px 38px;text-align:center;background:${COLORS.surface}}.sig strong{font-size:28px;color:${COLORS.ink}}.sig span{display:block;margin-top:6px;color:${COLORS.muted};font-size:16px}.foot{background:${COLORS.lilacTint};padding:24px 34px 32px;text-align:center;font-size:12px;color:${COLORS.muted};line-height:1.5}.panel{padding:18px}.panel h2{font-family:Georgia,serif;color:${COLORS.ink};font-size:27px;line-height:1.05;margin:0 0 8px}.panel-note{color:${COLORS.muted};font-size:13px;line-height:1.35;margin:0 0 14px}.section{border-top:1px solid ${COLORS.hairline};padding-top:15px;margin-top:16px}.section h3{margin:0 0 10px;color:${COLORS.ink};font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.asset-grid{display:grid;gap:8px}.asset{border:1px solid ${COLORS.hairline};background:${COLORS.canvas};padding:10px}.asset strong{display:block;color:${COLORS.ink};font-size:12px;text-transform:uppercase;letter-spacing:.7px;margin-bottom:7px}.asset-thumb{display:block;width:100%;height:84px;object-fit:contain;background:${COLORS.surface};border:1px solid ${COLORS.hairline};margin:0 0 8px}.asset code{display:block;color:${COLORS.body};font-size:12px;line-height:1.35;word-break:break-word}.asset a,.asset button{display:inline-block;margin-top:7px;margin-right:7px;color:${COLORS.cobalt};font-size:12px;font-weight:800}.asset button{background:transparent;border:0;padding:0;text-decoration:underline;cursor:pointer}.field{display:grid;gap:7px;margin-bottom:12px}.field-head{display:flex;gap:7px;align-items:flex-end;justify-content:space-between}.field label{color:${COLORS.blush};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px}.field textarea{width:100%;resize:vertical;border:1px solid ${COLORS.hairline};background:${COLORS.canvas};padding:10px;font:14px/1.42 Arial,Helvetica,sans-serif;color:${COLORS.body}}.copy-btn,.hex{border:0;cursor:pointer}.copy-btn{justify-self:start;background:${COLORS.cobalt};color:${COLORS.surface};font-size:12px;font-weight:800;padding:8px 12px}.swatches{display:flex;flex-wrap:wrap;gap:6px}.hex{background:var(--swatch);color:var(--swatchText);border:1px solid rgba(36,26,29,.14);padding:6px 7px;text-align:left;font-size:10px;font-weight:800;line-height:1.05}.hex span,.hex strong{display:block}.hex span{text-transform:uppercase;letter-spacing:.5px}.palette{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.toast{position:fixed;right:20px;bottom:20px;background:${COLORS.ink};color:${COLORS.surface};padding:10px 14px;font-size:13px;font-weight:800;opacity:0;transform:translateY(8px);transition:.18s}.toast.show{opacity:1;transform:translateY(0)}
</style></head><body>
<div class="app">
<aside class="rail"><div class="brand"><h1>StudioLAB Email Workbench</h1><p>Select a workflow, then an email. The preview, copy fields, swatches, and upload files all come from the same current source.</p></div><div class="workflow-tabs" id="workflowTabs"></div><nav class="menu" id="menu"></nav></aside>
<main class="preview-zone"><section class="status" id="status"></section><section id="emailPreview"></section></main>
<aside class="panel"><h2>Builder Resources</h2><p class="panel-note">Upload images from the local folder paths shown here. The browser preview is only for checking the finished structure.</p><div id="resourcePanel"></div></aside>
</div>
<div class="toast" id="toast">Copied</div>
<script>
const EMAILS=${JSON.stringify(records)};
const ROOT=${JSON.stringify(V2_ROOT)};
const COLORS=${JSON.stringify(COLORS)};
let activeStage="All";
const FIELD_SWATCHES={
  subject:[["Inbox text",COLORS.ink]],
  preview:[["Muted text",COLORS.muted]],
  hero:[["Eyebrow",COLORS.heroPink],["Headline",COLORS.surface],["Subline",COLORS.surface],["Overlay",COLORS.ink]],
  body:[["Surface",COLORS.surface],["Body",COLORS.body]],
  context:[["Band bg",COLORS.blushTint],["Title",COLORS.ink],["Body",COLORS.body]],
  cta:[["Button",COLORS.blush],["Text",COLORS.surface]],
  secondary:[["Link",COLORS.cobalt]],
  signature:[["Name",COLORS.ink],["Role",COLORS.muted]]
};
function esc(value){return String(value||"").replace(/[&<>"]/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch];});}
function paragraphs(value){return String(value||"").split(/\\n{2,}/).map(function(p){return "<p>"+esc(p).replace(/\\n/g,"<br>")+"</p>";}).join("");}
function swatchText(hex){return ["#faf6f1","#ffffff","#fde8f2","#ece8f4","#ebe4dd","#f3e6f3"].includes(String(hex).toLowerCase())?COLORS.ink:COLORS.surface;}
function swatches(items){return '<div class="swatches">'+items.map(function(item){return '<button class="hex" data-copy="'+esc(item[1])+'" style="--swatch:'+esc(item[1])+';--swatchText:'+swatchText(item[1])+'"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></button>';}).join("")+'</div>';}
function copyField(key,label,value,rows,swatchKey){return '<div class="field"><div class="field-head"><label for="'+key+'">'+esc(label)+'</label>'+swatches(FIELD_SWATCHES[swatchKey]||[])+'</div><textarea id="'+key+'" readonly rows="'+rows+'">'+esc(value)+'</textarea><button class="copy-btn" data-copy-target="'+key+'">Copy '+esc(label)+'</button></div>';}
function assetCard(label,folder,file){const rel=folder+"/"+file;const abs=ROOT+"/"+rel;return '<div class="asset"><strong>'+esc(label)+'</strong><img class="asset-thumb" src="'+esc(rel)+'" alt="'+esc(label)+'"><code>'+esc(file)+'</code><code>'+esc(abs)+'</code><a href="'+esc(rel)+'" target="_blank">Open image</a><button type="button" data-copy="'+esc(abs)+'">Copy path</button></div>';}
function stages(){return EMAILS.reduce(function(list,email){if(!list.includes(email.stage))list.push(email.stage);return list;},[]);}
function stageEmails(){return activeStage==="All"?EMAILS:EMAILS.filter(function(email){return email.stage===activeStage;});}
function renderWorkflowTabs(){const items=["All"].concat(stages());document.getElementById("workflowTabs").innerHTML=items.map(function(stage){return '<button type="button" class="'+(stage===activeStage?'active':'')+'" data-stage="'+esc(stage)+'">'+esc(stage)+'</button>';}).join("");}
function setStage(stage){activeStage=stage;const list=stageEmails();const current=EMAILS.find(function(email){return email.id===decodeURIComponent(location.hash.replace(/^#/,""));});render(list.find(function(email){return current&&email.id===current.id;})||list[0]||EMAILS[0]);}
function setActive(index){const email=EMAILS[index]||EMAILS[0];location.hash=email.id;render(email);}
function renderMenu(active){renderWorkflowTabs();const list=stageEmails();let currentStage="";document.getElementById("menu").innerHTML=list.map(function(email){const label=email.stage!==currentStage?'<div class="stage-label">'+esc(email.stage)+'</div>':"";currentStage=email.stage;return label+'<button type="button" class="'+(email.id===active.id?'active':'')+'" data-email-index="'+email.index+'"><span>'+email.number+' '+esc(email.id)+'</span><strong>'+esc(email.title)+'</strong><em>'+esc(email.stage)+'</em></button>';}).join("");}
function render(email){renderMenu(email);const rules=email.automationRules&&email.automationRules.length?'<p class="rules"><strong>Automation rules:</strong><br>'+email.automationRules.map(esc).join('<br>')+'</p>':"";document.getElementById("status").innerHTML='<p class="meta">'+email.number+' / '+esc(email.id)+' / '+esc(email.stage)+'</p><h2>'+esc(email.title)+'</h2><p><strong>Trigger:</strong> '+esc(email.trigger)+'</p><p><strong>Goal:</strong> '+esc(email.goal)+'</p>'+rules;const secondary=email.secondaryLine?'<div class="secondary-line">'+esc(email.secondaryLine)+'</div>':'';document.getElementById("emailPreview").innerHTML='<div class="email-frame"><img src="'+esc(email.folder+'/'+email.assets.topLogo)+'" width="600" alt="StudioLAB top logo"><img src="'+esc(email.folder+'/'+email.assets.hero)+'" width="600" alt="'+esc(email.heroHeadline)+'"><div class="body">'+paragraphs(email.body)+'</div><div class="button-row"><a class="btn" href="'+esc(email.primaryUrl)+'">'+esc(email.primaryCta)+'</a></div><div class="context"><p class="label">Why this helps</p><h3>'+esc(email.contextTitle)+'</h3><p>'+esc(email.contextText)+'</p></div>'+secondary+'<img src="'+esc(email.folder+'/'+email.assets.lower)+'" width="600" alt="StudioLAB lower visual"><div class="sig"><strong>Gary</strong><span>Founder, StudioLAB</span></div><div class="foot">Copyright (c) {{right_now.year}} StudioLAB Software. All rights reserved.<br>support@studiolabsoftware.com<br>You can unsubscribe from this list or manage your preferences.</div></div>';renderResources(email);}
function renderResources(email){const heroText=email.heroEyebrow+"\\n"+email.heroHeadline+"\\n"+email.heroSubline;const automationFields=email.automationRules&&email.automationRules.length?copyField("automationRules","Automation rules",email.automationRules.join("\\n"),5,"body"):"";const secondaryFields=email.secondaryCta?copyField("secondaryLine","Secondary line copy",email.secondaryLine,2,"secondary")+copyField("secondaryCta","Secondary CTA label",email.secondaryCta,1,"secondary")+copyField("secondaryUrl","Secondary CTA URL",email.secondaryUrl,1,"secondary"):"";document.getElementById("resourcePanel").innerHTML='<div class="section"><h3>Local upload images</h3><div class="asset-grid">'+assetCard("Top logo image",email.folder,email.assets.topLogo)+assetCard("Hero/header image with baked text",email.folder,email.assets.hero)+assetCard("Lower reference image",email.folder,email.assets.lower)+'</div></div><div class="section"><h3>Inbox and hero copy</h3>'+copyField("subject","Subject line",email.subject,2,"subject")+copyField("preview","Preview text",email.preview,2,"preview")+copyField("heroText","Hero text baked into image",heroText,4,"hero")+'</div><div class="section"><h3>Email builder copy</h3>'+copyField("bodyCopy","Body copy",email.body,9,"body")+copyField("contextTitle","Context title",email.contextTitle,2,"context")+copyField("contextCopy","Context copy",email.contextText,4,"context")+copyField("primaryCta","Primary CTA label",email.primaryCta,1,"cta")+copyField("primaryUrl","Primary CTA URL",email.primaryUrl,1,"cta")+automationFields+secondaryFields+copyField("signature","Signature",email.signature,3,"signature")+'</div><div class="section"><h3>Core palette</h3><div class="palette">'+Object.entries({Canvas:COLORS.canvas,Surface:COLORS.surface,Ink:COLORS.ink,Body:COLORS.body,Muted:COLORS.muted,Hairline:COLORS.hairline,CTA:COLORS.blush,Cobalt:COLORS.cobalt,Violet:COLORS.violet,BlushTint:COLORS.blushTint,LilacTint:COLORS.lilacTint,HeroPink:COLORS.heroPink}).map(function(pair){return '<button class="hex" data-copy="'+esc(pair[1])+'" style="--swatch:'+esc(pair[1])+';--swatchText:'+swatchText(pair[1])+'"><span>'+esc(pair[0])+'</span><strong>'+esc(pair[1])+'</strong></button>';}).join("")+'</div></div>';}
document.addEventListener("click",function(event){const stage=event.target.closest("[data-stage]");if(stage){setStage(stage.getAttribute("data-stage"));return;}const menu=event.target.closest("[data-email-index]");if(menu){setActive(Number(menu.getAttribute("data-email-index")));return;}const hex=event.target.closest("[data-copy]");if(hex){navigator.clipboard.writeText(hex.getAttribute("data-copy")).then(showToast);return;}const btn=event.target.closest("[data-copy-target]");if(!btn)return;const field=document.getElementById(btn.getAttribute("data-copy-target"));if(field)navigator.clipboard.writeText(field.value).then(showToast);});
function showToast(){const toast=document.getElementById("toast");toast.classList.add("show");setTimeout(function(){toast.classList.remove("show")},900);}
const hash=decodeURIComponent(location.hash.replace(/^#/,""));const initial=Math.max(0,EMAILS.findIndex(function(email){return email.id===hash;}));render(EMAILS[initial]||EMAILS[0]);
</script>
</body></html>`;
}

function uploadAssetIndex(emails) {
  const lines = [
    "StudioLAB v2 local upload asset index",
    "",
    "Use this file when building the emails in StudioLAB Growth.",
    "The browser preview is only for visual checking and copy reference.",
    "Upload the actual image files from the local folders listed below.",
    "",
    `Library root: ${V2_ROOT}`,
    "",
    "Each email folder contains:",
    "1. 01-top-logo-1200x240.png",
    "2. 02-hero-final-1200x736.jpg",
    "3. 03-lower-image-1200x430.jpg",
    "",
  ];

  emails.forEach((email, index) => {
    const folder = folderName(email, index);
    const dir = path.join(V2_ROOT, folder);
    lines.push(`${String(index + 1).padStart(2, "0")} ${clean(email.id)} - ${clean(email.title)}`);
    lines.push(`Folder: ${dir}`);
    lines.push(`Top logo image: ${path.join(dir, "01-top-logo-1200x240.png")}`);
    lines.push(`Hero/header image with baked text: ${path.join(dir, "02-hero-final-1200x736.jpg")}`);
    lines.push(`Lower reference image: ${path.join(dir, "03-lower-image-1200x430.jpg")}`);
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function heroAssetAudit(emails) {
  const lines = [
    "StudioLAB v2 hero asset consistency audit",
    "",
    "Generated from the current v2 lifecycle guide and production library data.",
    "",
  ];

  emails.forEach((email, index) => {
    const folder = folderName(email, index);
    lines.push(`${String(index + 1).padStart(2, "0")} ${clean(email.id)} - ${clean(email.title)}`);
    lines.push(`  Folder: ${folder}`);
    lines.push("  Hero text:");
    lines.push(`    ${clean(email.heroEyebrow).toUpperCase()}`);
    lines.push(`    ${clean(email.heroHeadline)}`);
    lines.push(`    ${clean(email.heroSubline)}`);
    lines.push(`  Hero image file: ${path.join(V2_ROOT, folder, "02-hero-final-1200x736.jpg")}`);
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function contentStructureAudit(emails) {
  const lines = [
    "StudioLAB v2 content structure audit",
    "",
    "Generated from the current v2 lifecycle guide and production library data.",
    "",
  ];

  emails.forEach((email, index) => {
    lines.push(`${String(index + 1).padStart(2, "0")} ${clean(email.id)} - ${clean(email.title)}`);
    lines.push(`  Stage: ${clean(email.stage)}`);
    lines.push(`  Trigger: ${clean(email.trigger)}`);
    lines.push(`  Goal: ${clean(email.goal)}`);
    if (Array.isArray(email.automationRules) && email.automationRules.length) {
      lines.push("  Automation rules:");
      email.automationRules.forEach((rule) => lines.push(`    - ${clean(rule)}`));
    }
    lines.push(`  Primary CTA: ${clean(email.primaryCta)} -> ${clean(email.primaryUrl)}`);
    if (email.secondaryCta) {
      lines.push(`  Secondary CTA: ${clean(email.secondaryCta)} -> ${clean(email.secondaryUrl)}`);
      lines.push(`  Secondary line: ${clean(secondaryLineText(email))}`);
    }
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function main() {
  ensure(V2_ROOT);
  const emails = readEmails();
  const shared = path.join(V2_ROOT, "00-shared-assets");
  ensure(shared);
  fs.copyFileSync(WEBSITE_LOGO, path.join(shared, "studiolab-logo.svg"));

  emails.forEach((email, index) => {
    const dir = path.join(V2_ROOT, folderName(email, index));
    ensure(dir);
    let layout = heroTextLayout(email);
    if (!GUIDES_ONLY) {
      if (!LOWER_ONLY && !HERO_ONLY) {
        createTopLogo(path.join(dir, "01-top-logo-1200x240.png"));
      }
      if (!LOWER_ONLY) {
        layout = createHero(email, path.join(dir, "02-hero-final-1200x736.jpg"));
      }
      if (!HERO_ONLY) {
        createLower(email, path.join(dir, "03-lower-image-1200x430.jpg"));
      }
    }
    copyTextFiles(email, index, dir, layout);
    fs.writeFileSync(path.join(dir, "full-email-preview.html"), renderPreview(email, index, emails));
  });

  fs.writeFileSync(path.join(V2_ROOT, "index.html"), renderWorkbench(emails));
  fs.writeFileSync(path.join(V2_ROOT, "00-reference-overview.html"), renderIndex(emails));
  fs.writeFileSync(path.join(V2_ROOT, "00-UPLOAD-ASSET-INDEX.txt"), uploadAssetIndex(emails));
  fs.writeFileSync(path.join(V2_ROOT, "00-HERO-ASSET-CONSISTENCY-AUDIT.txt"), heroAssetAudit(emails));
  fs.writeFileSync(path.join(V2_ROOT, "00-CONTENT-STRUCTURE-AUDIT.txt"), contentStructureAudit(emails));
  fs.writeFileSync(
    path.join(V2_ROOT, "00-READ-ME-V2-RETINA.txt"),
    `StudioLAB v2 retina email asset library

This is the high-resolution replacement set for upload testing.

Important:
The browser preview is only for visual checking. Do not copy images from the browser preview.
Upload the actual local image files from each numbered email folder on your computer.

Use these files inside each numbered email folder:

1. 01-top-logo-1200x240.png
2. 02-hero-final-1200x736.jpg
3. 03-lower-image-1200x430.jpg

Display each image at 600px wide in the email builder.

Open the main builder workbench:
${path.join(V2_ROOT, "index.html")}

The workbench is the stable source for:
- selecting each email from the left menu
- checking the finished visual structure
- copying subject, preview, hero, body, CTA, and support text
- copying the hex colors used beside each editable section
- checking the exact local image files to upload

Reference-only static overview:
${path.join(V2_ROOT, "00-reference-overview.html")}
`
  );
  console.log(V2_ROOT);
  console.log(`${emails.length} retina email folders generated.`);
  if (GUIDES_ONLY) console.log("Guide-only refresh: images were not regenerated.");
  if (LOWER_ONLY) console.log("Lower-image refresh: hero and top logo assets were not regenerated.");
  if (HERO_ONLY) console.log("Hero-image refresh: top logo and lower image assets were not regenerated.");
}

main();
