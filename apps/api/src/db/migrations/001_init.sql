-- Jotna core schema.
-- Money is stored as integers: XOF has no minor unit, Lightning amounts are millisatoshi.

create extension if not exists pgcrypto;

create table sellers (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,              -- E.164
  pin_hash        text not null,
  shop_name       text not null,
  shop_slug       text not null unique,
  city            text,
  failed_logins   integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);

create table sessions (
  token_hash      text primary key,                  -- sha256 of the cookie value
  seller_id       uuid not null references sellers(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
create index sessions_seller_idx on sessions (seller_id);
create index sessions_expiry_idx on sessions (expires_at);

create table wallets (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null unique references sellers(id) on delete cascade,
  kind            text not null check (kind in ('nwc', 'lnd')),
  secret_enc      text not null,                     -- AES-256-GCM envelope, never logged
  alias           text,
  node_pubkey     text,
  network         text,
  methods         jsonb not null default '[]',
  last_ok_at      timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table images (
  id              uuid primary key default gen_random_uuid(),
  seller_id       uuid not null references sellers(id) on delete cascade,
  mime            text not null check (mime in ('image/webp', 'image/jpeg', 'image/png')),
  bytes           bytea not null,
  created_at      timestamptz not null default now()
);

create table orders (
  id                      uuid primary key default gen_random_uuid(),
  public_id               text not null unique,
  seller_id               uuid not null references sellers(id),
  title                   text not null,
  description             text,
  image_id                uuid references images(id),
  customer_label          text,                      -- seller's private note, never shown publicly
  amount_xof              integer not null check (amount_xof > 0),
  delivery_fee_xof        integer not null default 0 check (delivery_fee_xof >= 0),
  total_xof               integer generated always as (amount_xof + delivery_fee_xof) stored,
  delivery_window_minutes integer not null check (delivery_window_minutes between 30 and 1200),
  status                  text not null default 'open' check (status in
                            ('open','awaiting_payment','funded','settling','completed','refunding','refunded','cancelled')),
  close_reason            text,
  buyer_key_hash          text,                      -- sha256 of a key only the paying device can derive
  funded_at               timestamptz,
  deadline_at             timestamptz,
  dispatched_at           timestamptz,
  completed_at            timestamptz,
  closed_at               timestamptz,
  rating                  smallint check (rating between 1 and 5),
  review                  text,
  rated_at                timestamptz,
  receipt_event_id        text,
  retry_at                timestamptz,               -- worker lease for settling/refunding retries
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index orders_seller_created_idx on orders (seller_id, created_at desc);
create index orders_work_idx on orders (status, deadline_at) where status in ('funded','settling','refunding');

create table payment_attempts (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id),
  payment_hash        text not null unique,
  preimage            text,                          -- only known once the buyer releases
  bolt11              text not null,
  amount_msat         bigint not null check (amount_msat > 0),
  xof_per_btc         numeric(20,2) not null,
  status              text not null default 'pending' check (status in
                        ('pending','held','settled','cancelled','expired')),
  invoice_expires_at  timestamptz not null,
  next_check_at       timestamptz not null default now(),
  held_at             timestamptz,
  settled_at          timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now()
);
-- At most one live attempt per order: the database, not application code, enforces single funding.
create unique index payment_attempts_one_live on payment_attempts (order_id) where status in ('pending','held');
create index payment_attempts_poll_idx on payment_attempts (next_check_at) where status = 'pending';

create table order_events (
  id          bigserial primary key,
  order_id    uuid not null references orders(id),
  type        text not null,
  actor       text not null check (actor in ('seller','buyer','system')),
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, id);

create table idempotency_keys (
  scope           text not null,                     -- e.g. seller:<uuid>:POST /v1/orders
  key             text not null,
  request_hash    text not null,
  state           text not null default 'in_progress' check (state in ('in_progress','done')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  primary key (scope, key)
);
create index idempotency_keys_created_idx on idempotency_keys (created_at);

create table outbox (
  id              bigserial primary key,
  topic           text not null,
  payload         jsonb not null,
  status          text not null default 'pending' check (status in ('pending','done','dead')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now()
);
create index outbox_due_idx on outbox (next_attempt_at) where status = 'pending';
