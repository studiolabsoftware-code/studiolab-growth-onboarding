// Close a stalled-studio flag from the link in its email. The 24-byte token is the only authority, and the
// worst a leaked one can do is stop a reminder. It holds the flag closed until its cause clears; it never
// changes anything about the studio. GET only shows a button: mail scanners follow links, and one must not
// silence a money flag nobody read. POST closes.
import { adminClient } from '../_shared/supabase.ts';

const page = (title: string, message: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F3F7;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:#13102E}
.c{background:#fff;border:1px solid #DFE0EC;border-radius:14px;padding:34px 32px;max-width:440px;margin:24px}h1{margin:0 0 10px;font-size:21px}p{margin:0;color:#4A4C65;line-height:1.6;font-size:15px}</style>
<div class="c"><h1>${title}</h1><p>${message}</p></div>`,
  { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('done') ?? '';
  if ((req.method !== 'GET' && req.method !== 'POST') || !/^[0-9a-f]{48}$/.test(token)) return page('Link not recognised', 'That link is not valid.');
  try {
    const sb = adminClient();
    const { data: row, error } = await sb.from('setup_stall_flags').select('id, closed_at').eq('done_token', token).is('cleared_at', null).maybeSingle();
    if (error) throw error;
    if (!row) return page('Nothing to close', 'This one has already cleared.');
    if (req.method === 'GET') {
      if (row.closed_at) return page('Already done', 'This one is already marked as done.');
      return page('Mark this done?', `You will not be reminded again unless it clears and comes back.</p><form method="post" action="?done=${token}"><button style="margin-top:18px;padding:10px 18px;border-radius:8px;border:0;background:#13102E;color:#fff;font-size:15px;cursor:pointer">Mark this done</button></form><p>`);
    }
    if (!row.closed_at) {
      const { error: updateError } = await sb.from('setup_stall_flags').update({ closed_at: new Date().toISOString() }).eq('id', row.id);
      if (updateError) throw updateError;
    }
    return page('Marked as done', 'You will not be reminded about this again unless it clears and comes back.');
  } catch {
    console.error('stall-flag-done failed');
    return page('Something went wrong', 'We could not close that. Try the link again in a moment.');
  }
});
