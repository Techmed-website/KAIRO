// TECHMED / KAIRO email (Resend, auth.techmedng.com). Standards: per-category opt-out, signed one-click unsubscribe
// (List-Unsubscribe + List-Unsubscribe-Post, RFC 8058), plain-text part, every send logged once per campaign.
//
//   GET/POST ?unsub=<token>        one-click unsubscribe (public; the token is signed by the database)
//   POST {action:"campaign", template, campaign, audience, category, test_to?, dry_run?}   (x-techmed-notify secret)
//        template:  class_offer
//   POST {action:"recaps", kind:"week"|"month", limit?, channels?}   weekly/monthly recap email + push, each once
//        audience:  techmed_unpaid | techmed_all | kairo_students | paid_students
//        test_to:   send one copy to this address only (personalised with sample data), nothing logged
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND = Deno.env.get("TECHMED_RESEND_API_KEY") || "";
const FROM_TECHMED = "TECHMED <hello@auth.techmedng.com>";
const FROM_KAIRO = "KAIRO by TECHMED <hello@auth.techmedng.com>";
const REPLY_TO = "admissions@techmedng.com";
const FN_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/kairo-mail`;
const APP = "https://kairo.techmedng.com";
const SITE = "https://techmedng.com";
const WA = "2347044255045";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const db = admin.schema("cbt");
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Person { user_id: string; email: string; first_name: string | null; unsub: string; unsub_all: string; paid: boolean; kairo: boolean }
interface Mail { from: string; to: string; subject: string; html: string; text: string; headers: Record<string, string> }

const unsubUrl = (token: string) => `${APP}/unsubscribe?t=${encodeURIComponent(token)}`;
const oneClick = (token: string) => `${FN_URL}?unsub=${encodeURIComponent(token)}`;
function listHeaders(p: Person) {
  return { "List-Unsubscribe": `<${oneClick(p.unsub)}>, <mailto:${REPLY_TO}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

// ───────────────────────── shared layout ─────────────────────────
function layout(o: { brand: "TECHMED" | "KAIRO"; preheader: string; body: string; p: Person; categoryLabel: string }) {
  const head = o.brand === "KAIRO"
    ? `<div style="font-weight:800;letter-spacing:.14em;font-size:13px;color:#C9A227">KAIRO</div><div style="font-size:11px;letter-spacing:.2em;color:#98B0C4;margin-top:4px">SEIZE THE MOMENT</div>`
    : `<div style="font-weight:800;letter-spacing:.14em;font-size:14px;color:#ffffff">TECHMED</div><div style="font-size:11px;letter-spacing:.2em;color:#C9A227;margin-top:4px">THINK SMART. PERFORM ELITE.</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#F1F4F7;font-family:Arial,Helvetica,sans-serif;color:#012748">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<div style="max-width:580px;margin:0 auto;padding:20px 12px">
<div style="background:#012748;border-radius:16px 16px 0 0;padding:18px 22px">${head}</div>
<div style="background:#ffffff;border-radius:0 0 16px 16px;padding:24px 22px;border:1px solid #e3e8ee;border-top:0">${o.body}</div>
<p style="font-size:12px;color:#6C87A0;text-align:center;line-height:1.6;margin:18px 8px">
TECHMED · <a href="${SITE}" style="color:#6C87A0">techmedng.com</a> · <a href="https://wa.me/${WA}" style="color:#6C87A0">WhatsApp 0704 425 5045</a><br>
You get ${esc(o.categoryLabel)} because you have a TECHMED/KAIRO account.<br>
<a href="${unsubUrl(o.p.unsub)}" style="color:#6C87A0">Unsubscribe from ${esc(o.categoryLabel)}</a> ·
<a href="${unsubUrl(o.p.unsub_all)}" style="color:#6C87A0">Unsubscribe from all emails</a> ·
<a href="${APP}/profile/notifications" style="color:#6C87A0">Email preferences</a></p>
</div></body></html>`;
}
const btn = (href: string, label: string, bg = "#C9A227", fg = "#012748") =>
  `<a href="${href}" style="display:block;text-align:center;background:${bg};color:${fg};text-decoration:none;font-weight:800;font-size:16px;padding:15px 18px;border-radius:12px;margin:10px 0">${label}</a>`;

