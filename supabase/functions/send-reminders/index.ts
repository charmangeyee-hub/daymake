// Daymark — serverless push reminders.
// Invoked every minute by pg_cron. For each stored subscription it computes the
// user's LOCAL time (from their timezone) and sends any reminder whose HH:MM matches,
// once per day per tag. Works whether or not the app/browser is open.
//
// Deploy:  supabase functions deploy send-reminders --no-verify-jwt
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE, CRON_SECRET  (SUPABASE_URL + SERVICE_ROLE are auto-injected)

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails('mailto:admin@daymark.app', VAPID_PUBLIC, VAPID_PRIVATE);
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function localNow(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || '';
  let hour = g('hour');
  if (hour === '24') hour = '00';           // some runtimes report midnight as 24
  return { hhmm: `${hour}:${g('minute')}`, date: `${g('year')}-${g('month')}-${g('day')}` };
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const { data: rows, error } = await supabase.from('push_subscriptions').select('*');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0;
  for (const row of rows ?? []) {
    const { hhmm, date } = localNow(row.timezone || 'UTC');
    const lastSent: Record<string, string> = row.last_sent || {};
    let changed = false;

    for (const r of row.reminders ?? []) {
      if (r.time !== hhmm) continue;              // not this minute
      if (r.date && r.date !== date) continue;    // one-time event on another day
      if (lastSent[r.tag] === date) continue;     // already sent today

      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({ title: r.title || 'Reminder', body: r.body || '', tag: r.tag }),
        );
        lastSent[r.tag] = date; changed = true; sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {       // subscription gone → drop it
          await supabase.from('push_subscriptions').delete().eq('user_id', row.user_id);
        }
      }
    }
    if (changed) {
      await supabase.from('push_subscriptions').update({ last_sent: lastSent }).eq('user_id', row.user_id);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
});
