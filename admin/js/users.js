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
      .select('id, email, name, role, is_active, last_login_at, created_at')
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
      const actions = canManage ? renderActions(r, isSelf) : '';
      return `
        <tr>
          <td class="studio-cell">${escapeHtml(r.name)}${isSelf ? ' <span class="user-you">(you)</span>' : ''}</td>
          <td>${escapeHtml(r.email)}</td>
          <td><span class="bdg bdg-role-${r.role}">${ROLE_LABEL[r.role] || r.role}</span></td>
          <td>${statusBdg}</td>
          <td class="muted">${escapeHtml(lastLogin)}</td>
          <td class="user-actions">${actions}</td>
        </tr>`;
    }).join('');
  }

  function renderActions(r, isSelf) {
    if (isSelf) return '<span class="muted" style="font-size:11px;">—</span>';
    const parts = [];
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

    if (action === 'resend') {
      btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Sending...';
      const r = await callFn('manage-admin-users', { action: 'resend_invite', id });
      btn.disabled = false; btn.textContent = orig;
      if (!r.ok) { window.alert(r.error || 'Could not resend.'); return; }
      window.alert('Invite resent to ' + row.email);
      return;
    }

    if (action === 'deactivate') {
      if (!window.confirm(`Deactivate ${row.name}? They will no longer be able to sign in.`)) return;
      const r = await callFn('manage-admin-users', { action: 'set_active', id, is_active: false });
      if (!r.ok) { window.alert(r.error || 'Failed.'); return; }
      await load();
      return;
    }

    if (action === 'reactivate') {
      const r = await callFn('manage-admin-users', { action: 'set_active', id, is_active: true });
      if (!r.ok) { window.alert(r.error || 'Failed.'); return; }
      await load();
      return;
    }

    if (action === 'role') {
      const next = window.prompt(`Change role for ${row.name}. Enter: owner, admin, or va`, row.role);
      if (!next) return;
      if (!['owner','admin','va'].includes(next.trim().toLowerCase())) {
        window.alert('Role must be owner, admin, or va.');
        return;
      }
      const r = await callFn('manage-admin-users', { action: 'set_role', id, role: next.trim().toLowerCase() });
      if (!r.ok) { window.alert(r.error || 'Failed.'); return; }
      await load();
      return;
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
