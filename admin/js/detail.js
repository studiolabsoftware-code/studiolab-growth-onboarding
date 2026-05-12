/* Submission detail view: full record, status/assign controls, notes, activity. */

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;
  const fmt = () => window.AdminDashboard.formatters;

  const ESC = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const empty = '<span class="empty">Not provided</span>';
  // Each formatter returns the rendered HTML plus the raw clipboard string.
  // section() rows can be [label, rendered, copyableString] or [label, value]
  // where the formatter handles the copy string automatically.
  const fmtVal = (v) => (v === null || v === undefined || v === '') ? empty : ESC(v);
  const fmtBool = (v) => v === true ? 'Yes' : v === false ? 'No' : empty;
  const fmtList = (v) => Array.isArray(v) && v.length ? ESC(v.join(', ')) : empty;
  const fmtDate = (v) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : empty;
  // Raw helpers: what should land in the clipboard for each value type.
  const rawVal  = (v) => (v === null || v === undefined || v === '') ? '' : String(v);
  const rawBool = (v) => v === true ? 'Yes' : v === false ? 'No' : '';
  const rawList = (v) => Array.isArray(v) && v.length ? v.join(', ') : '';

  let current = null;

  async function open(id) {
    const client = sb(); if (!client) return;
    window.AdminDashboard.showDetail();
    const screen = document.getElementById('detailScreen');
    screen.innerHTML = '<div class="adm-empty" style="padding:60px">Loading...</div>';

    const [{ data: sub, error }, { data: notes }, { data: log }] = await Promise.all([
      client.from('submissions').select('*').eq('id', id).single(),
      client.from('admin_notes').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
      client.from('activity_log').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
    ]);
    if (error || !sub) {
      screen.innerHTML = '<div class="adm-empty">Could not load this submission.</div>';
      return;
    }
    current = sub;
    render(sub, notes || [], log || []);

    // Log a 'viewed' activity (best-effort)
    try {
      await client.from('activity_log').insert({
        submission_id: id, action: 'viewed', actor: window.AdminAuth.currentUser || 'admin',
      });
    } catch (e) { /* ignore */ }
  }

  function render(sub, notes, log) {
    const isLaunch = sub.plan === 'launch';
    const isScale = sub.plan === 'scale';
    const isAi = sub.plan === 'ai';
    const screen = document.getElementById('detailScreen');

    const { STATUS_LABEL, PLAN_LABEL, SETUP_LABEL } = fmt();
    const submitted = new Date(sub.created_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

    screen.innerHTML = `
      <button type="button" class="det-back" id="detBack">← Back to all submissions</button>

      <div class="det-head">
        <div class="det-h-info">
          <div class="det-h-name">${ESC(sub.studio_name || 'Untitled')}</div>
          <div class="det-h-meta">Submitted ${ESC(submitted)} · Ref ${ESC(String(sub.id).replace(/-/g,'').substring(0,8).toUpperCase())}</div>
          <div class="det-h-badges">
            <span class="bdg bdg-plan-${sub.plan}">${PLAN_LABEL[sub.plan] || sub.plan}</span>
            <span class="bdg bdg-setup">${SETUP_LABEL[sub.setup_type] || sub.setup_type}</span>
            <span class="bdg bdg-st-${sub.status}">${STATUS_LABEL[sub.status] || sub.status}</span>
          </div>
        </div>
        <div class="det-actions">
          <button type="button" class="btn btn-p" id="detChangeReq">Request changes</button>
          <button type="button" class="btn btn-danger" id="detDelete" title="Delete this submission">Delete</button>
        </div>
      </div>

      <div class="det-grid">
        <div class="det-main">

          ${section('🏫 Studio details', [
            ['Studio name', fmtVal(sub.studio_name), undefined, 'studio_name'],
            ['Legal business name', fmtVal(sub.legal_name), undefined, 'legal_name'],
            ['Country', fmtVal(sub.country), undefined, 'country'],
            ['Time zone', fmtVal(sub.timezone), undefined, 'timezone'],
            ['Studio type', fmtVal(sub.studio_type), undefined, 'studio_type'],
            ['Address', fmtVal(sub.address), undefined, 'address'],
            ['Website', sub.website ? `<a href="${ESC(sub.website)}" target="_blank" rel="noopener">${ESC(sub.website)}</a>` : empty, sub.website || '', 'website'],
            ['Support URL', sub.support_url ? `<a href="${ESC(sub.support_url)}" target="_blank" rel="noopener">${ESC(sub.support_url)}</a>` : empty, sub.support_url || '', 'support_url'],
          ])}

          ${section('👤 Primary contact', [
            ['First name', fmtVal(sub.first_name), undefined, 'first_name'],
            ['Last name', fmtVal(sub.last_name), undefined, 'last_name'],
            ['Email', sub.contact_email ? `<a href="mailto:${ESC(sub.contact_email)}">${ESC(sub.contact_email)}</a>` : empty, sub.contact_email || '', 'contact_email'],
            ['Phone', fmtVal(sub.contact_phone), undefined, 'contact_phone'],
            ['Role', fmtVal(sub.role), undefined, 'role'],
            ['StudioLAB login email', fmtVal(sub.studiolab_email), undefined, 'studiolab_email'],
          ])}

          ${section('🎨 Branding', [
            ['Logo', logoBlock(sub.logo_url), sub.logo_url || ''],
            ['Primary colour', colourSwatch(sub.primary_colour), sub.primary_colour || '', 'primary_colour'],
            ['Secondary colour', colourSwatch(sub.secondary_colour), sub.secondary_colour || '', 'secondary_colour'],
            ['Sign-off', fmtVal(sub.sign_off), undefined, 'sign_off'],
            ['Email tone', fmtVal(sub.email_tone), undefined, 'email_tone'],
            ['Footer notes', fmtVal(sub.footer_notes), undefined, 'footer_notes'],
            ['Studio description', fmtVal(sub.studio_description), undefined, 'studio_description'],
          ])}

          ${section('✉️ Email setup', [
            ['From name', fmtVal(sub.from_name), undefined, 'from_name'],
            ['Reply-to', fmtVal(sub.reply_email), undefined, 'reply_email'],
            ['Custom domain', fmtBool(sub.custom_domain)],
            ['Email domain', fmtVal(sub.email_domain), undefined, 'email_domain'],
            ['DNS access', fmtVal(sub.dns_access), undefined, 'dns_access'],
          ])}

          ${(isScale || isAi) ? section('💬 SMS & social', [
            ['Number preference', fmtVal(sub.sms_type), undefined, 'sms_type'],
            ['Area code', fmtVal(sub.area_code), undefined, 'area_code'],
            ['Port number', fmtVal(sub.port_number), undefined, 'port_number'],
            ['SMS tone notes', fmtVal(sub.sms_tone), undefined, 'sms_tone'],
            ['Lead sources', fmtList(sub.lead_sources)],
          ]) : planNotice('SMS & social', 'Launch')}

          ${section('⚡ Automations', [
            ['Active season', fmtBool(sub.season_active)],
            ['Season name', fmtVal(sub.season_name), undefined, 'season_name'],
            ['Enrolment open', fmtVal(sub.enrol_open_date), undefined, 'enrol_open_date'],
            ['Billing start', fmtVal(sub.billing_start), undefined, 'billing_start'],
            ['Season end', fmtVal(sub.season_end), undefined, 'season_end'],
            ['Active workflows', fmtList(sub.active_workflows)],
          ])}

          ${isAi ? section('🤖 AI knowledge base', [
            ['Studio profile', fmtVal(sub.kb_profile), undefined, 'kb_profile'],
            ['Classes & timetable', fmtVal(sub.kb_classes), undefined, 'kb_classes'],
            ['Pricing', fmtVal(sub.kb_pricing), undefined, 'kb_pricing'],
            ['AI can quote prices', fmtBool(sub.kb_price_quoting)],
            ['Policies', fmtVal(sub.kb_policies), undefined, 'kb_policies'],
            ['Events', fmtVal(sub.kb_events), undefined, 'kb_events'],
            ['FAQs', Array.isArray(sub.kb_faqs) && sub.kb_faqs.length
              ? `${sub.kb_faqs.length} Q&amp;A pairs`
              : empty, ''],
            ['Restricted topics', fmtVal(sub.kb_restricted), undefined, 'kb_restricted'],
            ['AI tone', fmtVal(sub.kb_tone), undefined, 'kb_tone'],
            ['Voice agent hours', fmtVal(sub.voice_hours), undefined, 'voice_hours'],
            ['Voice escalation', fmtVal(sub.voice_escalate), undefined, 'voice_escalate'],
          ]) : planNotice('AI knowledge base', isLaunch ? 'Launch' : 'Scale')}

          ${section('📝 Additional notes', [
            ['Notes', sub.extra_notes ? ESC(sub.extra_notes) : empty, undefined, 'extra_notes'],
          ])}
        </div>

        <div class="det-side">
          <div class="det-section">
            <div class="det-section-hdr">Manage</div>
            <div class="det-section-body">
              <div class="det-field">
                <label for="detStatus">Status</label>
                <select id="detStatus">
                  ${['submitted','in_review','changes_requested','setup_in_progress','complete'].map((s) =>
                    `<option value="${s}"${s === sub.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
                </select>
              </div>
              <div class="det-field">
                <label for="detAssign">Assigned to</label>
                <input type="text" id="detAssign" value="${ESC(sub.assigned_to || '')}" placeholder="email or name">
              </div>
            </div>
          </div>

          <div class="det-section">
            <div class="det-section-hdr">Internal notes</div>
            <div class="det-section-body">
              <textarea id="detNote" rows="3" placeholder="Add a note for the team..." style="width:100%;border:1px solid var(--g2);border-radius:8px;padding:8px;font-family:inherit;font-size:13px;resize:vertical;"></textarea>
              <button type="button" class="btn btn-p" id="detAddNote" style="margin-top:8px;width:100%;">Add note</button>
              <div class="det-notes-list" id="detNotesList" style="margin-top:12px;"></div>
            </div>
          </div>

          <div class="det-section">
            <div class="det-section-hdr">Activity</div>
            <div class="det-section-body">
              <div class="det-timeline" id="detTimeline"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    renderNotes(notes);
    renderTimeline(log);

    document.getElementById('detBack').addEventListener('click', () => window.AdminDashboard.showList());
    document.getElementById('detStatus').addEventListener('change', (e) => updateField('status', e.target.value));
    document.getElementById('detAssign').addEventListener('change', (e) => updateField('assigned_to', e.target.value || null));
    document.getElementById('detAddNote').addEventListener('click', addNote);
    document.getElementById('detChangeReq').addEventListener('click', () => window.AdminChangeRequest.open(sub));
    const delBtn = document.getElementById('detDelete');
    if (delBtn) delBtn.addEventListener('click', handleDelete);

    hydrateLogos();
  }

  async function handleDelete() {
    if (!current) return;
    const msg = `Delete submission for "${current.studio_name || current.contact_email}"? This cannot be undone.\n\nAny logo file will be removed too.`;
    if (!window.confirm(msg)) return;
    const client = sb();
    // Best-effort logo cleanup
    if (current.logo_url) {
      const [bucket, ...rest] = current.logo_url.split('/');
      try { await client.storage.from(bucket).remove([rest.join('/')]); }
      catch (e) { console.warn('logo cleanup failed:', e); }
    }
    const { error } = await client.from('submissions').delete().eq('id', current.id);
    if (error) {
      console.error('delete failed:', error);
      window.alert('Delete failed. ' + (error.message || ''));
      return;
    }
    current = null;
    if (window.AdminDashboard && window.AdminDashboard.refresh) await window.AdminDashboard.refresh();
    window.AdminDashboard.showList();
  }

  function section(title, rows) {
    return `
      <div class="det-section">
        <div class="det-section-hdr">${title}</div>
        <div class="det-section-body">
          <dl>
            ${rows.map(renderRow).join('')}
          </dl>
        </div>
      </div>`;
  }

  // Each row is [label, renderedHtml, copyText?, editField?]. copyText falls
  // back to a stripped version of renderedHtml. editField, when set, enables
  // an Edit button that swaps the value into an input/textarea inline.
  function renderRow(row) {
    const [k, v, explicitCopy, editField] = row;
    let copy;
    if (explicitCopy !== undefined) {
      copy = explicitCopy;
    } else if (typeof v === 'string') {
      const stripped = v.replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
      copy = (stripped && stripped !== 'Not provided') ? stripped : '';
    } else {
      copy = '';
    }
    const copyBtn = copy
      ? `<button type="button" class="copy-btn" data-copy="${ESC(copy)}" aria-label="Copy ${ESC(k)}"><span class="copy-btn-ico" aria-hidden="true">⧉</span>Copy</button>`
      : '';
    const editBtn = editField
      ? `<button type="button" class="edit-btn" data-edit-field="${ESC(editField)}" data-edit-label="${ESC(k)}" aria-label="Edit ${ESC(k)}"><span class="copy-btn-ico" aria-hidden="true">✎</span>Edit</button>`
      : '';
    const dataAttr = editField ? ` data-field="${ESC(editField)}"` : '';
    return `<div class="det-row"${dataAttr}><dt>${ESC(k)}</dt><dd><span class="det-val">${v}</span>${copyBtn}${editBtn}</dd></div>`;
  }

  // ── Inline edit ────────────────────────────────────────────────────────────
  function enterEditMode(rowEl) {
    if (rowEl.classList.contains('editing')) return;
    const field = rowEl.dataset.field;
    if (!field || !current) return;
    const dd = rowEl.querySelector('dd');
    const valEl = dd.querySelector('.det-val');
    if (!dd || !valEl) return;
    const raw = current[field];
    const initial = raw === null || raw === undefined ? '' : String(raw);
    const useTextarea = initial.length > 60 || /(notes|address|description|policies|profile|classes|pricing|events|restricted|tone|escalate|hours)/i.test(field);
    rowEl.classList.add('editing');
    rowEl.dataset.originalValue = initial;
    const inputHtml = useTextarea
      ? `<textarea class="edit-input" rows="${Math.min(8, Math.max(3, Math.ceil(initial.length / 60)))}">${ESC(initial)}</textarea>`
      : `<input type="text" class="edit-input" value="${ESC(initial)}">`;
    dd.innerHTML = `${inputHtml}
      <div class="edit-actions">
        <button type="button" class="btn btn-p edit-save">Save</button>
        <button type="button" class="btn btn-g edit-cancel">Cancel</button>
      </div>`;
    const inp = dd.querySelector('.edit-input');
    if (inp) {
      inp.focus();
      if (inp.tagName === 'INPUT') inp.select();
    }
  }

  async function saveEdit(rowEl) {
    const field = rowEl.dataset.field;
    if (!field || !current) return;
    const inp = rowEl.querySelector('.edit-input');
    if (!inp) return;
    const newVal = inp.value.trim();
    const original = rowEl.dataset.originalValue || '';
    if (newVal === original) { cancelEdit(rowEl); return; }
    const client = sb();
    const save = rowEl.querySelector('.edit-save');
    if (save) { save.disabled = true; save.textContent = 'Saving...'; }
    const updateValue = newVal === '' ? null : newVal;
    const { error } = await client.from('submissions').update({ [field]: updateValue, updated_at: new Date().toISOString() }).eq('id', current.id);
    if (error) {
      console.error('field update failed:', error);
      if (save) { save.disabled = false; save.textContent = 'Save'; }
      window.alert('Save failed. ' + (error.message || ''));
      return;
    }
    await client.from('activity_log').insert({
      submission_id: current.id, action: 'note_added', // closest existing enum value
      actor: window.AdminAuth.currentUser || 'admin',
      details: { field, from: original, to: updateValue, edited_by_admin: true },
    });
    current[field] = updateValue;
    open(current.id); // simplest refresh; preserves scroll
  }

  function cancelEdit(rowEl) {
    if (!rowEl || !current) return;
    rowEl.classList.remove('editing');
    open(current.id);
  }

  function handleDetailClick(e) {
    const edit = e.target.closest('.edit-btn');
    if (edit) {
      const row = edit.closest('.det-row');
      if (row) enterEditMode(row);
      return;
    }
    const save = e.target.closest('.edit-save');
    if (save) { saveEdit(save.closest('.det-row')); return; }
    const cancel = e.target.closest('.edit-cancel');
    if (cancel) { cancelEdit(cancel.closest('.det-row')); return; }
  }

  async function handleCopyClick(e) {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const text = btn.dataset.copy || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Fallback for older browsers / non-HTTPS contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* noop */ }
      document.body.removeChild(ta);
    }
    const original = btn.innerHTML;
    btn.classList.add('copied');
    btn.innerHTML = '<span class="copy-btn-ico" aria-hidden="true">✓</span>Copied';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = original;
    }, 1400);
  }

  function planNotice(name, plan) {
    return `
      <div class="det-section">
        <div class="det-section-hdr">${ESC(name)}</div>
        <div class="det-plan-notice">Not included in the ${plan} plan.</div>
      </div>`;
  }

  function colourSwatch(hex) {
    if (!hex) return empty;
    return `<span style="display:inline-flex;align-items:center;gap:8px;"><span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${ESC(hex)};border:1px solid var(--g2);"></span><span style="font-family:monospace;">${ESC(hex)}</span></span>`;
  }

  function logoBlock(path) {
    if (!path) return empty;
    return `<span class="logo-block" data-logo-path="${ESC(path)}">
      <span class="logo-preview-wrap"><span class="logo-loading">Loading preview...</span></span>
      <span class="logo-meta"><span class="logo-path">${ESC(path)}</span></span>
    </span>`;
  }

  async function hydrateLogos() {
    const client = sb();
    if (!client) return;
    const wrappers = document.querySelectorAll('.logo-block');
    for (const wrap of wrappers) {
      const path = wrap.dataset.logoPath;
      if (!path) continue;
      // logo_url stored as "logos/uuid.ext" — strip the bucket prefix
      const [bucket, ...rest] = path.split('/');
      const file = rest.join('/');
      try {
        const { data, error } = await client.storage.from(bucket).createSignedUrl(file, 3600);
        if (error || !data?.signedUrl) throw error || new Error('No signed URL');
        const preview = wrap.querySelector('.logo-preview-wrap');
        const meta = wrap.querySelector('.logo-meta');
        if (preview) preview.innerHTML = `<a href="${ESC(data.signedUrl)}" target="_blank" rel="noopener"><img src="${ESC(data.signedUrl)}" alt="Studio logo" class="logo-thumb"></a>`;
        if (meta) meta.innerHTML = `<a href="${ESC(data.signedUrl)}" target="_blank" rel="noopener" class="logo-download">Open / download</a>`;
      } catch (e) {
        const preview = wrap.querySelector('.logo-preview-wrap');
        if (preview) preview.innerHTML = '<span class="logo-loading" style="color:var(--rd);">Could not load preview</span>';
        console.warn('logo signed url failed:', e);
      }
    }
  }

  async function updateField(field, value) {
    const client = sb();
    const prev = current[field];
    current[field] = value;
    const { error } = await client.from('submissions').update({ [field]: value }).eq('id', current.id);
    if (error) {
      console.error(error);
      current[field] = prev;
      return;
    }
    const action = field === 'status' ? 'status_changed' : (field === 'assigned_to' ? 'assigned' : null);
    if (action) {
      await client.from('activity_log').insert({
        submission_id: current.id, action, actor: window.AdminAuth.currentUser || 'admin',
        details: { field, from: prev, to: value },
      });
      refreshTimeline();
    }
  }

  async function addNote() {
    const ta = document.getElementById('detNote');
    const content = (ta.value || '').trim();
    if (!content) return;
    const client = sb();
    await client.from('admin_notes').insert({
      submission_id: current.id, content,
      created_by: window.AdminAuth.currentUser || 'admin',
    });
    await client.from('activity_log').insert({
      submission_id: current.id, action: 'note_added',
      actor: window.AdminAuth.currentUser || 'admin',
    });
    ta.value = '';
    const { data: notes } = await client.from('admin_notes').select('*').eq('submission_id', current.id).order('created_at', { ascending: false });
    renderNotes(notes || []);
    refreshTimeline();
  }

  async function refreshTimeline() {
    const client = sb();
    const { data: log } = await client.from('activity_log').select('*').eq('submission_id', current.id).order('created_at', { ascending: false });
    renderTimeline(log || []);
  }

  function renderNotes(notes) {
    const el = document.getElementById('detNotesList');
    if (!el) return;
    if (!notes.length) { el.innerHTML = '<div class="adm-empty" style="padding:16px 0;">No notes yet.</div>'; return; }
    el.innerHTML = notes.map((n) => `
      <div class="det-note">
        <div class="det-note-meta">${ESC(n.created_by)} · ${fmtDate(n.created_at)}</div>
        <div class="det-note-body">${ESC(n.content)}</div>
      </div>`).join('');
  }

  const ACTION_LABEL = {
    submitted: 'Submission received',
    viewed: 'Viewed',
    status_changed: 'Status changed',
    change_request_sent: 'Change request sent',
    change_request_completed: 'Studio completed change request',
    note_added: 'Note added',
    assigned: 'Reassigned',
    plan_changed: 'Plan changed',
  };

  function renderTimeline(log) {
    const el = document.getElementById('detTimeline');
    if (!el) return;
    if (!log.length) { el.innerHTML = '<div class="adm-empty" style="padding:16px 0;">No activity yet.</div>'; return; }
    el.innerHTML = log.map((e) => {
      const detail = e.details ? formatDetails(e.action, e.details) : '';
      return `
        <div class="det-tl-item">
          <div class="det-tl-dot"></div>
          <div class="det-tl-body">
            <div class="det-tl-action">${ESC(ACTION_LABEL[e.action] || e.action)}</div>
            <div class="det-tl-meta">${ESC(e.actor)} · ${fmtDate(e.created_at)}${detail ? ' · ' + detail : ''}</div>
          </div>
        </div>`;
    }).join('');
  }

  function formatDetails(action, d) {
    if (action === 'status_changed' && d?.from && d?.to) return `${ESC(d.from)} → ${ESC(d.to)}`;
    if (action === 'change_request_sent' && Array.isArray(d?.fields)) return `${d.fields.length} field(s)`;
    if (action === 'change_request_completed' && Array.isArray(d?.fields_updated)) return `${d.fields_updated.length} field(s) updated`;
    return '';
  }

  // Delegated handlers for copy and inline-edit interactions across the detail view.
  document.addEventListener('click', handleCopyClick);
  document.addEventListener('click', handleDetailClick);

  window.AdminDetail = {
    open,
    refresh: () => current && open(current.id),
    getCurrent: () => current,
  };
})();
