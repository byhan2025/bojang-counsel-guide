# 보장분석 라이프 리포트 v6.0 — 백엔드 배포 1분 가이드

> 이 폴더(`apps/bojang-guide/supabase/`)는 **그대로 실행 가능한 Supabase 패키지**입니다.
> SQL 마이그레이션 · Edge Function 3종 · 설정 파일이 모두 들어 있고, 앱(`backend.js`)은
> `SUPABASE_URL` / `SUPABASE_ANON_KEY` 가 비어 있으면 자동으로 **베타 오프라인 모드**로 동작합니다.
> 서버를 연결하는 순간 클라우드 동기화 · AI 사진 인식 · 구독 결제가 켜집니다.

---

## 0. 준비물 (한 번만)

| 항목 | 확인 |
| --- | --- |
| Supabase 계정 + 프로젝트 (리전 **ap-northeast-2 서울** 권장 — 국외이전 고지 불필요) | https://supabase.com/dashboard |
| Supabase CLI (`supabase --version` ≥ 2.x) | `brew install supabase/tap/supabase` |
| (선택) AI 비전 키 — OpenAI 또는 Gemini **1개** | `OPENAI_API_KEY` 또는 `GEMINI_API_KEY` |
| (선택) 토스페이먼츠 테스트 상점 시크릿 키 | `TOSS_SECRET_KEY` (`test_ck_...`) |

---

## 1. 1분 배포 (복사·붙여넣기)

```bash
cd apps/bojang-guide

# 1) 연결 (최초 1회) — PROJECT_REF 는 대시보드 URL의 https://<PROJECT_REF>.supabase.co
supabase link --project-ref <PROJECT_REF>

# 2) 스키마 적용 — profiles · subscriptions · clients · brand_settings · audit_logs
#    + consultations(002) + registered_devices · qr_challenges · pc_sessions(003) + RLS
supabase db push

# 3) 함수 배포 (JWT 검증 · CORS · 캐시 금지 헤더 포함)
supabase functions deploy parse-coverage-vision billing-subscribe billing-webhook
# v6.0 스마트키 (QR 로그인 · 기기 관리 · 원격 잠금)
supabase functions deploy qr-auth-challenge qr-auth-approve device-manage
```

### 시크릿 등록 (배포 후 1회)

```bash
supabase secrets set \
  OPENAI_API_KEY=sk-... \
  VISION_MODEL=gpt-4o-mini \
  TOSS_SECRET_KEY=test_ck_... \
  PG_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  BILLING_TEST_MODE=true
# Gemini 를 쓸 경우 OPENAI_API_KEY 대신:
# supabase secrets set GEMINI_API_KEY=... GEMINI_VISION_MODEL=gemini-2.0-flash
```

> `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_ANON_KEY` 는 Supabase 가 함수에 **자동 주입**합니다.
> 따로 넣지 마세요. 서비스 롤 키는 절대 앱(브라우저)에 넣지 않습니다.

### 로컬에서 먼저 검증하려면

```bash
supabase start                     # 로컬 스택 (API :54321, DB :54322, Studio :54323)
supabase db reset                  # migrations/001_initial_schema.sql 재적용
supabase functions serve parse-coverage-vision --env-file ./supabase/.env.local
```

---

## 2. 환경변수 체크리스트