// ───────────────────────── class offer ─────────────────────────
const OFFER_END = "Monday 7 December, 11:59 PM";
const PLANS = [
  { name: "TECHMED Core", std: 18000, now: 14400, note: "3 months · or <s>₦7,000</s> ₦5,600 monthly", perks: "Live classes 7–11 PM, Mon–Sat · 12-week curriculum · weekly CBT drills · 3 full JAMB mocks · tutor access" },
  { name: "TECHMED Mastery", std: 25000, now: 20000, note: "3 months · most popular", perks: "Everything in Core + 11 formula workbooks & mastery manuals (Mole Concept Cure, Organic Chemistry, Physics formulas…)" },
  { name: "TECHMED Ultimate", std: 40000, now: 32000, note: "one payment, covers you to UTME 2027 · best value", perks: "Everything in Mastery + 3 bootcamps (Organic 1.0, Mole Concept 2.0, Operation 100 CBT), 4 revision packages, final revision classes" },
];
function waLink(plan?: string) {
  const msg = `Hello TECHMED 👋 I want to secure my slot for the UTME 2027 classes with the 20% launch offer${plan ? ` (${plan})` : ""}.`;
  return `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`;
}
function classOffer(p: Person): Mail {
  const fn = p.first_name ? esc(p.first_name) : "Future scholar";
  const cards = PLANS.map((x) => `
<div style="border:1px solid #dfe6ec;border-radius:14px;padding:14px 16px;margin:10px 0">
  <div style="font-weight:800;font-size:16px;color:#012748">${x.name}</div>
  <div style="margin:6px 0 2px"><span style="font-size:26px;font-weight:800;color:#012748">${naira(x.now)}</span>
    <span style="font-size:15px;color:#8a99a8;text-decoration:line-through;margin-left:8px">${naira(x.std)}</span>
    <span style="background:#FDF3D7;color:#8A6A12;font-size:11px;font-weight:800;border-radius:999px;padding:3px 8px;margin-left:6px">SAVE ${naira(x.std - x.now)}</span></div>
  <div style="font-size:13px;color:#3d5a73">${x.note}</div>
  <div style="font-size:13px;color:#3d5a73;margin-top:6px">${x.perks}</div>
  <a href="${waLink(x.name)}" style="display:inline-block;margin-top:10px;color:#09476E;font-weight:800;text-decoration:none">Secure ${x.name.replace("TECHMED ", "")} on WhatsApp →</a>
</div>`).join("");
  const html = layout({ brand: "TECHMED", p, categoryLabel: "class and offer emails", preheader: `Live classes start Monday 30 Nov. 20% off every plan until ${OFFER_END}.`, body: `
<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:.12em;color:#C9A227">CLASSES START MONDAY · 30 NOVEMBER</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#012748">${fn}, your UTME 2027 run starts now. Lock in 20% off. 🔥</h1>
<p style="margin:0 0 12px;line-height:1.55">Live TECHMED classes kick off <b>Monday, 30 November, 7–11 PM</b>. Four hours of real teaching every weekday and Saturday, worked JAMB questions, weekly CBT drills and full mocks. To get you in from day one, <b>every plan is 20% off until ${OFFER_END}.</b></p>
${btn(waLink(), "Secure my slot on WhatsApp")}
<p style="text-align:center;margin:4px 0 14px;font-size:13px;color:#3d5a73">Prefer to pay online? <a href="${SITE}/pricing?utm_source=email&utm_medium=email&utm_campaign=class_launch_offer" style="color:#09476E;font-weight:700">See plans and pay securely</a> (the 20% is applied automatically).</p>
${cards}
<div style="background:#012748;color:#fff;border-radius:14px;padding:14px 16px;margin:16px 0">
  <b style="color:#C9A227">⏳ Offer ends ${OFFER_END}.</b><br><span style="font-size:14px;color:#c9d6e2">After that, prices go back to ${naira(18000)} / ${naira(25000)} / ${naira(40000)}. KAIRO practice stays free either way.</span>
</div>
${btn(waLink(), "Message us now: secure my slot")}
<p style="margin:14px 0 0;line-height:1.55">See you in class,<br><b>Wisdom &amp; the TECHMED team</b></p>`});
  const text = `${p.first_name ?? "Hi"}, TECHMED live classes start Monday 30 November (7–11 PM, Mon–Sat).
Every plan is 20% off until ${OFFER_END}:
${PLANS.map((x) => `- ${x.name}: ${naira(x.now)} (was ${naira(x.std)})`).join("\n")}
Secure your slot on WhatsApp: ${waLink()}
Or pay online: ${SITE}/pricing
Unsubscribe from class emails: ${unsubUrl(p.unsub)}`;
  return { from: FROM_TECHMED, to: p.email, subject: `Classes start Monday 🔥 20% off every TECHMED plan (ends 7 Dec)`, html, text, headers: listHeaders(p) };
}

