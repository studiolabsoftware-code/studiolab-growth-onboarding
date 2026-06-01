const C = {
  ink: "#13102E",
  indigo: "#4A3F8A",
  indigoDark: "#13102E",
  indigoSoft: "#EEEDF8",
  magenta: "#E8197F",
  magentaSoft: "#FDE8F4",
  surface: "#F8F7FC",
  gray50: "#F2F3F7",
  gray100: "#EAEBF2",
  gray200: "#DFE0EC",
  gray400: "#9B9DB8",
  gray500: "#6B6D8A",
  white: "#FFFFFF",
  ok: "#047857",
  okSoft: "#ECFDF5",
  warn: "#B45309",
  warnSoft: "#FFFBEB",
  crit: "#B91C1C",
  critSoft: "#FEF2F2",
  info: "#0284C7",
  infoSoft: "#E0F2FE",
};

const asset = (ctx, name) => `${ctx.assetDir}/${name}`;

function rect(slide, ctx, x, y, w, h, fill, line = C.gray200, width = 1, name) {
  return ctx.addShape(slide, {
    x,
    y,
    w,
    h,
    fill,
    line: { fill: line, width },
    name,
  });
}

function text(slide, ctx, value, x, y, w, h, opts = {}) {
  return ctx.addText(slide, {
    text: value,
    x,
    y,
    w,
    h,
    fontSize: opts.size ?? 20,
    color: opts.color ?? C.ink,
    bold: opts.bold ?? false,
    typeface: opts.face ?? "Aptos",
    align: opts.align ?? "left",
    valign: opts.valign ?? "top",
    fill: opts.fill ?? "#00000000",
    line: { fill: opts.line ?? "#00000000", width: opts.lineWidth ?? 0 },
    insets: opts.insets ?? { left: 0, right: 0, top: 0, bottom: 0 },
    name: opts.name,
  });
}

function line(slide, ctx, x1, y1, x2, y2, color = C.indigo, width = 2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1) || width;
  const h = Math.abs(y2 - y1) || width;
  const shape = ctx.addShape(slide, {
    x,
    y,
    w,
    h,
    fill: color,
    line: { fill: color, width: 0 },
  });
  return shape;
}

function pageBase(presentation, ctx, opts = {}) {
  const slide = presentation.slides.add();
  rect(slide, ctx, 0, 0, ctx.W, ctx.H, opts.dark ? C.indigoDark : C.white, opts.dark ? C.indigoDark : C.white, 0);
  if (!opts.dark) {
    rect(slide, ctx, 0, 0, ctx.W, 720, C.white, C.white, 0);
    rect(slide, ctx, 0, 644, ctx.W, 76, C.surface, C.surface, 0);
  }
  return slide;
}

async function brand(slide, ctx, dark = false) {
  if (dark) {
    await ctx.addImage(slide, {
      path: asset(ctx, "studiolab-icon.png"),
      x: 52,
      y: 36,
      w: 30,
      h: 30,
      fit: "contain",
      alt: "StudioLAB icon",
    });
    text(slide, ctx, "StudioLAB", 90, 34, 112, 24, { size: 18, color: C.white, bold: true });
    text(slide, ctx, "Growth", 202, 34, 80, 24, { size: 18, color: C.magenta, bold: true });
    rect(slide, ctx, 52, 92, 112, 3, C.magenta, C.magenta, 0);
  } else {
    await ctx.addImage(slide, {
      path: asset(ctx, "studiolab-growth-logo.png"),
      x: 52,
      y: 38,
      w: 178,
      h: 42,
      fit: "contain",
      alt: "StudioLAB Growth logo",
    });
  }
}

function footer(slide, ctx, source = "StudioLAB Growth onboarding research, May 2026") {
  text(slide, ctx, source, 52, 668, 900, 18, { size: 10, color: C.gray500 });
  text(slide, ctx, String(ctx.slideNumber).padStart(2, "0"), 1178, 660, 48, 28, {
    size: 16,
    color: C.indigo,
    bold: true,
    align: "right",
  });
}

function title(slide, ctx, kicker, claim, opts = {}) {
  const color = opts.dark ? C.white : C.ink;
  const muted = opts.dark ? C.indigoSoft : C.gray500;
  rect(slide, ctx, 52, 108, 34, 4, C.magenta, C.magenta, 0);
  text(slide, ctx, kicker.toUpperCase(), 98, 94, 360, 28, {
    size: 11,
    color: muted,
    bold: true,
  });
  text(slide, ctx, claim, 52, 126, opts.w ?? 740, opts.h ?? 92, {
    size: opts.size ?? 34,
    color,
    bold: true,
    face: "Aptos Display",
  });
}

