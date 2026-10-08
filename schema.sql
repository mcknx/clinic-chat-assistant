-- VA P2 clinic chat assistant (demo data). Apply: docker exec -i va-pg psql -U va -d va < schema.sql
-- Load KB: echo "insert into kb(id,body) values (1, :'kb') on conflict (id) do update set body=excluded.body;" | docker exec -i va-pg psql -U va -d va -v kb="$(cat knowledge.md)"
-- (psql -c does not interpolate :vars, so the statement goes on stdin.)
create table if not exists chat_messages (
  id serial primary key,
  session text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);
create index if not exists chat_messages_session on chat_messages (session, id);
create table if not exists chat_leads (
  session text primary key,
  name text, service text, patient_type text, preferred_day text,
  status text default 'open' check (status in ('open','booked','handoff')),
  updated_at timestamptz default now()
);
create table if not exists slots (
  id serial primary key,
  starts_at timestamptz unique not null,
  booked_by text
);
create table if not exists kb (id int primary key default 1, body text);

-- Mon-Sat 9:00-17:00 hourly, next 7 days, Asia/Manila. Re-run safe.
insert into slots (starts_at)
select (d + make_interval(hours => h)) at time zone 'Asia/Manila'
from generate_series(date_trunc('day', now() at time zone 'Asia/Manila'),
                     date_trunc('day', now() at time zone 'Asia/Manila') + interval '7 days',
                     interval '1 day') d,
     generate_series(9, 17) h
where extract(isodow from d) < 7
  and (d + make_interval(hours => h)) at time zone 'Asia/Manila' > now()
on conflict (starts_at) do nothing;
