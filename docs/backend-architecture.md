# 보장분석 라이프 리포트 v5.2 — 로그인 · 결제 백엔드 설계서

> 대상: `apps/bojang-guide/` (PWA · Vanilla JS) 의 다음 단계인 **SaaS 상용화**.
> 범위: 카카오/구글/이메일 로그인, Free/Pro 권한, 월·연 정기결제, 고객·상담 데이터 동기화, 화이트라벨 저장, PDF 유료 권한 검증.
> 원칙: **지금의 단일 HTML·오프라인 동작을 깨지 않고**, 온라인일 때만 계정·결제·동기화를 얹는다(점진적 도입).
> 기준일 2026-11-16. 결제·본인확인 제도는 변경될 수 있으므로 착수 시점에 최신 약관을 재확인한다.

---

## 0. 한 장 요약

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 인증 | **Supabase Auth** — 카카오 OAuth, 구글 OAuth, 이메일 OTP/매직링크 | 국내 FC의 실제 로그인 습관(카카오) + 해외/PC(구글·이메일). 비밀번호 저장을 직접 하지 않는다. |
| DB | **Supabase Postgres** + Row Level Security | 고객·상담·브랜드·구독을 한 곳에서. RLS로 "내 데이터만"을 DB에서 강제. |
| 파일 | Supabase Storage (비공개 버킷) + Signed URL | PDF 원본·프로필 이미지. 공개 URL 금지. |
| 서버 로직 | **Supabase Edge Functions** (Deno/TypeScript) | 빌링키 발급·해지, 웹훅 수신, 유료 PDF 생성/서명, 권한 검증. 시크릿 키는 함수 환경변수에만. |
| 결제 | **토스페이먼츠 빌링키 정기결제** (1순위) / **포트원 V2** (2순위·다채널) | 국내 카드 정기결제 표준. 카드정보는 PG가 보관하고 우리는 `billing_key`만 받는다. |
| 배포 | GitHub Pages(현재) → Cloudflare Pages 또는 동일 호스팅 유지 | 정적 앱은 그대로. API만 Supabase. |
| 관측 | Sentry(프론트) + Supabase Logs/Logflare + 결제 실패 알림 | 무료 사용자의 페이월 이탈, 결제 실패, PDF 오류를 분리해 본다. |

```
[브라우저 PWA] ──(JWT)──> [Supabase Auth]
      │                        │
      ├──(RLS 적용 REST)──> [Postgres: users·subscriptions·brand_profiles·clients·consultations]
      │
      ├──(Edge Function)──> [billing-checkout] ──> [토스페이먼츠 빌링키 발급]
      │                  └> [billing-webhook] <── [토스/포트원 웹훅]
      ├──(Edge Function)──> [entitlements]  ← Free/Pro 판정 단일 출처
      └──(Edge Function)──> [pdf-entitlement] ──> Signed URL (10·30장)
```

**핵심 결정:** Free/Pro 판정은 클라이언트 플래그가 아니라 **서버의 `entitlements` 응답**을 기준으로 한다. 지금 데모의 `localStorage['bojang.plan.v1']`은 시연용이며, 상용에서는 `subscriptions` 행이 유일한 근거다. 클라이언트 잠금 UI는 UX일 뿐이고, 10·30장 PDF·클라우드 동기화·화이트라벨 저장은 서버가 거부할 수 있어야 한다.

---

## 1. 인증 (Supabase Auth)

### 1-1. 제공자

| 제공자 | 용도 | 설정 요점 |
| --- | --- | --- |
| Kakao | 주 로그인 (모바일 FC 대부분) | Kakao Developers 앱 생성 → REST API 키/Client Secret → Supabase Auth Providers에 등록 → Redirect URI `https://<project>.supabase.co/auth/v1/callback`. **카카오 비즈 앱** 전환 시 이메일·닉네임 수집 동의항목 심사 필요. |
| Google | PC·업무용 | Google Cloud OAuth 동의화면(외부) + OAuth 클라이언트(웹) |
| Email OTP | 예비·해외 | 매직링크보다 6자리 OTP가 모바일 앱 전환에 안정적 |

### 1-2. 세션

- `supabase-js` v2 `persistSession: true` → IndexedDB/localStorage에 JWT 저장. PWA 재실행 시 자동 복구.
- Access Token 1시간, Refresh Token 회전. **오프라인**에서는 세션 없이 기존 로컬 기능(진단·1장 PDF)을 계속 허용하고, 동기화만 보류한다.
- 로그아웃 시 로컬 캐시(`bojang.session.v4`, `bojang.history.v4`)는 **삭제하지 않고** "이 기기 데이터"로 남긴다. 계정 전환 시 충돌 방지를 위해 `owner_id`를 붙인다(§4-6).

### 1-3. 최소 수집

