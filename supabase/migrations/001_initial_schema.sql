-- =====================================================================
-- 보장분석 라이프 리포트 v5.4 — 초기 스키마 (001_initial_schema.sql)
-- 대상: Supabase Postgres 15+ (pgcrypto)
-- 설계 근거: docs/backend-architecture.md §2 · §3
-- 적용: supabase db push   (또는 SQL Editor에 그대로 붙여넣기)
--
-- 이 파일은 여러 번 실행해도 안전하도록 작성했습니다(if not exists / drop policy if exists).
-- 테이블: profiles · subscriptions · clients · brand_settings · audit_logs
-- 원칙: 모든 테이블 RLS 활성. 쓰기는 본인 행만, 구독·감사 로그 쓰기는 service_role(Edge Function)만.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. 공통: updated_at 자동 갱신 트리거
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. 구독 상태 enum
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sub_status') then
    create type public.sub_status as enum ('free', 'trialing', 'active', 'past_due', 'canceled', 'expired');
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. profiles — auth.users 1:1 (설계사 프로필)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone        text,
  role         text not null default 'fc' check (role in ('fc', 'admin')),
  marketing_opt_in boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is '설계사 프로필. auth.users 1:1. 생년월일은 수집하지 않는다(설계서 §1-3).';
comment on column public.profiles.marketing_opt_in is '마케팅 수신 동의 — 동의 시각·버전은 audit_logs(action=consent.marketing)에 남긴다.';

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- 회원가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. subscriptions — 사용자당 유효 구독 1건
--    price_krw 는 서버(Edge Function) 상수만 기록한다. 클라이언트 금액은 신뢰하지 않는다.
-- ---------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  plan                 text not null check (plan in ('free', 'pro')),
  billing_cycle        text check (billing_cycle in ('month', 'year')),
  status               public.sub_status not null default 'free',
  provider             text check (provider in ('toss', 'portone', 'test')),
  billing_key          text,                 -- PG 빌링키. authenticated 에게는 컬럼 권한을 주지 않는다(아래 grant).
  customer_key         text,
  price_krw            integer check (price_krw is null or price_krw >= 0),
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at          timestamptz,
  trial_end            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.subscriptions.billing_key is 'PG 빌링키. 실서비스에서는 Vault/암호화 저장 권장. authenticated 롤은 select 권한 없음.';

create unique index if not exists subscriptions_one_live
  on public.subscriptions(user_id)
  where status in ('trialing', 'active', 'past_due');

create index if not exists subscriptions_user_idx on public.subscriptions(user_id, created_at desc);
create unique index if not exists subscriptions_billing_key_uidx
  on public.subscriptions(billing_key) where billing_key is not null;

drop trigger if exists trg_subscriptions_updated on public.subscriptions;
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4. clients — 고객(민감정보 최소화). 실제 이름·연락처는 앱에서 가명/이니셜 권장.
--    *_enc 는 선택(암호화 저장 시 사용). 앱은 display_name + payload 만 사용한다.
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  display_name     text not null check (char_length(display_name) between 1 and 40),
  name_enc         bytea,
  birth_enc        bytea,
  phone_enc        bytea,
  memo             text,
  status           text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  payload          jsonb not null default '{}'::jsonb,   -- 앱 저장 스냅샷(점수·입력 요약). 원본 증권 이미지 금지.
  last_contact_at  timestamptz,
  next_followup_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists clients_user_idx on public.clients(user_id, updated_at desc);
create index if not exists clients_user_status_idx on public.clients(user_id, status);

drop trigger if exists trg_clients_updated on public.clients;
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 5. brand_settings — 화이트라벨(1인 1행)
-- ---------------------------------------------------------------------
create table if not exists public.brand_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '보장분석 라이프 리포트' check (char_length(name) between 1 and 40),
  slogan     text not null default '고객 맞춤형 보장 점검 · 리모델링 상담 가이드' check (char_length(slogan) <= 80),
  consultant text,
  title      text,
  phone      text,
  kakao      text,
  theme      text not null default 'navy' check (theme in ('navy', 'emerald', 'rose', 'charcoal')),
  logo_data  text check (logo_data is null or char_length(logo_data) <= 1000000),  -- data:image/...;base64 (≤950KB)
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_brand_settings_updated on public.brand_settings;
create trigger trg_brand_settings_updated before update on public.brand_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 6. audit_logs — 감사·멱등 기록 (결제 웹훅 dedupe_key 포함)
--    내용에 고객 원문·이미지 바이트를 남기지 않는다(설계서 §15-2).
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  actor      text not null default 'system' check (actor in ('user', 'system', 'webhook', 'admin')),
  action     text not null,                 -- client.sync / brand.save / billing.subscribe / webhook.payment.approved / vision.parse ...
  target     text,
  detail     jsonb not null default '{}'::jsonb,
  dedupe_key text,                          -- PG 이벤트 ID 등 멱등 키
  ip_hash    text,
  created_at timestamptz not null default now()
);

