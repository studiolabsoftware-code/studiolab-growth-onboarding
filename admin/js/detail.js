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
  let currentAssignment = null;
  let currentAssignees = [];

  const ASSIGNMENT_STATUS_LABEL = {
    assigned: 'Assigned',
    in_progress: 'In progress',
    needs_recheck: 'Needs re-check',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  async function open(id) {
    const client = sb(); if (!client) return;
    window.AdminDashboard.showDetail();
    const screen = document.getElementById('detailScreen');
    screen.innerHTML = '<div class="adm-empty" style="padding:60px">Loading...</div>';

    const [{ data: sub, error }, { data: notes }, { data: log }, { data: assignees }, { data: assignment }] = await Promise.all([
      client.from('submissions').select('*').eq('id', id).single(),
      client.from('admin_notes').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
      client.from('activity_log').select('*').eq('submission_id', id).order('created_at', { ascending: false }),
      client.from('admin_users').select('id, name, email, role, is_active').eq('is_active', true).order('name'),
      client.from('submission_assignments')
        .select('id, admin_user_id, status, assigned_at, last_sent_at, completed_at, notes')
        .eq('submission_id', id)
        .in('status', ['assigned','in_progress','needs_recheck'])
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (error || !sub) {
      screen.innerHTML = '<div class="adm-empty">Could not load this submission.</div>';
      return;
    }
    current = sub;
    currentAssignment = assignment || null;
    currentAssignees = (assignees || []).filter((a) => a.role !== 'owner' || a.is_active);
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

          ${section('⚡ Plan automations', [
            ['Included', planAutomations(sub.plan), ''],
            ['Notes', 'Activated automatically once the account is live. Timing is pulled from StudioLAB season data.', ''],
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
              ${assignmentBlock()}
              ${sheetSyncRow(sub)}
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
    bindAssignmentControls();
    document.getElementById('detAddNote').addEventListener('click', addNote);
    document.getElementById('detChangeReq').addEventListener('click', () => window.AdminChangeRequest.open(sub));
    const delBtn = document.getElementById('detDelete');
    if (delBtn) delBtn.addEventListener('click', handleDelete);
    const syncOne = document.getElementById('detSheetSync');
    if (syncOne) syncOne.addEventListener('click', syncThisToSheet);

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

  const PLAN_AUTOMATIONS = {
    launch: [
      'Abandoned Enrolment Recovery (3 emails)',
      'Re-Enrolment Campaign (6 emails)',
    ],
    scale: [
      'Abandoned Enrolment Recovery (3 emails)',
      'Abandoned Enrolment SMS',
      'Re-Enrolment Campaign (6 emails)',
      'Re-Enrolment SMS',
      'Missed Call Text-Back',
    ],
    ai: [
      'Abandoned Enrolment Recovery (3 emails)',
      'Abandoned Enrolment SMS',
      'Re-Enrolment Campaign (6 emails)',
      'Re-Enrolment SMS',
      'Missed Call Text-Back',
      'AI Chat Widget (after KB review)',
      'AI Voice Agent (after KB review)',
    ],
  };

  function planAutomations(plan) {
    const items = PLAN_AUTOMATIONS[plan] || [];
    if (!items.length) return empty;
    return '<ul style="margin:0;padding-left:18px;line-height:1.7;">' +
      items.map((i) => `<li>${ESC(i)}</li>`).join('') + '</ul>';
  }

  function assignmentBlock() {
    const profile = window.AdminAuth?.profile;
    const myRole = profile?.role || 'admin';
    const canManage = myRole === 'owner' || myRole === 'admin';
    const isAssignee = !!(profile && currentAssignment && currentAssignment.admin_user_id === profile.id);

    const a = currentAssignment;
    const assigneeName = a ? (currentAssignees.find((x) => x.id === a.admin_user_id)?.name || 'Unknown') : '';
    const statusLabel = a ? (ASSIGNMENT_STATUS_LABEL[a.status] || a.status) : 'Unassigned';
    const statusBdgClass = a ? `bdg-asgn-${a.status}` : 'bdg-asgn-none';
    const assignedAt = a?.assigned_at ? new Date(a.assigned_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

    const dropdown = canManage ? `
      <div class="det-field">
        <label for="detAssignee">Assigned to</label>
        <select id="detAssignee">
          <option value="">— Unassigned —</option>
          ${currentAssignees.map((u) => `
            <option value="${ESC(u.id)}"${a && a.admin_user_id === u.id ? ' selected' : ''}>
              ${ESC(u.name)} (${ESC(u.role)})
            </option>`).join('')}
        </select>
      </div>` : `
      <div class="det-field">
        <label>Assigned to</label>
        <div class="det-static">${a ? ESC(assigneeName) : '<span class="empty">Unassigned</span>'}</div>
      </div>`;

    const lastSent = a?.last_sent_at ? new Date(a.last_sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null;
    const statusBlock = a ? `
      <div class="det-field">
        <label>Assignment status</label>
        <div class="det-asgn-status">
          <span class="bdg ${statusBdgClass}">${ESC(statusLabel)}</span>
          <span class="det-asgn-since">since ${ESC(assignedAt)}${lastSent ? ` · handoff sent ${ESC(lastSent)}` : ''}</span>
        </div>
      </div>` : '';

    const handoffBlock = (a && canManage) ? `
      <div class="det-field det-asgn-actions">
        <label>Handoff document</label>
        <div class="det-asgn-btns">
          <button type="button" class="btn btn-p" data-asgn-action="send_handoff">
            ${a.last_sent_at ? 'Resend handoff' : 'Send handoff'}
          </button>
        </div>
        <p class="det-asgn-hint">Generates a .docx with every field and emails it to ${ESC(assigneeName)}.</p>
      </div>` : '';

    // VAs viewing their own assignment can advance the status. Admins can too.
    const showVaControls = a && (isAssignee || canManage);
    const vaControls = showVaControls ? `
      <div class="det-field det-asgn-actions">
        <label>Update assignment status</label>
        <div class="det-asgn-btns">
          ${a.status !== 'in_progress' ? '<button type="button" class="btn btn-g" data-asgn-action="in_progress">Mark in progress</button>' : ''}
          ${a.status !== 'completed' ? '<button type="button" class="btn btn-p" data-asgn-action="completed">Mark completed</button>' : ''}
          ${a.status !== 'needs_recheck' ? '<button type="button" class="btn btn-g" data-asgn-action="needs_recheck">Flag needs re-check</button>' : ''}
        </div>
      </div>` : '';

    return dropdown + statusBlock + handoffBlock + vaControls;
  }

  function bindAssignmentControls() {
    const select = document.getElementById('detAssignee');
    if (select) select.addEventListener('change', (e) => changeAssignee(e.target.value || null));
    document.querySelectorAll('[data-asgn-action]').forEach((btn) => {
      const action = btn.dataset.asgnAction;
      if (action === 'send_handoff') {
        btn.addEventListener('click', () => sendHandoff(btn));
      } else {
        btn.addEventListener('click', () => updateAssignmentStatus(action));
      }
    });
  }

  async function changeAssignee(adminUserId) {
    const client = sb();
    const profile = window.AdminAuth?.profile;

    // Unassign path: cancel the current active assignment
    if (!adminUserId) {
      if (!currentAssignment) return;
      const { error } = await client.from('submission_assignments')
        .update({ status: 'cancelled' })
        .eq('id', currentAssignment.id);
      if (error) { window.alert('Could not unassign: ' + error.message); return; }
      await client.from('submissions').update({ assigned_to: null }).eq('id', current.id);
      await client.from('activity_log').insert({
        submission_id: current.id, action: 'assigned',
        actor: window.AdminAuth.currentUser || 'admin',
        details: { from: currentAssignment.admin_user_id, to: null },
      });
      currentAssignment = null;
      await refreshAssignmentBlock();
      return;
    }

    // Assign path: insert a new active row; the BEFORE INSERT trigger cancels prior active.
    const { data: inserted, error } = await client.from('submission_assignments').insert({
      submission_id: current.id,
      admin_user_id: adminUserId,
      assigned_by: profile?.id || null,
      status: 'assigned',
    }).select('*').single();
    if (error) { window.alert('Could not assign: ' + error.message); return; }

    // Mirror to legacy free-text field so existing dashboard cards and Sheet sync keep working.
    const assignee = currentAssignees.find((u) => u.id === adminUserId);
    await client.from('submissions').update({ assigned_to: assignee?.email || null }).eq('id', current.id);

    await client.from('activity_log').insert({
      submission_id: current.id, action: 'assigned',
      actor: window.AdminAuth.currentUser || 'admin',
      details: { to: assignee?.email || null, name: assignee?.name || null },
    });
    currentAssignment = inserted;
    await refreshAssignmentBlock();
    refreshTimeline();
  }

  async function updateAssignmentStatus(nextStatus) {
    if (!currentAssignment) return;
    const client = sb();
    const profile = window.AdminAuth?.profile;
    const isVa = profile?.role === 'va';
    const isAssignee = profile && currentAssignment.admin_user_id === profile.id;

    let error = null;
    if (isVa && isAssignee) {
      // VA self-update via RPC
      const r = await client.rpc('va_update_my_assignment', {
        p_assignment_id: currentAssignment.id, p_status: nextStatus,
      });
      error = r.error;
    } else {
      // Owner/admin direct update via RLS
      const r = await client.from('submission_assignments')
        .update({ status: nextStatus })
        .eq('id', currentAssignment.id);
      error = r.error;
    }
    if (error) { window.alert('Could not update: ' + error.message); return; }

    // Refresh assignment from server (completed_at gets set by trigger)
    const { data: refreshed } = await client.from('submission_assignments')
      .select('id, admin_user_id, status, assigned_at, last_sent_at, completed_at, notes')
      .eq('id', currentAssignment.id).maybeSingle();
    currentAssignment = refreshed && (refreshed.status !== 'cancelled' && refreshed.status !== 'completed') ? refreshed : (refreshed?.status === 'completed' ? null : currentAssignment);

    // If completed, drop the legacy assigned_to field too
    if (nextStatus === 'completed') {
      await client.from('submissions').update({ assigned_to: null }).eq('id', current.id);
      currentAssignment = null;
    }

    await client.from('activity_log').insert({
      submission_id: current.id, action: 'assignment_status_changed',
      actor: window.AdminAuth.currentUser || 'admin',
      details: { to: nextStatus },
    });
    await refreshAssignmentBlock();
    refreshTimeline();
  }

  async function sendHandoff(btn) {
    if (!currentAssignment) return;
    const isResend = !!currentAssignment.last_sent_at;
    if (!window.confirm(isResend
      ? 'Resend the handoff document to the assignee?'
      : 'Generate and send the handoff document?')) return;

    const client = sb();
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const { data, error } = await client.functions.invoke('send-handoff', {
        body: { submission_id: current.id },
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || 'Send failed.');
      window.alert(`Handoff sent to ${data.sent_to}`);
      await refreshAssignmentBlock();
    } catch (err) {
      window.alert('Could not send handoff: ' + (err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  async function refreshAssignmentBlock() {
    // Re-fetch and re-render only the Manage section pieces we control.
    const client = sb();
    const { data: assignment } = await client.from('submission_assignments')
      .select('id, admin_user_id, status, assigned_at, last_sent_at, completed_at, notes')
      .eq('submission_id', current.id)
      .in('status', ['assigned','in_progress','needs_recheck'])
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentAssignment = assignment || null;
    // Re-render the whole Manage section by re-rendering the screen
    render(current, [], []);
    // Notes/timeline weren't passed — refetch them
    const [{ data: notes }, { data: log }] = await Promise.all([
      client.from('admin_notes').select('*').eq('submission_id', current.id).order('created_at', { ascending: false }),
      client.from('activity_log').select('*').eq('submission_id', current.id).order('created_at', { ascending: false }),
    ]);
    renderNotes(notes || []);
    renderTimeline(log || []);
  }

  function sheetSyncRow(sub) {
    if (sub.status === 'draft') return '';
    let label;
    let warn = false;
    if (sub.sheets_sync_error) {
      label = 'Sheet backup: last sync failed';
      warn = true;
    } else if (!sub.sheets_synced_at) {
      label = 'Sheet backup: not yet synced';
      warn = true;
    } else {
      label = 'Sheet backup: ' + timeAgo(new Date(sub.sheets_synced_at));
    }
    const title = sub.sheets_sync_error ? ESC(sub.sheets_sync_error)
      : sub.sheets_synced_at ? new Date(sub.sheets_synced_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    return `
      <div class="det-sheet-sync">
        <span class="det-sheet-sync-label${warn ? ' warn' : ''}" title="${title}">${label}</span>
        <button type="button" id="detSheetSync">↻ Sync now</button>
      </div>`;
  }

  function timeAgo(d) {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60)   return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    return Math.floor(s / 86400) + ' day' + (s >= 172800 ? 's' : '') + ' ago';
  }

  async function syncThisToSheet() {
    if (!current) return;
    const btn = document.getElementById('detSheetSync');
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      const client = sb();
      const { data, error } = await client.functions.invoke('sync-to-sheet', { body: { submission_id: current.id } });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || 'Sync failed');
      // Pull the row again so the timestamp updates.
      const { data: fresh } = await client.from('submissions').select('*').eq('id', current.id).single();
      if (fresh) { current = fresh; open(current.id); }
    } catch (err) {
      console.error('sync-to-sheet failed:', err);
      window.alert('Sheet sync failed. ' + (err.message || err));
      btn.disabled = false;
      btn.textContent = orig;
    }
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
    assignment_status_changed: 'Assignment status changed',
    handoff_sent: 'Handoff document sent',
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
