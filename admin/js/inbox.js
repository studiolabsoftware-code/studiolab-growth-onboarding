/* Admin inbox: cross-studio conversation list, per-thread view, compose with
   internal-note toggle and per-thread subscribe toggle. Exposes helpers used
   by dashboard.js (unread badges on submission cards) and detail.js (per-
   studio Messages tab).

   Admins write directly to public.conversations / public.messages — RLS is
   `for all to authenticated`, and a Supabase DB webhook on messages INSERT
   fires the notify-new-message edge function to send the email. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;
  const me = () => window.AdminAuth?.profile;

  // Mirror upload-submission-attachment's allowlist + caps. Phase 2B: admin
  // attaches via the same edge function as the studio side so cleanup,
  // retention, and ACLs are handled in one place.
  const ATT_MAX_FILES_PER_MESSAGE = 5;
  const ATT_MAX_BYTES = 25 * 1024 * 1024;
  const ATT_ACCEPT_ATTR =
    '.pdf,.png,.jpg,.jpeg,.svg,.docx,.doc,.xlsx,.xls,' +
    'application/pdf,image/png,image/jpeg,image/svg+xml,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/msword,' +
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
    'application/vnd.ms-excel';

  const state = {
    rows: [],            // active conversations + their submissions (for list)
    filter: 'unread',    // 'unread' | 'all' | 'mine'
    search: '',
    threadConvId: null,  // currently open thread's conv id (in detail tab)
    threadMessages: [],
    unreadBySubmission: new Map(),  // submission_id -> {convId, count, lastAt}
  };

  const $ = (id) => document.getElementById(id);

  // ----------------------------------------------------------------------
  // Public surface
  // ----------------------------------------------------------------------
  async function init() {
    await refreshUnreadMap();
    bindNav();
    subscribeRealtime();
  }

  async function openListScreen() {
    document.getElementById('listScreen').style.display = 'none';
    document.getElementById('detailScreen').style.display = 'none';
    const catalog = document.getElementById('catalogScreen'); if (catalog) catalog.style.display = 'none';
    const users = document.getElementById('usersScreen'); if (users) users.style.display = 'none';
    const settings = document.getElementById('settingsScreen'); if (settings) settings.style.display = 'none';
    const screen = ensureListScreen();
    screen.style.display = '';
    await loadConversations();
    renderList();
  }

  // Used by detail.js to render the Messages tab for a single submission.
  async function renderThreadInto(container, submissionId, opts) {
    const studioName = opts?.studioName || 'this studio';
    container.innerHTML = `<div class="adm-empty" style="padding:24px 0;">Loading thread…</div>`;
    const conv = await ensureConversation(submissionId, studioName);
    if (!conv) {
      container.innerHTML = `<div class="adm-empty" style="padding:24px 0;">Could not open the conversation.</div>`;
      return;
    }
    state.threadConvId = conv.id;
    await loadThread(conv.id);
    await markThreadRead(conv.id);
    renderThread(container, conv, studioName);
  }

  function getUnreadForSubmission(submissionId) {
    return state.unreadBySubmission.get(submissionId) || null;
  }

  function getTotalUnread() {
    let total = 0;
    state.unreadBySubmission.forEach((v) => { total += v.count; });
    return total;
  }

  // ----------------------------------------------------------------------
  // Data
  // ----------------------------------------------------------------------

  // Cross-studio unread map. Cheap query — one row per conversation.
  async function refreshUnreadMap() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('conversations')
      .select('id, submission_id, admin_unread_count, last_message_at')
      .gt('admin_unread_count', 0);
    if (error) { console.error('refreshUnreadMap:', error); return; }
    const map = new Map();
    (data || []).forEach((c) => {
      map.set(c.submission_id, { convId: c.id, count: c.admin_unread_count, lastAt: c.last_message_at });
    });
    state.unreadBySubmission = map;
    paintNavBadge();
  }

  async function loadConversations() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('conversations')
      .select(`
        id, submission_id, subject, status, last_message_at,
        admin_unread_count, studio_unread_count,
        submission:submissions!inner(id, studio_name, contact_email, plan, status)
      `)
      .order('last_message_at', { ascending: false });
    if (error) { console.error('loadConversations:', error); state.rows = []; return; }
    state.rows = data || [];
  }

  // Idempotent: returns existing conversation row for a submission, creating
  // one on the fly if it doesn't exist yet. Used the first time an admin
  // opens the Messages tab on a studio without an existing thread.
  async function ensureConversation(submissionId, studioName) {
    const client = sb();
    const { data: existing } = await client
      .from('conversations')
      .select('id, submission_id, subject, status, last_message_at, admin_unread_count, studio_unread_count')
      .eq('submission_id', submissionId)
      .maybeSingle();
    if (existing) return existing;

    const { data: created, error } = await client
      .from('conversations')
      .insert({
        submission_id: submissionId,
        subject: studioName ? `Conversation with ${studioName}` : null,
      })
      .select('id, submission_id, subject, status, last_message_at, admin_unread_count, studio_unread_count')
      .single();
    if (error) { console.error('ensureConversation:', error); return null; }
    return created;
  }

  async function loadThread(conversationId) {
    const client = sb();
    const { data: msgs } = await client
      .from('messages')
      .select(`
        id, conversation_id, sender_role, visibility, sender_email, sender_name,
        sender_admin_id, body_text, body_html, created_at,
        read_by_admin_at, read_by_studio_at
      `)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    state.threadMessages = msgs || [];

    // Pull attachments from BOTH tables and merge per message. Legacy
    // message_attachments rows render as `source: 'legacy'` chips and
    // download through Supabase Storage directly; Phase 2B+
    // submission_attachments rows render as `source: 'submission'` and
    // download via the get-attachment-download-url edge function so the
    // bucket can stay private.
    const ids = state.threadMessages.map((m) => m.id);
    if (ids.length) {
      const [legacyRes, newRes] = await Promise.all([
        client.from('message_attachments')
          .select('id, message_id, storage_path, filename, content_type, size_bytes')
          .in('message_id', ids),
        client.from('submission_attachments')
          .select('id, message_id, file_name, mime_type, size_bytes, uploaded_at')
          .in('message_id', ids),
      ]);
      const byMsg = new Map();
      (legacyRes.data || []).forEach((a) => {
        if (!byMsg.has(a.message_id)) byMsg.set(a.message_id, []);
        byMsg.get(a.message_id).push({
          source: 'legacy',
          id: a.id,
          storage_path: a.storage_path,
          filename: a.filename,
          content_type: a.content_type,
          size_bytes: a.size_bytes,
        });
      });
      (newRes.data || []).forEach((a) => {
        if (!byMsg.has(a.message_id)) byMsg.set(a.message_id, []);
        byMsg.get(a.message_id).push({
          source: 'submission',
          id: a.id,
          filename: a.file_name,
          content_type: a.mime_type,
          size_bytes: a.size_bytes,
          uploaded_at: a.uploaded_at,
        });
      });
      state.threadMessages.forEach((m) => { m._attachments = byMsg.get(m.id) || []; });
    }
  }

  async function markThreadRead(conversationId) {
    const client = sb();
    // Team-inbox semantics: zeroing the counter when ANY admin opens the
    // thread. Per-admin read tracking would be over-engineered for a small
    // team — Gary said the owner sees everything anyway.
    await client.from('conversations')
      .update({ admin_unread_count: 0 })
      .eq('id', conversationId);
    state.unreadBySubmission.forEach((v, k) => {
      if (v.convId === conversationId) state.unreadBySubmission.delete(k);
    });
    paintNavBadge();
  }

  async function sendMessage(conversationId, body, opts) {
    const client = sb();
    const profile = me();
    if (!body.trim()) return { ok: false, error: 'Message is empty.' };
    const { data, error } = await client
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_role: 'admin',
        visibility: opts?.internal ? 'internal' : 'studio',
        sender_admin_id: profile?.id,
        sender_email: profile?.email,
        sender_name: profile?.name,
        body_text: body,
        body_html: bodyToHtml(body),
      })
      .select('id')
      .single();
    if (error) return { ok: false, error: String(error.message || error) };
    return { ok: true, id: data.id };
  }

  function bodyToHtml(text) {
    // Minimal text-to-HTML: escape, collapse blank lines, linkify URLs.
    const esc = String(text || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
    return linked.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>').replace(/^/, '<p>').replace(/$/, '</p>');
  }

  // ----------------------------------------------------------------------
  // Realtime — keep unread badge fresh + reload thread when open
  // ----------------------------------------------------------------------
  function subscribeRealtime() {
    const client = sb(); if (!client || window._inboxChannel) return;
    window._inboxChannel = client
      .channel('inbox-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        refreshUnreadMap();
        if (document.getElementById('inboxScreen')?.style.display !== 'none') {
          loadConversations().then(renderList);
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (state.threadConvId && payload.new?.conversation_id === state.threadConvId) {
          // A new message landed in the open thread — refresh it.
          loadThread(state.threadConvId).then(() => {
            const host = document.querySelector('[data-inbox-thread-host]');
            if (host) {
              const convRow = state.rows.find((r) => r.id === state.threadConvId);
              const studioName = convRow?.submission?.studio_name || 'this studio';
              renderThread(host, {
                id: state.threadConvId,
                submission_id: convRow?.submission_id || convRow?.submission?.id,
                subject: convRow?.subject,
              }, studioName);
            }
          });
        }
      })
      .subscribe();
  }

  // ----------------------------------------------------------------------
  // Cross-studio inbox screen
  // ----------------------------------------------------------------------
  function ensureListScreen() {
    let screen = $('inboxScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'inboxScreen';
    screen.className = 'inbox-screen';
    screen.innerHTML = `
      <div class="inbox-hdr">
        <div>
          <h2 class="users-title">Inbox</h2>
          <p class="users-desc">Conversations across all studios. Replies arrive here from the admin dashboard or by email to <code>reply+…@inbox.studiolabgrowth.com</code>.</p>
        </div>
      </div>
      <div class="inbox-toolbar">
        <div class="adm-pills" id="inboxPills" role="group" aria-label="Filter conversations">
          <button type="button" class="pill active" data-f="unread" aria-pressed="true">Unread</button>
          <button type="button" class="pill" data-f="mine" aria-pressed="false">Mine</button>
          <button type="button" class="pill" data-f="all" aria-pressed="false">All</button>
        </div>
        <div class="adm-search" role="search">
          <label class="sr-only" for="inboxSearch">Search</label>
          <input type="search" id="inboxSearch" placeholder="Search studios, subjects…">
        </div>
      </div>
      <div class="inbox-list" id="inboxList"><div class="adm-empty" style="padding:40px 0;">Loading…</div></div>`;
    document.querySelector('main.adm-main').appendChild(screen);

    screen.querySelector('#inboxPills').addEventListener('click', (e) => {
      const p = e.target.closest('.pill'); if (!p) return;
      state.filter = p.dataset.f;
      screen.querySelectorAll('#inboxPills .pill').forEach((b) => {
        const active = b === p;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderList();
    });
    screen.querySelector('#inboxSearch').addEventListener('input', (e) => {
      state.search = (e.target.value || '').toLowerCase();
      renderList();
    });
    screen.querySelector('#inboxList').addEventListener('click', (e) => {
      const row = e.target.closest('.inbox-row[data-sub-id]');
      if (row && window.AdminDetail) {
        window.AdminDetail.open(row.dataset.subId, { tab: 'messages' });
      }
    });
    return screen;
  }

  function renderList() {
    const host = $('inboxList'); if (!host) return;
    const profile = me();
    const rows = state.rows.filter((c) => {
      if (state.filter === 'unread' && (c.admin_unread_count || 0) === 0) return false;
      if (state.filter === 'mine') {
        // 'Mine' = conversations the current admin would be notified on. We
        // approximate by checking the assignment join via the dashboard's
        // assignment map — but inbox.js doesn't load that. Simpler heuristic:
        // owner sees all; other admins see only conversations with an active
        // assignment to themselves OR an explicit subscribe override.
        if (profile?.role === 'owner') return true;
        // Without an assignments cache here, fall back to 'all' for now and
        // let the badge truth-of-record be the server-side subscription
        // resolver in notify-new-message.
        return true;
      }
      if (!state.search) return true;
      const hay = [c.submission?.studio_name, c.submission?.contact_email, c.subject].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(state.search);
    });

    if (!rows.length) {
      host.innerHTML = `<div class="adm-empty" style="padding:40px 0;">${state.filter === 'unread' ? 'Nothing unread — you are caught up.' : 'No conversations match.'}</div>`;
      return;
    }

    host.innerHTML = rows.map((c) => {
      const studio = c.submission?.studio_name || c.submission?.contact_email || 'Untitled studio';
      const when = relTime(c.last_message_at);
      const unread = c.admin_unread_count || 0;
      const unreadBadge = unread > 0 ? `<span class="inbox-unread-pill" aria-label="${unread} unread">${unread}</span>` : '';
      const plan = c.submission?.plan || '';
      const planLabel = ({ launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' })[plan] || '';
      return `
        <div class="inbox-row" data-sub-id="${escapeHtml(c.submission_id)}" data-conv-id="${escapeHtml(c.id)}" tabindex="0" role="button">
          <div class="inbox-row-main">
            <div class="inbox-row-line1">
              <span class="inbox-studio">${escapeHtml(studio)}</span>
              ${planLabel ? `<span class="bdg bdg-plan-${plan}">${escapeHtml(planLabel)}</span>` : ''}
              ${unreadBadge}
            </div>
            <div class="inbox-row-line2">${escapeHtml(c.subject || 'Conversation')}</div>
          </div>
          <div class="inbox-row-when">${escapeHtml(when)}</div>
        </div>`;
    }).join('');
  }

  // ----------------------------------------------------------------------
  // Per-thread view (rendered inside the per-studio detail panel)
  // ----------------------------------------------------------------------
  function renderThread(host, conv, studioName) {
    host.setAttribute('data-inbox-thread-host', '1');
    const msgs = state.threadMessages;
    const rows = msgs.map(renderMsg).join('') || `<div class="adm-empty" style="padding:24px 0;">No messages yet. Start the conversation below.</div>`;
    host.innerHTML = `
      <div class="thread-wrap">
        <div class="thread-hdr">
          <div>
            <div class="thread-title">${escapeHtml(conv.subject || `Conversation with ${studioName}`)}</div>
            <div class="thread-sub">Replies by email route to <code>reply+${escapeHtml(conv.id)}@inbox.studiolabgrowth.com</code></div>
          </div>
          <div class="thread-actions">
            <button type="button" class="btn-link" data-act="copy-reply" title="Copy reply address">⧉ Copy reply address</button>
          </div>
        </div>
        <div class="thread-msgs" id="threadMsgs">${rows}</div>
        <form class="thread-compose" id="threadCompose" novalidate>
          <textarea id="composeBody" rows="4" placeholder="Type your reply… (Cmd/Ctrl-Enter to send)"></textarea>
          <div class="compose-files" id="composeFiles"></div>
          <div class="compose-bar">
            <label class="compose-internal" title="Internal notes are visible to admins only. The studio never sees them or gets notified.">
              <input type="checkbox" id="composeInternal"> Internal note
            </label>
            <label class="compose-attach" title="Attach up to ${ATT_MAX_FILES_PER_MESSAGE} files, ${ATT_MAX_BYTES / 1024 / 1024} MB each. Accepted: PDF, PNG, JPG, SVG, DOCX, DOC, XLSX, XLS.">
              📎 Attach
              <input type="file" id="composeFileInput" multiple accept="${ATT_ACCEPT_ATTR}" style="display:none">
            </label>
            <div class="compose-spacer"></div>
            <span class="compose-err" id="composeErr" role="alert"></span>
            <button type="submit" class="btn btn-p" id="composeSend">Send</button>
          </div>
        </form>
      </div>`;
    host.querySelector('[data-act="copy-reply"]').addEventListener('click', () => {
      const addr = `reply+${conv.id}@inbox.studiolabgrowth.com`;
      navigator.clipboard?.writeText(addr);
    });
    const form = host.querySelector('#threadCompose');
    const ta = host.querySelector('#composeBody');
    const fileInput = host.querySelector('#composeFileInput');
    const fileList = host.querySelector('#composeFiles');
    let pendingFiles = [];

    function renderFileList() {
      if (!pendingFiles.length) { fileList.innerHTML = ''; return; }
      fileList.innerHTML = pendingFiles.map((f, i) => {
        const oversize = f.size > ATT_MAX_BYTES;
        return `<span class="compose-file${oversize ? ' oversize' : ''}">📎 ${escapeHtml(f.name)} <span class="compose-file-size">${formatBytes(f.size)}</span>${oversize ? ' <span class="compose-file-warn">too large</span>' : ''} <button type="button" data-rm="${i}" aria-label="Remove">×</button></span>`;
      }).join('');
    }
    fileInput.addEventListener('change', () => {
      const errEl = host.querySelector('#composeErr');
      const cap = ATT_MAX_FILES_PER_MESSAGE - pendingFiles.length;
      const picked = Array.from(fileInput.files || []);
      if (cap <= 0) {
        errEl.textContent = `You've hit the ${ATT_MAX_FILES_PER_MESSAGE}-file limit. Remove one to add another.`;
      } else if (picked.length > cap) {
        errEl.textContent = `Only ${cap} more file${cap === 1 ? '' : 's'} fit before the ${ATT_MAX_FILES_PER_MESSAGE}-file limit.`;
      } else {
        errEl.textContent = '';
      }
      for (const f of picked.slice(0, Math.max(cap, 0))) pendingFiles.push(f);
      fileInput.value = '';
      renderFileList();
    });
    fileList.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (!rm) return;
      pendingFiles.splice(Number(rm.dataset.rm), 1);
      renderFileList();
    });

    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = host.querySelector('#composeErr');
      const btn = host.querySelector('#composeSend');
      errEl.textContent = '';
      const body = ta.value;
      const internal = host.querySelector('#composeInternal').checked;
      if (!body.trim() && !pendingFiles.length) { errEl.textContent = 'Type a message or attach a file first.'; return; }
      const oversize = pendingFiles.find((f) => f.size > ATT_MAX_BYTES);
      if (oversize) {
        errEl.textContent = `"${oversize.name}" is over the ${ATT_MAX_BYTES / 1024 / 1024} MB limit. Compress it or send a download link instead.`;
        return;
      }
      if (pendingFiles.length > ATT_MAX_FILES_PER_MESSAGE) {
        errEl.textContent = `You can attach up to ${ATT_MAX_FILES_PER_MESSAGE} files per message. Remove a few and try again.`;
        return;
      }
      btn.disabled = true;
      const res = await sendMessage(conv.id, body, { internal });
      if (!res.ok) { btn.disabled = false; errEl.textContent = res.error; return; }
      // Upload attachments after the message exists so we have its id.
      if (pendingFiles.length) {
        const submissionId = conv.submission_id;
        if (!submissionId) {
          errEl.textContent = 'Message sent, but attachments could not upload — missing submission link. Please refresh and try again.';
        } else {
          const upErr = await uploadAttachments(submissionId, res.id, pendingFiles);
          if (upErr) {
            errEl.textContent = 'Message sent, but one or more attachments failed to upload: ' + upErr;
          }
        }
      }
      btn.disabled = false;
      ta.value = '';
      pendingFiles = [];
      host.querySelector('#composeInternal').checked = false;
      renderFileList();
      await loadThread(conv.id);
      renderThread(host, conv, studioName);
      scrollMsgsToBottom();
    });

    // Click an attachment chip → mint a signed URL and open it. Two sources:
    // legacy message_attachments downloads direct from Storage; new
    // submission_attachments routes through get-attachment-download-url so
    // the bucket stays private.
    host.querySelectorAll('.msg-att[data-att-source]').forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        const source = el.getAttribute('data-att-source');
        if (source === 'submission') {
          const id = el.getAttribute('data-att-id');
          const url = await getSubmissionAttachmentUrl(id);
          if (!url) { alert('Could not generate download link.'); return; }
          window.open(url, '_blank', 'noopener');
        } else {
          const path = el.getAttribute('data-storage-path');
          const { data, error } = await sb().storage.from('message-attachments').createSignedUrl(path, 600);
          if (error || !data?.signedUrl) { alert('Could not generate download link.'); return; }
          window.open(data.signedUrl, '_blank', 'noopener');
        }
      });
    });
    scrollMsgsToBottom();
  }

  // POSTs each pending file to upload-submission-attachment with the admin
  // JWT. The edge function enforces the per-message file cap, mime allowlist,
  // size cap, and bucket placement; the metadata row is created server-side
  // so retention triggers and cleanup-attachments cron pick up these files
  // automatically (matches the studio + form-side flows).
  async function uploadAttachments(submissionId, messageId, files) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/upload-submission-attachment';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    const anonKey = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '';
    const failures = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('submission_id', submissionId);
      fd.append('message_id', messageId);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': jwt ? `Bearer ${jwt}` : '',
            'apikey': anonKey,
          },
          body: fd,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data?.ok) {
          failures.push(`${file.name}${data?.error ? ` (${data.error})` : ''}`);
        }
      } catch (err) {
        console.error('attachment upload failed:', err);
        failures.push(file.name);
      }
    }
    return failures.length ? failures.join(', ') : null;
  }

  async function getSubmissionAttachmentUrl(attachmentId) {
    const url = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) + '/functions/v1/get-attachment-download-url';
    const jwt = localStorage.getItem(window.ADMIN_JWT_KEY || 'sl-admin-jwt');
    const anonKey = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || '';
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': jwt ? `Bearer ${jwt}` : '',
          'apikey': anonKey,
        },
        body: JSON.stringify({ attachment_id: attachmentId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok || !data.url) return null;
      return data.url;
    } catch (err) {
      console.error('download attachment failed:', err);
      return null;
    }
  }

  function scrollMsgsToBottom() {
    const el = document.getElementById('threadMsgs');
    if (el) el.scrollTop = el.scrollHeight;
  }

  function renderMsg(m) {
    const role = m.sender_role;
    const isInternal = m.visibility === 'internal';
    const side = role === 'admin' ? 'right' : (role === 'system' ? 'system' : 'left');
    const cls = `msg msg-${side}${isInternal ? ' msg-internal' : ''}${role === 'system' ? ' msg-system' : ''}`;
    const who = role === 'admin' ? (m.sender_name || 'Admin') : (role === 'system' ? 'System' : (m.sender_name || m.sender_email || 'Studio'));
    const ts = new Date(m.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' });
    const body = m.body_html || textToHtml(m.body_text || '');
    const atts = (m._attachments || []).map((a) => {
      const isNew = a.source === 'submission';
      const ref = isNew
        ? `data-att-source="submission" data-att-id="${escapeHtml(a.id)}"`
        : `data-att-source="legacy" data-storage-path="${escapeHtml(a.storage_path)}"`;
      return `<a class="msg-att" href="#" ${ref}>📎 ${escapeHtml(a.filename)} <span class="msg-att-size">${formatBytes(a.size_bytes)}</span></a>`;
    }).join('');
    if (role === 'system') {
      return `<div class="msg-system-row"><span class="msg-system-dot">●</span> ${body} <span class="msg-system-when">${escapeHtml(ts)}</span></div>`;
    }
    return `
      <div class="${cls}">
        <div class="msg-meta">${escapeHtml(who)}${isInternal ? ' <span class="msg-internal-tag">internal</span>' : ''} · <span class="msg-when">${escapeHtml(ts)}</span></div>
        <div class="msg-body">${body}</div>
        ${atts ? `<div class="msg-atts">${atts}</div>` : ''}
      </div>`;
  }

  function textToHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  // ----------------------------------------------------------------------
  // Top-nav badge (sum of admin_unread_count across conversations)
  // ----------------------------------------------------------------------
  function bindNav() {
    // Wire the Inbox nav button if the host page has it.
    const btn = document.getElementById('admNavInbox');
    if (btn) {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.adm-nav-link').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        openListScreen();
      });
    }
  }

  function paintNavBadge() {
    const total = getTotalUnread();
    const badge = document.getElementById('admNavInboxBadge');
    if (!badge) return;
    if (total > 0) {
      badge.textContent = String(total);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
    // Mirror to the document title so it shows in the browser tab.
    const baseTitle = 'StudioLAB Growth: Admin';
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
  }

  // ----------------------------------------------------------------------
  // Utilities
  // ----------------------------------------------------------------------
  function relTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
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

  window.AdminInbox = {
    init,
    openListScreen,
    renderThreadInto,
    getUnreadForSubmission,
    getTotalUnread,
    refreshUnreadMap,
  };
})();
