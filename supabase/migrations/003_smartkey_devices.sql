-- =====================================================================
-- 보장분석 라이프 리포트 v6.0 — 스마트키 · 기기 바인딩 · 원격 잠금 (003_smartkey_devices.sql)
-- 대상: Supabase Postgres 15+ (pgcrypto)
--
-- 이 마이그레이션이 만드는 것
--   registered_devices : 최대 2기기 (마스터 휴대폰 1 + PC 1). (user_id, kind) 유니크로 강제.
--   qr_challenges      : 1회용 PC 로그인 챌린지. 6자리 코드 · 2자리 확인 숫자 · 180초 만료 · 단회 소비.
--   pc_sessions        : PC 세션. revoked_at 이 채워지면 원격 잠금 상태(즉시 무효).
--
-- 안전 원칙
--   · 상담 데이터(enc)는 폰이 PC 공개키로 암호화한 AES-GCM 암문입니다. 서버는 복호화 키가 없습니다.
--   · 기기 개인키는 서버에 저장하지 않습니다. 공개키(pub_ecdsa)만 받아 서명을 검증합니다.
--   · 여러 번 실행해도 안전합니다(if not exists / drop policy if exists).
--   · 적용: Supabase 대시보드 SQL Editor 붙여넣기 또는 `supabase db push`
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1) 등록 기기 — 최대 2대 (휴대폰 1 · PC 1)
-- ---------------------------------------------------------------------
create table if not exists public.registered_devices (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('phone', 'pc')),
  name          text not null default '',
  pub_ecdsa     jsonb,                              -- ECDSA P-256 공개키(JWK). 개인키는 절대 저장하지 않음
  pub_hash      text not null default '',            -- 공개키 지문(16 hex)
  master        boolean not null default false,      -- 마스터 휴대폰만 승인 권한
  session_token text,                                -- PC 기기의 현재 세션(있으면 연결 중)
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  constraint registered_devices_kind_key unique (user_id, kind)
);

comment on table public.registered_devices is
  '스마트키 기기. (user_id, kind) 유니크 = 휴대폰 1대 + PC 1대. 새 PC 를 붙이려면 기존 PC 를 밀어내야 합니다.';
comment on column public.registered_devices.pub_ecdsa is '기기 공개키(검증용). 개인키는 브라우저에만 있고 서버로 오지 않습니다.';

create index if not exists registered_devices_user_idx on public.registered_devices(user_id);

-- ---------------------------------------------------------------------
-- 2) QR 로그인 챌린지 — 180초 · 단회 소비
-- ---------------------------------------------------------------------
create table if not exists public.qr_challenges (
  id            text primary key,
  code6         text not null,                       -- 폰에 직접 입력하는 6자리
  code2         text not null,                       -- PC 화면과 폰 화면의 확인 숫자(00~99)
  pc_pub_ecdh   jsonb not null,                      -- PC 임시 ECDH 공개키 (상담 데이터 암호화 대상)
  pc_pub_ecdsa  jsonb not null,                      -- PC 임시 ECDSA 공개키 (챌린지 서명 검증)
  pc_pub_hash   text not null,                       -- 두 공개키 지문 — 릴레이 치환 방어
  pc_sig        text not null,                       -- PC 개인키가 challenge transcript 에 서명한 값
  pc_name       text not null default '',
  pc_platform   text not null default '',
  pc_host       text not null default '',
  issued_at     timestamptz not null default now(),
  expires_at    timestamptz not null,                -- issued_at + 180초
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'expired', 'replaced', 'discarded')),
  user_id       uuid references auth.users(id) on delete set null,
  device_id     text,
  phone_pub     jsonb,                               -- 폰 임시 ECDH 공개키
  enc           jsonb,                               -- { iv, ct } AES-GCM 암문 (서버 복호화 불가)
  approve_sig   text,                                -- 폰 기기 서명(양측 공개키·IV·암호문 해시 포함)
  session_token text,
  consumed_at   timestamptz,                         -- 단회 소비 표식
  created_at    timestamptz not null default now()
);