| 변수 | 필수 | 쓰는 함수 | 설명 |
| --- | --- | --- | --- |
| `SUPABASE_URL` | ✅ (자동) | 전체 | 프로젝트 URL |
| `SUPABASE_ANON_KEY` | ✅ (자동) | — | 앱에 넣는 공개 키(RLS 보호) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ (자동) | 전체 | RLS 우회. 함수 서버에서만 |
| `OPENAI_API_KEY` | ⬜ | parse-coverage-vision | 있으면 OpenAI 우선 |
| `VISION_MODEL` | ⬜ | parse-coverage-vision | 기본 `gpt-4o-mini` |
| `GEMINI_API_KEY` | ⬜ | parse-coverage-vision | OpenAI 키가 없을 때 사용 |
| `GEMINI_VISION_MODEL` | ⬜ | parse-coverage-vision | 기본 `gemini-2.0-flash` |
| `TOSS_SECRET_KEY` | ⬜ | billing-subscribe | 토스 빌링키 발급·첫 결제 |
| `PORTONE_API_SECRET` | ⬜ | billing-subscribe | 포트원 V2 검증(2순위) |
| `PG_WEBHOOK_SECRET` | ⬜ | billing-webhook | 웹훅 HMAC 서명 검증(없으면 웹훅 401) |
| `BILLING_TEST_MODE` | ⬜ | billing-subscribe | `true` 면 PG 없이 구독 전환(응답 `test:true`) |

**AI 키가 하나도 없으면** `parse-coverage-vision` 은 `503 provider_not_configured` 를 돌려주고,
앱은 v5.3 의 정적 베타 안내로 자동 복귀합니다(결제·동기화는 영향 없음).

---

## 3. 앱에 연결값 넣기

두 가지 방법 중 하나.

**(A) 개발자 설정 패널 (권장 · 코드 수정 없음)**
1. 앱 상단 **👤 계정** → **개발자 설정**
2. `SUPABASE_URL`(예: `https://abcd1234.supabase.co`) · `SUPABASE_ANON_KEY`(`eyJ...` anon public) 입력 → **저장**
3. **연결 테스트** → `연결됨 · 실서버 모드` 로 바뀌면 끝 (값은 그 브라우저 localStorage `bojang.backend.v1` 에만 저장)

**(B) 정적 배포에 고정**
`index.html` 의 `backend.js` 스크립트보다 앞에 한 줄 추가:

```html
<script>
  window.__BOJANG_CONFIG__ = {
    SUPABASE_URL: "https://abcd1234.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOi...",
    VISION_FN: "",        // 비우면 <SUPABASE_URL>/functions/v1/parse-coverage-vision
    BILLING_FN: ""        // 비우면 <SUPABASE_URL>/functions/v1/billing-subscribe
  };
</script>
```

---

## 4. 동작 확인 (5분)

| 순서 | 확인 | 기대 결과 |
| --- | --- | --- |
| 1 | 앱 → 👤 계정 | `베타 오프라인 모드` 안내 + 로그인/회원가입 폼 + 월 5,000원 / 연 50,000원 요금 |
| 2 | 회원가입 (이메일·비밀번호 6자 이상) | Supabase Auth 사용자 생성 → `audit_logs` 는 profiles 자동 생성 트리거로 `profiles` 행 생성 |
| 3 | 로그인 | 세션 저장(`bojang.auth.v1`) · 새로고침 후에도 로그인 유지(토큰 자동 갱신) |
| 4 | 사진 즉시 촬영 | AI 키가 있으면 `parse-coverage-vision` 호출 → 검수 화면에 담보·금액·근거 원문 |
| 5 | 구독 시작(테스트 모드) | `subscriptions` 에 `plan=pro · status=active · price_krw=5000/50000` |
| 6 | 웹훅 | `supabase functions logs billing-webhook` 에 `webhook.paid / duplicate:true(재전송)` |

### 서명 웹훅 테스트

```bash
BODY='{"eventId":"evt_test_1","eventType":"PAYMENT_STATUS_CHANGED","data":{"status":"DONE","customerKey":"<customer_key>","totalAmount":5000}}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$PG_WEBHOOK_SECRET" -binary | base64)
curl -s -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/billing-webhook" \
  -H "Content-Type: application/json" \
  -H "tosspayments-webhook-transmission-time: $TS" \
  -H "tosspayments-webhook-signature: $SIG" \
  --data "$BODY"
# → {"ok":true,"kind":"paid",...}   같은 요청을 한 번 더 → {"ok":true,"duplicate":true}
```