| 항목 | 수집 | 근거 |
| --- | --- | --- |
| `auth.users.email` | 카카오/구글/이메일 | 로그인 식별 |
| `profiles.display_name` | 선택 | 화면 표시 |
| `profiles.phone` | **선택, 결제·상담 안내용** | 세금계산서·환불 연락. 미입력 허용 |
| 생년월일 | **수집하지 않음** | FC 개인 계정에는 불필요. 고객 생년월일은 고객 데이터로 별도 암호화 |

> 마케팅 수신동의는 별도 체크박스 + `consent_logs`에 시각·버전·IP 해시를 남긴다(정보통신망법).

---

## 2. DB 스키마

Postgres 15+, `pgcrypto` 확장 사용. 모든 시각은 `timestamptz`.

```sql
create extension if not exists pgcrypto;

-- 2-1. 프로필 (auth.users 1:1)
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone        text,
  role         text not null default 'fc' check (role in ('fc','admin')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2-2. 구독 (한 사용자당 활성 1건)
create type sub_status as enum ('trialing','active','past_due','canceled','expired');
create table public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  plan              text not null check (plan in ('free','pro')),
  billing_cycle     text check (billing_cycle in ('month','year')),
  status            sub_status not null default 'free',
  provider          text check (provider in ('toss','portone')),
  billing_key       text,                         -- PG 빌링키(암호화 저장)
  customer_key      text,                         -- PG 고객 식별키
  price_krw         integer,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at       timestamptz,
  trial_end         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index subscriptions_one_live
  on public.subscriptions(user_id)
  where status in ('trialing','active','past_due');

-- 2-3. 결제 이벤트 (감사·멱등)
create table public.payment_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider       text not null,
  event_type     text not null,          -- payment.approved / payment.failed / billing.deleted ...
  provider_event_id text not null,       -- 웹훅 멱등 키
  amount_krw     integer,
  payload        jsonb not null,
  received_at    timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- 2-4. 브랜드(화이트라벨)
create table public.brand_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '보장분석 라이프 리포트',
  slogan       text not null default '고객 맞춤형 보장 점검 · 리모델링 상담 가이드',
  consultant   text,
  title        text,
  phone        text,
  kakao_url    text,
  theme        text not null default 'navy' check (theme in ('navy','emerald','rose','charcoal')),
  logo_path    text,                     -- Storage 경로 (선택 · 앱은 base64 DataURL 저장, 정식판은 Storage)
  updated_at   timestamptz not null default now()
);

-- 2-5. 고객 (민감정보 → 암호화 컬럼)
create table public.clients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  display_name   text not null,          -- 화면 표시용(가명 권장)
  name_enc       bytea,                  -- 실제 이름 (pgp_sym_encrypt)
  birth_enc      bytea,                  -- 생년월일 (pgp_sym_encrypt)
  phone_enc      bytea,                  -- 연락처 (pgp_sym_encrypt)
  memo           text,                   -- 비민감 메모만
  status         text not null default 'active' check (status in ('active','archived','deleted')),
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index clients_user_idx on public.clients(user_id, updated_at desc);

-- 2-6. 상담 (진단 스냅샷 + 결과)
create table public.consultations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete cascade,
  label         text,
  input_json    jsonb not null,          -- state.cov/flags/family/disc/premium (민감 최소화)
  result_json   jsonb not null,          -- score·letter·rows 요약만 (원본 전체 저장 금지)
  memo          text,
  consulted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index consultations_user_idx on public.consultations(user_id, consulted_at desc);

-- 2-7. 리모델링 시나리오
create table public.remodel_scenarios (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  consultation_id uuid references public.consultations(id) on delete cascade,
  input_json    jsonb not null,          -- acts·cuts·boosts·extra
  before_json   jsonb not null,
  after_json    jsonb not null,
  comment       text,
  created_at    timestamptz not null default now()
);

-- 2-8. 동의 로그
create table public.consent_logs (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete set null,
  kind       text not null,              -- terms / privacy / marketing
  version    text not null,
  agreed     boolean not null,
  ip_hash    text,
  created_at timestamptz not null default now()
);
```

### 2-1. 암호화 키 관리

- `pgp_sym_encrypt` 키는 **DB에 두지 않는다.** Supabase Vault(또는 Edge Function 환경변수)에서 읽어 RPC 파라미터로 전달한다.
- 키 회전을 위해 `key_version smallint` 컬럼을 두고, 복호화는 버전별 키로 시도한다.
- 검색이 필요한 값(이름)은 암호화하면 `LIKE` 검색이 어렵다. 해결: `display_name`(가명/이니셜)만 평문으로 두고 검색은 그 컬럼으로 한다. 실제 이름 검색은 복호화 후 서버에서 수행(건수 제한).

---

## 3. RLS (행 수준 보안)

