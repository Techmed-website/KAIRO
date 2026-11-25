// KAIRO practice notifications (OneSignal app "Kairo", kairo.techmedng.com).
// Called only by pg_cron with TECHMED's shared notify secret:
//   POST {slot: "morning" | "evening" | "enrol", dry_run?: true}
// cbt.kairo_push_plan decides the words and who gets them; this function sends them and records the send once.
// Each kind uses its own web_push_topic, so a new one replaces the previous one on the phone instead of piling up.
import { createClient } from "jsr:@supabase/supabase-js@2";

const APP_ID = "5983fe20-b980-4991-ab88-9bb3a1994bd2";
const KEY = Deno.env.get("KAIRO_ONESIGNAL_REST_KEY") || "";
const ICON = "https://kairo.techmedng.com/icons/icon-192.png";
const TTL: Record<string, number> = { morning: 12 * 3600, evening: 4 * 3600, enrol: 24 * 3600 };

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function send(body: Record<string, unknown>) {
  const r = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${KEY}` },
    body: JSON.stringify({ app_id: APP_ID, target_channel: "push", ...body }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || (out as { errors?: unknown }).errors) console.error("[kairo-push]", r.status, JSON.stringify(out).slice(0, 400));
  return { ok: r.ok, out };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "notify_hook_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-techmed-notify") !== secret.value) return json({ error: "forbidden" }, 403);
  const { slot, dry_run } = await req.json().catch(() => ({})) as { slot?: string; dry_run?: boolean };
  if (!slot || !(slot in TTL)) return json({ error: "bad_slot" }, 400);

  const { data: plan, error } = await admin.schema("cbt").rpc("kairo_push_plan", { p_slot: slot });
  if (error) return json({ error: error.message }, 500);
  if (!plan) return json({ skipped: true });
  type Group = { user_ids: string[]; title: string; body: string };
  const p = plan as { key: string; topic: string; audience: "all" | "users"; user_ids?: string[]; groups?: Group[]; title: string; body: string; url: string };
  if (dry_run) return json({ dry_run: true, plan: { ...p, user_ids: p.user_ids?.length, groups: p.groups?.map((g) => ({ ...g, user_ids: g.user_ids.length })) } });
  if (!KEY) return json({ error: "no_onesignal_key" }, 500);

  const base = { headings: { en: p.title }, contents: { en: p.body }, url: p.url, web_push_topic: p.topic,
                 chrome_web_icon: ICON, ttl: TTL[slot], priority: 10 };
  let sent = 0;
  if (p.audience === "all") {
    const r = await send({ ...base, included_segments: ["Total Subscriptions"] });
    if (r.ok) sent = Number((r.out as { recipients?: number }).recipients ?? 0);
  } else {
    // The general message, then each personalised group (e.g. "Keep your 5-day streak") with its own words.
    const batches: { ids: string[]; title: string; body: string }[] = [
      { ids: p.user_ids ?? [], title: p.title, body: p.body },
      ...(p.groups ?? []).map((g) => ({ ids: g.user_ids, title: g.title, body: g.body })),
    ];
    for (const b of batches) {
      for (let i = 0; i < b.ids.length; i += 2000) {
        const r = await send({ ...base, headings: { en: b.title }, contents: { en: b.body }, include_aliases: { external_id: b.ids.slice(i, i + 2000) } });
        if (r.ok) sent += Number((r.out as { recipients?: number }).recipients ?? 0);
      }
    }
  }
  await admin.schema("cbt").rpc("kairo_push_done", { p_key: p.key, p_audience: sent, p_detail: { title: p.title, url: p.url } });
  return json({ sent, key: p.key });
});
