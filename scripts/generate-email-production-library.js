const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const EMAIL_SYSTEM_ROOT = "/Users/gary/Library/CloudStorage/Dropbox/Gary's Files/StudioLAB/Media:Graphic Design/Email Design System";
const GUIDE_HTML = path.join(
  EMAIL_SYSTEM_ROOT,
  "12-lifecycle-template-guides",
  "studiolab-lifecycle-email-full-preview-tabs-v2.html"
);
const BUILDER_ASSETS = path.join(EMAIL_SYSTEM_ROOT, "07-builder-ready-assets");
const PRODUCTION_ROOT = path.join(EMAIL_SYSTEM_ROOT, "13-email-production-library");
const BRAND_ROOT = path.join(PRODUCTION_ROOT, "00-brand-shared-assets");
const WEBSITE_LOGO = "/Users/gary/Claude_Projects/StudioLAB-Builds/studiolab-website/public/brand/studiolab-logo.svg";
const ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
const GEORGIA_BOLD = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf";

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
  blushTint: "#fde8f2",
  cobaltTint: "#eeedf8",
  violetTint: "#f3e6f3",
  lilacTint: "#ece8f4",
  heroPink: "#f4a3c7",
};

const STYLES = {
  canvas: { width: 600, height: 368 },
  textX: 34,
  textMaxWidth: 532,
  bottomPadding: 34,
  eyebrow: {
    font: "Arial",
    intendedFont: "Inter Bold",
    size: 12,
    weight: 700,
    lineHeight: 15,
    tracking: 1.4,
    color: COLORS.heroPink,
  },
  headline: {
    font: "Georgia",
    intendedFont: "Fraunces Medium",
    size: 42,
    longSize: 38,
    extraLongSize: 34,
    weight: 700,
    lineHeight: 44,
    color: COLORS.surface,
  },
  subline: {
    font: "Arial",
    intendedFont: "Inter Semibold",
    size: 16,
    weight: 600,
    lineHeight: 22,
    color: COLORS.surface,
    opacity: 0.92,
  },
};