모든 테이블 `enable row level security`. `auth.uid()`만 신뢰한다. **service_role 키는 Edge Function에만.**

```sql
alter table public.profiles          enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.brand_profiles    enable row level security;
alter table public.clients           enable row level security;
alter table public.consultations     enable row level security;
alter table public.remodel_scenarios enable row level security;
alter table public.payment_events    enable row level security;
alter table public.consent_logs      enable row level security;

-- 프로필: 본인만 읽기/수정 (role 변경은 금지)
create policy profiles_self_read on public.profiles for select using (id = auth.uid());
create policy profiles_self_write on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- 구독: 본인 읽기만. 쓰기는 Edge Function(service_role)만.
create policy subs_self_read on public.subscriptions for select using (user_id = auth.uid());

-- 브랜드: Pro만 쓰기 가능
create policy brand_read on public.brand_profiles for select using (user_id = auth.uid());
create policy brand_write on public.brand_profiles for all
  using (user_id = auth.uid() and public.is_pro(auth.uid()))
  with check (user_id = auth.uid() and public.is_pro(auth.uid()));

-- 고객·상담·리모델링: 본인 + Free는 1명/1건 제한
create policy clients_rw on public.clients for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cons_rw on public.consultations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 결제 이벤트·동의 로그: 본인 읽기, 쓰기는 서버만
create policy pay_read on public.payment_events for select using (user_id = auth.uid());
create policy consent_read on public.consent_logs for select using (user_id = auth.uid());
```

### 3-1. 유료 판정 함수

```sql
create or replace function public.is_pro(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and s.status in ('trialing','active')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;
revoke all on function public.is_pro(uuid) from public;
grant execute on function public.is_pro(uuid) to authenticated;
```

### 3-2. Free 1명 제한을 DB에서

```sql
create or replace function public.enforce_free_client_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_pro(new.user_id) then
    if (select count(*) from public.clients c
        where c.user_id = new.user_id and c.status <> 'deleted') >= 1 then
      raise exception 'FREE_CLIENT_LIMIT' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger clients_free_limit before insert on public.clients
  for each row execute function public.enforce_free_client_limit();
```

---

## 4. Free / Pro 권한 검증 흐름

### 4-1. 단일 출처: `GET /functions/v1/entitlements`

```jsonc
// 응답
{
  "plan": "pro",
  "status": "active",
  "billing_cycle": "year",
  "current_period_end": "2027-11-16T00:00:00Z",
  "limits": { "clients": 30, "slides": 30, "pdf": ["summary","detail","advisor"], "watermark": false },
  "features": { "remodel": true, "whitelabel": true, "claim_copy": true, "code_detail": true },
  "server_time": "2026-11-16T01:00:00Z"
}
```

- 앱 시작·로그인 직후·결제 완료 후·포커스 복귀 시 호출, 결과를 10분 캐시.
- **오프라인**이면 마지막 성공 응답을 `localStorage['bojang.entitlements.v1']`에 저장해 사용하되, `current_period_end`가 지나면 Free로 강등.
- 클라이언트의 `BojangPlan` 은 이 응답을 읽도록 교체한다(현재는 데모 플래그).

### 4-2. 기능별 게이트

| 기능 | 클라이언트 | 서버(강제) |
| --- | --- | --- |
| 30장 슬라이드 7~30 | 블러 + 페이월 | 슬라이드 콘텐츠 자체는 정적 JS라 완전 차단 불가 → **민감한 판독 문구는 Edge Function에서 내려주는 옵션**으로 두고 Free에는 요약만 반환 |
| 1장 PDF | 허용 · 워터마크 | 워터마크는 서버 생성 시 각인 |
| 10·30장 PDF | 페이월 | `pdf-entitlement`가 `is_pro` 확인 후 5분 유효 Signed URL 발급 |
| 고객 2명째 저장 | 페이월 | RLS 트리거 + API 402 |
| 리모델링 After | 마스킹 | `remodel_scenarios` insert 시 `is_pro` 확인 |
| 화이트라벨 저장 | 미리보기만 | `brand_profiles` write policy |
| 코드 상세·청구 복사 | 잠금 | 원문 데이터는 공개 정적 자산이므로 **카피/상세 텍스트를 서버 API로 이동**해 Pro에게만 반환(2단계) |

> 정적 PWA의 한계: JS 번들에 들어간 콘텐츠는 결제 없이도 열람 가능하다. **정말 돈을 받는 자산(10·30장 PDF, 화이트라벨 저장, 고객 데이터)은 서버에 두고 권한 검사 후 내려준다.** 화면 잠금은 전환 UX로만 본다.

### 4-3. PDF 유료 검증 흐름

