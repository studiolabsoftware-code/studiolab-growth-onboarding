/* Studio portal — token-link based access to a single conversation plus a
   read-only view of the submission. Authentication is by token in the URL
   (?conv=<uuid>&t=<token>); anyone with the link can read and reply. */

(function () {
  'use strict';

  const FN_BASE = 'https://hiaruvsdamggenhqdvtp.supabase.co/functions/v1/';

  const state = {
    conv: null,
    submission: null,
    messages: [],
    convId: null,
    token: null,
    pendingFiles: [],
    activeTab: 'messages',
    pollTimer: null,
  };

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function boot() {
    const params = new URLSearchParams(window.location.search);
    state.convId = params.get('conv');
    state.token = params.get('t');
    if (!state.convId || !state.token) {
      showError();
      return;
    }
    bindUi();
    load().then(() => {
      startPolling();
      markRead();
    });
  }

  function showError() {
    $('portalErrorView').style.display = '';
    $('portalMain').style.display = 'none';
  }

  function bindUi() {
    document.querySelectorAll('.portal-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    $('portalRefresh').addEventListener('click', (e) => {
      e.preventDefault();
      load();
    });
    $('portalFileInput').addEventListener('change', () => {
      for (const f of $('portalFileInput').files) state.pendingFiles.push(f);
      $('portalFileInput').value = '';
      renderFileList();
    });
    $('portalFiles').addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]'); if (!rm) return;
      state.pendingFiles.splice(Number(rm.dataset.rm), 1);
      renderFileList();
    });
    $('portalBody').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        $('portalCompose').requestSubmit();
      }
    });
    $('portalCompose').addEventListener('submit', onSend);
  }

  function switchTab(name) {
    state.activeTab = name;
    document.querySelectorAll('.portal-tab').forEach((b) => {
      const active = b.dataset.tab === name;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $('portalMessagesTab').style.display = name === 'messages' ? '' : 'none';
    $('portalSetupTab').style.display = name === 'setup' ? '' : 'none';
    if (name === 'setup') renderSetup();
  }

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------
  async function api(action, extra) {
    const body = { action, conversation_id: state.convId, token: state.token, ...(extra || {}) };
    const resp = await fetch(FN_BASE + 'portal-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null; try { data = await resp.json(); } catch (_) {}
    if (resp.status === 401) { showError(); throw new Error('unauthorized'); }
    return { ok: resp.ok && data?.ok !== false, data };
  }

  async function load() {
    $('portalMain').style.display = '';
    $('portalErrorView').style.display = 'none';
    let res;
    try { res = await api('load'); }
    catch (e) { return; }
    if (!res.ok) { showError(); return; }
    state.conv = res.data.conversation;
    state.submission = res.data.submission;
    state.messages = res.data.messages || [];
    $('portalStudioName').textContent = state.submission?.studio_name || '';
    $('portalThreadTitle').textContent = state.conv?.subject || (state.submission?.studio_name ? `Conversation with ${state.submission.studio_name}` : 'Your conversation');
    renderMessages();
    updateUnreadBadge();
  }

  async function markRead() {
    try { await api('mark-read'); } catch (_) {}
    updateUnreadBadge(true);
  }

  function updateUnreadBadge(zero) {
    const badge = $('portalUnreadBadge');
    const count = zero ? 0 : (state.conv?.studio_unread_count || 0);
    if (count > 0) { badge.style.display = ''; badge.textContent = String(count); }
    else { badge.style.display = 'none'; }
  }

  async function onSend(e) {
    e.preventDefault();
    const errEl = $('portalErr');
    const btn = $('portalSend');
    errEl.textContent = '';
    const body = $('portalBody').value;
    if (!body.trim() && !state.pendingFiles.length) { errEl.textContent = 'Type a message or attach a file first.'; return; }
    const oversize = state.pendingFiles.find((f) => f.size > 10 * 1024 * 1024);
    if (oversize) { errEl.textContent = `"${oversize.name}" exceeds the 10 MB limit. Compress or send a download link.`; return; }
    btn.disabled = true;
    const senderName = state.submission?.studio_name || null;
    const senderEmail = state.submission?.contact_email || null;
    const sendRes = await api('send', { body_text: body, sender_name: senderName, sender_email: senderEmail });
    if (!sendRes.ok) {
      btn.disabled = false;
      errEl.textContent = sendRes.data?.error || 'Could not send.';
      return;
    }
    const messageId = sendRes.data.message_id;
    let attErr = null;
    if (state.pendingFiles.length) {
      attErr = await uploadFiles(messageId, state.pendingFiles);
    }
    btn.disabled = false;
    $('portalBody').value = '';
    state.pendingFiles = [];
    renderFileList();
    if (attErr) errEl.textContent = 'Message sent, but some attachments failed: ' + attErr;
    await load();
    scrollMsgsToBottom();
  }

  async function uploadFiles(messageId, files) {
    const failures = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('conversation_id', state.convId);
      fd.append('token', state.token);
      fd.append('message_id', messageId);
      fd.append('file', file);
      try {
        const resp = await fetch(FN_BASE + 'portal-attach', { method: 'POST', body: fd });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data?.ok === false) failures.push(file.name);
      } catch (_) { failures.push(file.name); }
    }
    return failures.length ? failures.join(', ') : null;
  }

  // ------------------------------------------------------------------
  // Polling for new messages (no realtime — token auth isn't a JWT)
  // ------------------------------------------------------------------
  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(() => {
      if (document.hidden) return;
      load();
    }, 20000);
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function renderMessages() {
    const host = $('portalMsgs');
    if (!state.messages.length) {
      host.innerHTML = `<div class="portal-empty">No messages yet — say hello below and we will get back to you shortly.</div>`;
      return;
    }
    host.innerHTML = state.messages.map(renderMsg).join('');
    // Wire attachment downloads.
    host.querySelectorAll('[data-storage-path]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        const path = el.getAttribute('data-storage-path');
        const res = await api('sign-url', { storage_path: path });
        if (!res.ok || !res.data?.signed_url) { alert('Could not generate download link.'); return; }
        window.open(res.data.signed_url, '_blank', 'noopener');
      });
    });
    scrollMsgsToBottom();
  }

  function renderMsg(m) {
    const isStudio = m.sender_role === 'studio';
    const isSystem = m.sender_role === 'system';
    const cls = `portal-msg ${isStudio ? 'portal-msg-mine' : 'portal-msg-them'}${isSystem ? ' portal-msg-system' : ''}`;
    const who = isStudio ? (m.sender_name || 'You') : (isSystem ? '' : (m.sender_name || 'StudioLAB Growth'));
    const ts = new Date(m.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' });
    const body = m.body_html || textToHtml(m.body_text || '');
    const atts = (m.attachments || []).map((a) => `<a class="portal-att" href="#" data-storage-path="${escapeHtml(a.storage_path)}">📎 ${escapeHtml(a.filename)} <span class="portal-att-size">${formatBytes(a.size_bytes)}</span></a>`).join('');
    if (isSystem) {
      return `<div class="portal-msg-system-row"><span class="portal-msg-system-dot">●</span> <span>${body}</span> <span class="portal-msg-system-when">${escapeHtml(ts)}</span></div>`;
    }
    return `
      <div class="${cls}">
        <div class="portal-msg-meta"><strong>${escapeHtml(who)}</strong> · ${escapeHtml(ts)}</div>
        <div class="portal-msg-body">${body}</div>
        ${atts ? `<div class="portal-msg-atts">${atts}</div>` : ''}
      </div>`;
  }

  function scrollMsgsToBottom() {
    const el = $('portalMsgs');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderFileList() {
    const host = $('portalFiles');
    if (!state.pendingFiles.length) { host.innerHTML = ''; return; }
    host.innerHTML = state.pendingFiles.map((f, i) => {
      const over = f.size > 10 * 1024 * 1024;
      return `<span class="portal-file${over ? ' oversize' : ''}">📎 ${escapeHtml(f.name)} <span class="portal-file-size">${formatBytes(f.size)}</span>${over ? ' <span class="portal-file-warn">too large</span>' : ''} <button type="button" data-rm="${i}" aria-label="Remove">×</button></span>`;
    }).join('');
  }

  // Setup tab — read-only fact grid drawn from the submission record.
  // Studios who want to change anything just send a message; admin updates
  // the record on their side. Editing here is intentionally out of scope —
  // the existing change-request magic-link flow handles structured edits.
  function renderSetup() {
    const grid = $('portalSetupFacts');
    if (!state.submission) { grid.innerHTML = '<div class="portal-loading">Loading…</div>'; return; }
    const s = state.submission;
    const planLabel = ({ launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' })[s.plan] || s.plan || '—';
    const rows = [
      ['Studio name', s.studio_name],
      ['Plan', planLabel],
      ['Contact email', s.contact_email],
      ['Status', humanStatus(s.status)],
    ].filter(([_, v]) => v);
    grid.innerHTML = rows.map(([k, v]) => `
      <div class="portal-fact">
        <dt>${escapeHtml(k)}</dt>
        <dd>${escapeHtml(v)}</dd>
      </div>`).join('') + `
      <div class="portal-fact portal-fact-wide">
        <dt>Need to change something?</dt>
        <dd>Just send us a message on the Messages tab and we will update your details. For larger updates we may email you a structured form.</dd>
      </div>`;
  }

  // ------------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------------
  function humanStatus(s) {
    return ({
      submitted: 'Submitted',
      in_review: 'In review',
      changes_requested: 'Changes requested',
      setup_in_progress: 'Setup in progress',
      complete: 'Complete',
      draft: 'Draft',
    })[s] || s || '';
  }

  function textToHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function formatBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
