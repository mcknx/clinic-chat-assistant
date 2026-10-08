// Cuts raw.webm by the run's own marks, lays the cloned-voice narration on top, burns captions + chapter tracker → p2-demo.mp4.
// node assemble.mjs   (after: say-clone.py lines.json $OUT/voices  and  node capture.mjs)
// Nothing is sped up. A live Claude wait plays in real time with its on-page timer; only if the film would run past 90 s
// is the middle of the longest waits cut, and each cut is captioned "~N s of waiting cut" — the timer jump shows it too.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = process.env.OUT || "/tmp/va-p2-demo";
const C = Number(process.env.CLIP_START || 0.3); // video t = mark − C (same offset as P1)
const here = new URL(".", import.meta.url).pathname;
const run = JSON.parse(readFileSync(OUT + "/run.json", "utf8"));
if (run.error) throw new Error("capture failed: " + run.error);
const voice = Object.fromEntries(JSON.parse(readFileSync(OUT + "/voices/manifest.json", "utf8")).map((v) => [v.id, v]));
const m = run.marks;

// [narration id | null, src start, src end, live|hold|wait, chapter]
const segs = [
  ["1-hook", m.title, m.chat, "hold", 0],
  ["2-ask", m.chat, m.sent1, "live", 1], [null, m.sent1, m.replied1, "wait", 1], ["3-price", m.replied1, m.new2, "hold", 1],
  ["4-unknown", m.new2, m.sent2, "live", 2], [null, m.sent2, m.replied2, "wait", 2], ["5-handoff", m.replied2, m.new3, "hold", 2],
  ["6-book", m.new3, m.sent3, "live", 3], [null, m.sent3, m.replied3, "wait", 3], [null, m.replied3, m.new4, "live", 3],
  [null, m.new4, m.sent4, "live", 3], [null, m.sent4, m.replied4, "wait", 3], ["7-booked", m.replied4, m.readdone, "hold", 3],
  ["8-inbox", m.inbox, m.flow, "hold", 4],
  ["9-flow", m.flow, m.end, "hold", 5],
  ["10-end", m.end, m.stop, "hold", 6],
];
const CHAPTERS = ["The problem", "Price question", "Not on the sheet", "Booking", "Front desk", "Workflow", "Built by"];
const AIR = { "3-price": 1.5, "5-handoff": 1.5, "7-booked": 1.5, "8-inbox": 1.5, "9-flow": 2, "10-end": 1.2 };
const VO = 0.4, KEEP_A = 2, KEEP_B = 2; // a cut wait keeps its first and last seconds

function build(cap) {
  let t = 0, vEnd = 0;
  return segs.map(([id, a, b, kind, ch]) => {
    const src = b - a, vs = id ? Math.max(t + VO, vEnd + 0.3) : null, vSec = id ? voice[id].seconds : 0;
    let dur = kind === "hold" && id ? Math.max(vs + vSec + (AIR[id] ?? 0.8) - t, src) : src; // a hold never cuts what was filmed (rings)
    let cut = 0;
    if (kind === "wait" && src > cap) { cut = src - KEEP_A - KEEP_B; dur = KEEP_A + KEEP_B; }
    const p = { id, kind, ss: +Math.max(0, a - C).toFixed(3), src: +src.toFixed(3), dur: +dur.toFixed(2), at: +t.toFixed(2), vs: vs && +vs.toFixed(2), ch, cut: +cut.toFixed(1) };
    t += p.dur; if (id) vEnd = vs + vSec;
    return p;
  });
}
const total = (plan) => +plan.reduce((s, p) => s + p.dur, 0).toFixed(2);
let cap = Infinity, plan = build(cap);
const waits = segs.filter((s) => s[3] === "wait").map((s) => s[2] - s[1]).sort((x, y) => y - x);
for (const w of waits) { if (total(plan) <= 89.5) break; cap = w - 0.01; plan = build(cap); } // cut the longest wait first
const T = total(plan);
console.table(plan);
if (T < 60 || T > 90) throw new Error(`planned ${T}s, outside 60–90`);