function pill(slide, ctx, label, x, y, w, color = C.indigo, fill = C.indigoSoft) {
  rect(slide, ctx, x, y, w, 32, fill, fill, 0);
  text(slide, ctx, label, x + 14, y + 8, w - 28, 16, {
    size: 12,
    color,
    bold: true,
    align: "center",
  });
}

function stepMarker(slide, ctx, n, x, y, color = C.magenta) {
  rect(slide, ctx, x, y, 34, 34, color, color, 0);
  text(slide, ctx, String(n), x, y + 7, 34, 18, { size: 14, color: C.white, bold: true, align: "center" });
}

function checkRow(slide, ctx, label, x, y, w, state = "Ready", opts = {}) {
  const displayState = state === "Connected" || state === "Done" ? "OK" : state;
  const palette = state === "Ready" || state === "Connected" || state === "Done"
    ? [C.ok, C.okSoft]
    : state === "Check"
      ? [C.warn, C.warnSoft]
      : [C.info, C.infoSoft];
  rect(slide, ctx, x, y, w, 48, C.white, C.gray200, 1);
  rect(slide, ctx, x + 12, y + 14, 20, 20, palette[1], palette[0], 1);
  text(slide, ctx, "OK", x + 12, y + 18, 20, 10, { size: 7, color: palette[0], bold: true, align: "center" });
  text(slide, ctx, label, x + 42, y + 14, w - 118, 20, { size: opts.size ?? 14, color: C.ink, bold: opts.bold ?? false });
  text(slide, ctx, displayState, x + w - 70, y + 14, 52, 18, { size: 10, color: palette[0], bold: true, align: "right" });
}

function miniBrowser(slide, ctx, cfg) {
  const { x, y, w, h, nav = "Settings", active = "Integrations", heading = "Integrations", target = "Connect", cards = [] } = cfg;
  rect(slide, ctx, x, y, w, h, C.white, C.gray200, 1);
  rect(slide, ctx, x, y, w, 38, C.gray50, C.gray200, 1);
  rect(slide, ctx, x + 16, y + 13, 12, 12, C.magentaSoft, C.magentaSoft, 0);
  rect(slide, ctx, x + 34, y + 13, 12, 12, C.warnSoft, C.warnSoft, 0);
  rect(slide, ctx, x + 52, y + 13, 12, 12, C.okSoft, C.okSoft, 0);
  text(slide, ctx, "StudioLAB Growth", x + 84, y + 10, 180, 18, { size: 12, color: C.indigo, bold: true });
  rect(slide, ctx, x, y + 38, 150, h - 38, C.surface, C.gray200, 1);
  const items = ["Dashboard", "Conversations", "Marketing", "Reputation", "Settings"];
  items.forEach((item, i) => {
    const yy = y + 66 + i * 42;
    const isNav = item === nav;
    rect(slide, ctx, x + 14, yy, 122, 30, isNav ? C.indigoSoft : "#00000000", isNav ? C.indigoSoft : "#00000000", 0);
    text(slide, ctx, item, x + 26, yy + 8, 96, 12, { size: 10, color: isNav ? C.indigo : C.gray500, bold: isNav });
  });
  text(slide, ctx, heading, x + 178, y + 66, w - 210, 26, { size: 22, color: C.ink, bold: true });
  pill(slide, ctx, active, x + 178, y + 102, 142, C.indigo, C.indigoSoft);
  cards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = x + 178 + col * 226;
    const cy = y + 154 + row * 94;
    rect(slide, ctx, cx, cy, 202, 68, C.white, card.highlight ? C.magenta : C.gray200, card.highlight ? 2 : 1);
    text(slide, ctx, card.title, cx + 16, cy + 14, 128, 18, { size: 13, color: C.ink, bold: true });
    text(slide, ctx, card.note ?? "", cx + 16, cy + 34, 120, 16, { size: 9, color: C.gray500 });
    rect(slide, ctx, cx + 148, cy + 22, 38, 20, card.highlight ? C.magenta : C.indigoSoft, card.highlight ? C.magenta : C.indigoSoft, 0);
    text(slide, ctx, card.button ?? target, cx + 148, cy + 27, 38, 8, { size: 7, color: card.highlight ? C.white : C.indigo, bold: true, align: "center" });
  });
}