function readEmails() {
  const html = fs.readFileSync(GUIDE_HTML, "utf8");
  const start = html.indexOf("const emails = ");
  const arrayStart = html.indexOf("[", start);
  const arrayEnd = html.indexOf("];", arrayStart) + 1;
  if (start < 0 || arrayStart < 0 || arrayEnd < 1) {
    throw new Error("Could not find email data in lifecycle preview HTML.");
  }
  return vm.runInNewContext(html.slice(arrayStart, arrayEnd));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cleanAscii(value) {
  return String(value || "")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function escapeXml(value) {
  return cleanAscii(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtml(value) {
  return escapeXml(value).replace(/\n/g, "<br>");
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function runMagick(args) {
  execFileSync("magick", args, { stdio: "pipe" });
}

function getEmailFolder(email, index) {
  return `${String(index + 1).padStart(2, "0")}-${email.id.toLowerCase()}-${slugify(email.title)}`;
}

function sourceHeroNames(imageName) {
  const names = [];
  const add = (name) => {
    if (name && !names.includes(name)) names.push(name);
  };
  add(imageName);
  add(imageName.replace("header-gradient-bottom-600x368", "header-clean-600x368"));
  add(imageName.replace("banner-clean-600x300", "header-clean-600x368"));
  add(imageName.replace("banner-gradient-bottom-600x300", "header-clean-600x368"));
  add(imageName.replace("banner-clean-600x300", "header-gradient-bottom-600x368"));
  add(imageName.replace("banner-gradient-bottom-600x300", "header-gradient-bottom-600x368"));
  return names;
}

function findFirstExisting(names) {
  for (const name of names) {
    const candidate = path.join(BUILDER_ASSETS, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function wrapText(text, maxChars) {
  const words = cleanAscii(text).split(/\s+/).filter(Boolean);
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

function headlineStyleFor(text) {
  const len = cleanAscii(text).length;
  if (len > 46) return { size: STYLES.headline.extraLongSize, lineHeight: 38, maxChars: 28 };
  if (len > 31) return { size: STYLES.headline.longSize, lineHeight: 41, maxChars: 25 };
  return { size: STYLES.headline.size, lineHeight: STYLES.headline.lineHeight, maxChars: 23 };
}

function textOverlaySvg(email, withGradient = true) {
  const { width, height } = STYLES.canvas;
  const h = headlineStyleFor(email.heroHeadline);
  const eyebrow = cleanAscii(email.heroEyebrow || "");
  const headlineLines = wrapText(email.heroHeadline, h.maxChars).slice(0, 3);
  const sublineLines = wrapText(email.heroSubline, 54).slice(0, 3);
  const eyebrowHeight = STYLES.eyebrow.lineHeight;
  const headlineHeight = headlineLines.length * h.lineHeight;
  const sublineHeight = sublineLines.length * STYLES.subline.lineHeight;
  const totalHeight = eyebrowHeight + 13 + headlineHeight + 12 + sublineHeight;
  let y = height - STYLES.bottomPadding - totalHeight;
  if (y < 112) y = 112;
  const headlineY = y + eyebrowHeight + 13;
  const sublineY = headlineY + headlineHeight + 12;

  const gradient = withGradient
    ? `
  <defs>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${COLORS.ink}" stop-opacity="0"/>
      <stop offset="46%" stop-color="${COLORS.ink}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${COLORS.ink}" stop-opacity="0.74"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bottomFade)"/>`
    : "";

  const headlineText = headlineLines
    .map((line, index) => {
      const textY = headlineY + index * h.lineHeight + h.size * 0.82;
      return `<text x="${STYLES.textX}" y="${textY}" font-family="${STYLES.headline.font}" font-size="${h.size}" font-weight="${STYLES.headline.weight}" fill="${STYLES.headline.color}">${escapeXml(line)}</text>`;
    })
    .join("\n");
  const sublineText = sublineLines
    .map((line, index) => {
      const textY = sublineY + index * STYLES.subline.lineHeight + STYLES.subline.size * 0.82;
      return `<text x="${STYLES.textX}" y="${textY}" font-family="${STYLES.subline.font}" font-size="${STYLES.subline.size}" font-weight="${STYLES.subline.weight}" fill="${STYLES.subline.color}" opacity="${STYLES.subline.opacity}">${escapeXml(line)}</text>`;
    })
    .join("\n");

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${gradient}
<text x="${STYLES.textX}" y="${y + STYLES.eyebrow.size}" font-family="${STYLES.eyebrow.font}" font-size="${STYLES.eyebrow.size}" font-weight="${STYLES.eyebrow.weight}" letter-spacing="${STYLES.eyebrow.tracking}" fill="${STYLES.eyebrow.color}">${escapeXml(eyebrow.toUpperCase())}</text>
${headlineText}
${sublineText}
</svg>`,
    sketch: {
      textBoxX: STYLES.textX,
      textBoxY: Math.round(y),
      textBoxWidth: STYLES.textMaxWidth,
      eyebrowBaseline: y + STYLES.eyebrow.size,
      eyebrow,
      eyebrowSize: STYLES.eyebrow.size,
      eyebrowLineHeight: STYLES.eyebrow.lineHeight,
      eyebrowTracking: STYLES.eyebrow.tracking,
      headlineSize: h.size,
      headlineLineHeight: h.lineHeight,
      headlineLines,
      headlineBaselines: headlineLines.map((_, index) =>
        headlineY + index * h.lineHeight + h.size * 0.82
      ),
      sublineSize: STYLES.subline.size,
      sublineLineHeight: STYLES.subline.lineHeight,
      sublineLines,
      sublineBaselines: sublineLines.map((_, index) =>
        sublineY + index * STYLES.subline.lineHeight + STYLES.subline.size * 0.82
      ),
    },
  };
}

function createTextOverlayPng(email, sketch, dest) {
  const args = ["-size", "600x368", "xc:none"];
  args.push("-font", ARIAL_BOLD, "-pointsize", String(STYLES.eyebrow.size));
  args.push("-fill", COLORS.heroPink, "-kerning", String(STYLES.eyebrow.tracking));
  args.push("-annotate", `+${STYLES.textX}+${Math.round(sketch.eyebrowBaseline)}`, cleanAscii(email.heroEyebrow).toUpperCase());
  args.push("-kerning", "0");

  args.push("-font", GEORGIA_BOLD, "-pointsize", String(sketch.headlineSize), "-fill", COLORS.surface);
  sketch.headlineLines.forEach((line, index) => {
    args.push("-annotate", `+${STYLES.textX}+${Math.round(sketch.headlineBaselines[index])}`, cleanAscii(line));
  });

  args.push("-font", ARIAL_BOLD, "-pointsize", String(STYLES.subline.size), "-fill", "rgba(255,255,255,0.92)");
  sketch.sublineLines.forEach((line, index) => {
    args.push("-annotate", `+${STYLES.textX}+${Math.round(sketch.sublineBaselines[index])}`, cleanAscii(line));
  });

  args.push(dest);
  runMagick(args);
}

function gradientSvgOnly() {
  const { width, height } = STYLES.canvas;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${COLORS.ink}" stop-opacity="0"/>
      <stop offset="46%" stop-color="${COLORS.ink}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${COLORS.ink}" stop-opacity="0.74"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bottomFade)"/>
</svg>`;
}

function createTopLogoBlock(dest) {
  const logoPng = path.join(BRAND_ROOT, "studiolab-logo-320w.png");
  const markLogo = path.join(BRAND_ROOT, "studiolab-top-logo-with-tagline-600x120.png");
  copyFile(WEBSITE_LOGO, path.join(BRAND_ROOT, "studiolab-logo.svg"));
  runMagick(["-background", "none", WEBSITE_LOGO, "-resize", "320x", logoPng]);
  runMagick([
    "-size",
    "600x120",
    `xc:${COLORS.surface}`,
    logoPng,
    "-gravity",
    "center",
    "-geometry",
    "+0-12",
    "-composite",
    "-gravity",
    "south",
    "-font",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "-pointsize",
    "15",
    "-fill",
    COLORS.ink,
    "-annotate",
    "+0+14",
    "Dance software that performs",
    markLogo,
  ]);
  copyFile(markLogo, dest);
}

function plainTextEmailCopy(email) {
  return [
    `Email ID: ${email.id}`,
    `Title: ${cleanAscii(email.title)}`,
    `Stage: ${cleanAscii(email.stage)}`,
    `Trigger: ${cleanAscii(email.trigger)}`,
    "",
    `Subject: ${cleanAscii(email.subject)}`,
    `Preview text: ${cleanAscii(email.preview)}`,
    "",
    "Hero image text:",
    `${cleanAscii(email.heroEyebrow).toUpperCase()}`,
    `${cleanAscii(email.heroHeadline)}`,
    `${cleanAscii(email.heroSubline)}`,
    "",
    "Body copy:",
    cleanAscii(email.body),
    "",
    `Primary CTA: ${cleanAscii(email.primaryCta)}`,
    `Primary CTA URL: ${cleanAscii(email.primaryUrl)}`,
    email.secondaryCta ? `Secondary CTA: ${cleanAscii(email.secondaryCta)}` : "",
    email.secondaryUrl ? `Secondary CTA URL: ${cleanAscii(email.secondaryUrl)}` : "",
    "",
    `Context block title: ${cleanAscii(email.contextTitle)}`,
    `Context block text: ${cleanAscii(email.contextText)}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function assetSpec(email, folderName, sketch) {
  return `# ${cleanAscii(email.id)} - ${cleanAscii(email.title)}

## Folder

${path.join(PRODUCTION_ROOT, folderName)}

## Finished Assets

- top-logo-600x120.png
- hero-branded-600x368.png
- hero-background-clean-600x368.jpg
- hero-background-gradient-600x368.jpg
- hero-gradient-overlay-600x368.svg
- hero-text-overlay-transparent.svg
- lower-image-600x215.jpg
- email-copy.txt

## Sketch Hero Setup

Canvas: 600px wide x 368px high

Background image: hero-background-clean-600x368.jpg

Gradient overlay:
- Bottom vertical fade: ${COLORS.ink}
- Top opacity: 0%
- Mid opacity: 22% at 46%
- Bottom opacity: 74%

Text box:
- X: ${sketch.textBoxX}px
- Y: ${sketch.textBoxY}px
- Width: ${sketch.textBoxWidth}px
- Bottom-aligned hero text group

Eyebrow:
- Text: ${cleanAscii(email.heroEyebrow).toUpperCase()}
- Intended font: ${STYLES.eyebrow.intendedFont}
- Export fallback used: Arial Bold
- Size: ${sketch.eyebrowSize}px
- Line height: ${sketch.eyebrowLineHeight}px
- Letter spacing: ${sketch.eyebrowTracking}px
- Color: ${COLORS.heroPink}
- Case: uppercase

Headline:
- Text: ${cleanAscii(email.heroHeadline)}
- Intended font: ${STYLES.headline.intendedFont}
- Export fallback used: Georgia Bold
- Size: ${sketch.headlineSize}px
- Line height: ${sketch.headlineLineHeight}px
- Color: ${COLORS.surface}
- Weight: 500 intended / 700 fallback

Subline:
- Text: ${cleanAscii(email.heroSubline)}
- Intended font: ${STYLES.subline.intendedFont}
- Export fallback used: Arial Bold
- Size: ${sketch.sublineSize}px
- Line height: ${sketch.sublineLineHeight}px
- Color: ${COLORS.surface}
- Opacity: 92%

## Email Color Reference

- Warm canvas: ${COLORS.canvas}
- White surface: ${COLORS.surface}
- Ink: ${COLORS.ink}
- Body text: ${COLORS.body}
- Muted text: ${COLORS.muted}
- Hairline: ${COLORS.hairline}
- Primary CTA blush: ${COLORS.blush}
- Cobalt: ${COLORS.cobalt}
- Violet: ${COLORS.violet}
- Blush tint: ${COLORS.blushTint}
- Cobalt tint: ${COLORS.cobaltTint}
- Violet tint: ${COLORS.violetTint}
- Lilac tint: ${COLORS.lilacTint}
`;
}

function renderEmailPreview(email, folderName) {
  const bodyParas = cleanAscii(email.body)
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para)}</p>`)
    .join("\n");
  const secondary = email.secondaryCta
    ? `<p class="secondary">${escapeHtml(email.secondaryCta)}</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(email.id)} - ${escapeHtml(email.title)}</title>
<style>
  body{margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.body};}
  .wrap{max-width:760px;margin:0 auto;padding:34px 18px 56px;}
  .email{max-width:600px;margin:0 auto;background:${COLORS.surface};overflow:hidden;}
  img{display:block;width:100%;height:auto;border:0;}
  .body{padding:44px 38px 20px;background:${COLORS.surface};}
  .body p{font-size:19px;line-height:1.46;margin:0 0 22px;}
  .button{display:block;width:max-content;margin:28px auto 18px;background:${COLORS.blush};color:white;text-decoration:none;border-radius:999px;padding:14px 34px;font-weight:700;font-size:17px;}
  .context{padding:28px 38px;background:${COLORS.blushTint};}
  .context .label{font-size:13px;line-height:1.1;text-transform:uppercase;letter-spacing:1.2px;color:${COLORS.blush};font-weight:800;margin:0 0 14px;}
  .context h2{font-family:Georgia,serif;font-size:30px;line-height:1.08;margin:0 0 14px;color:${COLORS.ink};}
  .context p{font-size:18px;line-height:1.48;margin:0;color:${COLORS.body};}
  .secondary{text-align:center;font-size:15px;color:${COLORS.cobalt};text-decoration:underline;margin:20px 0 0;}
  .sig{padding:34px 38px;text-align:center;background:${COLORS.surface};}
  .sig .name{font-size:28px;font-weight:800;color:${COLORS.ink};margin:0;}
  .sig .role{font-size:16px;color:${COLORS.muted};margin:6px 0 0;}
  .footer{padding:24px 34px 32px;text-align:center;background:${COLORS.lilacTint};font-size:12px;color:${COLORS.muted};line-height:1.5;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="email">
      <img src="top-logo-600x120.png" alt="StudioLAB">
      <img src="hero-branded-600x368.png" alt="${escapeHtml(email.heroHeadline)}">
      <div class="body">
        ${bodyParas}
        <a class="button" href="${escapeHtml(email.primaryUrl)}">${escapeHtml(email.primaryCta)}</a>
        ${secondary}
      </div>
      <div class="context">
        <p class="label">Why this helps</p>
        <h2>${escapeHtml(email.contextTitle)}</h2>
        <p>${escapeHtml(email.contextText)}</p>
      </div>
      <img src="lower-image-600x215.jpg" alt="StudioLAB">
      <div class="sig">
        <p class="name">Gary</p>
        <p class="role">Founder, StudioLAB</p>
      </div>
      <div class="footer">
        Copyright (c) {{right_now.year}} StudioLAB Software. All rights reserved.<br>
        support@studiolabsoftware.com<br>
        You can unsubscribe from this list or manage your preferences.
      </div>
    </div>
  </div>
</body>
</html>`;
}

function colorCard(name, hex) {
  const darkText = ["#faf6f1", "#ffffff", "#fde8f2", "#eeedf8", "#f3e6f3", "#ece8f4", "#ebe4dd"].includes(hex.toLowerCase());
  return `<button class="swatch" data-copy="${hex}" style="background:${hex};color:${darkText ? COLORS.ink : COLORS.surface};"><span>${escapeHtml(name)}</span><strong>${hex}</strong></button>`;
}

function renderIndex(emails, folders) {
  const cards = emails
    .map((email, index) => {
      const folder = folders[index];
      const rel = folder.folderName;
      const body = cleanAscii(email.body).split(/\n{2,}/).slice(0, 2).join("\n\n");
      return `<section class="email-card" id="${escapeHtml(email.id)}">
  <div class="preview">
    <div class="email-shell">
      <img src="${rel}/top-logo-600x120.png" alt="StudioLAB">
      <img src="${rel}/hero-branded-600x368.png" alt="${escapeHtml(email.heroHeadline)}">
      <div class="copy-block">
        ${body.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
        <button>${escapeHtml(email.primaryCta)}</button>
      </div>
      <div class="full-band">
        <p class="band-kicker">Why this helps</p>
        <h3>${escapeHtml(email.contextTitle)}</h3>
        <p>${escapeHtml(email.contextText)}</p>
      </div>
      <img src="${rel}/lower-image-600x215.jpg" alt="StudioLAB lower visual">
    </div>
  </div>
  <div class="details">
    <p class="meta">${String(index + 1).padStart(2, "0")} / ${escapeHtml(email.stage)} / ${escapeHtml(email.id)}</p>
    <h2>${escapeHtml(email.title)}</h2>
    <p class="goal"><strong>Goal:</strong> ${escapeHtml(email.goal)}</p>
    <div class="actions">
      <a href="${rel}/" target="_blank">Open Folder</a>
      <a href="${rel}/full-email-preview.html" target="_blank">Preview Email</a>
      <a href="${rel}/asset-spec.md" target="_blank">Sketch Specs</a>
      <a href="${rel}/email-copy.txt" target="_blank">Copy Sheet</a>
    </div>
    <div class="asset-grid">
      <div><img src="${rel}/hero-branded-600x368.png" alt=""><span>Final baked hero</span></div>
      <div><img src="${rel}/hero-background-clean-600x368.jpg" alt=""><span>Clean background</span></div>
      <div><img src="${rel}/hero-background-gradient-600x368.jpg" alt=""><span>Gradient background</span></div>
      <div><img src="${rel}/hero-text-overlay-transparent.png" alt=""><span>Transparent text overlay</span></div>
    </div>
    <div class="copy-panel">
      <label>Subject</label>
      <button data-copy="${escapeHtml(email.subject)}">${escapeHtml(email.subject)}</button>
      <label>Preview Text</label>
      <button data-copy="${escapeHtml(email.preview)}">${escapeHtml(email.preview)}</button>
      <label>Hero Text</label>
      <button data-copy="${escapeHtml(`${email.heroEyebrow.toUpperCase()}\n${email.heroHeadline}\n${email.heroSubline}`)}">${escapeHtml(`${email.heroEyebrow.toUpperCase()}\n${email.heroHeadline}\n${email.heroSubline}`)}</button>
    </div>
    <div class="colors">
      ${colorCard("Canvas", COLORS.canvas)}
      ${colorCard("Surface", COLORS.surface)}
      ${colorCard("Ink", COLORS.ink)}
      ${colorCard("Body", COLORS.body)}
      ${colorCard("Muted", COLORS.muted)}
      ${colorCard("Hairline", COLORS.hairline)}
      ${colorCard("CTA", COLORS.blush)}
      ${colorCard("Cobalt", COLORS.cobalt)}
      ${colorCard("Blush Tint", COLORS.blushTint)}
      ${colorCard("Lilac Tint", COLORS.lilacTint)}
    </div>
  </div>
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StudioLAB Email Production Library</title>
<style>
  :root{--canvas:${COLORS.canvas};--surface:${COLORS.surface};--ink:${COLORS.ink};--body:${COLORS.body};--muted:${COLORS.muted};--hairline:${COLORS.hairline};--blush:${COLORS.blush};--cobalt:${COLORS.cobalt};--tint:${COLORS.blushTint};}
  *{box-sizing:border-box}
  body{margin:0;background:var(--canvas);color:var(--body);font-family:Arial,Helvetica,sans-serif;}
  header{padding:42px 32px 26px;max-width:1240px;margin:0 auto;}
  h1{font-family:Georgia,serif;font-size:50px;line-height:1.02;margin:0 0 12px;color:var(--ink);}
  header p{font-size:18px;line-height:1.5;max-width:760px;margin:0;color:var(--muted);}
  .palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(136px,1fr));gap:10px;margin:24px 0 0;max-width:980px;}
  .swatch{border:1px solid rgba(36,26,29,.12);border-radius:0;padding:14px;text-align:left;cursor:pointer;min-height:72px;font:inherit;}
  .swatch span{display:block;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:800;margin-bottom:8px;}
  .swatch strong{font-size:17px;}
  main{max-width:1240px;margin:0 auto;padding:0 32px 60px;}
  .email-card{display:grid;grid-template-columns:minmax(360px,600px) minmax(360px,1fr);gap:34px;padding:34px 0;border-top:1px solid var(--hairline);}
  .email-shell{background:var(--surface);box-shadow:0 16px 46px rgba(36,26,29,.08);overflow:hidden;}
  img{display:block;width:100%;height:auto;border:0;}
  .copy-block{padding:38px;}
  .copy-block p{font-size:18px;line-height:1.48;margin:0 0 18px;}
  .copy-block button{display:block;margin:24px auto 0;background:var(--blush);border:0;border-radius:999px;color:white;padding:13px 32px;font-size:16px;font-weight:800;}
  .full-band{background:var(--tint);padding:28px 38px;}
  .band-kicker{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:var(--blush);font-weight:800;margin:0 0 12px;}
  .full-band h3{font-family:Georgia,serif;font-size:30px;line-height:1.05;margin:0 0 10px;color:var(--ink);}
  .full-band p{font-size:17px;line-height:1.45;margin:0;}
  .details{padding-top:4px;}
  .meta{font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:var(--blush);font-weight:800;margin:0 0 10px;}
  h2{font-family:Georgia,serif;color:var(--ink);font-size:38px;line-height:1.08;margin:0 0 14px;}
  .goal{font-size:16px;line-height:1.48;color:var(--muted);margin:0 0 20px;}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px;}
  .actions a{background:var(--surface);border:1px solid var(--hairline);color:var(--cobalt);text-decoration:none;font-weight:800;padding:10px 13px;font-size:13px;}
  .asset-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:0 0 20px;}
  .asset-grid div{background:var(--surface);border:1px solid var(--hairline);}
  .asset-grid span{display:block;font-size:12px;font-weight:800;color:var(--muted);padding:8px 10px;text-transform:uppercase;letter-spacing:.8px;}
  .copy-panel{display:grid;gap:8px;margin:0 0 20px;}
  .copy-panel label{font-size:12px;text-transform:uppercase;letter-spacing:1.1px;font-weight:800;color:var(--muted);}
  .copy-panel button{background:var(--surface);border:1px solid var(--hairline);text-align:left;padding:12px;color:var(--body);font-size:14px;line-height:1.4;white-space:pre-wrap;cursor:pointer;}
  .colors{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:8px;}
  @media(max-width:980px){.email-card{grid-template-columns:1fr;}h1{font-size:40px;}}
</style>
</head>
<body>
  <header>
    <h1>StudioLAB Email Production Library</h1>
    <p>Finished image assets, source backgrounds, lower-image blocks, copy sheets, and Sketch-ready style specs for the lifecycle email system. Click any color or copy block to copy the value.</p>
    <div class="palette">
      ${colorCard("Warm Canvas", COLORS.canvas)}
      ${colorCard("White Surface", COLORS.surface)}
      ${colorCard("Ink", COLORS.ink)}
      ${colorCard("Body", COLORS.body)}
      ${colorCard("Muted", COLORS.muted)}
      ${colorCard("Hairline", COLORS.hairline)}
      ${colorCard("Primary CTA", COLORS.blush)}
      ${colorCard("Cobalt", COLORS.cobalt)}
      ${colorCard("Violet", COLORS.violet)}
    </div>
  </header>
  <main>
    ${cards}
  </main>
<script>
document.addEventListener('click', function(event) {
  const target = event.target.closest('[data-copy]');
  if (!target) return;
  navigator.clipboard.writeText(target.getAttribute('data-copy')).then(function() {
    const old = target.dataset.old || target.innerHTML;
    target.dataset.old = old;
    target.innerHTML = 'Copied';
    setTimeout(function(){ target.innerHTML = old; }, 900);
  });
});
</script>
</body>
</html>`;
}

function main() {
  ensureDir(PRODUCTION_ROOT);
  ensureDir(BRAND_ROOT);
  const emails = readEmails();
  const folders = [];
  const brandLogoPerEmail = path.join(BRAND_ROOT, "studiolab-top-logo-with-tagline-600x120.png");
  createTopLogoBlock(brandLogoPerEmail);

  emails.forEach((email, index) => {
    const folderName = getEmailFolder(email, index);
    const dir = path.join(PRODUCTION_ROOT, folderName);
    ensureDir(dir);
    folders.push({ folderName, dir });

    const cleanHeroPath = findFirstExisting(
      sourceHeroNames(email.image).filter((name) => name.includes("header-clean"))
    ) || findFirstExisting(sourceHeroNames(email.image));
    if (!cleanHeroPath) throw new Error(`Missing hero source for ${email.id}: ${email.image}`);

    const cleanDest = path.join(dir, "hero-background-clean-600x368.jpg");
    const gradientDest = path.join(dir, "hero-background-gradient-600x368.jpg");
    const heroDest = path.join(dir, "hero-branded-600x368.png");
    const gradientSvgPath = path.join(dir, "hero-gradient-overlay-600x368.svg");
    const gradientPngPath = path.join(dir, "hero-gradient-overlay-600x368.png");
    const textSvgPath = path.join(dir, "hero-text-overlay-transparent.svg");
    const textPngPath = path.join(dir, "hero-text-overlay-transparent.png");

    runMagick([cleanHeroPath, "-resize", "600x368^", "-gravity", "center", "-extent", "600x368", cleanDest]);
    fs.writeFileSync(gradientSvgPath, gradientSvgOnly());
    runMagick(["-size", "600x368", `gradient:rgba(36,26,29,0)-rgba(36,26,29,0.74)`, gradientPngPath]);
    runMagick([cleanDest, gradientPngPath, "-compose", "over", "-composite", "-quality", "94", gradientDest]);
    const overlay = textOverlaySvg(email, true);
    fs.writeFileSync(textSvgPath, textOverlaySvg(email, false).svg);
    createTextOverlayPng(email, overlay.sketch, textPngPath);
    runMagick([gradientDest, textPngPath, "-composite", heroDest]);

    const lowerSource = path.join(BUILDER_ASSETS, email.lowerImage);
    if (!copyFile(lowerSource, path.join(dir, "lower-image-600x215.jpg"))) {
      throw new Error(`Missing lower image for ${email.id}: ${email.lowerImage}`);
    }
    copyFile(brandLogoPerEmail, path.join(dir, "top-logo-600x120.png"));
    fs.writeFileSync(path.join(dir, "email-copy.txt"), plainTextEmailCopy(email));
    fs.writeFileSync(path.join(dir, "asset-spec.md"), assetSpec(email, folderName, overlay.sketch));
    fs.writeFileSync(path.join(dir, "full-email-preview.html"), renderEmailPreview(email, folderName));
  });

  fs.writeFileSync(path.join(PRODUCTION_ROOT, "index.html"), renderIndex(emails, folders));
  fs.writeFileSync(
    path.join(PRODUCTION_ROOT, "library-readme.txt"),
    [
      "StudioLAB Email Production Library",
      "",
      `Created from: ${GUIDE_HTML}`,
      "",
      "Each numbered email folder contains:",
      "- top-logo-600x120.png",
      "- hero-branded-600x368.png",
      "- hero-background-clean-600x368.jpg",
      "- hero-background-gradient-600x368.jpg",
      "- hero-gradient-overlay-600x368.svg",
      "- hero-text-overlay-transparent.svg",
      "- hero-text-overlay-transparent.png",
      "- lower-image-600x215.jpg",
      "- email-copy.txt",
      "- asset-spec.md",
      "- full-email-preview.html",
      "",
      "Open index.html for the visual browser guide.",
    ].join("\n")
  );

  console.log(PRODUCTION_ROOT);
  console.log(`${emails.length} email folders generated.`);
}

main();