---

## 5. 파일 지도

```
supabase/
├── config.toml                       # 프로젝트·함수(JWT) 설정
├── DEPLOY.md                         # 이 문서
├── .env.local.example                # 로컬 serve 용 시크릿 예시
├── migrations/
│   └── 001_initial_schema.sql        # 5개 테이블 + RLS + is_pro() + updated_at 트리거
└── functions/
    ├── _shared/http.ts               # CORS · no-store · JSON 응답
    ├── _shared/supabase.ts           # admin(service_role) · requireUser(JWT) · audit()
    ├── parse-coverage-vision/index.ts# 사진 → 텍스트(휘발) · 최대 10MB · 1분 6회
    ├── billing-subscribe/index.ts    # 월 5,000 / 연 50,000 · 빌링키·첫 결제 · 테스트 모드
    └── billing-webhook/index.ts      # 서명 검증 · 멱등 · 구독 상태 동기화
```

---

## 6. 운영 주의

- **이미지 미저장**: `parse-coverage-vision` 은 Storage·DB·로그에 사진을 남기지 않습니다(`persisted:false`).
  감사 로그에는 바이트 수·모델·소요시간만 남습니다.
- **금액 위변조**: 결제 금액은 함수 상수(`PLAN_PRICE`)만 사용합니다. 앱이 보낸 금액은 무시합니다.
- **RLS**: `subscriptions` 는 본인 읽기만, 쓰기는 service_role 만. `billing_key` 는 컬럼 권한으로
  authenticated 에게 숨깁니다. 실서비스에서는 Vault 암호화를 권장합니다.
- **레이트 리밋**: 사진 인식은 사용자당 1분 6회(인스턴스 메모리 기준). 트래픽이 커지면
  `audit_logs` 집계 기반으로 승격하세요.
- **카카오 로그인**: `config.toml` 의 `[auth.external.kakao]` 주석을 풀고 Kakao Developers 키를 넣으면
  웹 OAuth 가 켜집니다(비즈 앱 심사 필요). 앱의 이메일 로그인은 그대로 동작합니다.

---

## v6.0 스마트키 배포 체크 (003 마이그레이션 · 함수 3종)

| 항목 | 내용 |
| --- | --- |
| `migrations/003_smartkey_devices.sql` | `registered_devices`(2기기 유니크) · `qr_challenges`(180초·단회 소비) · `pc_sessions`(원격 잠금) + RLS. 여러 번 실행해도 안전합니다. |
| `functions/qr-auth-challenge` | PC 가 로그아웃 상태여도 호출 가능. PC 키 서명(pc_sig) 검증 → 1회용 코드 발급. 요청 제한 분당 8회. |
| `functions/qr-auth-approve` | 폰 JWT 필수. 마스터 기기 검증 · 폰 기기 서명 검증 · 원자적 단회 소비 · 만료 검사 · 상담 데이터는 암문(enc)만 저장. |
| `functions/device-manage` | 기기 목록 · 등록(최대 2) · 기존 PC 밀어내기 · 원격 잠금(세션 무효) · PC 세션 확인. |
| `parse-coverage-vision` | `x-smartkey-session` 헤더가 있으면 기기·세션을 확인하고, 원격 잠금된 세션이면 `device_revoked` 401. |

배포 전에는 앱이 자동으로 **같은 브라우저 안 모의 릴레이**로 동작합니다(만료·단회·서명 규칙 동일).
기기를 넘나드는 스마트키 동기화는 위 3개 함수를 배포한 뒤 켜집니다.

```bash
supabase db push
supabase functions deploy qr-auth-challenge qr-auth-approve device-manage
# 확인
curl -i -X POST "$SUPABASE_URL/functions/v1/qr-auth-challenge" -H "Content-Type: application/json" -d '{}'
# → 400 bad-request (함수가 살아 있으면 404 가 아닙니다)
```