// ───────────────────────── weekly / monthly recap ─────────────────────────
type Recap = { from: string; to: string; questions: number; prev_questions: number; correct: number; accuracy: number | null; prev_accuracy: number | null;
  minutes: number; active_days: number; day_map: boolean[] | null; sessions: number; daily_quizzes: number; mocks: number; xp: number;
  best_subject: { name: string; accuracy: number; n: number } | null; focus_topic: { name: string; code: string; accuracy: number; n: number } | null;
  strong_topic: { name: string; accuracy: number } | null; streak: { current: number; best: number }; badges: string[]; beat_pct: number | null;
  attendance: { held: number; attended: number; rate: number | null } | null };
export interface RecapPerson extends Person { kind: "week" | "month"; period_start: string; period_end: string; data: Recap }
const fmtD = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
const nf = (n: number) => n.toLocaleString("en-NG");
function delta(cur: number, prev: number, unit = "") {
  if (!prev) return cur ? `<span style="color:#17714d;font-weight:700">new this ${unit || "period"}</span>` : "";
  const d = cur - prev; const pct = Math.round((100 * d) / prev);
  return d === 0 ? `<span style="color:#6C87A0">same as before</span>`
    : `<span style="color:${d > 0 ? "#17714d" : "#b23434"};font-weight:700">${d > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs last ${unit}</span>`;
}
const tile = (big: string, label: string, sub = "") => `<td style="width:50%;padding:6px"><div style="background:#F2F6F9;border-radius:12px;padding:12px 14px">
  <div style="font-size:24px;font-weight:800;color:#012748;line-height:1.1">${big}</div><div style="font-size:13px;color:#3d5a73;margin-top:2px">${label}</div>${sub ? `<div style="font-size:12px;margin-top:4px">${sub}</div>` : ""}</div></td>`;
