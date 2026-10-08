// Films the real P2 flow headless: title → 3 visitors in the live chat (4 live Claude calls, uncut) → front-desk inbox → flow → end card.
// node capture.mjs   (needs bridge :8788, n8n :5678, va-pg; resets the p2 tables + slots first)
// Writes $OUT/raw.webm + $OUT/run.json (event marks in seconds since the page opened ≈ video t=0).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");

const OUT = process.env.OUT || "/tmp/va-p2-demo";
const BASE = "http://localhost:8788";
const SIZE = { width: 1280, height: 720 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const here = new URL(".", import.meta.url).pathname;
// [visitor, message, what the reply must show] — a reply that misses is a failed take (exit 1), re-run.
const TURNS = [
  ["v1", "Hi! How much is teeth whitening?", (d) => /8,?000/.test(d.reply)],
  ["v2", "Do you accept PhilHealth Konsulta?", (d) => d.action === "handoff"],
  ["v3", "Hi, I'd like a cleaning. I'm a new patient, Saturday works best. My name is Ana.", (d) => d.action === "none" && /\d\s?(am|pm)|\d:\d\d/i.test(d.reply)],
  ["v3", "The first time works for me.", (d) => d.action === "book"],
];

// Flow diagram from workflow.json: the main path grouped into 5 boxes (every node name is checked against the file).
function flowHtml() {
  const wf = JSON.parse(readFileSync(here + "../workflow.json", "utf8"));
  const names = new Set(wf.nodes.map((n) => n.name));
  const groups = [
    ["New message", ["Chat", "Valid?"]],
    ["Load clinic info + history", ["Load context"]],
    ["Claude decides", ["Build prompt", "Ask Claude", "Parse reply"]],
    ["Save lead / booking / handoff", ["Save"]],
    ["Reply", ["Reply"]],
  ];
  for (const n of groups.flatMap((g) => g[1])) if (!names.has(n)) throw new Error("workflow.json has no node " + n);
  const boxes = groups.map(([title, ns], i) => `${i ? '<div class="arr" style="animation-delay:' + (1.6 + i * 1.6) + 's">→</div>' : ""}
    <div class="box" style="animation-delay:${1.6 + i * 1.6}s"><div class="k">${i + 1}</div><b>${title}</b><span>${ns.join(" · ")}</span></div>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#f3f7fa;color:#0f2a3d;font:16px -apple-system,Segoe UI,Roboto,sans-serif}
  h2{margin:0 0 6px;font-size:30px;text-align:center} p{margin:0 0 40px;text-align:center;color:#5b7083}
  .row{display:flex;align-items:center;gap:10px}
  .box{width:196px;min-height:150px;padding:20px 14px;background:#fff;border:2px solid #dde5ec;border-radius:14px;text-align:center;opacity:.35;animation:on .5s forwards}
  .box b{display:block;font-size:18px;margin:8px 0 6px;line-height:1.25} .box span{color:#5b7083;font-size:13px}
  .k{width:30px;height:30px;margin:0 auto;border-radius:50%;background:#0e7c86;color:#fff;display:grid;place-items:center;font-weight:700}
  .arr{font-size:28px;color:#0e7c86;opacity:.2;animation:on2 .5s forwards}
  @keyframes on{to{opacity:1;border-color:#0e7c86;box-shadow:0 8px 24px rgba(14,124,134,.18)}} @keyframes on2{to{opacity:1}}
  </style><div><h2>${wf.name.replace(/^VA P2 — /, "")}: the n8n workflow</h2><p>Rendered from workflow.json · ${wf.nodes.length} nodes in 5 steps</p><div class="row">${boxes}</div></div>`;
}
const card = (eyebrow, title, sub) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#0f2a3d;color:#fff;font:18px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center}
  .e{letter-spacing:.18em;text-transform:uppercase;color:#7fd3da;font-size:15px;font-weight:600} h1{font-size:50px;margin:14px 0 12px;line-height:1.15} p{color:#b9c8d4;margin:0}
  </style><div><div class="e">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div>`;

// Visible cursor + ring (Playwright's mouse is invisible on video). Both pointer-events:none.
const cursorJs = () => {
  if (document.getElementById("__cur")) return;
  const mk = (id, css) => Object.assign(document.body.appendChild(Object.assign(document.createElement("div"), { id })).style, { position: "fixed", pointerEvents: "none", zIndex: 2147483646, ...css });
  mk("__cur", { width: "20px", height: "20px", borderRadius: "50%", background: "rgba(20,20,20,.9)", boxShadow: "0 0 0 5px rgba(255,255,255,.85),0 3px 10px rgba(0,0,0,.4)", left: "60%", top: "60%", transition: "left .6s cubic-bezier(.4,0,.2,1),top .6s cubic-bezier(.4,0,.2,1)" });
  mk("__ring", { border: "3px solid #EF621C", borderRadius: "14px", boxShadow: "0 0 0 6px rgba(239,98,28,.18)", opacity: 0, transition: "all .5s cubic-bezier(.4,0,.2,1)" });
};
async function point(page, loc, hold = 800, ring = false) {
  let b; // the inbox re-renders on change, so a box can come back null mid-swap
  for (let i = 0; i < 10 && !(b = await loc.boundingBox()); i++) await wait(100);
  await page.evaluate(([b, ring]) => {
    Object.assign(document.getElementById("__cur").style, ring ? { left: b.x + b.width - 4 + "px", top: b.y + b.height - 4 + "px" } : { left: b.x + b.width / 2 - 10 + "px", top: b.y + b.height / 2 - 10 + "px" });
    Object.assign(document.getElementById("__ring").style, ring ? { left: b.x - 8 + "px", top: b.y - 8 + "px", width: b.width + 10 + "px", height: b.height + 10 + "px", opacity: 1 } : { opacity: 0 });
  }, [b, ring]);
  await wait(hold);
}

let browser, ctx;
const run = { turns: [], marks: {} };
try {
  const psql = (sql) => execFileSync("docker", ["exec", "-i", "va-pg", "psql", "-U", "va", "-d", "va", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql });
  psql("truncate chat_messages, chat_leads; update slots set booked_by=null;");
  psql(readFileSync(here + "../schema.sql")); // re-seed the week
  mkdirSync(OUT + "/raw", { recursive: true });
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: OUT + "/raw", size: SIZE } });
  const page = await ctx.newPage();
  // capture the webhook's JSON so run.json holds exactly what the visitor saw
  const replies = [];
  page.on("response", async (r) => { if (r.url().endsWith("/webhook/chat")) replies.push(await r.json().catch(() => ({ error: r.status() }))); });
  const t0 = Date.now();
  const mark = (k) => (run.marks[k] = +((Date.now() - t0) / 1000).toFixed(2));

  await page.setContent(card("Bayview Dental · a fictional clinic", "Questions answered.<br>Slots booked. After hours too.", "Website chat assistant · n8n + Claude + Postgres"));
  mark("title"); await wait(8000);

  await page.goto(BASE + "/chat", { waitUntil: "domcontentloaded" });
  await page.locator("h1").waitFor(); await page.evaluate(cursorJs); await page.evaluate(() => sessionStorage.clear());
  mark("chat"); await wait(700);
  await point(page, page.locator("#launch"), 700); await page.locator("#launch").click(); await wait(500);

  let who = "v1";
  for (const [i, [visitor, msg, ok]] of TURNS.entries()) {
    const n = i + 1;
    if (visitor !== who) { // next visitor = the widget's own "New chat"
      mark("new" + n); await point(page, page.locator("#reset"), 700); await page.locator("#reset").click(); who = visitor; await wait(500);
    } else if (i) mark("new" + n);
    await point(page, page.locator("#q"), 500); await page.locator("#q").click();
    await page.locator("#q").pressSequentially(msg, { delay: 28 });
    if ((await page.locator("#q").inputValue()) !== msg) throw new Error("message did not stick");
    // Receipt for the wait: elapsed since Send, frozen with ✓ when the reply lands.
    await page.evaluate(() => {
      document.getElementById("__timer")?.remove();
      const t = performance.now(), el = document.body.appendChild(Object.assign(document.createElement("div"), { id: "__timer" }));
      const bots = document.querySelectorAll("#log .bot").length;
      Object.assign(el.style, { position: "fixed", top: "78px", right: "450px", padding: "7px 14px", borderRadius: "10px", background: "rgba(14,17,22,.9)", color: "#E6EDF3", font: "600 15px ui-monospace,Menlo,monospace", pointerEvents: "none", zIndex: 2147483647 });
      const id = setInterval(() => { el.textContent = `live Claude call · ${((performance.now() - t) / 1000).toFixed(1)} s`; if (document.querySelectorAll("#log .bot").length > bots) { clearInterval(id); el.textContent += " ✓"; } }, 100);
    });
    const bots = await page.locator("#log .bot").count();
    await point(page, page.locator("#send"), 400); await page.locator("#send").click(); mark("sent" + n);
    await page.locator("#log .bot").nth(bots).waitFor({ timeout: 120_000 }); mark("replied" + n);
    await wait(400);
    const d = replies.at(-1) || {};
    run.turns.push({ n, visitor, message: msg, reply: d.reply, action: d.action, fields: d.fields, booking: d.booking, seconds: +(run.marks["replied" + n] - run.marks["sent" + n]).toFixed(1) });
    if (!ok(d)) throw new Error(`turn ${n} off-script: ${JSON.stringify(d)}`);
    await point(page, page.locator("#log .bot").last(), 3200, true); // ring the reply, then its Booked/Handoff chip
    const last = page.locator("#log > *").last();
    if ((await last.getAttribute("class")).includes("chip")) await point(page, last, 2200, true);
  }
  mark("readdone");

  await page.goto(BASE + "/inbox", { waitUntil: "domcontentloaded" });
  await page.locator("#c-booked .card").waitFor({ timeout: 15_000 }); await page.evaluate(cursorJs); mark("inbox");
  await wait(1200);
  for (const col of ["open", "booked", "handoff"]) await point(page, page.locator(`#c-${col} .card`).first(), 2600, true);
  run.inbox = await page.locator("main").innerText();

  await page.setContent(flowHtml()); mark("flow"); await wait(12000);
  await page.setContent(card("Built by", "McKeen Asma", "AI Automation VA · n8n + Claude")); mark("end"); await wait(6000);
  mark("stop");
} catch (e) { run.error = String(e); console.error(e); process.exitCode = 1; }
finally {
  const v = ctx && ctx.pages()[0]?.video();
  await ctx?.close(); await browser?.close(); // close is what writes the webm
  if (v) renameSync(await v.path(), OUT + "/raw.webm");
  writeFileSync(OUT + "/run.json", JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
}