create unique index if not exists audit_logs_dedupe_uidx
  on public.audit_logs(dedupe_key) where dedupe_key is not null;
create index if not exists audit_logs_user_idx on public.audit_logs(user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs(action, created_at desc);

-- ---------------------------------------------------------------------
-- 7. 유료 판정 — 단일 출처
-- ---------------------------------------------------------------------
create or replace function public.is_pro(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = uid
      and s.plan = 'pro'
      and s.status in ('trialing', 'active', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

revoke all on function public.is_pro(uuid) from public;
grant execute on function public.is_pro(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.subscriptions  enable row level security;
alter table public.clients        enable row level security;
alter table public.brand_settings enable row level security;
alter table public.audit_logs     enable row level security;

-- profiles: 본인만 읽기/수정. role 변경은 막는다(관리자 승격은 service_role 만).
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists profiles_self_write on public.profiles;
create policy profiles_self_write on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- role(admin) 승격은 본인 UPDATE 로 불가능하게 트리거로 고정한다.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_role_guard on public.profiles;
create trigger trg_profiles_role_guard before update on public.profiles
  for each row execute function public.protect_profile_role();

-- subscriptions: 본인 읽기만. 쓰기는 service_role(Edge Function)만.
drop policy if exists subs_self_read on public.subscriptions;
create policy subs_self_read on public.subscriptions
  for select using (user_id = auth.uid());

-- clients: 본인 행 전체 CRUD. 다른 사용자 행은 보이지 않고 수정도 불가.
drop policy if exists clients_rw on public.clients;
create policy clients_rw on public.clients
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- brand_settings: 읽기는 본인, 쓰기는 Pro 만(Free 는 미리보기 = 로컬 캐시만).
drop policy if exists brand_read on public.brand_settings;
create policy brand_read on public.brand_settings
  for select using (user_id = auth.uid());

drop policy if exists brand_write on public.brand_settings;
create policy brand_write on public.brand_settings
  for all using (user_id = auth.uid() and public.is_pro(auth.uid()))
  with check (user_id = auth.uid() and public.is_pro(auth.uid()));

-- audit_logs: 본인 기록 읽기만. 쓰기는 service_role 만.
drop policy if exists audit_self_read on public.audit_logs;
create policy audit_self_read on public.audit_logs
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 9. 롤별 테이블 권한 (RLS 위에 한 겹 더)
--    authenticated 는 subscriptions.billing_key 를 select 할 수 없다.
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.brand_settings to authenticated;
grant select on public.audit_logs to authenticated;

revoke all on public.subscriptions from anon, authenticated;
grant select (
  id, user_id, plan, billing_cycle, status, provider, customer_key, price_krw,
  current_period_start, current_period_end, cancel_at_period_end, canceled_at, trial_end,
  created_at, updated_at
) on public.subscriptions to authenticated;

revoke all on public.subscriptions from anon;
revoke all on public.audit_logs from anon;
revoke all on public.profiles from anon;
revoke all on public.clients from anon;
revoke all on public.brand_settings from anon;

-- service_role(Edge Function)은 RLS 우회 + 전체 권한
grant all on public.profiles, public.subscriptions, public.clients, public.brand_settings, public.audit_logs to service_role;
grant usage, select on all sequences in schema public to service_role, authenticated;

-- ---------------------------------------------------------------------
-- 10. 동작 확인용 주석
-- ---------------------------------------------------------------------
-- select public.is_pro(auth.uid());
-- select plan, status, current_period_end from public.subscriptions where user_id = auth.uid();
