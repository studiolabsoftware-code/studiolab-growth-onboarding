// Dominate-AI scrape and KB pre-fill function. Fired in parallel with
// create-checkout-session at Pay-click for AI-plan studios that have a
// website URL on file. Runs fire-and-forget — the frontend dispatches and
// immediately redirects to Stripe, while this function does the work in
// the background and writes results back onto the submission.
//
// Flow:
//   1. Authenticate via session_token (same anchor as save-draft).
//   2. Mark kb_scrape_status='pending'.
//   3. Discover candidate pages from the homepage.
//   4. Fetch each (up to MAX_PAGES) and clean to plain text via deno-dom.
//   5. Call Claude Haiku once with the brief's extraction prompt.
//   6. Map the JSON onto kb_* columns, filling gaps with brand defaults.
//   7. Persist + flip status to 'complete' (or 'failed' on hard error).
//
// Robustness: any non-fatal failure during page discovery or crawl is
// tolerated — we extract from whatever we got and fall back to defaults
// for the rest. A hard failure (no homepage at all, Claude JSON unrecoverable)
// marks status='failed' and leaves kb_* untouched so the KB page can fall
// back to all-defaults using the same kb-mapping with rawExtraction=null.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { anthropicMessages, extractJsonFromText } from '../_shared/anthropic.ts';
import {
  KB_EXTRACTION_SYSTEM_PROMPT,
  KB_EXTRACTION_USER_PROMPT_HEADER,
  KB_RETRY_USER_PROMPT,
} from '../_shared/kb-prompt.ts';
// KB_RETRY_USER_PROMPT is re-used as the third message in the JSON-repair retry below.
import { buildKbFields } from '../_shared/kb-mapping.ts';
import { DOMParser, type Element } from 'https://deno.land/x/deno_dom@v0.1.46/deno-dom-wasm.ts';

const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 350;
const MAX_TEXT_PER_PAGE = 5000;
const USER_AGENT = 'StudioLAB-Growth-Bot/1.0 (knowledge-base extraction; contact info@studiolabsoftware.com)';

// URL pattern → page type label. First match wins.
const PAGE_PATTERNS: Array<{ type: string; patterns: RegExp[] }> = [
  { type: 'about',    patterns: [/\/about/i, /\/our-story/i, /\/who-we-are/i, /\/our-studio/i, /\/the-studio/i] },
  { type: 'classes',  patterns: [/\/classes/i, /\/programs?/i, /\/timetable/i, /\/schedule/i, /\/what-we-offer/i, /\/dance-styles/i] },
  { type: 'faq',      patterns: [/\/faqs?/i, /\/frequently-asked/i, /\/questions/i, /\/help/i] },
  { type: 'contact',  patterns: [/\/contact/i, /\/find-us/i, /\/location/i, /\/visit/i, /\/where/i] },
  { type: 'policies', patterns: [/\/terms/i, /\/policies/i, /\/policy/i, /\/enrolment-policy/i, /\/conditions/i, /\/rules/i] },
  { type: 'team',     patterns: [/\/team/i, /\/teachers/i, /\/instructors/i, /\/staff/i, /\/our-team/i] },
  { type: 'pricing',  patterns: [/\/pricing/i, /\/fees/i, /\/rates/i, /\/tuition/i, /\/costs?/i, /\/packages?/i] },
];

