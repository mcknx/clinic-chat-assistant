// node bridge.mjs -> :8788. POST /reply {prompt} -> `claude -p` (local Claude Code CLI). GET / or /chat clinic site + chat, GET /inbox front desk, GET /p2/state rows.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const run = (cmd, args, input) => new Promise((ok, no) => {
  const p = execFile(cmd, args, { maxBuffer: 1e7, timeout: 120e3 }, (e, out) => (e ? no(e) : ok(out)));
  if (input) p.stdin.end(input);
});
createServer(async (req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
  try {
    if (req.method === "POST" && req.url === "/reply") {
      let b = ""; for await (const c of req) b += c;
      const { prompt } = JSON.parse(b);
      const text = (await run("claude", ["-p", "--model", "opus"], prompt)).trim();
      return send(200, "application/json", JSON.stringify({ text }));
    }
    if (req.url === "/p2/state") {
      const json = await run("docker", ["exec", "va-pg", "psql", "-U", "va", "-d", "va", "-t", "-A", "-c", `select json_build_object(
        'leads', (select coalesce(json_agg(l order by updated_at desc), '[]') from chat_leads l),
        'bookings', (select coalesce(json_agg(b order by starts_at), '[]') from (select s.starts_at, s.booked_by, l.name, l.service, l.patient_type
           from slots s left join chat_leads l on l.session = s.booked_by where s.booked_by is not null) b),
        'messages', (select coalesce(json_agg(m order by id), '[]') from (select * from chat_messages order by id desc limit 50) m))`]);
      return send(200, "application/json", json.trim());
    }
    if (req.url === "/" || req.url === "/chat") return send(200, "text/html", readFileSync(dir + "chat.html"));
    if (req.url === "/inbox") return send(200, "text/html", readFileSync(dir + "inbox.html"));
    send(404, "text/plain", "not found");
  } catch (e) { send(500, "text/plain", String(e)); }
}).listen(8788, () => console.log("bridge :8788"));
