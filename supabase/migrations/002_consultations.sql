-- =====================================================================
-- 보장분석 라이프 리포트 v5.8 — 상담 기록 테이블 (002_consultations.sql)
-- 대상: Supabase Postgres 15+ (pgcrypto)
-- 배경: v5.4 의 001 스키마는 profiles·subscriptions·clients·brand_settings·audit_logs
--       5개 테이블만 만들었고 consultations 는 만들지 않았습니다.
--       v5.8 클라우드 동기화는 상담 1건 = consultations 1행 을 씁니다.
-- 적용: Supabase 대시보드 SQL Editor 에 그대로 붙여넣기
--       또는 `supabase db push` (CLI 토큰 필요)
-- 특징: 여러 번 실행해도 안전합니다(if not exists / drop policy if exists).
--       앱은 local_id 를 (user_id, local_id) 유니크 인덱스로 upsert 합니다.
--       테이블이 없는 프로젝트에서는 앱이 clients.payload 로 자동 폴백합니다.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.consultations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  local_id      text,                                   -- 앱의 로컬 상담 id (기기 간 멱등 키)
  label         text,
  input_json    jsonb not null default '{}'::jsonb,     -- 입력 스냅샷(연령대·5대 담보·직접 기재·계약·고지 체크)
  result_json   jsonb not null default '{}'::jsonb,     -- 점수·등급 요약만 (원본 증권 이미지 금지)
  memo          text,
  consulted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.consultations is '상담 1건 스냅샷. 원본 증권 이미지·주민번호는 저장하지 않는다.';
comment on column public.consultations.local_id is '앱 로컬 상담 id. (user_id, local_id) 유니크 — 같은 상담을 다시 저장하면 갱신.';

create unique index if not exists consultations_user_local_uidx
  on public.consultations(user_id, local_id) where local_id is not null;
create index if not exists consultations_user_idx
  on public.consultations(user_id, consulted_at desc);

-- ---------------------------------------------------------------------
-- RLS — 본인 행만 읽기·쓰기
-- ---------------------------------------------------------------------
alter table public.consultations enable row level security;

drop policy if exists cons_rw on public.consultations;
create policy cons_rw on public.consultations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.consultations to authenticated;
revoke all on public.consultations from anon;
grant all on public.consultations to service_role;

-- ---------------------------------------------------------------------
-- 동작 확인용 주석
-- ---------------------------------------------------------------------
-- select count(*) from public.consultations where user_id = auth.uid();
-- select label, consulted_at from public.consultations
--   where user_id = auth.uid() order by consulted_at desc limit 20;
