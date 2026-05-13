// Post-payment AI knowledge-base intake. Loads the studio's submission via
// the existing session_token (same anchor as save-draft), polls scrape
// status while pending, pre-fills textareas from the row, auto-saves on
// blur, and finalises on click.

(function () {
  const FN_BASE = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/';
  const SESSION_KEY = 'sl-growth-session';

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
    state.session = readSession();
    if (!sessionValid(state.session)) { showOnly('kb-auth'); return; }
    await loadStatus({ initial: true });
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

    // Finalise.
    $('kb-finalize-btn').addEventListener('click', async () => {
      const btn = $('kb-finalize-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      // Make sure any debounced changes flush first.
      if (dirty.size > 0) { await saveNow(); }
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