1. 앱: `POST /functions/v1/pdf-entitlement { kind: "detail", consultation_id }`
2. 함수: JWT 검증 → `is_pro` → 소유권 확인 → `consultation` 스냅샷 로드 → **서버에서 PDF 생성**(Node/Deno + `pdf-lib` 또는 헤드리스 렌더) → Storage `pdfs/{user}/{consultation}/{kind}.pdf` 업로드 → 5분 Signed URL 반환.
3. 앱: URL로 다운로드/공유. URL 재사용 방지를 위해 `jti`를 `pdf_grants`에 기록.
4. Free의 1장 요약은 서버가 워터마크 텍스트를 각인해 생성한다(현재 클라이언트 워터마크는 데모).

> 단계적 대안: 초기에는 현재의 클라이언트 Canvas PDF 생성을 유지하되, **10·30장은 서버 함수가 `entitlement` 토큰(5분 JWT)을 발급하고 앱이 그 토큰이 있을 때만 생성**하도록 한다. 완전한 서버 생성은 2단계.

### 4-4. 결제 → 권한 반영

```
결제 완료(카드 등록) → billing-checkout이 billing_key 저장
   → 첫 결제 승인 → subscriptions.status='active'
   → 웹훅(payment.approved, 멱등) → payment_events 기록
   → 앱이 entitlements 재조회 → Pro UI
```
웹훅이 늦거나 유실될 수 있으므로 **결제창 복귀 시 `billing-verify`를 한 번 더 호출**해 PG에 승인 상태를 직접 조회한다(웹훅 단독 신뢰 금지).

### 4-5. 해지·환불

- 해지: `cancel_at_period_end=true`, 기간 만료 시 `status='expired'`. 즉시 잠그지 않는다(이미 낸 기간 보장).
- 결제 실패: `past_due` + 3일 유예 → 재시도 2회 → `expired`. 유예 중에는 Pro 유지, 상단에 결제 수단 갱신 배너.
- 환불: 청약철회 7일(디지털 콘텐츠 미사용 시). 사용 이력이 있으면 부분 환불 정책을 약관에 명시. 환불 시 `payment_events`에 `refund.approved` 기록 후 `status='canceled'`.
- 카드 변경: 새 빌링키 발급 → 기존 키 삭제 → `subscriptions.billing_key` 교체(트랜잭션).

### 4-6. 기기 → 계정 마이그레이션 (중요)

현재 앱은 모든 데이터가 `localStorage`에 있다. 첫 로그인 시:

1. `bojang.history.v4`(최대 5/30건), `bojang.session.v4`, `bojang.brand.v1`을 읽는다.
2. **사용자에게 묻는다**: "이 기기의 상담 N건을 계정에 올릴까요?" (고객 개인정보이므로 자동 업로드 금지 — 국외이전·보관 동의 필요).
3. 업로드 시 `clients`/`consultations`로 분해하고, 로컬에는 `owner_id`와 `synced_at`을 남긴다.
4. Free는 1명만 업로드 가능 → 나머지는 "Pro에서 동기화" 안내 후 로컬 보관.
5. 로그아웃해도 로컬은 유지하되, 다른 계정 로그인 시 `owner_id`가 다르면 읽기 전용으로 표시.

---

## 5. 결제 연동 상세

### 5-1. 상품

| 상품 | 가격 | PG 상품 ID | 비고 |
| --- | --- | --- | --- |
| Pro 월 구독 | 5,000원/월 | `pro_month` | 부가세 포함 표시 · 정식 출시 예정가 |
| Pro 연 구독 | 50,000원/년 | `pro_year` | 2개월 무료 (월 4,167원) · 정식 출시 예정가 |
| 베타 테스트 | 0원 | `beta` | 2026-11 정식 출시 전 전 기능 무료 |
| 14일 체험 | 0원 | `trial_14` | 카드 등록 없이 1회. `trialing` |

가격은 `products` 테이블 또는 Edge Function 상수로 두고, 클라이언트가 보낸 금액을 **절대 신뢰하지 않는다**(위변조 방지).

### 5-2. 토스페이먼츠 빌링키 흐름 (1순위)

1. `billing-checkout` 함수가 `customerKey`(난수 UUID)와 성공/실패 URL 반환.
2. 앱이 토스 결제창(`https://pay.toss.im/...` 또는 SDK)으로 카드 등록.
3. 성공 리다이렉트의 `authKey`를 `billing-issue` 함수로 전달 → 토스 `POST /v1/billing/authorizations/issue` 로 **빌링키** 발급.
4. 빌링키로 첫 결제 `POST /v1/billing/{billingKey}` 승인.
5. `subscriptions` upsert(`active`, `current_period_end`). 빌링키는 Vault/암호화 컬럼에 저장.
6. 매월/매년 스케줄(§5-4)로 자동결제.

> 토스 API 버전·경로는 계약 시점 문서를 따른다. 테스트 키(`test_ck_...`)로 전체 플로우를 먼저 검증한다.

