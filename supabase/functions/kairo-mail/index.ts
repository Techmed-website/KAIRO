// TECHMED / KAIRO email (Resend, auth.techmedng.com). Standards: per-category opt-out, signed one-click unsubscribe
// (List-Unsubscribe + List-Unsubscribe-Post, RFC 8058), plain-text part, every send logged once per campaign.
//
//   GET/POST ?unsub=<token>        one-click unsubscribe (public; the token is signed by the database)
//   POST {action:"campaign", template, campaign, audience, category, test_to?, dry_run?}   (x-techmed-notify secret)
//        template:  class_offer | weekly_recap | monthly_recap
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

const TEMPLATES: Record<string, (p: Person) => Mail> = { class_offer: classOffer };

// ───────────────────────── sending ─────────────────────────
async function sendBatch(mails: Mail[]): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify(mails.map((m) => ({ from: m.from, to: m.to, reply_to: REPLY_TO, subject: m.subject, html: m.html, text: m.text, headers: m.headers }))),
  });
  if (!r.ok) return { ok: false, error: `resend ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return { ok: true };
}

async function campaign(b: { template: string; campaign: string; audience: string; category: string; test_to?: string; dry_run?: boolean; preview?: boolean }) {
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
  let sent = 0, failed = 0;
  for (let i = 0; i < people.length; i += 50) {
    const chunk = people.slice(i, i + 50);
    const r = await sendBatch(chunk.map(make));
    for (const p of chunk) await db.rpc("mail_logged", { p_campaign: b.campaign, p_user: p.user_id, p_email: p.email, p_status: r.ok ? "sent" : "failed", p_error: r.error ?? null });
    if (r.ok) sent += chunk.length; else failed += chunk.length;
    await sleep(700);
  }
  return { campaign: b.campaign, recipients: people.length, sent, failed };
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
    return json({ error: "bad_action" }, 400);
  } catch (e) { return json({ error: (e as Error).message }, 500); }
});
