-- Закрити таблиці від Data API Supabase (spec-fix-03, п. 1). Supabase публікує схему public
-- через PostgREST для ролей anon/authenticated, а publishable-ключ публічний за призначенням:
-- без RLS будь-хто читав би й змінював поїздки напряму, в обхід API і перевірки власника.
-- RLS без жодної політики = заборона всього для цих ролей. Застосунок підключається роллю
-- власника таблиць (postgres), яка RLS обходить; доступ і далі перевіряє сервіс `trips`.

alter table trips enable row level security;
alter table participants enable row level security;
alter table expenses enable row level security;
alter table expense_shares enable row level security;
alter table transfers enable row level security;
alter table idempotency_keys enable row level security;
alter table schema_migrations enable row level security;
