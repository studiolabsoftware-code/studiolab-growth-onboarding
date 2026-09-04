/* Admin Settings page: owner-only. Reads the singleton payment_settings row
   directly (RLS grants authenticated select), writes via save-payment-settings
   edge function, and probes Stripe via stripe-test-connection. Secret keys
   never travel through this page — they live in Supabase Edge Function env. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;
  const $ = (id) => document.getElementById(id);

  let settings = null;
  let bound = false;
  let testing = false;

  async function show() {
    bind();
    await load();
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('.set-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => onModeClick(btn.dataset.mode));
    });

    $('setTestBtn').addEventListener('click', runConnectionTest);
    $('setSaveBtn').addEventListener('click', saveSettings);
    $('setWebhookCopy').addEventListener('click', copyWebhook);
  }

  async function load() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('payment_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      setStatus('error', 'Could not load settings', escapeHtml(error.message));
      return;
    }
    settings = data || {};
    render();
  }

  function render() {
    const mode = settings.stripe_mode || 'test';
    document.querySelectorAll('.set-mode-btn').forEach((btn) => {
      const on = btn.dataset.mode === mode;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const pubField = $('setPublishable');
    pubField.value = (mode === 'live'
      ? settings.stripe_publishable_key_live
      : settings.stripe_publishable_key_test) || '';
    pubField.placeholder = mode === 'live' ? 'pk_live_…' : 'pk_test_…';

    $('setDefaultMode').value = settings.default_payment_mode || 'immediate';
    $('setCaptureStage').value = settings.auto_capture_stage || 'setup_in_progress';

    const supabaseUrl = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '';
    $('setWebhookUrl').value = supabaseUrl ? `${supabaseUrl}/functions/v1/stripe-webhook` : '';

    renderStatusFromCache();
  }

  function renderStatusFromCache() {
    const facts = $('setFacts');
    facts.innerHTML = '';

    if (!settings.last_connection_test_at) {
      setStatus('unknown', 'Not yet tested', 'Press Test connection to verify the current mode.');
      return;
    }
    const when = new Date(settings.last_connection_test_at);
    const detail = settings.last_connection_test_detail || {};
    const headline = settings.last_connection_test_ok
      ? `Connected in ${detail.mode || settings.stripe_mode} mode`
      : 'Connection test failed';
    const sub = settings.last_connection_test_ok
      ? `Last verified ${when.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}.`
      : `${escapeHtml(detail.error || 'Unknown error.')} Last checked ${when.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })}.`;
    setStatus(settings.last_connection_test_ok ? 'ok' : 'error', headline, sub);
    renderFacts(detail);
  }

  function renderFacts(detail) {
    const facts = $('setFacts');
    if (!detail || typeof detail !== 'object') { facts.innerHTML = ''; return; }
    const items = [];

    items.push(factRow('Mode', `${detail.mode || '—'}${detail.mode_matches === false ? ' <span class="pill-bad">Key mismatch</span>' : ''}`));
    items.push(factRow('Account ID', detail.account_id ? escapeHtml(detail.account_id) : muted('—')));
    if (detail.account_name) items.push(factRow('Account name', escapeHtml(detail.account_name)));
    items.push(factRow('Secret key', detail.secret_key_present
      ? `${escapeHtml(detail.secret_key_fingerprint || '')} <span class="pill-ok">Loaded</span>`
      : '<span class="pill-bad">Missing</span>'));
    items.push(factRow('Webhook secret', detail.webhook_secret_present
      ? '<span class="pill-ok">Loaded</span>'
      : '<span class="pill-warn">Not set</span>'));
    items.push(factRow('AU GST registration', detail.au_gst_registered
      ? '<span class="pill-ok">Active</span>'
      : (detail.au_gst_status
        ? `<span class="pill-warn">${escapeHtml(detail.au_gst_status)}</span>`
        : '<span class="pill-bad">Not found</span>')));

    facts.innerHTML = items.join('');
  }

  function factRow(label, valueHtml) {
    return `<div class="set-fact"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
  }
  function muted(s) { return `<span class="muted">${escapeHtml(s)}</span>`; }

  function setStatus(state, headline, detailHtml) {
    const dot = document.querySelector('#setStatus .set-status-dot');
    dot.setAttribute('data-state', state);
    $('setStatusHeadline').textContent = headline;
    $('setStatusDetail').innerHTML = detailHtml || '';
  }

  async function onModeClick(nextMode) {
    if (!nextMode || nextMode === settings.stripe_mode) return;

    if (nextMode === 'live') {
      const ok = await window.AdminModal.confirm({
        title: 'Switch to live mode?',
        message: '<p>Real cards will be charged. Make sure the live secret key and live webhook secret are set in Supabase Edge Function secrets, and that the live webhook endpoint exists in Stripe.</p>',
        confirmLabel: 'Switch to live',
        danger: true,
      });
      if (!ok) return;
    }

    const r = await callFn('save-payment-settings', { stripe_mode: nextMode });
    if (!r.ok) {
      await window.AdminModal.alert({ title: 'Could not switch mode', message: escapeHtml(r.error || 'Unknown error.') });
      return;
    }
    settings = r.data.settings || settings;
    render();
    setStatus('unknown', `Switched to ${nextMode} mode`, 'Press Test connection to verify the keys for this mode.');
    $('setFacts').innerHTML = '';
  }

  async function runConnectionTest() {
    if (testing) return;
    testing = true;
    const btn = $('setTestBtn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Testing…';
    setStatus('unknown', 'Testing…', 'Asking Stripe to confirm the credentials and tax setup.');

    const r = await callFn('stripe-test-connection', {});
    btn.disabled = false;
    btn.textContent = orig;
    testing = false;

    if (!r.ok && !r.data) {
      setStatus('error', 'Connection test failed', escapeHtml(r.error || 'Unknown error.'));
      return;
    }
    // Reload settings so the cached detail/timestamp render through the same path.
    await load();
  }

  async function saveSettings() {
    const msg = $('setSaveMsg');
    msg.textContent = '';
    msg.classList.remove('err');

    const mode = settings.stripe_mode || 'test';
    const pubKey = $('setPublishable').value.trim();
    const patch = {
      default_payment_mode: $('setDefaultMode').value,
      auto_capture_stage: $('setCaptureStage').value,
    };
    if (mode === 'live') patch.stripe_publishable_key_live = pubKey || null;
    else patch.stripe_publishable_key_test = pubKey || null;

    const btn = $('setSaveBtn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const r = await callFn('save-payment-settings', patch);
    btn.disabled = false;
    btn.textContent = orig;

    if (!r.ok) {
      msg.textContent = r.error || 'Could not save.';
      msg.classList.add('err');
      return;
    }
    settings = r.data.settings || settings;
    msg.textContent = 'Saved.';
    setTimeout(() => { if (msg.textContent === 'Saved.') msg.textContent = ''; }, 3000);
    render();
  }

  async function copyWebhook() {
    const url = $('setWebhookUrl').value;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch (_) { return; }
    const btn = $('setWebhookCopy');
    const orig = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = '✓ Copied';
    setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1500);
  }

  async function callFn(name, body) {
    const client = sb();
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data && data.ok === false) return { ok: false, error: data.error || 'Failed.', data };
    return { ok: true, data };
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  window.AdminSettings = { show, refresh: load };
})();
