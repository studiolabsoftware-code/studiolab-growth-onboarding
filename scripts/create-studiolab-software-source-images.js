const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = "/Users/gary/Library/CloudStorage/Dropbox/Gary's Files/StudioLAB/Media:Graphic Design/Email Design System";
const SOURCE_ROOT = path.join(ROOT, "02-source-images");
const OUT = path.join(SOURCE_ROOT, "generated-software");
const TMP = "/tmp/studiolab-email-software-sources";

const BASES = {
  class: path.join(SOURCE_ROOT, "generated-student-class", "studiolab-kids-class-energy-source.png"),
  circle: path.join(SOURCE_ROOT, "generated-student-class", "studiolab-kids-dance-circle-source.png"),
  ballet: path.join(SOURCE_ROOT, "generated-student-class", "studiolab-young-ballet-class-source.png"),
  reception: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-family-reception-source.png"),
  planning: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-owner-planning-source.png"),
  barre: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-studio-detail-barre-source.png"),
  support: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-support-call-source.png"),
  growth: path.join(SOURCE_ROOT, "generated-lifecycle", "studiolab-growth-communication-source.png"),
};

const C = {
  canvas: "#faf6f1",
  surface: "#ffffff",
  ink: "#241a1d",
  muted: "#706168",
  hairline: "#ebe4dd",
  blush: "#ec639e",
  cobalt: "#4a429b",
  violet: "#a65fa6",
  lilac: "#ece8f4",
  blushTint: "#fde8f2",
  cobaltTint: "#eeedf8",
  violetTint: "#f3e6f3",
};

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runMagick(args) {
  execFileSync("magick", args, { stdio: "pipe" });
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function rect(x, y, w, h, fill = C.surface, stroke = C.hairline, rx = 28, opacity = 0.9) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="2"/>`;
}

function line(x1, y1, x2, y2, color = C.cobalt, width = 8, opacity = 0.5) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`;
}

function dot(cx, cy, r, fill, opacity = 0.95) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`;
}

function pill(x, y, w, h, fill, opacity = 0.92) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" opacity="${opacity}"/>`;
}