function oauthPanel(slide, ctx, cfg) {
  const { x, y, w, h, platform, accountLabel, permissions = [], finalButton = "Allow access" } = cfg;
  rect(slide, ctx, x, y, w, h, C.white, C.gray200, 1);
  rect(slide, ctx, x, y, w, 52, C.indigoDark, C.indigoDark, 0);
  text(slide, ctx, `Authorise ${platform}`, x + 22, y + 16, w - 44, 20, { size: 17, color: C.white, bold: true });
  text(slide, ctx, "Review permissions before continuing", x + 22, y + 76, w - 44, 18, { size: 13, color: C.gray500 });
  permissions.slice(0, 4).forEach((perm, i) => {
    const yy = y + 108 + i * 38;
    rect(slide, ctx, x + 22, yy, w - 44, 32, C.white, C.gray200, 1);
    rect(slide, ctx, x + 34, yy + 8, 16, 16, C.infoSoft, C.info, 1);
    text(slide, ctx, "OK", x + 34, yy + 11, 16, 8, { size: 6, color: C.info, bold: true, align: "center" });
    text(slide, ctx, perm, x + 60, yy + 9, w - 142, 12, { size: 11, color: C.ink });
    text(slide, ctx, "OK", x + w - 70, yy + 9, 40, 12, { size: 9, color: C.info, bold: true, align: "right" });
  });
  rect(slide, ctx, x + 22, y + h - 92, w - 44, 42, C.surface, C.gray200, 1);
  text(slide, ctx, accountLabel, x + 38, y + h - 78, w - 76, 14, { size: 12, color: C.ink, bold: true });
  rect(slide, ctx, x + w - 156, y + h - 40, 122, 28, C.magenta, C.magenta, 0);
  text(slide, ctx, finalButton, x + w - 152, y + h - 32, 114, 12, { size: 10, color: C.white, bold: true, align: "center" });
}

function verificationBoard(slide, ctx, cfg) {
  const { x, y, w, h, columns } = cfg;
  rect(slide, ctx, x, y, w, h, C.surface, C.gray200, 1);
  const gap = 18;
  const colW = (w - 52 - gap * (columns.length - 1)) / columns.length;
  columns.forEach((col, i) => {
    const cx = x + 26 + i * (colW + gap);
    rect(slide, ctx, cx, y + 26, colW, h - 52, C.white, C.gray200, 1);
    pill(slide, ctx, col.title, cx + 18, y + 44, colW - 36, col.color ?? C.indigo, col.fill ?? C.indigoSoft);
    col.items.forEach((item, j) => {
      checkRow(slide, ctx, item, cx + 18, y + 92 + j * 52, colW - 36, j === 0 ? "Connected" : "Check", { size: 11 });
    });
  });
}

function routeMap(slide, ctx, routes) {
  routes.forEach((route, i) => {
    const x = 92 + i * 372;
    rect(slide, ctx, x, 256, 300, 168, C.white, C.gray200, 1);
    stepMarker(slide, ctx, i + 1, x + 20, 228, route.color ?? C.magenta);
    text(slide, ctx, route.title, x + 26, 278, 250, 28, { size: 22, color: C.ink, bold: true });
    text(slide, ctx, route.note, x + 26, 318, 248, 60, { size: 14, color: C.gray500 });
    pill(slide, ctx, route.path, x + 26, 380, 248, route.color ?? C.indigo, route.fill ?? C.indigoSoft);
    if (i < routes.length - 1) {
      line(slide, ctx, x + 300, 340, x + 372, 340, C.gray200, 3);
    }
  });
}

