-- 1. Parallel checkouts.
--    Before: one live attempt per order, so anyone holding the link could start a checkout and
--    block the real buyer until the invoice expired. Now several devices may each hold an unpaid
--    invoice; the first payment to lock wins and the others are cancelled. The database still
--    guarantees that at most one payment is ever locked per order.

alter table payment_attempts add column buyer_key_hash text;

update payment_attempts a
   set buyer_key_hash = o.buyer_key_hash
  from orders o
 where o.id = a.order_id and a.buyer_key_hash is null;

drop index if exists payment_attempts_one_live;
create unique index payment_attempts_one_held on payment_attempts (order_id) where status = 'held';
create index payment_attempts_pending_idx on payment_attempts (order_id, created_at) where status = 'pending';

-- Until a payment is locked, the order has no buyer: every unpaid attempt carries its own key.
update orders set buyer_key_hash = null where status in ('open', 'awaiting_payment');

-- 2. Trusted devices.
--    A device that has signed in successfully keeps a long-lived token. The account lockout that
--    stops PIN guessing does not apply to it, so a stranger who deliberately enters wrong PINs can
--    no longer lock the owner out of the phone they always use.

create table trusted_devices (
  token_hash    text primary key,                    -- sha256 of the cookie value
  seller_id     uuid not null references sellers(id) on delete cascade,
  failed_logins integer not null default 0,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);
create index trusted_devices_seller_idx on trusted_devices (seller_id, last_used_at desc);