function smallLines(x, y, widths, color = C.muted, gap = 24) {
  return widths
    .map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="10" rx="5" fill="${color}" opacity="${i === 0 ? 0.82 : 0.42}"/>`)
    .join("");
}

function laptop(x, y, w, h, inner = "") {
  return `
    <g>
      ${rect(x, y, w, h, C.surface, C.hairline, 34, 0.88)}
      <rect x="${x + 38}" y="${y + 38}" width="${w - 76}" height="${h - 98}" rx="20" fill="${C.canvas}" opacity="0.95"/>
      ${inner}
      <path d="M${x + 110} ${y + h + 20} H${x + w - 110} L${x + w - 54} ${y + h + 72} H${x + 54} Z" fill="${C.ink}" opacity="0.14"/>
    </g>`;
}

function phone(x, y, w, h, inner = "") {
  return `
    <g>
      ${rect(x, y, w, h, C.ink, C.ink, 42, 0.16)}
      ${rect(x + 14, y + 14, w - 28, h - 28, C.surface, C.hairline, 34, 0.94)}
      ${inner}
    </g>`;
}

function cardStack(x, y, colors) {
  return colors
    .map((color, i) => `${rect(x + i * 34, y + i * 30, 320, 160, C.surface, C.hairline, 24, 0.88)}${pill(x + i * 34 + 28, y + i * 30 + 30, 96, 18, color, 0.8)}${smallLines(x + i * 34 + 28, y + i * 30 + 70, [210, 170, 230], C.muted, 24)}`)
    .join("");
}

function sceneSvg(item) {
  const bg = `
    <rect width="1800" height="1104" fill="${C.canvas}"/>
    <circle cx="230" cy="180" r="520" fill="${C.blushTint}" opacity="0.74"/>
    <circle cx="1580" cy="210" r="560" fill="${C.cobaltTint}" opacity="0.70"/>
    <circle cx="1240" cy="930" r="460" fill="${C.violetTint}" opacity="0.52"/>
    <path d="M-40 942 C 280 804, 560 1050, 920 902 S 1510 720, 1860 856" fill="none" stroke="${C.blush}" stroke-width="54" opacity="0.10"/>
    <path d="M-80 280 C 300 108, 620 284, 1010 180 S 1460 42, 1880 146" fill="none" stroke="${C.cobalt}" stroke-width="46" opacity="0.10"/>
  `;

  const pattern = {
    platform: () => laptop(520, 225, 760, 520, `
      ${pill(604, 314, 180, 22, C.blush, .78)}${smallLines(604, 364, [310, 250, 380], C.muted)}
      ${rect(604, 480, 210, 150, C.blushTint, "none", 22, .95)}
      ${rect(844, 480, 210, 150, C.cobaltTint, "none", 22, .95)}
      ${rect(1084, 480, 110, 150, C.violetTint, "none", 22, .95)}
      ${line(635, 596, 770, 540, C.blush, 10, .55)}${line(875, 590, 1010, 526, C.cobalt, 10, .45)}
    `) + phone(1215, 380, 220, 390, `${pill(1260, 455, 120, 16, C.blush)}${smallLines(1260, 500, [110, 132, 92], C.muted)}${dot(1325, 665, 52, C.cobalt, .18)}`) + cardStack(220, 360, [C.blush, C.cobalt, C.violet]),

    setupMap: () => {
      const nodes = [[390, 310, C.blush], [700, 310, C.cobalt], [1010, 310, C.violet], [1320, 310, C.blush], [545, 620, C.cobalt], [855, 620, C.blush], [1165, 620, C.violet]];
      return `${nodes.slice(0, -1).map((n, i) => line(n[0], n[1], nodes[i + 1][0], nodes[i + 1][1], i % 2 ? C.blush : C.cobalt, 8, .34)).join("")}
      ${nodes.map(([x, y, color], i) => `${dot(x, y, 74, color, .88)}${rect(x - 110, y + 94, 220, 96, C.surface, C.hairline, 20, .88)}${smallLines(x - 72, y + 130, [130, 96], C.muted, 24)}`).join("")}`;
    },

    season: () => laptop(450, 210, 900, 560, `
      ${pill(540, 300, 170, 20, C.cobalt, .74)}
      ${[0,1,2,3,4,5].map(i => `<rect x="${540 + i * 118}" y="368" width="88" height="250" rx="18" fill="${i % 3 === 0 ? C.blushTint : i % 3 === 1 ? C.cobaltTint : C.violetTint}" opacity=".96"/>`).join("")}
      ${[0,1,2,3,4].map(i => line(560 + i * 150, 675, 660 + i * 140, 675, i % 2 ? C.blush : C.cobalt, 12, .35)).join("")}
    `),

    schedule: () => laptop(410, 180, 980, 620, `
      ${pill(500, 270, 170, 18, C.blush)}
      ${[0,1,2].map(row => [0,1,2,3].map(col => `<rect x="${500 + col * 190}" y="${338 + row * 126}" width="152" height="84" rx="18" fill="${[C.blushTint,C.cobaltTint,C.violetTint,C.lilac][(row+col)%4]}" opacity=".95"/>`).join("")).join("")}
      ${line(500, 710, 1180, 710, C.cobalt, 10, .28)}
    `),

    portal: () => phone(560, 205, 330, 620, `
      ${pill(620, 285, 160, 18, C.blush, .78)}
      ${rect(612, 345, 226, 118, C.blushTint, "none", 24, .92)}
      ${rect(612, 494, 226, 118, C.cobaltTint, "none", 24, .92)}
      ${rect(612, 642, 226, 86, C.violetTint, "none", 24, .92)}
    `) + `${rect(920, 310, 420, 142, C.surface, C.hairline, 28, .9)}${smallLines(968, 358, [255, 205, 300], C.muted)}${rect(1010, 512, 470, 150, C.surface, C.hairline, 28, .88)}${smallLines(1060, 562, [300, 230, 350], C.muted)}${dot(1330, 715, 82, C.blush, .18)}`,

    billing: () => `${cardStack(430, 240, [C.blush, C.cobalt, C.violet])}${laptop(820, 250, 560, 410, `
      ${pill(890, 330, 140, 18, C.cobalt, .78)}
      ${[0,1,2,3,4].map((i) => `<rect x="${900 + i * 72}" y="${560 - i * 38}" width="42" height="${70 + i * 38}" rx="14" fill="${i % 2 ? C.blush : C.cobalt}" opacity=".54"/>`).join("")}
      ${line(900, 610, 1220, 418, C.violet, 8, .45)}
    `)}`,

    growthHub: () => {
      const nodes = [[450, 310, C.blush], [760, 250, C.cobalt], [1080, 330, C.violet], [1330, 520, C.blush], [910, 690, C.cobalt], [560, 620, C.violet]];
      return `${nodes.map((n, i) => nodes[(i + 1) % nodes.length]).map((to, i) => line(nodes[i][0], nodes[i][1], to[0], to[1], i % 2 ? C.blush : C.cobalt, 8, .28)).join("")}
      ${nodes.map(([x, y, color], i) => `${rect(x - 138, y - 54, 276, 108, C.surface, C.hairline, 26, .88)}${dot(x - 88, y, 30, color, .78)}${smallLines(x - 38, y - 22, [120, 160], C.muted, 28)}`).join("")}`;
    },

    automation: () => {
      const xs = [310, 575, 840, 1105, 1370];
      return `${xs.slice(0, -1).map((x, i) => line(x + 108, 450, xs[i + 1] - 108, 450, i % 2 ? C.blush : C.cobalt, 10, .35)).join("")}
      ${xs.map((x, i) => `${dot(x, 450, 92, [C.blush,C.cobalt,C.violet,C.blush,C.cobalt][i], .9)}${rect(x - 120, 580, 240, 120, C.surface, C.hairline, 26, .88)}${smallLines(x - 72, 626, [132, 88], C.muted, 28)}`).join("")}
      ${rect(590, 210, 620, 108, C.surface, C.hairline, 30, .86)}${smallLines(650, 252, [340, 250], C.muted, 28)}`;
    },

    checklist: () => laptop(470, 185, 860, 610, `
      ${pill(560, 276, 210, 20, C.blush, .75)}
      ${[0,1,2,3,4].map((i) => `${dot(590, 360 + i * 82, 24, i < 3 ? C.blush : C.cobalt, .75)}${smallLines(640, 348 + i * 82, [410, 270], C.muted, 25)}`).join("")}
      ${rect(1080, 350, 160, 210, C.cobaltTint, "none", 24, .9)}${line(1115, 500, 1200, 425, C.blush, 10, .5)}
    `),

    support: () => laptop(440, 220, 680, 480, `
      ${rect(525, 305, 210, 160, C.blushTint, "none", 28, .94)}${dot(630, 385, 62, C.blush, .25)}
      ${rect(770, 305, 210, 160, C.cobaltTint, "none", 28, .94)}${dot(875, 385, 62, C.cobalt, .2)}
      ${rect(525, 500, 455, 92, C.surface, C.hairline, 22, .86)}${smallLines(570, 532, [260, 330], C.muted, 24)}
    `) + `${rect(1160, 300, 330, 270, C.surface, C.hairline, 34, .88)}${dot(1235, 390, 52, C.violet, .22)}${smallLines(1300, 352, [120, 90, 140], C.muted, 26)}`,

    enrollment: () => {
      const steps = [[330, 350, C.blush], [610, 350, C.cobalt], [890, 350, C.violet], [1170, 350, C.blush], [1450, 350, C.cobalt]];
      return `${steps.slice(0,-1).map((s,i)=>line(s[0]+80,s[1],steps[i+1][0]-80,steps[i+1][1],C.ink,8,.18)).join("")}
      ${steps.map(([x,y,color],i)=>`${rect(x-105,y-88,210,176,C.surface,C.hairline,28,.88)}${dot(x,y-26,38,color,.78)}${smallLines(x-62,y+28,[112,84],C.muted,24)}`).join("")}
      ${rect(520, 640, 760, 110, C.surface, C.hairline, 30, .82)}${smallLines(590, 678, [420, 540], C.muted, 30)}`;
    },

    insights: () => laptop(420, 205, 960, 565, `
      ${pill(512, 292, 190, 20, C.violet, .75)}
      ${rect(512, 355, 300, 220, C.blushTint, "none", 28, .93)}
      ${rect(850, 355, 215, 220, C.cobaltTint, "none", 28, .93)}
      ${rect(1100, 355, 170, 220, C.violetTint, "none", 28, .93)}
      ${[0,1,2,3,4].map(i=>`<rect x="${555+i*42}" y="${520-i*28}" width="24" height="${60+i*28}" rx="9" fill="${i%2?C.cobalt:C.blush}" opacity=".52"/>`).join("")}
      ${line(890, 525, 1025, 430, C.cobalt, 10, .42)}${dot(1184, 465, 58, C.violet, .18)}
    `),

    ownerDashboard: () => `${rect(260, 245, 420, 430, C.surface, C.hairline, 34, .86)}${dot(374, 370, 74, C.blush, .2)}${smallLines(450, 330, [150, 110, 180], C.muted, 28)}${laptop(700, 205, 760, 530, `
      ${pill(790, 300, 180, 20, C.cobalt, .74)}
      ${rect(790, 365, 260, 150, C.blushTint, "none", 24, .95)}
      ${rect(1085, 365, 220, 150, C.cobaltTint, "none", 24, .95)}
      ${rect(790, 548, 515, 92, C.violetTint, "none", 24, .86)}
    `)}`,
  }[item.kind] || (() => laptop(460, 220, 880, 520, ""));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1104" viewBox="0 0 1800 1104">
    ${bg}
    <g>${pattern()}</g>
  </svg>`;
}

