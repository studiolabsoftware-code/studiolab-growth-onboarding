/* Admin Users page: list / invite / deactivate / reactivate / change role.
   Reads from admin_users directly (RLS allows authenticated select). Writes
   go through the manage-admin-users edge function which enforces owner-only.
*/

(function () {
  'use strict';

  const sb = () => window.AdminAuth?.sb;
  const $ = (id) => document.getElementById(id);

  const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', va: 'VA' };
  let rows = [];
  let bound = false;

  async function show() {
    bind();
    await load();
  }

  function bind() {
    if (bound) return;
    bound = true;

    $('usersInviteBtn').addEventListener('click', openInvite);
    $('inviteSend').addEventListener('click', submitInvite);

    document.body.addEventListener('click', (e) => {
      const close = e.target.closest('[data-action="close-invite"]');
      if (close) { closeInvite(); return; }
      const act = e.target.closest('[data-user-action]');
      if (act) handleAction(act);
    });
  }

  async function load() {
    const client = sb(); if (!client) return;
    const { data, error } = await client
      .from('admin_users')
      .select('id, email, name, role, is_active, email_notifications_enabled, last_login_at, created_at')
      .order('created_at', { ascending: true });
    if (error) {
      $('usersTbody').innerHTML = `<tr><td colspan="6" class="adm-empty">Could not load users: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    rows = data || [];
    render();
  }

  function render() {
    const me = window.AdminAuth?.profile;
    const canManage = me?.role === 'owner';
    const tbody = $('usersTbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="adm-empty">No admin users yet.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const isSelf = me && r.id === me.id;
      const lastLogin = r.last_login_at
        ? new Date(r.last_login_at).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })
        : '—';
      const statusBdg = r.is_active
        ? '<span class="bdg bdg-active">Active</span>'
        : '<span class="bdg bdg-inactive">Inactive</span>';
      // Notifications toggle. Owners can flip anyone's; non-owners can
      // only flip their own. The button is rendered enabled / disabled
      // accordingly so the affordance matches the permission.
      const notifOn = r.email_notifications_enabled !== false;
      const canToggleNotif = canManage || isSelf;
      const notifBdg = canToggleNotif
        ? `<button class="bdg ${notifOn ? 'bdg-notif-on' : 'bdg-notif-off'} bdg-clickable" data-user-action="toggle_notif" data-id="${r.id}" data-enabled="${notifOn}" title="${notifOn ? 'Receiving emails — click to mute' : 'Muted — click to resume'}">${notifOn ? 'On' : 'Off'}</button>`
        : `<span class="bdg ${notifOn ? 'bdg-notif-on' : 'bdg-notif-off'}">${notifOn ? 'On' : 'Off'}</span>`;
      const actions = canManage ? renderActions(r, isSelf) : (isSelf ? `<button class="btn-link" data-user-action="edit" data-id="${r.id}">Edit my profile</button>` : '');
      return `
        <tr>
          <td class="studio-cell">${escapeHtml(r.name)}${isSelf ? ' <span class="user-you">(you)</span>' : ''}</td>
          <td>${escapeHtml(r.email)}</td>
          <td><span class="bdg bdg-role-${r.role}">${ROLE_LABEL[r.role] || r.role}</span></td>
          <td>${statusBdg}</td>
          <td>${notifBdg}</td>
          <td class="muted">${escapeHtml(lastLogin)}</td>
          <td class="user-actions">${actions}</td>
        </tr>`;
    }).join('');
  }

  function renderActions(r, isSelf) {
    const parts = [];
    parts.push(`<button class="btn-link" data-user-action="edit" data-id="${r.id}">Edit</button>`);
    if (isSelf) return parts.join('');
    parts.push(`<button class="btn-link" data-user-action="resend" data-id="${r.id}">Resend invite</button>`);
    if (r.is_active) {
      parts.push(`<button class="btn-link" data-user-action="deactivate" data-id="${r.id}">Deactivate</button>`);
    } else {
      parts.push(`<button class="btn-link" data-user-action="reactivate" data-id="${r.id}">Reactivate</button>`);
    }
    parts.push(`<button class="btn-link" data-user-action="role" data-id="${r.id}" data-role="${r.role}">Change role</button>`);
    return parts.join('');
  }

  async function handleAction(btn) {
    const action = btn.dataset.userAction;
    const id = btn.dataset.id;
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (!row) return;

    if (action === 'edit') { await openEdit(row); return; }

    if (action === 'toggle_notif') {
      // Optimistic: flip the pill immediately, server-call rolls it
      // back if the request fails. Owners can toggle anyone; non-owners
      // can only toggle themselves (server-enforced too).
      const wasEnabled = btn.getAttribute('data-enabled') === 'true';
      const nextEnabled = !wasEnabled;
      btn.disabled = true;
      const r = await callFn('manage-admin-users', { action: 'set_notifications', id, enabled: nextEnabled });
      btn.disabled = false;
      if (!r.ok) {
        await window.AdminModal.alert({
          title: 'Could not update notifications',
          message: escapeHtml(r.error || 'Unknown error.'),
        });
        return;
      }
      // Patch local state then re-render so the pill class + tooltip
      // refresh without a full server round-trip.
      row.email_notifications_enabled = nextEnabled;
      render();
      return;
    }

    if (action === 'resend') {
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Sending...';
      const r = await callFn('manage-admin-users', { action: 'resend_invite', id });
      btn.disabled = false; btn.textContent = orig;
      if (!r.ok) { await window.AdminModal.alert({ title: 'Could not resend', message: escapeHtml(r.error || 'Unknown error.') }); return; }
      await window.AdminModal.alert({ title: 'Invite sent', message: `Invite resent to <strong>${escapeHtml(row.email)}</strong>.` });
      return;
    }

    if (action === 'deactivate') {
      const ok = await window.AdminModal.confirm({
        title: 'Deactivate user?',
        message: `<p>Deactivate <strong>${escapeHtml(row.name)}</strong>? They will no longer be able to sign in.</p>`,
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
      const r = await callFn('manage-admin-users', { action: 'set_active', id, is_active: false });
      if (!r.ok) { await window.AdminModal.alert({ title: 'Failed', message: escapeHtml(r.error || 'Unknown error.') }); return; }
      await load();
      return;
    }

    if (action === 'reactivate') {
      const r = await callFn('manage-admin-users', { action: 'set_active', id, is_active: true });
      if (!r.ok) { await window.AdminModal.alert({ title: 'Failed', message: escapeHtml(r.error || 'Unknown error.') }); return; }
      await load();
      return;
    }

    if (action === 'role') {
      const next = await window.AdminModal.prompt({
        title: 'Change role',
        message: `Set a new role for <strong>${escapeHtml(row.name)}</strong>.`,
        value: row.role,
        confirmLabel: 'Save role',
        options: [
          { value: 'va', label: 'VA — only sees assigned submissions' },
          { value: 'admin', label: 'Admin — sees all submissions' },
          { value: 'owner', label: 'Owner — full access, can manage users' },
        ],
      });
      if (!next || next === row.role) return;
      const r = await callFn('manage-admin-users', { action: 'set_role', id, role: next });
      if (!r.ok) { await window.AdminModal.alert({ title: 'Failed', message: escapeHtml(r.error || 'Unknown error.') }); return; }
      await load();
      return;
    }
  }

  // Edit a single admin row. Owners can edit anyone (name/email/role);
  // non-owners can only edit themselves (name/email — role is fixed). The
  // role field is also disabled when editing yourself, matching the
  // server-side guard that prevents self-role changes.
  async function openEdit(row) {
    const me = window.AdminAuth?.profile;
    const canEditRole = me?.role === 'owner' && row.id !== me.id;
    const formId = 'admEditUser_' + row.id.slice(0, 8);
    const html = `
      <div class="f"><label for="${formId}-name">Name</label>
        <input type="text" id="${formId}-name" value="${escapeHtml(row.name || '')}" maxlength="80" style="width:100%;">
      </div>
      <div class="f" style="margin-top:10px;"><label for="${formId}-email">Email address</label>
        <input type="email" id="${formId}-email" value="${escapeHtml(row.email || '')}" autocomplete="off" style="width:100%;">
      </div>
      ${canEditRole ? `
        <div class="f" style="margin-top:10px;"><label for="${formId}-role">Role</label>
          <select id="${formId}-role" style="width:100%;">
            <option value="va"${row.role === 'va' ? ' selected' : ''}>VA — only sees assigned submissions</option>
            <option value="admin"${row.role === 'admin' ? ' selected' : ''}>Admin — sees all submissions</option>
            <option value="owner"${row.role === 'owner' ? ' selected' : ''}>Owner — full access, can manage users</option>
          </select>
        </div>` : `
        <p style="font-size:12px;color:#6B7280;margin-top:10px;">Role: <strong>${escapeHtml(ROLE_LABEL[row.role] || row.role)}</strong>${row.id === me?.id ? ' (owners cannot change their own role — ask another owner)' : ''}</p>`}
      <p id="${formId}-err" style="color:#B91C1C;font-size:12px;margin-top:8px;display:none;"></p>
    `;
    const ok = await window.AdminModal.confirm({
      title: row.id === me?.id ? 'Edit my profile' : 'Edit ' + (row.name || 'user'),
      message: html,
      confirmLabel: 'Save changes',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    const nameEl = document.getElementById(`${formId}-name`);
    const emailEl = document.getElementById(`${formId}-email`);
    const roleEl = document.getElementById(`${formId}-role`);
    const errEl = document.getElementById(`${formId}-err`);
    const name = (nameEl?.value || '').trim();
    const email = (emailEl?.value || '').trim().toLowerCase();
    const role = roleEl ? roleEl.value : row.role;
    if (!name) {
      await window.AdminModal.alert({ title: 'Name required', message: 'Please enter a name.' });
      return openEdit(row);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await window.AdminModal.alert({ title: 'Invalid email', message: 'Please enter a valid email address.' });
      return openEdit(row);
    }
    const payload = { action: 'update_user', id: row.id, name, email };
    if (canEditRole) payload.role = role;
    const r = await callFn('manage-admin-users', payload);
    if (!r.ok) {
      await window.AdminModal.alert({ title: 'Could not update', message: escapeHtml(r.error || 'Unknown error.') });
      return;
    }
    const emailChanged = !!(r.data && r.data.email_changed);
    const wasSelf = row.id === me?.id;
    await load();
    if (emailChanged && wasSelf) {
      await window.AdminModal.alert({
        title: 'Email updated',
        message: `Your admin email is now <strong>${escapeHtml(email)}</strong>. Sign out and sign back in with the new address to refresh your session — the old sign-in keeps working until then.`,
      });
    } else if (emailChanged) {
      await window.AdminModal.alert({
        title: 'Email updated',
        message: `<strong>${escapeHtml(row.name || row.email)}</strong> now signs in with <strong>${escapeHtml(email)}</strong>. Their next sign-in OTP will go to the new address.`,
      });
    }
  }

  function openInvite() {
    $('inviteName').value = '';
    $('inviteEmail').value = '';
    $('inviteRole').value = 'va';
    setErr('inviteNameErr', '');
    setErr('inviteEmailErr', '');
    setErr('inviteErr', '');
    $('inviteModal').hidden = false;
  }
  function closeInvite() { $('inviteModal').hidden = true; }

  async function submitInvite() {
    const name = $('inviteName').value.trim();
    const email = $('inviteEmail').value.trim().toLowerCase();
    const role = $('inviteRole').value;
    setErr('inviteNameErr', ''); setErr('inviteEmailErr', ''); setErr('inviteErr', '');
    if (!name) { setErr('inviteNameErr', 'Please enter a name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('inviteEmailErr', 'Please enter a valid email.'); return; }

    const btn = $('inviteSend');
    const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Sending...';
    const r = await callFn('manage-admin-users', { action: 'invite', name, email, role });
    btn.disabled = false; btn.textContent = orig;

    if (!r.ok) { setErr('inviteErr', r.error || 'Could not send invite.'); $('inviteErr').style.display = 'block'; return; }
    closeInvite();
    await load();
  }

  async function callFn(name, body) {
    const client = sb();
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) return { ok: false, error: error.message || String(error) };
    if (data && data.ok === false) return { ok: false, error: data.error || 'Failed.' };
    return { ok: true, data };
  }

  function setErr(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || el.textContent;
    el.style.display = msg ? 'block' : 'none';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  window.AdminUsers = { show, refresh: load };
})();
