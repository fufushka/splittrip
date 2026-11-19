-- Схема лаби 2 (contract.md, розд. 2; spec-fix-02, п. 1). Застосовує `npm run db:migrate`
-- (ADR-0020); застосований файл не редагується — зміна схеми лише новою міграцією.
-- Id — UUIDv7 від застосунку; суми — цілі копійки (ADR-0009). Інваріанти I1–I6 — architecture.md
-- лаби 1: ті, що виражаються в SQL, дублюються обмеженнями як друга лінія захисту.

create table trips (
  id uuid primary key,
  -- `sub` із JWT Supabase Auth; без FK на auth.users: база прогону тестів не має схеми auth.
  owner_id uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('open', 'closed')),
  closed_at timestamptz,
  created_at timestamptz not null,
  check ((status = 'closed') = (closed_at is not null))
);

-- GET /trips: owner_id = $1 and id < $cursor order by id desc limit $n.
create index trips_owner_id_id_idx on trips (owner_id, id desc);

create table participants (
  id uuid primary key,
  trip_id uuid not null references trips (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  position integer not null check (position > 0),
  unique (trip_id, position),
  -- Ціль складених FK: посилання на учасника лише тієї самої поїздки (I3).
  unique (trip_id, id)
);

create table expenses (
  id uuid primary key,
  trip_id uuid not null references trips (id) on delete cascade,
  payer_id uuid not null,
  amount bigint not null check (amount between 1 and 10000000000),
  split_mode text not null check (split_mode in ('equal', 'exact')),
  description text not null check (char_length(description) <= 200),
  unique (trip_id, id),
  -- Без каскаду: учасника, що платив, не видалити (I5).
  foreign key (trip_id, payer_id) references participants (trip_id, id)
);

create index expenses_trip_id_idx on expenses (trip_id);

create table expense_shares (
  -- trip_id дублюється, щоб складений FK гарантував I3 і для учасників поділу.
  trip_id uuid not null,
  expense_id uuid not null,
  participant_id uuid not null,
  amount bigint not null check (amount > 0),
  primary key (expense_id, participant_id),
  foreign key (trip_id, expense_id) references expenses (trip_id, id) on delete cascade,
  foreign key (trip_id, participant_id) references participants (trip_id, id)
);

create index expense_shares_participant_idx on expense_shares (trip_id, participant_id);

create table transfers (
  id uuid primary key,
  trip_id uuid not null references trips (id) on delete cascade,
  from_id uuid not null,
  to_id uuid not null,
  amount bigint not null check (amount between 1 and 10000000000),
  check (from_id <> to_id),
  foreign key (trip_id, from_id) references participants (trip_id, id),
  foreign key (trip_id, to_id) references participants (trip_id, id)
);

create index transfers_trip_id_idx on transfers (trip_id);

-- ADR-0019: ключ унікальний у межах власника; status/response = null — ще обробляється.
create table idempotency_keys (
  owner_id uuid not null,
  key text not null check (char_length(key) between 1 and 255),
  request_hash text not null,
  status integer,
  response text,
  created_at timestamptz not null,
  primary key (owner_id, key),
  check ((status is null) = (response is null))
);