### 5-3. 포트원 V2 (2순위)

- `PortOne.requestPayment({ channelKey, billingKey: ... })` 또는 빌링키 발급 API.
- 여러 PG(토스·KG이니시스·나이스)를 채널로 묶어 이탈률을 낮출 수 있다.
- 웹훅 서명 검증(`webhook-id`, `webhook-timestamp`, `webhook-signature`) 필수.

### 5-4. 정기결제 스케줄

- Supabase `pg_cron` + Edge Function: 매일 03:00 KST `billing-run`.
- 대상: `status in ('active','past_due')` and `current_period_end <= now() + 1 day`.
- 처리: PG 결제 승인 → 성공 시 기간 연장, 실패 시 `past_due` + 재시도 큐.
- **멱등**: `payment_events(provider, provider_event_id)` unique + `subscriptions.updated_at` 조건부 업데이트.

```sql
select cron.schedule('billing-daily', '0 18 * * *',  -- 03:00 KST (UTC 18:00)
  $$ select net.http_post(
       url := 'https://<project>.supabase.co/functions/v1/billing-run',
       headers := jsonb_build_object('Authorization','Bearer ' || current_setting('app.cron_secret'))
     ) $$);
```

### 5-5. 웹훅

```ts
// supabase/functions/billing-webhook/index.ts (요지)
Deno.serve(async (req) => {
  const raw = await req.text();
  if (!verifySignature(req.headers, raw, Deno.env.get("PG_WEBHOOK_SECRET")!)) {
    return new Response("bad signature", { status: 401 });
  }
  const evt = JSON.parse(raw);
  const { error } = await admin.from("payment_events").insert({
    provider: "toss",
    provider_event_id: evt.eventId,
    event_type: evt.type,
    payload: evt,
    amount_krw: evt.data?.totalAmount ?? null,
  });
  if (error?.code === "23505") return new Response("duplicate", { status: 200 }); // 멱등
  await applyEvent(evt);   // 구독 상태 전이
  return new Response("ok");
});
```

### 5-6. 세금·정산

- 부가세 포함 금액으로 표시. 연 구독은 1회 결제로 처리(분할 청구 아님).
- 세금계산서 발행을 위해 `profiles.business_no`(선택)와 `billing_email`을 받는다. 개인 고객은 현금영수증.
- PG 정산 주기·수수료(카드 3.3% 내외, 정기결제 별도 협의)는 계약서 기준으로 `docs/billing-terms.md`에 기록.

---

## 6. 화이트라벨 저장·적용

- `brand_profiles`는 1인 1행. `theme`는 4종 enum.
- 저장 시 Edge Function `brand-save`가 `is_pro` 확인 후 upsert. Free는 403 + `PAYWALL:brandSave`.
- 앱은 로그인 후 `GET brand_profiles`를 받아 `BojangBrand.hydrate(row)`로 주입. 현재 `localStorage['bojang.brand.v1']`은 오프라인 캐시로 유지.
- PDF 표지·꼬리말은 서버 생성 시 `brand_profiles`를 조인해 각인(클라이언트 위변조 방지).
- 로고 업로드는 2MB 이하 PNG/SVG, 비공개 버킷 + 서명 URL. 악성 SVG 스크립트 제거(살균).

---

## 7. 개인정보 최소 수집 · 암호화 · 보관

### 7-1. 최소 수집 원칙

| 데이터 | 수집 | 보관 | 비고 |
| --- | --- | --- | --- |
| 설계사 계정 | 이메일, 닉네임, (선택)연락처 | 탈퇴 시 30일 내 파기 | 결제 기록은 전자상거래법 5년 |
| 고객 이름 | 가명/이니셜 권장 | 계약 종료 후 3년 또는 고객 요청 시 즉시 | 실제 이름은 암호화 |
| 고객 생년월일 | 보험나이 계산 목적 | 상담 후 1년 (설정 가능) | 암호화 |
| 고객 연락처 | 후속 연락 목적 | 동의 철회 시 즉시 | 암호화 |
| 상담 결과 | 점수·부족분 요약 | 3년 | 원문 전체 저장 금지 |
| 결제 | 카드정보 **미보관** | PG 보관 | 빌링키만 암호화 저장 |

### 7-2. 기술적 보호

- 전 구간 TLS. HSTS.
- DB 암호화: `pgp_sym_encrypt`(AES-256) + Vault 키. 키는 90일 회전, `key_version` 기록.
- Supabase Storage: 버킷 `private`, RLS 정책으로 `auth.uid()` 경로만. PDF는 5분 Signed URL.
- 로그에 이름·연락처·주민번호를 남기지 않는다. 에러 리포트(Sentry)에서 `input_json` 마스킹.
- 관리자(role='admin')도 고객 원문 열람 시 **사유 입력 + 감사 로그**(`admin_access_logs`).
- 백업: Supabase PITR(7일) + 주 1회 암호화 덤프를 별도 리전에 30일 보관. 복구 리허설 분기 1회.