function recapMail(p: RecapPerson): Mail {
  const r = p.data; const week = p.kind === "week"; const unit = week ? "week" : "month";
  const period = week ? `${fmtD(p.period_start, { day: "numeric", month: "short" })} – ${fmtD(p.period_end, { day: "numeric", month: "short" })}` : fmtD(p.period_start, { month: "long", year: "numeric" });
  const fn = p.first_name ? esc(p.first_name) : "Builder";
  const practise = r.focus_topic ? `${APP}/practice/${r.focus_topic.code}/topics` : `${APP}/practice`;
  const idle = r.questions === 0;
  const dots = week && r.day_map ? `<div style="margin:6px 0 2px">${["M","T","W","T","F","S","S"].map((d, i) => `<span style="display:inline-block;width:34px;text-align:center;margin-right:4px">
      <span style="display:block;width:28px;height:28px;margin:0 auto;border-radius:50%;background:${r.day_map![i] ? "#C9A227" : "#E3E8EE"};color:${r.day_map![i] ? "#012748" : "#8a99a8"};font-weight:800;line-height:28px;font-size:13px">${r.day_map![i] ? "✓" : ""}</span>
      <span style="font-size:11px;color:#6C87A0">${d}</span></span>`).join("")}</div>` : "";
  const body = idle ? `
<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:.12em;color:#C9A227">YOUR ${unit.toUpperCase()} ON KAIRO · ${esc(period).toUpperCase()}</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${fn}, we missed you this ${unit}. 👀</h1>
<p style="line-height:1.55;margin:0 0 12px">No practice logged this ${unit}. UTME 2027 is closer than it looks, and 10 questions a day adds up to 3,600 by exam day.${r.streak.best ? ` Your best streak is <b>${r.streak.best} days</b>. Beat it.` : ""}</p>
${btn(`${APP}/quizzes`, "Take today’s 5-minute quiz")}
<p style="text-align:center;font-size:13px;color:#3d5a73;margin:6px 0 0">Or <a href="${APP}/practice" style="color:#09476E;font-weight:700">practise any topic</a>. Every question comes with an explanation.</p>`
  : `
<p style="margin:0 0 6px;font-size:13px;font-weight:800;letter-spacing:.12em;color:#C9A227">YOUR ${unit.toUpperCase()} ON KAIRO · ${esc(period).toUpperCase()}</p>
<h1 style="margin:0 0 4px;font-size:24px;line-height:1.25">${fn}, you answered <span style="color:#09476E">${nf(r.questions)} questions</span> this ${unit}. ${r.questions >= 200 ? "🔥" : "💪"}</h1>
<p style="margin:0 0 14px;font-size:14px">${delta(r.questions, r.prev_questions, unit)}${r.beat_pct != null && r.beat_pct >= 50 ? ` · <b>more than ${r.beat_pct}% of KAIRO students</b>` : ""}</p>
${dots}
<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0">
<tr>${tile(r.accuracy != null ? `${r.accuracy}%` : "–", "accuracy", r.prev_accuracy != null && r.accuracy != null ? (r.accuracy >= r.prev_accuracy ? `<span style="color:#17714d;font-weight:700">▲ ${r.accuracy - r.prev_accuracy} pts</span>` : `<span style="color:#b23434;font-weight:700">▼ ${r.prev_accuracy - r.accuracy} pts</span>`) : "")}
    ${tile(`${nf(r.minutes)} min`, "focused practice")}</tr>
<tr>${tile(`${r.active_days}${week ? "/7" : ""}`, "days active")}${tile(`🔥 ${r.streak.current}`, "day streak", r.streak.best > r.streak.current ? `<span style="color:#6C87A0">best ${r.streak.best}</span>` : r.streak.current > 1 ? `<span style="color:#17714d;font-weight:700">your best yet</span>` : "")}</tr>
<tr>${tile(`+${nf(r.xp)}`, "XP earned")}${tile(nf(r.sessions), "sessions finished", r.mocks ? `<span style="color:#3d5a73">incl. ${r.mocks} full mock${r.mocks > 1 ? "s" : ""}</span>` : "")}</tr>
</table>
${p.paid && r.attendance && r.attendance.held > 0 ? `<div style="border:1px solid #dfe6ec;border-radius:12px;padding:12px 14px;margin:10px 0"><b>🎓 TECHMED classes:</b> you attended <b>${r.attendance.attended} of ${r.attendance.held}</b> live classes${r.attendance.rate != null ? ` (${r.attendance.rate}%)` : ""}.${r.attendance.attended < r.attendance.held ? " Check in at every class: consistency is the edge." : " Perfect attendance. Respect. 🙌"}</div>` : ""}
${r.best_subject ? `<p style="margin:12px 0 4px">💪 <b>Strongest subject:</b> ${esc(r.best_subject.name)} (${r.best_subject.accuracy}% on ${nf(r.best_subject.n)} questions)</p>` : ""}
${r.badges.length ? `<p style="margin:4px 0">🏅 <b>New badges:</b> ${r.badges.map(esc).join(", ")}</p>` : ""}
${r.focus_topic ? `<div style="background:#012748;color:#fff;border-radius:14px;padding:14px 16px;margin:14px 0">
  <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#C9A227">YOUR NEXT MOVE</div>
  <div style="font-size:16px;font-weight:800;margin:4px 0">Fix “${esc(r.focus_topic.name)}”</div>
  <div style="font-size:14px;color:#c9d6e2">You got ${r.focus_topic.accuracy}% here this ${unit}. 10 targeted questions with explanations will move it fast.</div></div>
${btn(practise, `Practise ${esc(r.focus_topic.name)} now`)}` : btn(`${APP}/practice`, "Keep the run going")}
<p style="text-align:center;margin:6px 0 0;font-size:13px"><a href="${APP}/recap" style="color:#09476E;font-weight:700">See your full recap in KAIRO →</a></p>`;
  const subject = idle ? `${p.first_name ?? "Hey"}, your KAIRO streak is waiting 👀`
    : `📊 Your ${unit}: ${nf(r.questions)} questions${r.accuracy != null ? `, ${r.accuracy}% accuracy` : ""}${r.beat_pct != null && r.beat_pct >= 50 ? ` · top ${Math.max(1, 100 - r.beat_pct)}%` : ""}`;
  const html = layout({ brand: "KAIRO", p, categoryLabel: "weekly recaps", preheader: idle ? "10 questions today restarts your run." : `${r.active_days} active days, ${r.minutes} minutes, ${r.streak.current}-day streak.`, body });
  const text = idle ? `${p.first_name ?? "Hi"}, no KAIRO practice this ${unit}. Take today's quiz: ${APP}/quizzes`
    : `Your ${unit} on KAIRO (${period}): ${r.questions} questions, ${r.accuracy ?? "-"}% accuracy, ${r.minutes} min, ${r.active_days} active days, ${r.streak.current}-day streak.${r.focus_topic ? ` Next: practise ${r.focus_topic.name} ${practise}` : ""} Full recap: ${APP}/recap`;
  return { from: FROM_KAIRO, to: p.email, subject, html, text, headers: listHeaders(p) };
}
function recapPush(p: RecapPerson) {
  const r = p.data; const unit = p.kind === "week" ? "week" : "month";
  if (!r.questions) return { title: "👀 We missed you this " + unit, body: "10 questions today restarts your run. Today’s quiz takes 5 minutes." };
  return { title: `📊 Your ${unit} on KAIRO is ready`, body: `${nf(r.questions)} questions${r.beat_pct != null && r.beat_pct >= 50 ? `, more than ${r.beat_pct}% of students` : ""}, ${r.streak.current}-day streak. Tap to see your recap.` };
}

