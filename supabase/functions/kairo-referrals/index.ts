// PROUDLY KAIRO notifications (recognition only: no money, no prizes).
// Called only with TECHMED's shared notify secret (pg_cron / an operator):
//   POST {action: "tick"}                       every 10 min: award badges from learning records, then push + email each new badge once
//   POST {action: "launch", dry_run?: true}     one-time programme announcement: push to every subscribed device and a personal
//                                               email (with the student's own link) to every signed-up student. Runs once only.
import { createClient } from "jsr:@supabase/supabase-js@2";

const APP = "https://kairo.techmedng.com";
const ONESIGNAL_APP = "5983fe20-b980-4991-ab88-9bb3a1994bd2";
const ONESIGNAL_KEY = Deno.env.get("KAIRO_ONESIGNAL_REST_KEY") || "";
const RESEND = Deno.env.get("TECHMED_RESEND_API_KEY") || "";
const FROM = "KAIRO by TECHMED <hello@auth.techmedng.com>";
const REPLY_TO = "admissions@techmedng.com";
const ICON = `${APP}/icons/icon-192.png`;
const LAUNCH_KEY = "kairo:referral-launch";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => (n <= 10 ? WORDS[n] : String(n));

async function push(body: Record<string, unknown>) {
  if (!ONESIGNAL_KEY) return { ok: false, out: { error: "no key" } };
  const r = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${ONESIGNAL_KEY}` },
    body: JSON.stringify({ app_id: ONESIGNAL_APP, target_channel: "push", chrome_web_icon: ICON, priority: 10, ...body }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || (out as { errors?: unknown }).errors) console.error("[kairo-referrals] push", r.status, JSON.stringify(out).slice(0, 300));
  return { ok: r.ok, out };
}

async function email(to: string, subject: string, html: string) {
  if (!RESEND) throw new Error("no resend key");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

function shell(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#F8F9FA;font-family:Arial,sans-serif;color:#012748">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="background:#012748;color:#fff;border-radius:14px 14px 0 0;padding:18px 22px">
  <div style="font-weight:800;letter-spacing:.14em;font-size:13px;color:#C9A227">PROUDLY KAIRO</div>
  <div style="font-size:12px;letter-spacing:.2em;color:#98B0C4;margin-top:4px">LEARN. REFER. INSPIRE.</div>
</div>
<div style="background:#fff;border-radius:0 0 14px 14px;padding:22px;border:1px solid #e3e8ee;border-top:0">
<h1 style="font-size:21px;margin:0 0 12px;color:#012748">${title}</h1>${body}
<p style="font-size:12px;color:#6C87A0;margin-top:26px">Proudly KAIRO is recognition only: badges, status and leaderboards. No cash, data or prizes, ever.<br>
You get this because you have a KAIRO account. Reply "STOP" to stop KAIRO announcements.</p>
</div></div></body></html>`;
}
const btn = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${href}" style="background:#C9A227;color:#012748;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${label}</a></p>`;

// ───────────── badge earned ─────────────
function badgeCopy(title: string, n: number) {
  const name = title.toUpperCase();
  return {
    push: { title: `🛡️ You unlocked ${name}`, body: `${count(n)} ${n === 1 ? "student has" : "students have"} joined KAIRO and started learning through you. Respect. 🙌` },
    subject: `You just earned the ${name} badge 🛡️`,
    html: (first: string | null) => shell(`Congratulations${first ? `, ${esc(first)}` : ""}! You’re now a ${esc(name)}.`, `
<p>${count(n)} ${n === 1 ? "student has" : "students have"} joined KAIRO and started learning through your referrals. That’s real impact: you helped someone take their UTME prep seriously.</p>
<p>Your new badge is live on your profile and next to your name on the leaderboards.</p>
${btn(`${APP}/referrals`, "See your badge")}
<p style="margin-bottom:0">Keep putting people on. 💛<br><b>Team KAIRO</b></p>`),
  };
}

async function tick() {
  const { data, error } = await admin.schema("cbt").rpc("referral_tick");
  if (error) throw new Error(error.message);
  type Notice = { user_id: string; badge_code: string; title: string; goal: number; activated: number; email: string | null; first_name: string | null; needs_push: boolean; needs_email: boolean };
  const list = (data ?? []) as Notice[];
  let pushed = 0, emailed = 0;
  for (const n of list) {
    const c = badgeCopy(n.title, n.activated);
    if (n.needs_push) {
      const r = await push({ headings: { en: c.push.title }, contents: { en: c.push.body }, url: `${APP}/referrals`,
                             web_push_topic: `kairo-ref-${n.badge_code}`, ttl: 3 * 86400, include_aliases: { external_id: [n.user_id] } });
      // Recorded either way: a student without push on this phone will still see it in the app.
      await admin.schema("cbt").rpc("referral_notice_done", { p_user: n.user_id, p_code: n.badge_code, p_channel: "push" });
      if (r.ok) pushed++;
    }
    if (n.needs_email) {
      try { if (n.email) { await email(n.email, c.subject, c.html(n.first_name)); emailed++; await sleep(600); } }
      catch (e) { console.error("[kairo-referrals] email", (e as Error).message); continue; }   // retried next tick
      await admin.schema("cbt").rpc("referral_notice_done", { p_user: n.user_id, p_code: n.badge_code, p_channel: "email" });
    }
  }
  return { notices: list.length, pushed, emailed };
}