// ── captions (timed from the voice manifest) + chapter tracker + cut notes, one ASS file
const ts = (s) => { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const wrap = (s, n) => { const out = [""]; for (const w of s.replace(/[{}]/g, "").split(/\s+/)) (out.at(-1) + " " + w).trim().length > n ? out.push(w) : (out[out.length - 1] = (out.at(-1) + " " + w).trim()); return out.slice(0, 3).join("\\N"); };
const ev = [];
for (const p of plan) {
  const chat = p.ch >= 1 && p.ch <= 3; // the chat panel owns the right side: captions go bottom-left
  if (p.id) ev.push(`Dialogue: 0,${ts(p.vs)},${ts(p.vs + voice[p.id].seconds + 0.4)},Sub,,${chat ? "40,470,30,,{\\an1}" : "0,0,0,,"}${wrap(voice[p.id].text.replace("V A", "VA"), chat ? 40 : 58)}`);
  if (p.cut) ev.push(`Dialogue: 0,${ts(p.at + KEEP_A - 0.3)},${ts(p.at + KEEP_A + 1.8)},Note,,0,470,130,,~${Math.round(p.cut)} s of waiting cut · the timer shows real time`);
  const chips = CHAPTERS.map((c, i) => (i === p.ch ? `{\\c&H1C62EF&\\b1}● ${c}{\\r}` : i < p.ch ? `{\\c&H8B8B8B&}● ${c}{\\r}` : `{\\c&HC8C8C8&}○ ${c}{\\r}`)).join("  ");
  ev.push(`Dialogue: 1,${ts(p.at)},${ts(p.at + p.dur)},Track,,0,0,0,,${chips}`);
}
writeFileSync(OUT + "/subs.ass", `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Sub,Helvetica,30,&H00FFFFFF,&H00FFFFFF,&H00000000,&H330A0D13,-1,0,0,0,100,100,0,0,3,10,0,2,70,70,30,1
Style: Track,Helvetica,16,&H00FFFFFF,&H00FFFFFF,&H00000000,&H400A0D13,0,0,0,0,100,100,0,0,3,7,0,8,20,20,12,1
Style: Note,Helvetica,22,&H00FFFFFF,&H00FFFFFF,&H00000000,&H201C62EF,-1,0,0,0,100,100,0,0,3,8,0,8,20,20,130,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${ev.join("\n")}
`);

// ── picture: trim each shot (a cut wait = its head + its tail), pad holds by cloning the last frame, concat, burn subs
const norm = "scale=1280:720,fps=30,setsar=1,format=yuv420p";
const pieces = plan.flatMap((p) => p.cut
  ? [{ ss: p.ss, src: KEEP_A, dur: KEEP_A }, { ss: p.ss + p.src - KEEP_B, src: KEEP_B, dur: KEEP_B }]
  : [{ ss: p.ss, src: Math.min(p.src, p.dur), dur: p.dur }]);
const vf = pieces.map((p, i) => `[0:v]trim=start=${p.ss.toFixed(3)}:duration=${p.src.toFixed(3)},setpts=PTS-STARTPTS,${norm},tpad=stop_mode=clone:stop_duration=${(p.dur - p.src + 0.05).toFixed(3)},trim=duration=${p.dur}[v${i}]`);
const voiced = plan.filter((p) => p.id);
const af = voiced.map((p, i) => `[${i + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(p.vs * 1000)}:all=1[a${i}]`);
const graph = [...vf, `${pieces.map((_, i) => `[v${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0,ass=${OUT}/subs.ass[v]`,
  ...af, `${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:duration=longest:normalize=0,apad=whole_dur=${T},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]`].join(";");
const dest = here + "p2-demo.mp4";
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", OUT + "/raw.webm", ...voiced.flatMap((p) => ["-i", voice[p.id].file]),
  "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
  "-t", String(T), "-movflags", "+faststart", dest], { stdio: "inherit" });
writeFileSync(here + "run.json", JSON.stringify({ ...run, plan, seconds: T }, null, 2));
console.log(`wrote ${dest} · planned ${T}s · replies took ${run.turns.map((x) => x.seconds + "s").join(", ")} · cuts: ${plan.filter((p) => p.cut).map((p) => "~" + p.cut + "s").join(", ") || "none"}`);
