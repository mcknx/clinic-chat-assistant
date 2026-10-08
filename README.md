# Clinic Chat Assistant (n8n + Claude)

A chat on a dental clinic's website that answers from the clinic's info sheet, books a real open appointment slot, and hands anything it doesn't know to a person.
The front desk sees every conversation, lead, booking and handoff in an inbox.

Live case study (with the demo video): https://mckenneth.vercel.app/case-studies/clinic-chat-assistant/

## Architecture

The n8n workflow (`workflow.json`):

```
Chat (Webhook POST /webhook/chat {session, message})
  -> Valid?        IF: session + message present, else -> Bad request (400)
  -> Load context  Postgres: chat history, lead so far, open slots, clinic info sheet
  -> Build prompt  Code: history + info sheet + open slots -> one prompt
  -> Ask Claude    HTTP Request -> bridge.mjs /reply -> Claude (returns JSON: reply, fields, action, booking)
  -> Parse reply   Code: validate JSON, only accept a slot that is really open, fall back to handoff
  -> Save          Postgres: messages, lead fields, book the slot (only if still free)
  -> Reply         Respond to Webhook { reply, fields, action, booking }
```

| File | What it is |
| --- | --- |
| `workflow.json` | the n8n workflow |
| `schema.sql` | tables (`chat_messages`, `chat_leads`, `slots`, `kb`) + 7 days of demo slots |
| `knowledge.md` | the clinic info sheet the assistant answers from |
| `pg-credential.json` | n8n Postgres credential (local demo login `va`/`va`) |
| `chat.html` | the clinic site with the chat widget (served by the bridge at `/`) |
| `inbox.html` | the front-desk inbox (served at `/inbox`, reads `/p2/state`) |
| `bridge.mjs` | tiny local server: `/reply` calls the `claude` CLI, also serves the pages |
| `check.sh`, `check-bridge.sh` | end-to-end checks |
| `demo/` | scripts that recorded the demo video (Playwright capture, narration, ffmpeg assembly) and `p2-demo.mp4` |
| `case-study.html` | the case study page |

## How to run

Needs Docker, Node 18+, and the [Claude Code](https://claude.com/claude-code) CLI (`claude`) logged in.

```bash
cp .env.example .env            # set N8N_ENCRYPTION_KEY
docker compose up -d
docker exec -i va-pg psql -U va -d va < schema.sql
echo "insert into kb(id,body) values (1, :'kb') on conflict (id) do update set body=excluded.body;" \
  | docker exec -i va-pg psql -U va -d va -v kb="$(cat knowledge.md)"

docker exec n8n n8n import:credentials --input=/demo/pg-credential.json
docker exec n8n n8n import:workflow --input=/demo/workflow.json
docker exec n8n n8n publish:workflow --id=vaP2ChatAssistant
docker restart n8n               # pick up the published workflow

node bridge.mjs                  # :8788, keep it running
./check-bridge.sh                # bridge ok, state ok
```

Open http://localhost:8788/ (clinic site + chat) and http://localhost:8788/inbox (front desk), or run the end-to-end check:

```bash
./check.sh                       # price answer from the info sheet, handoff for an unknown HMO, one real booking
```

The n8n editor is at http://localhost:5678 (create the owner account on first open).

## Honest notes

- This is a demo for a fictional clinic, Bayview Dental. No real patients or business; prices and HMOs in `knowledge.md` are made up.
- Claude is called through `bridge.mjs`, a small local bridge to the `claude` CLI, so the demo runs on a Claude subscription without an API key. In production, swap the "Ask Claude" node for n8n's Anthropic (or OpenAI) node with an API key and drop the bridge.
- The Postgres login `va`/`va` is a local demo credential, only reachable inside Docker.
- Re-recording the video: `demo/capture.mjs` needs Playwright (`npm i playwright` or set `PW=/path/to/playwright`), and `demo/say-clone.py` needs your own voice clip via `REF=/path/to/clip.wav` (never committed).

Built by McKeen Asma with Claude Code. MIT licence.
