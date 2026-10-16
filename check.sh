#!/usr/bin/env bash
set -e
S="check-$(date +%s)"
say() { curl -sf -X POST localhost:5678/webhook/chat -H 'content-type: application/json' -d "{\"session\":\"$S\",\"message\":\"$1\"}"; echo; }
q() { docker exec va-pg psql -U va -d va -t -A -c "$1"; }
docker exec -i -e PGOPTIONS=-cclient_min_messages=warning va-pg psql -U va -d va -q < "$(dirname "$0")/schema.sql"  # re-seed: always 7 days of slots, whatever today is
q "update slots set booked_by = null where booked_by like 'check-%'" >/dev/null  # free slots from earlier runs so the check stays repeatable
r1=$(say "Hi! How much is teeth whitening?"); echo "$r1"; echo "$r1" | grep -q '8,000\|8000' || { echo "FAIL: kb price"; exit 1; }
r2=$(say "Do you accept PhilHealth Konsulta?"); echo "$r2"; echo "$r2" | grep -q '"action":"handoff"' || { echo "FAIL: expected handoff for unknown HMO"; exit 1; }
S="$S-b"
say "I'd like a cleaning. I'm a new patient. Saturday works. My name is Ana." >/dev/null
r4=$(say "The first time you offered is fine."); echo "$r4"
[ "$(q "select status from chat_leads where session='$S'")" = "booked" ] && echo "p2 ok: booked" || { echo "FAIL: not booked"; exit 1; }
[ "$(q "select count(*) from slots where booked_by='$S'")" = "1" ] && echo "p2 ok: one slot" || { echo "FAIL: slot"; exit 1; }
