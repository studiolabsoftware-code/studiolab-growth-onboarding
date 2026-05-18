// Owner-only admin user management: invite, deactivate, reactivate, change role.
//
// The caller must be authenticated and have role='owner'. The function reads
// the caller's JWT from the Authorization header, verifies it via the Supabase
// auth API, then checks admin_users.role using the service-role client. All
// writes happen with service role so RLS does not get in the way.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { adminInvite } from '../_shared/email-templates.ts';

const VALID_ROLES = new Set(['owner', 'admin', 'va']);
const ADMIN_URL = Deno.env.get('ADMIN_PANEL_URL') || 'https://growth.studiolab.com.au/admin/';

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function getCallerProfile(req: Request) {
  const authz = req.headers.get('Authorization') || '';
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user?.email) return null;

  const email = String(userData.user.email).toLowerCase();
  const sb = adminClient();
  const { data: row } = await sb.from('admin_users')
    .select('id, email, name, role, is_active')
    .ilike('email', email)
    .maybeSingle();
  if (!row || !row.is_active) return null;
  return row;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
    if (caller.role !== 'owner') {
      return jsonResponse({ ok: false, error: 'Only the owner can manage admin users.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const sb = adminClient();

    if (action === 'invite') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim();
      const role = String(body.role || 'va');
      if (!isValidEmail(email)) return jsonResponse({ ok: false, error: 'Please enter a valid email.' }, 400);
      if (!name) return jsonResponse({ ok: false, error: 'Please enter a name.' }, 400);
      if (!VALID_ROLES.has(role)) return jsonResponse({ ok: false, error: 'Invalid role.' }, 400);

      // If already exists, reactivate + update role/name rather than error.
      const { data: existing } = await sb.from('admin_users')
        .select('id, is_active, role')
        .ilike('email', email)
        .maybeSingle();

      let userId: string;
      let wasReactivated = false;
      if (existing) {
        const { error: upErr } = await sb.from('admin_users')
          .update({ name, role, is_active: true, invited_by: caller.id })
          .eq('id', existing.id);
        if (upErr) throw upErr;
        userId = existing.id;
        wasReactivated = !existing.is_active;
      } else {
        const { data: inserted, error: insErr } = await sb.from('admin_users')
          .insert({ email, name, role, is_active: true, invited_by: caller.id })
          .select('id')
          .single();
        if (insErr) throw insErr;
        userId = inserted.id;
      }

      // Best-effort send invite email
      try {
        const tpl = adminInvite({
          inviteeName: name,
          inviterName: caller.name || 'StudioLAB',
          role,
          adminUrl: ADMIN_URL,
        });
        await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: `You have been invited to the StudioLAB Growth admin panel. Sign in at ${ADMIN_URL}` });
      } catch (mailErr) {
        console.warn('invite email failed:', mailErr);
      }

      return jsonResponse({ ok: true, id: userId, reactivated: wasReactivated, created: !existing });
    }

    if (action === 'set_notifications') {
      // Permission: owner can toggle anyone; non-owner can only toggle
      // themselves. This deliberately diverges from set_active/set_role
      // (where self-change is forbidden) because an admin opting
      // themselves out of email is a routine, low-risk self-service
      // action, not a privilege change.
      const id = String(body.id || '');
      const enabled = !!body.enabled;
      if (!id) return jsonResponse({ ok: false, error: 'Missing user id.' }, 400);
      if (id !== caller.id && caller.role !== 'owner') {
        return jsonResponse({ ok: false, error: 'Only owners can change another user\'s notifications.' }, 403);
      }
      const { error } = await sb.from('admin_users')
        .update({ email_notifications_enabled: enabled })
        .eq('id', id);
      if (error) throw error;
      return jsonResponse({ ok: true, enabled });
    }

    if (action === 'set_active' || action === 'set_role') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing user id.' }, 400);
      if (id === caller.id) {
        return jsonResponse({ ok: false, error: 'You cannot change your own role or status.' }, 400);
      }

      if (action === 'set_active') {
        const isActive = !!body.is_active;
        const { error } = await sb.from('admin_users').update({ is_active: isActive }).eq('id', id);
        if (error) throw error;
        return jsonResponse({ ok: true });
      }

      // set_role
      const role = String(body.role || '');
      if (!VALID_ROLES.has(role)) return jsonResponse({ ok: false, error: 'Invalid role.' }, 400);
      // Prevent demoting the last owner
      if (role !== 'owner') {
        const { data: target } = await sb.from('admin_users').select('role').eq('id', id).maybeSingle();
        if (target?.role === 'owner') {
          const { count } = await sb.from('admin_users')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'owner')
            .eq('is_active', true);
          if ((count || 0) <= 1) {
            return jsonResponse({ ok: false, error: 'Cannot demote the last active owner.' }, 400);
          }
        }
      }
      const { error } = await sb.from('admin_users').update({ role }).eq('id', id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (action === 'update_user') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing user id.' }, 400);
      const { data: target } = await sb.from('admin_users')
        .select('id, email, name, role')
        .eq('id', id)
        .maybeSingle();
      if (!target) return jsonResponse({ ok: false, error: 'User not found.' }, 404);

      const targetIsSelf = (id === caller.id);
      const updates: Record<string, unknown> = {};

      if (typeof body.name === 'string') {
        const n = body.name.trim();
        if (!n) return jsonResponse({ ok: false, error: 'Name cannot be empty.' }, 400);
        if (n !== target.name) updates.name = n;
      }
      if (typeof body.email === 'string') {
        const e = body.email.trim().toLowerCase();
        if (!isValidEmail(e)) return jsonResponse({ ok: false, error: 'Please enter a valid email.' }, 400);
        if (e !== String(target.email).toLowerCase()) {
          const { data: clash } = await sb.from('admin_users')
            .select('id')
            .ilike('email', e)
            .maybeSingle();
          if (clash && clash.id !== id) {
            return jsonResponse({ ok: false, error: 'Another admin user already uses this email.' }, 400);
          }
          updates.email = e;
        }
      }
      if (typeof body.role === 'string') {
        if (targetIsSelf) {
          return jsonResponse({ ok: false, error: 'You cannot change your own role.' }, 400);
        }
        if (!VALID_ROLES.has(body.role)) return jsonResponse({ ok: false, error: 'Invalid role.' }, 400);
        if (body.role !== target.role) {
          // Prevent demoting the last active owner.
          if (body.role !== 'owner' && target.role === 'owner') {
            const { count } = await sb.from('admin_users')
              .select('id', { count: 'exact', head: true })
              .eq('role', 'owner')
              .eq('is_active', true);
            if ((count || 0) <= 1) {
              return jsonResponse({ ok: false, error: 'Cannot demote the last active owner.' }, 400);
            }
          }
          updates.role = body.role;
        }
      }

      if (!Object.keys(updates).length) {
        return jsonResponse({ ok: true, no_changes: true });
      }
      const { error } = await sb.from('admin_users').update(updates).eq('id', id);
      if (error) throw error;
      return jsonResponse({
        ok: true,
        updated_fields: Object.keys(updates),
        email_changed: 'email' in updates,
        self: targetIsSelf,
      });
    }

    if (action === 'resend_invite') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing user id.' }, 400);
      const { data: row } = await sb.from('admin_users')
        .select('email, name, role, is_active')
        .eq('id', id)
        .maybeSingle();
      if (!row) return jsonResponse({ ok: false, error: 'User not found.' }, 404);
      if (!row.is_active) return jsonResponse({ ok: false, error: 'User is inactive — reactivate first.' }, 400);

      const tpl = adminInvite({
        inviteeName: row.name,
        inviterName: caller.name || 'StudioLAB',
        role: row.role,
        adminUrl: ADMIN_URL,
      });
      await sendEmail({ to: row.email, subject: tpl.subject, html: tpl.html, text: `Sign in at ${ADMIN_URL}` });
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('manage-admin-users error:', err);
    return jsonResponse({ ok: false, error: String(err?.message || err) }, 500);
  }
});