-- v6.1 — 이미 적용된 설치에도 'discarded'(시도 초과 폐기) 상태를 허용
alter table public.qr_challenges drop constraint if exists qr_challenges_status_check;
alter table public.qr_challenges add constraint qr_challenges_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired', 'replaced', 'discarded'));

comment on table public.qr_challenges is
  '1회용 PC 로그인 챌린지. status=pending + expires_at>now() 에서만 승인되며 consumed_at 은 한 번만 채워집니다.';
comment on column public.qr_challenges.enc is
  '폰이 PC 의 ECDH 공개키로 암호화한 상담 데이터. 서버·중계자는 평문을 볼 수 없습니다.';

create index if not exists qr_challenges_code_idx on public.qr_challenges(code6, status);
create index if not exists qr_challenges_expiry_idx on public.qr_challenges(expires_at);
create index if not exists qr_challenges_pc_hash_idx on public.qr_challenges(pc_pub_hash, status);

-- ---------------------------------------------------------------------
-- 3) PC 세션 — 원격 잠금 즉시 무효
-- ---------------------------------------------------------------------
create table if not exists public.pc_sessions (
  token        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  device_id    text,
  pc_pub_hash  text not null default '',
  pc_name      text not null default '',
  created_at   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   text
);

comment on table public.pc_sessions is
  'PC 세션. revoked_at 이 채워지면 활성 창은 즉시 잠금 화면으로 전환되고, 재진입도 차단됩니다.';

create index if not exists pc_sessions_user_idx on public.pc_sessions(user_id, created_at desc);
create index if not exists pc_sessions_device_idx on public.pc_sessions(device_id);

-- ---------------------------------------------------------------------
-- 4) RLS — 본인 행만. 챌린지 생성은 PC 가 로그아웃 상태일 수 있어 anon 도 insert 가능하되,
--    정책상 SELECT 는 막고(코드 조회는 Edge Function 의 service_role 만) 최소 권한으로 둡니다.
-- ---------------------------------------------------------------------
alter table public.registered_devices enable row level security;
alter table public.qr_challenges enable row level security;
alter table public.pc_sessions enable row level security;

drop policy if exists devices_own on public.registered_devices;
/* v6.1 — 인증 사용자 직접 쓰기 정책을 제거합니다. 쓰기는 Edge Function(service_role) 단일 경로만. */
create policy devices_own_read on public.registered_devices
  for select using (user_id = auth.uid());

drop policy if exists challenges_anon_insert on public.qr_challenges;
create policy challenges_anon_insert on public.qr_challenges
  for insert to anon, authenticated with check (true);

drop policy if exists challenges_own_read on public.qr_challenges;
create policy challenges_own_read on public.qr_challenges
  for select using (user_id = auth.uid());

drop policy if exists sessions_own on public.pc_sessions;
/* v6.1 — PC 세션 쓰기도 Edge Function 만. 사용자는 자기 세션을 조회만 합니다. */
create policy sessions_own_read on public.pc_sessions
  for select using (user_id = auth.uid());

grant select on public.registered_devices to authenticated;
grant select on public.pc_sessions to authenticated;
revoke insert, update, delete on public.registered_devices from anon, authenticated;
revoke insert, update, delete on public.pc_sessions from anon, authenticated;
grant insert on public.qr_challenges to anon, authenticated;
grant select on public.qr_challenges to authenticated;
grant all on public.registered_devices, public.qr_challenges, public.pc_sessions to service_role;

-- ---------------------------------------------------------------------
-- 5) 만료 청소 (선택) — 30일 지난 챌린지 정리. pg_cron 이 없으면 수동 호출.
-- ---------------------------------------------------------------------
create or replace function public.purge_old_qr_challenges() returns integer
language plpgsql security definer as $$
declare n integer;
begin
  delete from public.qr_challenges where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_old_qr_challenges() from public;

-- ---------------------------------------------------------------------
-- 확인용
-- ---------------------------------------------------------------------
-- select kind, name, last_seen from public.registered_devices where user_id = auth.uid();
-- select id, status, expires_at, consumed_at from public.qr_challenges order by created_at desc limit 5;
-- select token, pc_name, revoked_at from public.pc_sessions where user_id = auth.uid() order by created_at desc limit 5;