### 7-3. 국외 이전

Supabase 리전은 **ap-northeast-2(서울)** 를 선택한다. 부득이 싱가포르/도쿄를 쓰면 국외이전 고지·동의를 받아야 한다. 결제 PG(토스/포트원)는 국내 사업자.

### 7-4. 고객 권리

- 앱 내 "내 데이터 내려받기"(JSON) / "삭제 요청" 버튼 → Edge Function `data-request` → 30일 내 처리, `consent_logs`에 기록.
- FC가 고객 데이터를 삭제하면 `clients.status='deleted'` + 30일 후 하드 삭제(pg_cron).

---

## 8. API 표면 (Edge Functions)

| 함수 | 메서드 | 인증 | 역할 |
| --- | --- | --- | --- |
| `entitlements` | GET | JWT | Free/Pro·한도·기능 플래그 |
| `billing-checkout` | POST | JWT | customerKey·결제 세션 생성 |
| `billing-issue` | POST | JWT | authKey → 빌링키 발급·첫 결제 |
| `billing-verify` | POST | JWT | 결제 복귀 시 PG 상태 재확인 |
| `billing-cancel` | POST | JWT | 해지 예약/즉시 해지 |
| `billing-webhook` | POST | 서명 | PG 웹훅 수신(멱등) |
| `billing-run` | POST | cron secret | 정기결제 배치 |
| `brand-save` | POST | JWT + Pro | 화이트라벨 저장 |
| `pdf-entitlement` | POST | JWT + Pro | 10·30장 PDF 권한·서명 URL |
| `data-request` | POST | JWT | 내려받기·삭제 요청 |
| `admin-metrics` | GET | JWT + admin | MRR·이탈·실패율 |

응답 규약: 성공 `200`, 권한 없음 `403 {code:"PAYWALL:deck"}`, 한도 `402 {code:"LIMIT:clients"}`, 검증 실패 `422`. 앱은 `PAYWALL:*`을 받으면 동일한 페이월 모달을 띄운다(현재 `openPaywall(feature)` 재사용).

---

## 9. 프론트엔드 변경점 (v5.2 베타 → 상용)

1. `monetize.js`의 `plan` 변수를 `BojangPlan.hydrate(entitlements)`로 교체. 데모 스위치는 `?demo=1`에서만 노출.
2. `saveConsult()`: 서버 저장 성공 시 로컬 캐시 갱신. 402 응답 → `openPaywall('save2')`.
3. `doPdf('detail'|'advisor')`: `pdf-entitlement` 호출 → 토큰 없으면 페이월.
4. `BojangBrand.save()`: `brand-save` 성공 후 로컬 캐시.
5. 로그인 UI: 헤더 플랜 배지 옆에 프로필 아바타. 비로그인 시 "로그인" 버튼.
6. 동기화 상태 아이콘(구름/오프라인), 충돌 시 "이 기기 우선 / 서버 우선" 선택.
7. 서비스워커: API 응답은 캐시하지 않는다(`/functions/*` 제외). 정적 자산만 캐시.

---

## 10. 단계별 로드맵

| 단계 | 기간(예시) | 산출물 | 완료 기준 |
| --- | --- | --- | --- |
| M0. 준비 | 3일 | Supabase 프로젝트(서울), 카카오/구글 앱, 토스 테스트 상점 | 테스트 로그인·테스트 결제 1건 |
| M1. 인증 | 4일 | 로그인 UI, `profiles`, 세션 복구 | 카카오/구글/OTP 로그인, 로그아웃, 재실행 유지 |
| M2. 권한 | 3일 | `subscriptions`, `is_pro`, `entitlements`, Free 제한 | Free/Pro 전환 시 잠금·해제, 402/403 처리 |
| M3. 결제 | 6일 | 빌링키 발급·첫 결제·해지·웹훅·배치 | 테스트 카드 월/연 결제, 해지 예약, 실패 유예 |
| M4. 동기화 | 5일 | `clients`·`consultations`·`remodel_scenarios` + 마이그레이션 | 기기 2대에서 동일 데이터, 오프라인 편집 후 병합 |
| M5. 화이트라벨·PDF | 4일 | `brand-save`, `pdf-entitlement` | 저장값이 PDF 표지·꼬리말에 반영, Free 차단 |
| M6. 운영 | 상시 | Sentry, 지표 대시보드, 약관·개인정보처리방침, 고객센터 | MRR·이탈·결제실패 알림 |

---

## 11. 테스트 계획