const SLIDES = [
  {
    type: "cover",
    kicker: "Setup guide",
    title: "Connect studio profiles without collecting passwords",
    sub: "A slide-through onboarding presentation for StudioLAB Growth profile connections.",
  },
  {
    type: "split-image",
    kicker: "Core model",
    title: "The form identifies public profiles; the owner authorises access later.",
    leftTitle: "Capture first",
    leftBody: "URLs and handles tell StudioLAB which public profiles belong to the studio.",
    rightTitle: "Connect second",
    rightBody: "The studio owner signs in directly and grants permission inside StudioLAB Growth.",
  },
  {
    type: "handoff",
    kicker: "Security",
    title: "No passwords are entered into the onboarding form.",
    steps: ["Studio owner opens StudioLAB Growth", "Platform login opens in their browser", "OAuth grants the selected access", "StudioLAB verifies the connection"],
  },
  {
    type: "prep",
    kicker: "Before you start",
    title: "Have the real account owner available before pressing Connect.",
    items: ["StudioLAB Growth login", "Correct Facebook, Instagram, Google, TikTok or YouTube login", "Two-factor authentication device", "Admin or owner permissions", "Pop-ups allowed for the setup session", "Public profile URLs from the onboarding form"],
  },
  {
    type: "three-areas",
    kicker: "Product map",
    title: "Connections happen in three StudioLAB Growth areas.",
  },
  {
    type: "order",
    kicker: "Setup sequence",
    title: "Connect Meta first, then add Google, TikTok and YouTube as needed.",
  },
  {
    type: "access",
    platform: "Facebook",
    kicker: "Facebook access",
    title: "Facebook needs Page control, and lead ads need extra lead access.",
    need: ["Business Page, not a personal profile", "Admin or full control Page access", "Ad account access if lead ads are included", "Lead Access Permission for lead form data"],
    source: "Source: Facebook integration and multi-page lead ads support articles, May 2026",
  },
  {
    type: "click",
    platform: "Facebook",
    kicker: "Facebook click path",
    title: "Leads, DMs and forms start in Settings > Integrations.",
    nav: "Settings",
    active: "Integrations",
    heading: "Integrations",
    cards: [
      { title: "Facebook & Instagram", note: "Lead Ads, Messenger, forms", highlight: true, button: "Connect" },
      { title: "Google Business Profile", note: "Reviews and GBP sync" },
      { title: "TikTok", note: "Lead Ads and automations" },
      { title: "Connected Apps", note: "Review permissions" },
    ],
    source: "Source: Settings > Integrations path from vendor support docs",
  },
  {
    type: "oauth",
    platform: "Facebook",
    kicker: "Facebook authorisation",
    title: "Approve all requested permissions, then select the correct Page.",
    permissions: ["Manage Page connection", "Access lead forms", "Read Page messages", "Sync selected Page data"],
    accountLabel: "Selected asset: Your Studio Facebook Page",
    callout: "If the Page is missing, check the Facebook profile and Page permissions.",
  },
  {
    type: "verify",
    platform: "Facebook",
    kicker: "Facebook verification",
    title: "A green badge is not enough. Verify the capability you plan to use.",
    columns: [
      { title: "Page", items: ["Correct Page connected", "Multiple Pages checked"] },
      { title: "Inbox", items: ["Messenger enabled", "Instagram messages checked"] },
      { title: "Lead Ads", items: ["Forms mapped", "Test lead received"] },
    ],
  },
  {
    type: "access",
    platform: "Instagram",
    kicker: "Instagram access",
    title: "Instagram must be Business or Creator before it can be connected.",
    need: ["Business or Creator profile", "Use Direct Integration for social posting", "Facebook Page link needed for ads or DMs", "Correct Instagram login available"],
    source: "Source: Instagram direct and Facebook-linked integration support article, May 2026",
  },
  {
    type: "dual-route",
    platform: "Instagram",
    kicker: "Instagram routes",
    title: "Posting and inbox workflows use different setup routes.",
    routes: [
      { title: "Social posting", note: "Connect directly for posts, Stories and Reels where supported.", path: "Marketing > Social Planner", color: C.magenta, fill: C.magentaSoft },
      { title: "Ads and DMs", note: "Use the Facebook and Instagram integration when inbox or ads are included.", path: "Settings > Integrations", color: C.indigo, fill: C.indigoSoft },
    ],
  },
  {
    type: "oauth",
    platform: "Instagram",
    kicker: "Instagram authorisation",
    title: "Direct Instagram Integration is the simplest path for content scheduling.",
    permissions: ["Connect Business or Creator profile", "Publish eligible content", "View engagement metrics", "Reconnect if permissions expire"],
    accountLabel: "Selected profile: @yourstudio",
    callout: "Use Facebook-linked setup when the package includes ads, DMs or legacy Meta permissions.",
  },
  {
    type: "verify",
    platform: "Instagram",
    kicker: "Instagram verification",
    title: "Confirm the profile type, the Page link and the inbox status.",
    columns: [
      { title: "Profile", items: ["Business or Creator", "Correct handle visible"] },
      { title: "Publishing", items: ["Direct connection active", "Post types tested"] },
      { title: "DMs", items: ["Facebook Page linked", "Messages enabled"] },
    ],
  },
  {
    type: "access",
    platform: "Google Business Profile",
    kicker: "Google access",
    title: "Google Business Profile must be verified and managed by the connecting Google account.",
    need: ["Verified Google Business Profile", "Owner or Manager access", "Correct location selected", "Call tracking decision ready"],
    source: "Source: Google Business Profile integration and Google owner role docs, May 2026",
  },
  {
    type: "dual-route",
    platform: "Google Business Profile",
    kicker: "Google routes",
    title: "Reviews and reputation connect from Settings; GBP posts connect through Social Planner.",
    routes: [
      { title: "Reviews and reputation", note: "Connect the verified location for review and reputation workflows.", path: "Settings > Integrations", color: C.indigo, fill: C.indigoSoft },
      { title: "GBP posts", note: "Use the connected location for Google Business Profile scheduling.", path: "Marketing > Social Planner", color: C.magenta, fill: C.magentaSoft },
    ],
  },
  {
    type: "oauth",
    platform: "Google Business Profile",
    kicker: "Google authorisation",
    title: "Select the exact location, then confirm call tracking.",
    permissions: ["Access verified GBP locations", "Read and respond to reviews", "Manage eligible GBP posts", "Refresh profile data"],
    accountLabel: "Selected location: Your Studio, Suburb",
    callout: "Native Google Business Profile chat was deprecated in 2024. Use connected messaging channels where configured.",
  },
  {
    type: "verify",
    platform: "Google Business Profile",
    kicker: "Google verification",
    title: "Check review sync separately from posting availability.",
    columns: [
      { title: "Location", items: ["Correct GBP connected", "Owner or Manager access"] },
      { title: "Reputation", items: ["Reviews visible", "Reply path checked"] },
      { title: "Posting", items: ["GBP in Social Planner", "Post type available"] },
    ],
  },
  {
    type: "access",
    platform: "TikTok",
    kicker: "TikTok access",
    title: "TikTok has three setup jobs: posting, lead ads and DM or comment automation.",
    need: ["TikTok login for posting", "Business Profile for comment management", "Advertiser account for lead ads", "At least one Instant Form for lead sync"],
    source: "Source: TikTok Social Planner, Lead Ads and DM automation docs, May 2026",
  },
  {
    type: "dual-route",
    platform: "TikTok",
    kicker: "TikTok routes",
    title: "Posting starts in Social Planner; lead ads and automations start in Integrations.",
    routes: [
      { title: "Posting", note: "Connect personal or business TikTok profiles for Social Planner publishing.", path: "Marketing > Social Planner", color: C.magenta, fill: C.magentaSoft },
      { title: "Lead ads and automations", note: "Connect TikTok Business Account and map forms for lead capture.", path: "Settings > Integrations", color: C.indigo, fill: C.indigoSoft },
    ],
  },
  {
    type: "oauth",
    platform: "TikTok",
    kicker: "TikTok authorisation",
    title: "Lead ads require advertiser selection and form mapping.",
    permissions: ["Authorise TikTok Business Account", "Select advertiser account", "Map Instant Form fields", "Test lead submission"],
    accountLabel: "Selected advertiser: Your Studio Ads Account",
    callout: "If no forms appear, create an Instant Form in TikTok Ads Manager first.",
  },
  {
    type: "verify",
    platform: "TikTok",
    kicker: "TikTok verification",
    title: "Test the workflow that matches the Growth package.",
    columns: [
      { title: "Posting", items: ["TikTok profile visible", "Test draft created"] },
      { title: "Lead Ads", items: ["Advertiser selected", "Form mapping saved"] },
      { title: "Automations", items: ["Account available", "Trigger tested"] },
    ],
  },
  {
    type: "access",
    platform: "YouTube",
    kicker: "YouTube access",
    title: "YouTube must be connected by the channel primary owner.",
    need: ["Public channel URL captured", "Primary owner available", "Correct Google account selected", "Only needed when publishing is included"],
    source: "Source: YouTube scheduling and Google channel permissions docs, May 2026",
  },
  {
    type: "click",
    platform: "YouTube",
    kicker: "YouTube click path",
    title: "Connect YouTube only when StudioLAB Growth will publish videos or Shorts.",
    nav: "Marketing",
    active: "Social Planner",
    heading: "Social Planner",
    cards: [
      { title: "Facebook Page", note: "Posts and Page content" },
      { title: "Instagram", note: "Posts, Reels, Stories" },
      { title: "TikTok", note: "Video posting" },
      { title: "YouTube", note: "Videos and Shorts", highlight: true, button: "Connect" },
    ],
    source: "Source: YouTube scheduling in Social Planner support article",
  },
  {
    type: "oauth",
    platform: "YouTube",
    kicker: "YouTube authorisation",
    title: "Manager access cannot authorise third-party publishing.",
    permissions: ["Sign in as primary owner", "Select the correct channel", "Approve publishing permissions", "Confirm channel appears"],
    accountLabel: "Selected channel: Your Studio Channel",
    callout: "If the channel does not appear, the owner is probably logged into the wrong Google account.",
  },
  {
    type: "verify",
    platform: "YouTube",
    kicker: "YouTube verification",
    title: "Confirm the channel appears before scheduling anything.",
    columns: [
      { title: "Owner", items: ["Primary owner connected", "Manager-only avoided"] },
      { title: "Channel", items: ["Correct channel visible", "Token active"] },
      { title: "Publishing", items: ["Video option tested", "Shorts option checked"] },
    ],
  },
  {
    type: "handoff-board",
    kicker: "StudioLAB handoff",
    title: "Verify the intended workflow, not just the connected badge.",
  },
  {
    type: "package",
    kicker: "Production model",
    title: "Use one master deck, then five short videos for the platform details.",
  },
  {
    type: "sources",
    kicker: "Sources",
    title: "Access requirements are source-backed and ready for video production.",
  },
];