// ───────────── launch announcement (once) ─────────────
const LAUNCH_PUSH = {
  title: "🛡️ NEW: Proudly KAIRO",
  body: "Put your friends on to KAIRO and unlock 6 elite badges, from Proud KAIRO User to KAIRO Icon. Your squad, your legacy. 👑",
};
function launchEmail(first: string | null, link: string, code: string) {
  return shell(`${first ? `${esc(first)}, ` : ""}your squad needs KAIRO. 👀`, `
<p>You already know KAIRO: free JAMB CBT practice, 13,000+ past questions, no activation code, no PIN. Now you can bring your friends along and get the credit for it.</p>
<p style="font-weight:700;margin:18px 0 6px">Introducing PROUDLY KAIRO 🛡️</p>
<p style="margin:0 0 10px">Every friend who signs up with your link and finishes their first practice (10+ questions) counts. Hit the milestones, unlock the badges:</p>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 0">⭐ <b>Proud KAIRO User</b></td><td style="text-align:right;color:#09476E">1 friend</td></tr>
<tr><td style="padding:6px 0">🌿 <b>KAIRO Advocate</b></td><td style="text-align:right;color:#09476E">3 friends</td></tr>
<tr><td style="padding:6px 0">🎖️ <b>KAIRO Ambassador</b></td><td style="text-align:right;color:#09476E">5 friends</td></tr>
<tr><td style="padding:6px 0">🏆 <b>KAIRO Champion</b></td><td style="text-align:right;color:#09476E">10 friends</td></tr>
<tr><td style="padding:6px 0">🏅 <b>KAIRO Legend</b></td><td style="text-align:right;color:#09476E">25 friends</td></tr>
<tr><td style="padding:6px 0">💎 <b>KAIRO Icon</b></td><td style="text-align:right;color:#09476E">50 friends</td></tr>
</table>
<p>Your badge shows on your profile and beside your name on the leaderboards, and the top referrers headline the new <b>KAIRO Ambassadors</b> board.</p>
<p style="background:#F2F6F9;border-radius:10px;padding:12px 14px;margin:16px 0">Your link: <a href="${link}" style="color:#09476E;font-weight:700">${esc(link)}</a><br>Your code: <b style="letter-spacing:.08em">${esc(code)}</b></p>
${btn(`${APP}/referrals`, "Get your link and start")}
<p style="margin-bottom:0">Learn. Refer. Inspire. 💛<br><b>Team KAIRO</b></p>`);
}

async function launch(dryRun: boolean) {
  const { data: done } = await admin.schema("cbt").from("push_log").select("key").eq("key", LAUNCH_KEY).maybeSingle();
  if (done) return { skipped: "already sent" };
  const { data, error } = await admin.schema("cbt").rpc("referral_launch_audience");
  if (error) throw new Error(error.message);
  const people = (data ?? []) as { user_id: string; email: string; first_name: string | null; code: string }[];
  if (dryRun) return { dry_run: true, emails: people.length, sample: people.slice(0, 2).map((p) => ({ first_name: p.first_name, code: p.code })), push: LAUNCH_PUSH };
  // Record first, so a retry can never send it twice.
  const { error: e2 } = await admin.schema("cbt").rpc("kairo_push_done", { p_key: LAUNCH_KEY, p_audience: 0, p_detail: { started: new Date().toISOString(), emails: people.length } });
  if (e2) throw new Error(e2.message);
  const p = await push({ headings: { en: LAUNCH_PUSH.title }, contents: { en: LAUNCH_PUSH.body }, url: `${APP}/referrals`,
                         web_push_topic: "kairo-referral-launch", ttl: 2 * 86400, included_segments: ["Total Subscriptions"] });
  let sent = 0; const failed: string[] = [];
  for (const s of people) {
    const link = `${APP}/r/${s.code}`;
    try { await email(s.email, "Introducing PROUDLY KAIRO 🛡️ Learn. Refer. Inspire.", launchEmail(s.first_name, link, s.code)); sent++; }
    catch (e) { failed.push(s.user_id); console.error("[kairo-referrals] launch email", (e as Error).message); }
    await sleep(600);   // stay under Resend's rate limit
  }
  return { push_ok: p.ok, push_id: (p.out as { id?: string }).id ?? null, emails_sent: sent, emails_failed: failed.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "notify_hook_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-techmed-notify") !== secret.value) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({})) as { action?: string; dry_run?: boolean };
  try {
    if (body.action === "tick") return json(await tick());
    if (body.action === "launch") return json(await launch(!!body.dry_run));
    return json({ error: "bad_action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
