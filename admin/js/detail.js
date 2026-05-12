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
        </div>
      </div>

      <div class="det-grid">
        <div class="det-main">

          ${section('🏫 Studio details', [
            ['Studio name', fmtVal(sub.studio_name)],
            ['Legal business name', fmtVal(sub.legal_name)],
            ['Country', fmtVal(sub.country)],
            ['Time zone', fmtVal(sub.timezone)],
            ['Studio type', fmtVal(sub.studio_type)],
            ['Address', fmtVal(sub.address)],
            ['Website', sub.website ? `<a href="${ESC(sub.website)}" target="_blank" rel="noopener">${ESC(sub.website)}</a>` : empty],
            ['Support URL', sub.support_url ? `<a href="${ESC(sub.support_url)}" target="_blank" rel="noopener">${ESC(sub.support_url)}</a>` : empty],
          ])}

          ${section('👤 Primary contact', [
            ['Name', fmtVal([sub.first_name, sub.last_name].filter(Boolean).join(' '))],
            ['Email', sub.contact_email ? `<a href="mailto:${ESC(sub.contact_email)}">${ESC(sub.contact_email)}</a>` : empty],
            ['Phone', fmtVal(sub.contact_phone)],
            ['Role', fmtVal(sub.role)],
            ['StudioLAB login email', fmtVal(sub.studiolab_email)],
          ])}

          ${section('🎨 Branding', [
            ['Logo', sub.logo_url ? `<span style="font-family:monospace;font-size:11px;">${ESC(sub.logo_url)}</span>` : empty],
            ['Primary colour', colourSwatch(sub.primary_colour)],
            ['Secondary colour', colourSwatch(sub.secondary_colour)],
            ['Sign-off', fmtVal(sub.sign_off)],
            ['Email tone', fmtVal(sub.email_tone)],
            ['Footer notes', fmtVal(sub.footer_notes)],
            ['Studio description', fmtVal(sub.studio_description)],
          ])}

          ${section('✉️ Email setup', [
            ['From name', fmtVal(sub.from_name)],
            ['Reply-to', fmtVal(sub.reply_email)],
            ['Custom domain', fmtBool(sub.custom_domain)],
            ['Email domain', fmtVal(sub.email_domain)],
            ['DNS access', fmtVal(sub.dns_access)],
          ])}

          ${(isScale || isAi) ? section('💬 SMS & social', [
            ['Number preference', fmtVal(sub.sms_type)],
            ['Area code', fmtVal(sub.area_code)],
            ['Port number', fmtVal(sub.port_number)],
            ['SMS tone notes', fmtVal(sub.sms_tone)],
            ['Lead sources', fmtList(sub.lead_sources)],
          ]) : planNotice('SMS & social', 'Launch')}

          ${section('⚡ Automations', [
            ['Active season', fmtBool(sub.season_active)],
            ['Season name', fmtVal(sub.season_name)],
            ['Enrolment open', fmtVal(sub.enrol_open_date)],
            ['Billing start', fmtVal(sub.billing_start)],
            ['Season end', fmtVal(sub.season_end)],
            ['Active workflows', fmtList(sub.active_workflows)],
          ])}

          ${isAi ? section('🤖 AI knowledge base', [
            ['Studio profile', fmtVal(sub.kb_profile)],
            ['Classes & timetable', fmtVal(sub.kb_classes)],
            ['Pricing', fmtVal(sub.kb_pricing)],
            ['AI can quote prices', fmtBool(sub.kb_price_quoting)],
            ['Policies', fmtVal(sub.kb_policies)],
            ['Events', fmtVal(sub.kb_events)],
            ['FAQs', Array.isArray(sub.kb_faqs) && sub.kb_faqs.length
              ? `${sub.kb_faqs.length} Q&amp;A pairs`
              : empty, ''],
            ['Restricted topics', fmtVal(sub.kb_restricted)],
            ['AI tone', fmtVal(sub.kb_tone)],
            ['Voice agent hours', fmtVal(sub.voice_hours)],
            ['Voice escalation', fmtVal(sub.voice_escalate)],
          ]) : planNotice('AI knowledge base', isLaunch ? 'Launch' : 'Scale')}

          ${sub.extra_notes ? section('📝 Additional notes', [['Notes', ESC(sub.extra_notes)]]) : ''}
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

  // Each row is [label, renderedHtml, copyText?]. If copyText is omitted we
  // derive it from the renderedHtml by stripping tags. Empty/Not-provided
  // values get no copy button.
  function renderRow(row) {
    const [k, v, explicitCopy] = row;
    let copy;
    if (explicitCopy !== undefined) {
      copy = explicitCopy;
    } else if (typeof v === 'string') {
      // Strip HTML, decode entities, trim. Empty placeholder -> empty.
      const stripped = v.replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
      copy = (stripped && stripped !== 'Not provided') ? stripped : '';
    } else {
      copy = '';
    }
    const btn = copy
      ? `<button type="button" class="copy-btn" data-copy="${ESC(copy)}" aria-label="Copy ${ESC(k)}"><span class="copy-btn-ico" aria-hidden="true">⧉</span>Copy</button>`
      : '';
    return `<div class="det-row"><dt>${ESC(k)}</dt><dd><span class="det-val">${v}</span>${btn}</dd></div>`;
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

  // Single delegated copy handler covers every .copy-btn in the detail view.
  document.addEventListener('click', handleCopyClick);

  window.AdminDetail = {
    open,
    refresh: () => current && open(current.id),
    getCurrent: () => current,
  };
})();