async function renderCover(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx, { dark: true });
  await brand(slide, ctx, true);
  text(slide, ctx, d.kicker.toUpperCase(), 72, 166, 280, 20, { size: 12, color: C.indigoSoft, bold: true });
  text(slide, ctx, d.title, 72, 204, 690, 136, { size: 50, color: C.white, bold: true, face: "Aptos Display" });
  text(slide, ctx, d.sub, 76, 374, 520, 52, { size: 20, color: C.indigoSoft });
  const routes = ["Capture URLs", "Owner login", "OAuth access", "StudioLAB verifies"];
  routes.forEach((item, i) => {
    const x = 704 + (i % 2) * 214;
    const y = 178 + Math.floor(i / 2) * 156;
    rect(slide, ctx, x, y, 178, 116, i === 0 ? C.magenta : C.indigo, i === 0 ? C.magenta : C.indigo, 0);
    text(slide, ctx, `0${i + 1}`, x + 18, y + 18, 44, 24, { size: 20, color: C.white, bold: true });
    text(slide, ctx, item, x + 18, y + 58, 138, 34, { size: 18, color: C.white, bold: true });
  });
  text(slide, ctx, "Slide-through setup deck", 76, 618, 260, 24, { size: 14, color: C.indigoSoft, bold: true });
  text(slide, ctx, "01", 1168, 636, 50, 26, { size: 16, color: C.indigoSoft, bold: true, align: "right" });
  return slide;
}

