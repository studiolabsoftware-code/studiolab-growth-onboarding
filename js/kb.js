// Post-payment AI knowledge-base intake. Loads the studio's submission via
// the existing session_token (same anchor as save-draft), polls scrape
// status while pending, pre-fills textareas from the row, auto-saves on
// blur, and finalises on click.

(function () {
  const FN_BASE = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/';
  const SESSION_KEY = 'sl-growth-session';
  const PREVIEW_MODE = new URLSearchParams(window.location.search).get('preview') === '1';

  // Mock submission used in preview mode so admins can walk the KB intake
  // without a real session_token, paid submission, or scrape worker run.
  const PREVIEW_SUBMISSION = {
    studio_name: 'Preview Dance Studio',
    plan: 'ai',
    payment_status: 'paid',
    website: 'https://previewdance.example.com',
    kb_scrape_status: 'complete',
    kb_scrape_pages_count: 6,
    kb_assistant_persona_type: 'studio',
    kb_assistant_persona_name: '',
    kb_greeting: 'Hi! Welcome to Preview Dance Studio. I can help you find a class, answer your questions, or help you get started. What can I help with?',
    kb_profile: 'Preview Dance Studio is a community-focused dance school running classes for ages 3 through adult across ballet, jazz, contemporary, and hip-hop. Now in its 18th year, the studio is known for warm, experienced teachers and a strong focus on technique.',
    kb_classes: 'First class is free — wear something comfortable you can move in.\n\nBallet: leotard, tights, hair in a bun, ballet shoes.\nJazz: fitted top, leggings or shorts, hair tied back, jazz shoes or bare feet.\nContemporary: fitted clothing, hair tied back, bare feet.\nHip-hop: comfortable streetwear, clean trainers (indoor use only).',
    kb_pricing: 'Term-based pricing with multi-class and family discounts. New families receive a free trial class. Live pricing and packages are available in the parent portal — we direct enquiries there rather than quoting over chat.',
    kb_price_quoting: 'Never calculate combined or multi-class pricing. Always direct parents to the portal for live totals tailored to their family.',
    kb_policies: 'Term fees are non-refundable but classes can be made up within the term. We ask for two weeks\' notice before withdrawing from a class so we can manage the waitlist. Behaviour expectations are based on respect for teachers, peers, and the space.',
    kb_events: 'Annual end-of-year concert held each December at a local theatre. Costume orders run from August. Dress rehearsals are the week before the concert — attendance is required.',
    kb_faqs: 'Free on-site parking. Closest train station is a 6-minute walk. Viewing windows in each studio so parents can watch class. Water bottles encouraged; we have a refill station in the lobby.',
    kb_restricted: 'Teacher personal contact details, internal staffing matters, specific student incidents, medical advice.',
    kb_tone: 'Warm, encouraging, and clear. Speak like a friendly studio owner — never corporate, never pushy. Use plain language a busy parent can read in five seconds.',
    voice_hours: 'Office hours: Tuesday–Friday 10am–6pm, Saturday 9am–1pm. Closed Sunday and Monday.',
    voice_escalate: 'Medical concerns, billing disputes, complaints, anything related to a specific child by name, anything the parent describes as urgent.',
    kb_scrape_sources: {
      kb_profile: 'website',
      kb_classes: 'website',
      kb_pricing: 'website',
      kb_policies: 'website',
      kb_events: 'website',
      kb_faqs: 'website',
      kb_greeting: 'default',
      kb_price_quoting: 'default',
      kb_tone: 'default',
      kb_restricted: 'default',
      voice_hours: 'default',
      voice_escalate: 'default',
    },
  };

  function showPreviewBanner() {
    if (document.getElementById('kb-preview-banner')) return;
    const b = document.createElement('div');
    b.id = 'kb-preview-banner';
    b.style.cssText = 'position:sticky;top:0;z-index:50;background:#7C3AED;color:#fff;padding:8px 14px;text-align:center;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;';
    b.textContent = 'Preview mode · no changes are saved';
    document.body.insertBefore(b, document.body.firstChild);
  }

  // ----- Utilities ----------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function showOnly(id) {
    ['kb-loading', 'kb-auth', 'kb-unpaid', 'kb-wrongplan', 'kb-form', 'kb-done'].forEach((x) => {
      const el = $(x);
      if (!el) return;
      el.style.display = (x === id) ? (x === 'kb-form' ? 'block' : 'block') : 'none';
    });
  }
  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function sessionValid(s) { return Boolean(s && s.token && s.expiresAt && new Date(s.expiresAt) > new Date()); }
  async function callFn(name, body) {
    const r = await fetch(FN_BASE + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await r.json(); } catch (_) { /* ignore */ }
    return { ok: r.ok, status: r.status, data: data || {} };
  }
  function setSaveState(state) {
    const el = $('kb-savestate');
    if (!el) return;
    el.classList.remove('saving', 'err');
    if (state === 'saving') { el.classList.add('saving'); el.textContent = 'Saving…'; }
    else if (state === 'err') { el.classList.add('err'); el.textContent = 'Could not save. Retrying…'; }
    else if (state === 'saved') { el.textContent = 'All changes saved.'; }
  }
  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      const self = this;
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  // ----- State --------------------------------------------------------------
  const state = {
    session: null,
    submission: null,
    pollTimer: null,
    finalized: false,
    studioName: 'the studio',
  };

  const TRACKED_FIELDS = [
    'kb_greeting',
    'kb_profile',
    'kb_classes',
    'kb_pricing',
    'kb_price_quoting',
    'kb_policies',
    'kb_events',
    'kb_faqs',
    'kb_restricted',
    'kb_tone',
    'voice_hours',
    'voice_escalate',
  ];

  // ----- Boot ---------------------------------------------------------------
  async function boot() {
    if (PREVIEW_MODE) { previewBoot(); return; }
    state.session = readSession();
    if (!sessionValid(state.session)) { showOnly('kb-auth'); return; }
    await loadStatus({ initial: true });
  }

  // Preview-mode boot: skip the session check + get-kb-status call and seed
  // the form straight from the mock submission so admins can walk the KB
  // intake exactly as a paying studio would see it after a fresh scrape.
  function previewBoot() {
    showPreviewBanner();
    state.session = { token: 'preview', expiresAt: new Date(Date.now() + 3600e3).toISOString() };
    state.submission = PREVIEW_SUBMISSION;
    state.studioName = PREVIEW_SUBMISSION.studio_name;
    showOnly('kb-form');
    $('kb-h1').textContent = `Your AI knowledge base for ${state.studioName}`;
    updatePersonaPreviews();
    renderScrapeStatus(PREVIEW_SUBMISSION);
    fillFromSubmission(PREVIEW_SUBMISSION);
    setSaveState('saved');
  }

  async function loadStatus(opts) {
    const r = await callFn('get-kb-status', { session_token: state.session.token });
    if (!r.ok || !r.data || r.data.ok === false) {
      if (r.status === 401) { showOnly('kb-auth'); return; }
      // Transient error — back off and retry.
      setTimeout(() => loadStatus({}), 3000);
      return;
    }
    const sub = r.data.submission;
    state.submission = sub;
    state.studioName = sub.studio_name || 'the studio';

    // Wrong plan: KB intake is Dominate AI only.
    if (sub.plan !== 'ai') { showOnly('kb-wrongplan'); return; }

    // Unpaid: payment hasn't confirmed yet.
    const paid = sub.payment_status === 'paid' || sub.payment_status === 'authorised' || sub.payment_status === 'card_saved';
    if (!paid) { showOnly('kb-unpaid'); return; }

    // Show the form shell so the studio sees progress even while scrape runs.
    showOnly('kb-form');
    $('kb-h1').textContent = `Your AI knowledge base for ${state.studioName}`;
    updatePersonaPreviews();

    // Banner + shimmer for the various scrape statuses.
    renderScrapeStatus(sub);
    fillFromSubmission(sub);

    if (sub.kb_scrape_status === 'pending') {
      // Keep polling while the background worker runs.
      if (state.pollTimer) clearTimeout(state.pollTimer);
      state.pollTimer = setTimeout(() => loadStatus({}), 3000);
    } else {
      if (state.pollTimer) { clearTimeout(state.pollTimer); state.pollTimer = null; }
    }
  }

  // ----- Status banner + add-website callout --------------------------------
  function renderScrapeStatus(sub) {
    const banner = $('kb-scrape-banner');
    const addsite = $('kb-addsite');
    const status = sub.kb_scrape_status;
    addsite.style.display = 'none';
    banner.classList.remove('warn', 'scraping');
    if (status === 'pending') {
      banner.style.display = 'flex';
      banner.classList.add('scraping');
      banner.innerHTML = `<div class="kb-spin" aria-hidden="true"></div><div>Reading your website and filling things in…</div>`;
      setShimmer(true);
    } else if (status === 'complete') {
      banner.style.display = 'block';
      banner.innerHTML = `We read <strong>${sub.kb_scrape_pages_count || 'a few'} pages</strong> from your website and pre-filled the sections below. Read through and edit anything that is not quite right.`;
      setShimmer(false);
    } else if (status === 'failed') {
      banner.style.display = 'block';
      banner.classList.add('warn');
      banner.innerHTML = `We could not finish reading your website, so we have started you off with our standard defaults. Edit each section to fit how you actually do things.`;
      setShimmer(false);
    } else if (status === 'skipped' || !status) {
      banner.style.display = 'none';
      // If no website is on file, show the add-website callout.
      if (!sub.website) {
        addsite.style.display = 'block';
      }
      setShimmer(false);
    } else {
      banner.style.display = 'none';
      setShimmer(false);
    }
  }
  function setShimmer(on) {
    TRACKED_FIELDS.forEach((f) => {
      const el = document.getElementById(f);
      if (!el) return;
      if (on && (!el.value || el.value.length < 10)) el.classList.add('kb-loading-shimmer');
      else el.classList.remove('kb-loading-shimmer');
    });
  }

  // ----- Pre-fill -----------------------------------------------------------
  function fillFromSubmission(sub) {
    // Persona radios.
    const personaType = (sub.kb_assistant_persona_type === 'named') ? 'named' : 'studio';
    const personaName = sub.kb_assistant_persona_name || '';
    $('persona-studio').checked = (personaType === 'studio');
    $('persona-named').checked = (personaType === 'named');
    $('persona-name-input').value = personaName;

    // All tracked text fields — only overwrite the textarea if it's empty
    // (so we don't clobber what the studio is currently typing during a
    // poll refresh).
    TRACKED_FIELDS.forEach((f) => {
      const el = document.getElementById(f);
      if (!el) return;
      if (document.activeElement === el) return;
      const v = sub[f];
      if (typeof v === 'string') el.value = v;
      else if (v === null) el.value = '';
    });

    // Source badges.
    const sources = sub.kb_scrape_sources || {};
    document.querySelectorAll('[data-badge-for]').forEach((b) => {
      const field = b.getAttribute('data-badge-for');
      const src = sources[field] || (sub.kb_scrape_status === 'complete' ? 'default' : '');
      b.className = 'kb-badge ' + (src || '');
      b.textContent = src === 'website' ? 'From your website'
        : src === 'edited' ? 'Edited by you'
        : src === 'default' ? 'Standard default'
        : '';
    });

    updatePersonaPreviews();
  }

  // ----- Persona preview ----------------------------------------------------
  function updatePersonaPreviews() {
    const studio = state.studioName || 'the studio';
    const name = ($('persona-name-input').value || '').trim() || 'Casey';
    $('persona-preview-studio').textContent = `Hi! Welcome to ${studio}. I can help you find a class, answer your questions, or help you get started.`;
    $('persona-preview-named').textContent = `Hi, I'm ${name}, the AI assistant for ${studio}. I can help you find a class, answer your questions, or help you get started.`;
  }

  function currentPersonaType() {
    return $('persona-named').checked ? 'named' : 'studio';
  }
  function currentPersonaName() {
    const v = ($('persona-name-input').value || '').trim();
    return v || null;
  }
  function regenerateGreeting() {
    const greetingEl = $('kb_greeting');
    // Only regenerate if the studio has not edited the greeting away from
    // the persona-derived form. We check by looking at the source badge.
    const badge = document.querySelector('[data-badge-for="kb_greeting"]');
    const isEdited = badge && badge.classList.contains('edited');
    if (isEdited) return;
    const studio = state.studioName || 'the studio';
    if (currentPersonaType() === 'named') {
      const name = currentPersonaName() || 'Casey';
      greetingEl.value = `Hi, I'm ${name}, the AI assistant for ${studio}. I can help you find a class, answer your questions, or help you get started. What can I help with?`;
    } else {
      greetingEl.value = `Hi! Welcome to ${studio}. I can help you find a class, answer your questions, or help you get started. What can I help with?`;
    }
  }

  // ----- Auto-save ----------------------------------------------------------
  const dirty = new Set();
  function markDirty(field) { dirty.add(field); scheduleSave(); }

  const scheduleSave = debounce(saveNow, 1200);

  async function saveNow() {
    if (state.finalized) return;
    if (dirty.size === 0) return;
    setSaveState('saving');
    const payload = {};
    dirty.forEach((f) => {
      if (f === 'persona') {
        payload.kb_assistant_persona_type = currentPersonaType();
        payload.kb_assistant_persona_name = currentPersonaType() === 'named' ? currentPersonaName() : null;
      } else {
        const el = document.getElementById(f);
        if (el) payload[f] = el.value;
      }
    });
    dirty.clear();

    if (PREVIEW_MODE) {
      // Fake the round-trip so the save indicator and edited-badge flip
      // behave exactly as in production.
      await new Promise((res) => setTimeout(res, 350));
      Object.keys(payload).forEach((k) => {
        const b = document.querySelector(`[data-badge-for="${k}"]`);
        if (!b) return;
        if (['kb_assistant_persona_type', 'kb_assistant_persona_name'].indexOf(k) >= 0) return;
        b.className = 'kb-badge edited';
        b.textContent = 'Edited by you';
      });
      setSaveState('saved');
      return;
    }

    const r = await callFn('save-kb', { session_token: state.session.token, payload, finalize: false });
    if (!r.ok || !r.data || r.data.ok === false) {
      setSaveState('err');
      // Re-mark everything dirty so the next change re-attempts.
      Object.keys(payload).forEach((k) => dirty.add(k));
      setTimeout(() => { if (dirty.size > 0) saveNow(); }, 5000);
      return;
    }
    // Update source badges for fields that just became 'edited'.
    Object.keys(payload).forEach((k) => {
      const b = document.querySelector(`[data-badge-for="${k}"]`);
      if (!b) return;
      // Persona fields don't carry badges; skip.
      if (['kb_assistant_persona_type', 'kb_assistant_persona_name'].indexOf(k) >= 0) return;
      b.className = 'kb-badge edited';
      b.textContent = 'Edited by you';
    });
    setSaveState('saved');
  }

  // ----- Wire up ------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    // Textareas — save on blur and on debounced input.
    TRACKED_FIELDS.forEach((f) => {
      const el = document.getElementById(f);
      if (!el) return;
      el.addEventListener('blur', () => markDirty(f));
      el.addEventListener('input', () => markDirty(f));
    });

    // Persona radios.
    document.querySelectorAll('input[name="persona"]').forEach((r) => {
      r.addEventListener('change', () => {
        regenerateGreeting();
        updatePersonaPreviews();
        markDirty('persona');
        markDirty('kb_greeting');
      });
    });
    $('persona-name-input').addEventListener('input', () => {
      updatePersonaPreviews();
      if (currentPersonaType() === 'named') {
        regenerateGreeting();
        markDirty('persona');
        markDirty('kb_greeting');
      }
    });
    $('persona-name-input').addEventListener('focus', () => {
      $('persona-named').checked = true;
      updatePersonaPreviews();
    });

    // Add-website callout.
    $('kb-addsite-btn').addEventListener('click', async () => {
      const btn = $('kb-addsite-btn');
      const input = $('kb-addsite-input');
      const url = (input.value || '').trim();
      if (!url) { input.focus(); return; }
      btn.disabled = true;
      btn.textContent = 'Scanning…';
      const r = await callFn('add-website-and-scrape', {
        session_token: state.session.token,
        website: url,
      });
      btn.disabled = false;
      btn.textContent = 'Scan now';
      if (!r.ok || !r.data || r.data.ok === false) {
        alert((r.data && r.data.error) || 'Could not start the scan.');
        return;
      }
      $('kb-addsite').style.display = 'none';
      loadStatus({});
    });
    $('kb-addsite-skip').addEventListener('click', () => {
      $('kb-addsite').style.display = 'none';
    });

    // Save draft — flush every field as a draft save and show a confirmation
    // pill so the studio knows it's safe to leave and come back.
    $('kb-savedraft-btn').addEventListener('click', async () => {
      const btn = $('kb-savedraft-btn');
      const msg = $('kb-savedraft-msg');
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = 'Saving…';
      if (msg) { msg.textContent = ''; msg.className = 'kb-savedraft-msg'; }
      // Push every tracked field + persona into the dirty set so saveNow
      // sends the full current state rather than just recent edits.
      TRACKED_FIELDS.forEach((f) => dirty.add(f));
      dirty.add('persona');
      try {
        await saveNow();
        if (msg) {
          msg.textContent = 'Draft saved. You can close this page and come back any time.';
          msg.className = 'kb-savedraft-msg ok';
        }
      } catch (_) {
        if (msg) {
          msg.textContent = 'Could not save right now — please try again.';
          msg.className = 'kb-savedraft-msg err';
        }
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

    // Finalise.
    $('kb-finalize-btn').addEventListener('click', async () => {
      const btn = $('kb-finalize-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      // Make sure any debounced changes flush first.
      if (dirty.size > 0) { await saveNow(); }
      if (PREVIEW_MODE) {
        await new Promise((res) => setTimeout(res, 600));
        state.finalized = true;
        showOnly('kb-done');
        window.scrollTo(0, 0);
        return;
      }
      const r = await callFn('save-kb', { session_token: state.session.token, payload: {}, finalize: true });
      if (!r.ok || !r.data || r.data.ok === false) {
        btn.disabled = false;
        btn.textContent = 'Confirm and finish';
        alert((r.data && r.data.error) || 'Could not finalise.');
        return;
      }
      state.finalized = true;
      showOnly('kb-done');
      window.scrollTo(0, 0);
    });

    boot();
  });
})();