const TEMPLATES: Record<string, (p: Person) => Mail> = { class_offer: classOffer };

// ───────────────────────── sending ─────────────────────────
async function sendBatch(mails: Mail[]): Promise<{ ok: boolean; error?: string; status?: number }> {
  const r = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify(mails.map((m) => ({ from: m.from, to: m.to, reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text, headers: m.headers }))),
  });
  if (!r.ok) return { ok: false, status: r.status, error: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return { ok: true, status: r.status };
}

/** Send in batches of 50. A 422 batch (one bad address) is retried one by one; a 429 (quota) stops the run, unsent stay unsent. */
async function deliver<T extends Person>(people: T[], make: (p: T) => Mail, onDone: (p: T, ok: boolean, err?: string) => Promise<void>) {
  let sent = 0, failed = 0, quota = false;
  outer: for (let i = 0; i < people.length; i += 50) {
    const chunk = people.slice(i, i + 50);
    const r = await sendBatch(chunk.map(make));
    if (r.ok) { for (const p of chunk) await onDone(p, true); sent += chunk.length; }
    else if (r.status === 429) { quota = true; break; }
    else {
      for (const p of chunk) {
        const one = await sendBatch([make(p)]);
        if (one.status === 429) { quota = true; break outer; }
        await onDone(p, one.ok, one.error); if (one.ok) sent++; else failed++;
        await sleep(250);
      }
    }
    await sleep(700);
  }
  return { sent, failed, quota_reached: quota };
}