async function renderSplitImage(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 780 });
  rect(slide, ctx, 60, 258, 380, 270, C.surface, C.gray200, 1);
  text(slide, ctx, d.leftTitle, 92, 292, 260, 28, { size: 26, color: C.indigo, bold: true });
  text(slide, ctx, d.leftBody, 92, 338, 280, 84, { size: 18, color: C.gray500 });
  await ctx.addImage(slide, {
    path: asset(ctx, "onboarding-social-profiles-screenshot.png"),
    x: 510,
    y: 236,
    w: 640,
    h: 356,
    fit: "contain",
    alt: "Onboarding form screenshot",
  });
  rect(slide, ctx, 858, 456, 238, 92, C.white, C.magenta, 2);
  text(slide, ctx, d.rightTitle, 880, 480, 190, 22, { size: 20, color: C.magenta, bold: true });
  text(slide, ctx, d.rightBody, 880, 510, 190, 34, { size: 12, color: C.gray500 });
  footer(slide, ctx, "Source: user-provided onboarding screenshot and StudioLAB Growth setup plan");
  return slide;
}

async function renderHandoff(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 760 });
  const x0 = 104;
  d.steps.forEach((s, i) => {
    const x = x0 + i * 282;
    rect(slide, ctx, x, 300, 204, 128, C.white, C.gray200, 1);
    stepMarker(slide, ctx, i + 1, x + 24, 270);
    text(slide, ctx, s, x + 24, 336, 154, 48, { size: 18, color: C.ink, bold: true });
    if (i < d.steps.length - 1) line(slide, ctx, x + 204, 364, x + 282, 364, C.gray200, 3);
  });
  rect(slide, ctx, 186, 504, 828, 56, C.infoSoft, C.info, 1);
  text(slide, ctx, "StudioLAB receives authorised access only after the owner approves the platform permission screen.", 220, 522, 760, 20, { size: 17, color: C.info, bold: true });
  footer(slide, ctx, "Source: OAuth permission model and vendor setup documentation");
  return slide;
}

async function renderPrep(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 840 });
  d.items.forEach((item, i) => {
    const x = 94 + (i % 2) * 520;
    const y = 250 + Math.floor(i / 2) * 82;
    checkRow(slide, ctx, item, x, y, 448, "Ready", { size: 16, bold: i < 2 });
  });
  rect(slide, ctx, 840, 506, 276, 76, C.warnSoft, C.warn, 1);
  text(slide, ctx, "Most failed setup attempts are caused by using the wrong login or missing admin permissions.", 868, 528, 220, 34, { size: 14, color: C.warn, bold: true });
  footer(slide, ctx, "Source: platform permission troubleshooting patterns across Meta, Google, TikTok and YouTube");
  return slide;
}

async function renderThreeAreas(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 760 });
  const routes = [
    { title: "Settings", note: "Integrations for leads, inbox, reviews and connected apps.", path: "Settings > Integrations", color: C.indigo, fill: C.indigoSoft },
    { title: "Marketing", note: "Social Planner for publishing and scheduling profiles.", path: "Marketing > Social Planner", color: C.magenta, fill: C.magentaSoft },
    { title: "Reputation", note: "GBP optimisation, listings and review workflows.", path: "Reputation", color: C.info, fill: C.infoSoft },
  ];
  routeMap(slide, ctx, routes);
  footer(slide, ctx, "Source: StudioLAB Growth connection mapping from support documentation");
  return slide;
}