const items = [
  ["studiolab-platform-overview", "platform", BASES.reception],
  ["studiolab-setup-guide-map", "setupMap", BASES.planning],
  ["studiolab-season-builder", "season", BASES.barre],
  ["studiolab-class-schedule", "schedule", BASES.class],
  ["studiolab-family-portal", "portal", BASES.circle],
  ["studiolab-billing-operations", "billing", BASES.planning],
  ["studiolab-growth-communication-hub", "growthHub", BASES.growth],
  ["studiolab-automation-follow-up", "automation", BASES.growth],
  ["studiolab-go-live-checklist", "checklist", BASES.reception],
  ["studiolab-support-workspace", "support", BASES.support],
  ["studiolab-enrollment-flow", "enrollment", BASES.ballet],
  ["studiolab-reporting-insights", "insights", BASES.planning],
  ["studiolab-studio-owner-dashboard", "ownerDashboard", BASES.reception],
];

ensure(OUT);
ensure(TMP);

for (const [name, kind, base] of items) {
  if (!fs.existsSync(base)) throw new Error(`Missing base image: ${base}`);
  const bg = path.join(TMP, `${name}-bg.png`);
  const svg = path.join(TMP, `${name}.svg`);
  const overlay = path.join(TMP, `${name}-overlay.png`);
  const out = path.join(OUT, `${name}-source.png`);
  fs.writeFileSync(svg, sceneSvg({ kind }));
  runMagick([
    base,
    "-resize",
    "1800x1104^",
    "-gravity",
    "center",
    "-extent",
    "1800x1104",
    "-blur",
    "0x2.2",
    "-modulate",
    "108,28,100",
    "-fill",
    "#faf6f1",
    "-colorize",
    "52",
    bg,
  ]);
  runMagick(["-background", "none", svg, overlay]);
  runMagick([bg, overlay, "-compose", "over", "-composite", "-strip", out]);
  console.log(out);
}

if (!process.argv.includes("--keep-tmp")) {
  fs.rmSync(TMP, { recursive: true, force: true });
}