- **단위**: `is_pro` 경계(기간 만료 1초 전/후), Free 1명 제한 트리거, 웹훅 멱등(같은 eventId 2회), 금액 위변조(클라이언트가 0원 전송).
- **통합(스테이징)**: 카카오 로그인 → 체험 14일 → 월 결제 → 해지 → 기간 만료 → Free 강등. 각 단계 `entitlements` 스냅샷 비교.
- **E2E(Playwright)**: 로그인, Free 페이월 4종, Pro 전환, 10장 PDF 다운로드, 브랜드 저장 후 PDF 표지 텍스트 검증.
- **보안**: RLS 교차 접근(다른 user_id로 select/update 시도 → 0행/403), Storage 경로 탈취, JWT 만료 후 요청, 웹훅 서명 위조.
- **부하**: PDF 생성 동시 20건, 웹훅 100건/분. Supabase Edge Function 동시성 한도 확인.
- **개인정보**: 삭제 요청 후 30일 내 모든 테이블·Storage·백업에서 제거 확인.

---

## 12. 비용·운영 개략

| 항목 | 무료/소규모 | 성장기(1,000명) |
| --- | --- | --- |
| Supabase | Free (DB 500MB, Edge 500K/월) | Pro $25~ + 사용량 |
| 결제 수수료 | 카드 3.3% 내외 | 협의 |
| PDF 서버 생성 | Edge Function 실행시간 | 워커 분리 검토 |
| 도메인·SSL | Cloudflare 무료 | 동일 |
| Sentry | 무료 5K 이벤트 | Team $26~ |

> 1,000명 × 5,000원 = 월 500만원, PG 수수료 약 16.5만원. Supabase·관측 비용은 100만원 이하로 유지 가능.

---

## 13. 리스크와 대응

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| 정적 JS에 콘텐츠 노출 | 유료 가치 훼손 | 핵심 자산(PDF·브랜드·고객)은 서버 생성·서버 저장 |
| 카카오 비즈 앱 심사 지연 | 로그인 출시 지연 | 구글·이메일 OTP 먼저 오픈, 카카오 후속 |
| 결제 웹훅 유실 | Pro 미반영 | 복귀 시 `billing-verify` 이중 확인 + 일일 대사 |
| 고객 개인정보 유출 | 법적·신뢰 타격 | 암호화 컬럼, RLS, 최소 수집, 감사 로그, 2인 승인 |
| 기기 데이터와 계정 충돌 | 상담 기록 중복/유실 | `owner_id`·`synced_at`·충돌 해결 UI |
| 약관·환불 분쟁 | 환불 요구 | 7일 청약철회·사용 후 부분환불 명시, 결제 전 동의 기록 |

---

## 14. 지금 코드에서 바로 이어 붙일 지점

| 현재 | 상용 교체 |
| --- | --- |
| `localStorage['bojang.plan.v1']` | `BojangPlan.hydrate(entitlements)` |
| `BojangPlan.setPlan('pro')` (데모) | `billing-checkout` → 결제 → `entitlements` 재조회 |
| `BojangPlan.openPaywall(feature)` | 동일 + `feature`를 서버 코드(`PAYWALL:deck`)와 매핑 |
| `buildPdfBlob(kind)` 클라이언트 생성 | `pdf-entitlement` 토큰 필요, 2단계에서 서버 생성 |
| `BojangBrand.save()` 로컬 저장 | `brand-save` upsert + 로컬 캐시 |
| `saveConsult()` localStorage | `consultations` insert + 로컬 캐시 |
| `sw.js` 정적 캐시 | `/functions/*`·`/rest/*` 캐시 제외 |

이 문서의 스키마·정책·함수 표면을 그대로 마이그레이션 파일(`supabase/migrations/0001_init.sql`)로 옮기면 M1을 바로 시작할 수 있다.

---

## 15. v5.3 자동입력 — AI 비전 프록시 (3단계 백엔드 설계)

정적 베타(v5.3)는 **수기 / 사진 즉시 촬영(휘발) / PDF·텍스트 로컬 추출** 세 갈래 입력을 이미 제공합니다.
사진의 숫자 자동 인식만 서버가 필요하며, 클라이언트에는 어댑터 `BojangImport.parseWithVisionBackend(blob, endpoint)` 가 준비되어 있습니다.
`import-parser.js`의 `VISION_ENDPOINT` 값을 비워 두면 비전 호출이 일어나지 않습니다(정적 베타 기본값).

### 15-1. 엔드포인트

```
POST /functions/v1/vision-parse        (Edge Function, JWT 필요)
Content-Type: multipart/form-data
  image:  image/jpeg  (클라이언트 전처리본 · 최대 1600px, 품질 0.85)
  hint?:  string      (예: "암/뇌/심장 담보표")
Authorization: Bearer <user JWT>

200 → { "text": "...", "items": [{ "field": "cancer.general", "value": 5000, "snippet": "..." }], "premium": 24, "silson": "4", "model": "gpt-4o-vision", "ms": 1840 }
4xx → { "error": "too_large" | "not_coverage_table" | "rate_limited" }
```