async function renderOrder(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 820 });
  const steps = [
    ["01", "Facebook Page", "Page, lead ads and Messenger"],
    ["02", "Instagram", "Posting, DMs and Meta-linked access"],
    ["03", "Google Profile", "Reviews, reputation and GBP posts"],
    ["04", "TikTok", "Posting, lead ads and automations"],
    ["05", "YouTube", "Only if publishing is included"],
  ];
  steps.forEach((s, i) => {
    const x = 78 + i * 226;
    rect(slide, ctx, x, 302, 182, 152, i === 0 ? C.magentaSoft : C.white, i === 0 ? C.magenta : C.gray200, i === 0 ? 2 : 1);
    text(slide, ctx, s[0], x + 20, 328, 50, 26, { size: 24, color: i === 0 ? C.magenta : C.indigo, bold: true });
    text(slide, ctx, s[1], x + 20, 366, 138, 24, { size: 18, color: C.ink, bold: true });
    text(slide, ctx, s[2], x + 20, 402, 136, 34, { size: 11, color: C.gray500 });
    if (i < steps.length - 1) line(slide, ctx, x + 182, 378, x + 226, 378, C.gray200, 3);
  });
  footer(slide, ctx, "Recommendation: connect only the platforms included in the client's Growth package");
  return slide;
}

async function renderAccess(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 690 });
  rect(slide, ctx, 790, 110, 310, 70, C.indigoSoft, C.indigoSoft, 0);
  text(slide, ctx, d.platform, 816, 130, 258, 30, { size: 27, color: C.indigo, bold: true });
  d.need.forEach((item, i) => {
    const x = 94 + (i % 2) * 522;
    const y = 268 + Math.floor(i / 2) * 106;
    rect(slide, ctx, x, y, 452, 76, C.white, C.gray200, 1);
    stepMarker(slide, ctx, i + 1, x + 18, y + 21, i === 0 ? C.magenta : C.indigo);
    text(slide, ctx, item, x + 70, y + 21, 330, 32, { size: 18, color: C.ink, bold: i === 0 });
  });
  footer(slide, ctx, d.source);
  return slide;
}

async function renderClick(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 780 });
  miniBrowser(slide, ctx, { x: 102, y: 228, w: 786, h: 358, nav: d.nav, active: d.active, heading: d.heading, cards: d.cards });
  rect(slide, ctx, 930, 270, 210, 204, C.magentaSoft, C.magenta, 1);
  text(slide, ctx, "Click target", 958, 300, 154, 18, { size: 14, color: C.magenta, bold: true });
  text(slide, ctx, d.cards.find((c) => c.highlight)?.title ?? "Connect", 958, 334, 150, 50, { size: 25, color: C.ink, bold: true });
  text(slide, ctx, "The owner signs in from their browser. StudioLAB does not see the password.", 958, 400, 144, 58, { size: 12, color: C.gray500 });
  footer(slide, ctx, d.source);
  return slide;
}

async function renderOAuth(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 800 });
  miniBrowser(slide, ctx, {
    x: 80,
    y: 262,
    w: 440,
    h: 272,
    nav: d.platform === "YouTube" || d.platform === "Instagram" ? "Marketing" : "Settings",
    active: d.platform === "YouTube" || d.platform === "Instagram" ? "Social Planner" : "Integrations",
    heading: "StudioLAB Growth",
    cards: [{ title: d.platform, note: "Start secure connection", highlight: true, button: "Connect" }],
  });
  oauthPanel(slide, ctx, {
    x: 580,
    y: 218,
    w: 468,
    h: 356,
    platform: d.platform,
    permissions: d.permissions,
    accountLabel: d.accountLabel,
  });
  rect(slide, ctx, 144, 566, 830, 40, C.infoSoft, C.info, 1);
  text(slide, ctx, d.callout, 168, 579, 780, 14, { size: 12, color: C.info, bold: true });
  footer(slide, ctx, "Source: platform authorisation and connection support docs");
  return slide;
}

async function renderVerify(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 790 });
  verificationBoard(slide, ctx, { x: 72, y: 228, w: 1060, h: 354, columns: d.columns });
  footer(slide, ctx, `Source: ${d.platform} setup verification rules from researched support docs`);
  return slide;
}

async function renderDualRoute(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 830 });
  d.routes.forEach((route, i) => {
    const x = 150 + i * 506;
    rect(slide, ctx, x, 260, 398, 224, C.white, route.color, 2);
    pill(slide, ctx, i === 0 ? "Route A" : "Route B", x + 28, 228, 112, route.color, route.fill);
    text(slide, ctx, route.title, x + 34, 294, 320, 28, { size: 25, color: C.ink, bold: true });
    text(slide, ctx, route.note, x + 34, 338, 312, 58, { size: 16, color: C.gray500 });
    rect(slide, ctx, x + 34, 424, 310, 34, route.fill, route.fill, 0);
    text(slide, ctx, route.path, x + 52, 434, 274, 12, { size: 11, color: route.color, bold: true, align: "center" });
  });
  line(slide, ctx, 548, 372, 656, 372, C.gray200, 3);
  footer(slide, ctx, `Source: ${d.platform} route mapping from vendor support docs`);
  return slide;
}