const NON_HTML_EXT = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip|docx?|xlsx?)(\?|#|$)/i;

interface CrawledPage {
  url: string;
  pageType: string;
  text: string;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  let submissionId: string | null = null;
  let websiteUrl: string | null = null;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);
    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('id, plan, website, kb_scrape_status, kb_assistant_persona_type, kb_assistant_persona_name, studio_name, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }
    if (row.plan !== 'ai') {
      return jsonResponse({ ok: true, skipped: 'non_ai_plan' });
    }
    if (row.kb_scrape_status === 'complete' || row.kb_scrape_status === 'pending') {
      // Idempotency — already done or already running.
      return jsonResponse({ ok: true, skipped: row.kb_scrape_status });
    }

    submissionId = row.id;
    websiteUrl = (row.website || '').trim() || null;

    // Mark pending immediately so the frontend can poll a real status.
    await sb.from('submissions').update({
      kb_scrape_status: 'pending',
      kb_scrape_started_at: new Date().toISOString(),
      kb_scrape_error: null,
    }).eq('id', submissionId);

    // Respond to the client straight away. The remaining work runs in the
    // background via Deno's waitUntil — Stripe redirect is already happening
    // on the client side, so we do not need to block.
    const work = runScrape(sb, submissionId!, row.studio_name, row.kb_assistant_persona_type, row.kb_assistant_persona_name, websiteUrl);
    // @ts-ignore Deno supports EdgeRuntime waitUntil; falling back to a fire-and-forget promise is fine.
    if (typeof (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil === 'function') {
      (globalThis as unknown as { EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime.waitUntil(work);
    } else {
      work.catch((e) => console.error('scrape-and-extract background error:', e));
    }
    return jsonResponse({ ok: true, status: 'pending' });
  } catch (err) {
    console.error('scrape-and-extract setup error:', err);
    if (submissionId) {
      try {
        const sb = adminClient();
        await sb.from('submissions').update({
          kb_scrape_status: 'failed',
          kb_scrape_error: String((err as Error)?.message || err),
          kb_scrape_completed_at: new Date().toISOString(),
        }).eq('id', submissionId);
      } catch (_) { /* noop */ }
    }
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});

// ============================================================================
// Background worker
// ============================================================================
async function runScrape(
  sb: ReturnType<typeof adminClient>,
  submissionId: string,
  studioName: string | null,
  personaType: 'studio' | 'named' | null,
  personaName: string | null,
  websiteUrl: string | null,
): Promise<void> {
  try {
    let pages: CrawledPage[] = [];
    if (websiteUrl) {
      const normalisedHome = normaliseUrl(websiteUrl);
      if (normalisedHome) {
        pages = await crawl(normalisedHome);
      }
    }

    // Skip the Claude call when we have no usable pages — go straight to
    // defaults. We still mark this 'complete' because the KB page can open
    // with sensible defaults and the studio can fill in the gaps.
    let rawExtraction: unknown | null = null;
    if (pages.length) {
      const callResult = await callClaudeWithRetry(pages);
      rawExtraction = callResult.json;
      if (callResult.tokensIn) {
        console.log(`scrape-and-extract: claude tokens in=${callResult.tokensIn} out=${callResult.tokensOut}`);
      }
    }

    const { fields, sources } = buildKbFields({
      studioName,
      personaType,
      personaName,
      rawExtraction,
    });

    const update: Record<string, unknown> = {
      kb_scrape_status: 'complete',
      kb_scrape_completed_at: new Date().toISOString(),
      kb_scrape_pages_count: pages.length,
      kb_scrape_sources: sources,
      kb_scrape_error: null,
      ...fields,
    };
    // Persist persona defaults if the row had no choice yet.
    if (!personaType) update.kb_assistant_persona_type = 'studio';

    const { error: updErr } = await sb.from('submissions').update(update).eq('id', submissionId);
    if (updErr) throw updErr;
    try {
      const { postSystemMessage } = await import('../_shared/inbox.ts');
      await postSystemMessage(sb, submissionId, studioName,
        `🌐 Website scrape complete — ${pages.length} page${pages.length === 1 ? '' : 's'} analysed and added to the knowledge base.`);
    } catch (e) { console.error('system message (scrape complete) failed:', e); }
  } catch (err) {
    console.error('scrape-and-extract worker error:', err);
    try {
      // On hard failure, still pre-fill with defaults so the KB page has
      // something to show — mark status 'failed' with the error for admin
      // visibility but populate the kb_* fields from defaults only.
      const { fields, sources } = buildKbFields({
        studioName,
        personaType,
        personaName,
        rawExtraction: null,
      });
      await sb.from('submissions').update({
        kb_scrape_status: 'failed',
        kb_scrape_error: String((err as Error)?.message || err),
        kb_scrape_completed_at: new Date().toISOString(),
        kb_scrape_sources: sources,
        ...fields,
      }).eq('id', submissionId);
    } catch (e2) {
      console.error('scrape-and-extract failure-update error:', e2);
    }
  }
}

// ============================================================================
// URL normalisation
// ============================================================================
function normaliseUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function sameRegistrableHost(a: URL, b: URL): boolean {
  // Strip leading www. so example.com and www.example.com match.
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return norm(a.hostname) === norm(b.hostname);
}

// ============================================================================
// Crawl
// ============================================================================
async function crawl(homepageUrl: string): Promise<CrawledPage[]> {
  const homepageHtml = await fetchHtml(homepageUrl);
  if (!homepageHtml) return [];

  const origin = new URL(homepageUrl);
  const homepageText = htmlToText(homepageHtml);
  const pages: CrawledPage[] = [{ url: homepageUrl, pageType: 'home', text: trimText(homepageText) }];

  const candidates = discoverLinks(homepageHtml, origin);
  for (const c of candidates) {
    if (pages.length >= MAX_PAGES) break;
    if (pages.some((p) => p.url === c.url)) continue;
    await sleep(REQUEST_DELAY_MS);
    const html = await fetchHtml(c.url);
    if (!html) continue;
    const text = trimText(htmlToText(html));
    if (text.length < 80) continue;
    pages.push({ url: c.url, pageType: c.type, text });
  }
  return pages;
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    return await resp.text();
  } catch (e) {
    console.warn(`fetchHtml failed for ${url}:`, (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function discoverLinks(html: string, origin: URL): Array<{ url: string; type: string }> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];
  const anchors = Array.from(doc.querySelectorAll('a[href]')) as Element[];
  const seen = new Set<string>();
  const out: Array<{ url: string; type: string }> = [];
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let abs: URL;
    try { abs = new URL(href, origin); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (!sameRegistrableHost(abs, origin)) continue;
    if (NON_HTML_EXT.test(abs.pathname)) continue;
    abs.hash = '';
    const url = abs.toString();
    if (seen.has(url)) continue;
    const matched = matchPageType(abs.pathname + abs.search);
    if (!matched) continue;
    seen.add(url);
    out.push({ url, type: matched });
  }
  // Order by page-pattern priority so the most useful pages get in first.
  const priority = PAGE_PATTERNS.map((p) => p.type);
  out.sort((a, b) => priority.indexOf(a.type) - priority.indexOf(b.type));
  return out;
}

function matchPageType(pathAndQuery: string): string | null {
  for (const p of PAGE_PATTERNS) {
    for (const re of p.patterns) {
      if (re.test(pathAndQuery)) return p.type;
    }
  }
  return null;
}

// ============================================================================
// HTML → text
// ============================================================================
const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '[class*="menu" i]', '[class*="nav" i]', '[class*="sidebar" i]',
  '[class*="footer" i]', '[class*="header" i]', '[class*="cookie" i]',
  '[class*="popup" i]', '[class*="modal" i]', '[class*="widget" i]',
  '[id*="menu" i]', '[id*="nav" i]', '[id*="sidebar" i]',
  '[id*="footer" i]', '[id*="header" i]', '[id*="cookie" i]',
];

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return '';
  for (const sel of STRIP_SELECTORS) {
    try {
      const els = doc.querySelectorAll(sel);
      els.forEach((el) => el.parentNode?.removeChild(el));
    } catch (_) { /* selector errors are fine — just skip */ }
  }
  const body = doc.querySelector('body') || doc.documentElement;
  const text = (body?.textContent || '');
  return text.replace(/ /g, ' ')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimText(text: string): string {
  if (text.length <= MAX_TEXT_PER_PAGE) return text;
  return text.slice(0, MAX_TEXT_PER_PAGE) + '\n…[truncated]';
}

// ============================================================================
// Claude call (single + one retry)
// ============================================================================
async function callClaudeWithRetry(pages: CrawledPage[]): Promise<{ json: unknown; tokensIn: number; tokensOut: number }> {
  const pageBlock = pages.map((p) => `PAGE: ${p.pageType} (${p.url})\n${p.text}`).join('\n\n---\n\n');
  const userPrompt = KB_EXTRACTION_USER_PROMPT_HEADER + pageBlock;

  const first = await anthropicMessages({
    system: KB_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 4096,
    temperature: 0,
    cacheSystem: true,
  });
  if (!first.ok) {
    // One retry after a short backoff for transient failures.
    await sleep(2000);
    const retry = await anthropicMessages({
      system: KB_EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096,
      temperature: 0,
      cacheSystem: true,
    });
    if (!retry.ok) throw new Error(`Claude API failed: ${retry.error}`);
    return parseOrRetry(retry.text, userPrompt, retry.inputTokens, retry.outputTokens);
  }
  return parseOrRetry(first.text, userPrompt, first.inputTokens, first.outputTokens);
}

async function parseOrRetry(text: string, originalUserPrompt: string, tokensIn: number, tokensOut: number): Promise<{ json: unknown; tokensIn: number; tokensOut: number }> {
  try {
    return { json: extractJsonFromText(text), tokensIn, tokensOut };
  } catch (_) {
    // Ask Claude to fix the JSON. One shot only.
    const retry = await anthropicMessages({
      system: KB_EXTRACTION_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: originalUserPrompt },
        { role: 'assistant', content: text },
        { role: 'user', content: KB_RETRY_USER_PROMPT },
      ],
      maxTokens: 4096,
      temperature: 0,
      cacheSystem: true,
    });
    if (!retry.ok) throw new Error(`Claude JSON retry failed: ${retry.error}`);
    return { json: extractJsonFromText(retry.text), tokensIn: tokensIn + retry.inputTokens, tokensOut: tokensOut + retry.outputTokens };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