async function campaign(b: { template: string; campaign: string; audience: string; category: string; test_to?: string; dry_run?: boolean; preview?: boolean; limit?: number }) {
  const make = TEMPLATES[b.template];
  if (!make) return { error: "unknown template" };
  if (b.preview) {
    // Rendered for review only; nothing is sent.
    const m = make({ user_id: "00000000-0000-0000-0000-000000000000", email: "student@example.com", first_name: "Ada", unsub: "preview", unsub_all: "preview", paid: false, kairo: true });
    return { subject: m.subject, html: m.html, text: m.text };
  }
  if (b.test_to) {
    const p: Person = { user_id: "00000000-0000-0000-0000-000000000000", email: b.test_to, first_name: "Wisdom", unsub: "preview", unsub_all: "preview", paid: false, kairo: true };
    const m = make(p);
    const r = await sendBatch([{ ...m, subject: `[TEST] ${m.subject}` }]);
    return { test: true, to: b.test_to, ...r };
  }
  const { data, error } = await db.rpc("mail_audience", { p_audience: b.audience, p_category: b.category, p_campaign: b.campaign });
  if (error) return { error: error.message };
  const people = (data ?? []) as Person[];
  if (b.dry_run) return { dry_run: true, recipients: people.length, sample_first_names: people.slice(0, 3).map((p) => p.first_name) };
  const todo = b.limit ? people.slice(0, Math.max(0, Number(b.limit))) : people;
  const res = await deliver(todo, make, async (p, ok, err) => {
    await db.rpc("mail_logged", { p_campaign: b.campaign, p_user: p.user_id, p_email: p.email, p_status: ok ? "sent" : "failed", p_error: err ?? null });
  });
  return { campaign: b.campaign, waiting: people.length, attempted: todo.length, ...res };
}

// Weekly/monthly recaps: email (respecting opt-outs) and push (KAIRO OneSignal app, per student), each once.
const OS_KEY = Deno.env.get("KAIRO_ONESIGNAL_REST_KEY") || "";
async function recaps(b: { kind: "week" | "month"; limit?: number; channels?: string[]; preview?: boolean }) {
  const kind = b.kind === "month" ? "month" : "week";
  const channels = b.channels ?? ["email", "push"];
  const out: Record<string, unknown> = { kind };
  if (b.preview) {
    const { data } = await db.rpc("recap_queue", { p_kind: kind, p_channel: "push", p_limit: 1 });
    return { preview: ((data ?? []) as RecapPerson[]).map((p) => ({ subject: recapMail({ ...p, first_name: "Ada" }).subject })) };
  }
  if (channels.includes("email")) {
    const { data, error } = await db.rpc("recap_queue", { p_kind: kind, p_channel: "email", p_limit: b.limit ?? 100 });
    if (error) return { error: error.message };
    const people = (data ?? []) as RecapPerson[];
    out.email = { waiting: people.length, ...(await deliver(people, recapMail, async (p, ok) => {
      if (ok) await db.rpc("recap_mark", { p_user: p.user_id, p_kind: kind, p_period: p.period_start, p_channel: "email" });
    })) };
  }
  if (channels.includes("push") && OS_KEY) {
    const { data } = await db.rpc("recap_queue", { p_kind: kind, p_channel: "push", p_limit: 500 });
    let pushed = 0;
    for (const p of (data ?? []) as RecapPerson[]) {
      const m = recapPush(p);
      const r = await fetch("https://api.onesignal.com/notifications", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Key ${OS_KEY}` },
        body: JSON.stringify({ app_id: "5983fe20-b980-4991-ab88-9bb3a1994bd2", target_channel: "push", include_aliases: { external_id: [p.user_id] },
          headings: { en: m.title }, contents: { en: m.body }, url: `${APP}/recap`, web_push_topic: `kairo-recap-${kind}`, ttl: 3 * 86400, priority: 10,
          chrome_web_icon: `${APP}/icons/icon-192.png` }) });
      await db.rpc("recap_mark", { p_user: p.user_id, p_kind: kind, p_period: p.period_start, p_channel: "push" });
      if (r.ok) pushed++;
    }
    out.push = { pushed };
  }
  return out;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const unsub = url.searchParams.get("unsub");
  if (unsub) {
    // RFC 8058 one-click (POST from the mail app) or a plain click (GET → friendly page).
    if (req.method === "POST") {
      const { data } = await db.rpc("email_unsubscribe", { p_token: unsub });
      return json({ ok: !!(data as { ok?: boolean } | null)?.ok });
    }
    return Response.redirect(unsubUrl(unsub), 302);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { data: secret } = await admin.from("app_secrets").select("value").eq("name", "notify_hook_secret").maybeSingle();
  if (!secret?.value || req.headers.get("x-techmed-notify") !== secret.value) return json({ error: "forbidden" }, 403);
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (b.action === "campaign") return json(await campaign(b as never));
    if (b.action === "recaps") return json(await recaps(b as never));
    return json({ error: "bad_action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