async function renderHandoffBoard(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 820 });
  const columns = [
    { title: "Meta", items: ["Page connected", "IG linked if needed", "Lead forms mapped", "Messenger enabled"], color: C.indigo, fill: C.indigoSoft },
    { title: "Google", items: ["GBP location connected", "Reviews visible", "Call tracking decision", "GBP posts checked"], color: C.info, fill: C.infoSoft },
    { title: "TikTok", items: ["Profile connected", "Advertiser selected", "Forms mapped", "Trigger tested"], color: C.magenta, fill: C.magentaSoft },
    { title: "YouTube", items: ["Primary owner used", "Channel visible", "Publishing tested", "Optional if not in package"], color: C.warn, fill: C.warnSoft },
  ];
  verificationBoard(slide, ctx, { x: 54, y: 226, w: 1120, h: 368, columns });
  footer(slide, ctx, "Internal StudioLAB verification checklist");
  return slide;
}

async function renderPackage(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx);
  await brand(slide, ctx);
  title(slide, ctx, d.kicker, d.title, { w: 850 });
  const parts = [
    ["Master deck", "One client-facing click-through presentation for the full setup flow."],
    ["Five short videos", "Facebook, Instagram, Google Business Profile, TikTok and YouTube, each under 3 minutes."],
    ["Setup checklist", "Pre-flight owner permissions and profile URLs before the onboarding call."],
    ["Support fallback", "15-minute assisted setup call when platform permissions are messy."],
  ];
  parts.forEach((p, i) => {
    const x = 110 + (i % 2) * 512;
    const y = 260 + Math.floor(i / 2) * 138;
    rect(slide, ctx, x, y, 424, 96, C.white, i === 0 ? C.magenta : C.gray200, i === 0 ? 2 : 1);
    text(slide, ctx, p[0], x + 28, y + 22, 300, 24, { size: 22, color: i === 0 ? C.magenta : C.indigo, bold: true });
    text(slide, ctx, p[1], x + 28, y + 56, 350, 24, { size: 12, color: C.gray500 });
  });
  footer(slide, ctx, "Recommended production model for StudioLAB Growth onboarding");
  return slide;
}

async function renderSources(presentation, ctx, d) {
  const slide = pageBase(presentation, ctx, { dark: true });
  await brand(slide, ctx, true);
  title(slide, ctx, d.kicker, d.title, { dark: true, w: 780 });
  const groups = [
    ["Facebook and Instagram", "Official support on Facebook Page integration, lead ads, Messenger and Instagram direct integration."],
    ["Google Business Profile", "Official support on GBP connection, owner or manager access, review sync and GBP post scheduling."],
    ["TikTok", "Official support on Social Planner, Lead Ads, Business Center permissions and DM or comment automations."],
    ["YouTube", "Official support on Social Planner scheduling and Google channel permission limits."],
  ];
  groups.forEach((g, i) => {
    const x = 88 + (i % 2) * 522;
    const y = 274 + Math.floor(i / 2) * 126;
    rect(slide, ctx, x, y, 440, 82, "#FFFFFF14", C.indigo, 1);
    text(slide, ctx, g[0], x + 24, y + 18, 330, 20, { size: 18, color: C.white, bold: true });
    text(slide, ctx, g[1], x + 24, y + 46, 370, 24, { size: 11, color: C.indigoSoft });
  });
  text(slide, ctx, "Detailed source links are saved with the deck workspace source notes and the research plan.", 90, 604, 740, 22, { size: 14, color: C.indigoSoft });
  text(slide, ctx, "29", 1168, 636, 50, 26, { size: 16, color: C.indigoSoft, bold: true, align: "right" });
  return slide;
}

export async function buildSlide(presentation, ctx, number) {
  const d = SLIDES[number - 1];
  if (!d) throw new Error(`No slide data for ${number}`);
  switch (d.type) {
    case "cover":
      return renderCover(presentation, ctx, d);
    case "split-image":
      return renderSplitImage(presentation, ctx, d);
    case "handoff":
      return renderHandoff(presentation, ctx, d);
    case "prep":
      return renderPrep(presentation, ctx, d);
    case "three-areas":
      return renderThreeAreas(presentation, ctx, d);
    case "order":
      return renderOrder(presentation, ctx, d);
    case "access":
      return renderAccess(presentation, ctx, d);
    case "click":
      return renderClick(presentation, ctx, d);
    case "oauth":
      return renderOAuth(presentation, ctx, d);
    case "verify":
      return renderVerify(presentation, ctx, d);
    case "dual-route":
      return renderDualRoute(presentation, ctx, d);
    case "handoff-board":
      return renderHandoffBoard(presentation, ctx, d);
    case "package":
      return renderPackage(presentation, ctx, d);
    case "sources":
      return renderSources(presentation, ctx, d);
    default:
      throw new Error(`Unknown slide type ${d.type}`);
  }
}