- `text` 를 돌려주면 클라이언트가 `parseCoverageText()` 로 다시 파싱해 **인식 근거(snippet)를 그대로 검수 화면**에 보여줍니다. `items` 를 직접 돌려주는 경로도 지원합니다.
- 목표: 3단계 연동 시 담보 숫자 자동 인식률 **95% 이상**, p95 응답 4초 이내.

### 15-2. 휘발성 보장 (서버 쪽)

| 항목 | 규칙 |
| --- | --- |
| 이미지 저장 | **저장하지 않음.** Edge Function 메모리에서만 처리하고 응답 후 폐기 |
| 로깅 | 이미지 바이트·base64 를 로그에 남기지 않음(요청 크기·소요시간·모델명만) |
| 캐시 | CDN·프록시 캐시 금지(`Cache-Control: no-store`) |
| 보관 | 인식 결과 텍스트도 서버에 저장하지 않고 응답으로만 반환 |
| 감사 | 호출 사용량(사용자·일시·토큰)만 집계, 내용 미포함 |
| 권한 | `is_pro()` 또는 베타 화이트리스트, 레이트 리밋(사용자당 분당 6회) |

### 15-3. 개인정보 최소화

- 클라이언트가 촬영 전 **민감정보 가림 안내**를 띄우고, 필요하면 상단/하단 크롭(담보표 영역)을 먼저 적용합니다.
- 프록시는 이름·주민번호 패턴(`\d{6}-\d{7}`)을 감지하면 **해당 줄을 마스킹한 뒤** 모델에 전달하고, 응답에도 남기지 않습니다.
- 3단계에서도 **원본 사진 미저장 원칙**을 유지하므로, 사고 시 유출 대상이 존재하지 않습니다.

### 15-4. 교체 지점

| 현재(v5.3 정적) | 3단계 |
| --- | --- |
| `VISION_ENDPOINT = ''` | Supabase Functions URL |
| `preprocessImage()` → 통계만 표시 | 같은 전처리본을 `parseWithVisionBackend()` 로 전송 |
| PDF/텍스트 로컬 추출 | 그대로 유지(오프라인·비용 0) — 서버는 사진만 보조 |

---

## 16. v5.4 구현 매핑 (이 문서 → 실제 코드)

이 설계서의 1~4단계(M1·M2·M3) 중 **스키마 · 인증 · 구독 결제 · AI 비전 프록시**를 실행 가능한 코드로 옮겼습니다.

| 설계서 위치 | 구현 파일 | 비고 |
| --- | --- | --- |
| §2 스키마 · §3 RLS · §3-1 is_pro | `supabase/migrations/001_initial_schema.sql` | `profiles`·`subscriptions`·`clients`·`brand_settings`·`audit_logs`, updated_at 트리거, 가입 시 프로필 자동 생성, `billing_key` 컬럼 권한 차단 |
| §5-2·§5-3 결제 | `supabase/functions/billing-subscribe/index.ts` | 월 5,000 / 연 50,000 서버 상수, 토스 빌링키 발급+첫 결제, 포트원 V2 검증, `BILLING_TEST_MODE` |
| §5-5 웹훅 | `supabase/functions/billing-webhook/index.ts` | HMAC 서명 검증, `audit_logs.dedupe_key` 멱등, 상태 전이(active·past_due·canceled) |
| §15 AI 비전 프록시 | `supabase/functions/parse-coverage-vision/index.ts` | JWT 검증, 10MB 제한, **저장 없는 메모리 처리**, `Cache-Control: no-store`, 분당 6회, PII 마스킹, `parseCoverageText` 호환 JSON |
| §4-1 entitlements(단순판) | 앱 `backend.js` → `subscriptions` 조회 → `BojangPlan.hydrate()` | 별도 함수 없이 RLS 조회로 처리(초기 단계) |
| §9 프론트 변경점 | `apps/bojang-guide/backend.js` + `monetize.js`·`import-parser.js`·`app.js` | SDK 없는 fetch 레이어, `beta-local` / `live-backend` 자동 판별, 계정/구독 모달 |

배포 절차·환경변수는 `supabase/DEPLOY.md`, 검증은 `tests/test_v5_4.py`(116항목)를 참고하세요.

**아직 구현하지 않은 것(다음 단계):** `entitlements` 전용 함수와 서버 강제 페이월(§4-2), 기기→계정 마이그레이션 UI(§4-6), 정기결제 배치(`billing-run`, §5-4), PDF 서버 생성·서명 URL(§4-3), 카카오 OAuth 활성화(§1-1).
