// =====================================================================
// 보장분석 라이프 리포트 v5.4 — 구독 시작 (billing-subscribe)
//
// POST /functions/v1/billing-subscribe      (Authorization: Bearer <user JWT>)
//   { "plan": "month" | "year",                                        // 필수
//     "provider": "toss" | "portone" | "test",                          // 생략 시 서버 기본값
//     "authKey": "...",         // 토스: 카드등록 성공 리다이렉트의 authKey
//     "billingKey": "...",      // 포트원: 사전 발급 빌링키(또는 paymentId 로 검증)
//     "paymentId": "...",       // 포트원: 결제 ID (서버가 금액·상태를 직접 조회)
//     "customerKey": "..." }    // 생략 시 서버가 난수 생성
//
// 금액은 절대 클라이언트 값을 쓰지 않습니다. 아래 PLAN_PRICE 상수만 신뢰합니다.
//   월 구독 5,000원 / 연 구독 50,000원 (부가세 포함 표시가)
//
// 200 → { ok:true, plan:"pro", status:"active", billing_cycle:"month",
//         price_krw:5000, current_period_start, current_period_end, provider, test:false }
// 4xx → { ok:false, error:"invalid_plan" | "already_active" | "payment_failed" | ... }
//
// 테스트 모드: BILLING_TEST_MODE=true 이면 PG 호출 없이 subscriptions 를 active 로 올리고
//              응답에 test:true 를 붙입니다(앱 화면·권한 전환 검증용).
// =====================================================================
import { fail, json, preflight, sha256Hex } from "../_shared/http.ts";
import { admin, audit, env, requireUser } from "../_shared/supabase.ts";

type Cycle = "month" | "year";

const PLAN_PRICE: Record<Cycle, { amount: number; label: string }> = {
  month: { amount: 5000, label: "보장분석 라이프 리포트 Pro 월 구독" },
  year: { amount: 50000, label: "보장분석 라이프 리포트 Pro 연 구독" },
};

function addCycle(from: Date, cycle: Cycle): Date {
  const d = new Date(from.getTime());
  if (cycle === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

function uuid(): string {
  return crypto.randomUUID();
}

type SubRow = { id: string; status: string; current_period_end: string | null };

/** v6.1 — 테스트 결제 우회는 명시적 non-prod 환경에서만 허용합니다(기본 차단).
 *  운영에서 BILLING_TEST_MODE=true 만 켜져 있으면 무시되고, provider=test 요청은 403 으로 거부됩니다.
 *  허용 조건: BILLING_TEST_MODE=true  그리고  APP_ENV(또는 ENVIRONMENT)가 development/dev/staging/local/test */
function nonProdEnv(): boolean {
  const appEnv = String(env("APP_ENV") ?? env("ENVIRONMENT") ?? "production").toLowerCase();
  return ["development", "dev", "staging", "local", "test"].includes(appEnv);
}
function testModeAllowed(): boolean {
  const flag = String(env("BILLING_TEST_MODE") ?? "").toLowerCase() === "true";
  return flag && nonProdEnv();
}

async function liveSubscription(userId: string): Promise<SubRow | null> {
  const { data, error } = await admin()
    .from("subscriptions")
    .select("id, status, current_period_end")
    .eq("user_id", userId)
    .in("status", ["trialing", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as SubRow | null) ?? null;
}

async function activate(row: {
  userId: string;
  cycle: Cycle;
  provider: "toss" | "portone" | "test";
  billingKey?: string | null;
  customerKey: string;
  priceKrw: number;
}): Promise<{ id: string; start: string; end: string } | { error: string }> {
  const now = new Date();
  const end = addCycle(now, row.cycle);
  const existing = await liveSubscription(row.userId);
  const patch = {
    user_id: row.userId,
    plan: "pro" as const,
    billing_cycle: row.cycle,
    status: "active" as const,
    provider: row.provider,
    billing_key: row.billingKey ?? null,
    customer_key: row.customerKey,
    price_krw: row.priceKrw,
    current_period_start: now.toISOString(),
    current_period_end: end.toISOString(),
    cancel_at_period_end: false,
    canceled_at: null,
  };

  if (existing) {
    const { error } = await admin().from("subscriptions").update(patch).eq("id", existing.id);
    if (error) return { error: error.message };
    return { id: existing.id, start: patch.current_period_start, end: patch.current_period_end };
  }
  const { data, error } = await admin().from("subscriptions").insert(patch).select("id").maybeSingle();
  if (error) return { error: error.message };
  return { id: (data as { id: string } | null)?.id ?? "", start: patch.current_period_start, end: patch.current_period_end };
}

/** 토스페이먼츠: authKey → 빌링키 발급 → 즉시 첫 결제 */
async function tossSubscribe(opts: {
  authKey: string;
  customerKey: string;
  cycle: Cycle;
  email?: string;
}): Promise<{ ok: true; billingKey: string; paymentKey?: string } | { ok: false; code: string; status: number }> {
  const secret = env("TOSS_SECRET_KEY");
  if (!secret) return { ok: false, code: "toss_not_configured", status: 503 };
  const basic = "Basic " + btoa(`${secret}:`);
  const { amount, label } = PLAN_PRICE[opts.cycle];

  const issueRes = await fetch("https://api.tosspayments.com/v1/billing/authorizations/issue", {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/json" },
    body: JSON.stringify({ authKey: opts.authKey, customerKey: opts.customerKey }),
  });
  if (!issueRes.ok) {
    const detail = await issueRes.text().catch(() => "");
    return { ok: false, code: `billing_issue_failed_${issueRes.status}_${detail.slice(0, 80)}`, status: 502 };
  }
  const issued = await issueRes.json() as { billingKey?: string };
  const billingKey = issued.billingKey ?? "";
  if (!billingKey) return { ok: false, code: "billing_key_missing", status: 502 };

  const payRes = await fetch(`https://api.tosspayments.com/v1/billing/${encodeURIComponent(billingKey)}`, {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/json" },
    body: JSON.stringify({
      customerKey: opts.customerKey,
      amount,
      orderId: `bojang-${opts.cycle}-${Date.now()}-${uuid().slice(0, 8)}`,
      orderName: label,
      customerEmail: opts.email,
    }),
  });
  if (!payRes.ok) {
    const detail = await payRes.text().catch(() => "");
    return { ok: false, code: `payment_failed_${payRes.status}_${detail.slice(0, 80)}`, status: 402 };
  }
  const paid = await payRes.json() as { paymentKey?: string };
  return { ok: true, billingKey };
}

/** 포트원 V2: paymentId 로 결제 상태·금액을 서버가 직접 조회(클라이언트 금액 불신) */
async function portoneVerify(paymentId: string, cycle: Cycle): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  const secret = env("PORTONE_API_SECRET");
  if (!secret) return { ok: false, code: "portone_not_configured", status: 503 };
  const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `PortOne ${secret}`, "Content-Type": "application/json" },
  });
  if (!res.ok) return { ok: false, code: "portone_lookup_failed", status: 502 };
  const pay = await res.json() as { status?: string; amount?: { total?: number } };
  if (pay.status !== "PAID") return { ok: false, code: "payment_not_paid", status: 402 };
  if (Number(pay.amount?.total ?? 0) !== PLAN_PRICE[cycle].amount) {
    return { ok: false, code: "amount_mismatch", status: 422 };
  }
  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  const auth = await requireUser(req);
  if (!auth.ok) return fail(auth.code, auth.status);
  const userId = auth.user.id;
  const email = auth.user.email ?? undefined;

  let body: Record<string, string> = {};
  try {
    body = await req.json();
  } catch {
    return fail("bad_json", 422);
  }

  const cycle = String(body.plan ?? body.cycle ?? "") as Cycle;
  if (cycle !== "month" && cycle !== "year") return fail("invalid_plan", 422);
  const priceKrw = PLAN_PRICE[cycle].amount;

  const current = await liveSubscription(userId);
  if (current && current.status === "active" && current.current_period_end && new Date(current.current_period_end) > new Date()) {
    return json({
      ok: true,
      already_active: true,
      plan: "pro",
      status: "active",
      current_period_end: current.current_period_end,
      price_krw: priceKrw,
      billing_cycle: cycle,
    });
  }

  const ipHash = await sha256Hex(req.headers.get("x-forwarded-for") ?? "unknown");
  const testMode = testModeAllowed();
  const wantsTest = String(body.test ?? "") === "true" || String(body.provider ?? "") === "test";
  const provider = (String(body.provider ?? "") || (testMode ? "test" : "toss")) as "toss" | "portone" | "test";
  const customerKey = String(body.customerKey ?? "") || uuid();

  /* v6.1 — 운영에서는 test=true / provider=test 우회 경로를 차단합니다. */
  if (!testMode && (provider === "test" || wantsTest)) {
    await audit({
      userId, actor: "user", action: "billing.blocked", target: "subscriptions",
      detail: { cycle, price: priceKrw, reason: "test_bypass_blocked", provider: String(body.provider ?? ""), test: String(body.test ?? "") },
      ipHash,
    });
    return fail("test_bypass_blocked", 403);
  }

  let billingKey: string | null = String(body.billingKey ?? "") || null;

  if (provider === "test" || testMode) {
    // PG 호출 없이 구독 상태만 전환합니다. 응답 test:true 로 앱이 명확히 구분합니다.
    const res = await activate({ userId, cycle, provider: "test", billingKey: null, customerKey, priceKrw });
    if ("error" in res) return fail("db_error", 500, res.error);
    await audit({
      userId, actor: "user", action: "billing.subscribe", target: "subscriptions",
      detail: { plan: "pro", cycle, price: priceKrw, provider: "test", test: true, subscription_id: res.id },
      ipHash,
    });
    return json({
      ok: true, test: true, provider: "test", plan: "pro", status: "active", billing_cycle: cycle,
      price_krw: priceKrw, current_period_start: res.start, current_period_end: res.end,
    });
  }

  if (provider === "toss") {
    if (!body.authKey) return fail("auth_key_required", 422);
    const res = await tossSubscribe({ authKey: String(body.authKey), customerKey, cycle, email });
    if (!res.ok) {
      await audit({
        userId, actor: "user", action: "billing.failed", target: "subscriptions",
        detail: { cycle, price: priceKrw, provider: "toss", reason: res.code.slice(0, 80) }, ipHash,
      });
      return fail(res.code.split("_").slice(0, 2).join("_"), res.status);
    }
    billingKey = res.billingKey;
  } else if (provider === "portone") {
    if (!body.paymentId) return fail("payment_id_required", 422);
    const check = await portoneVerify(String(body.paymentId), cycle);
    if (!check.ok) return fail(check.code, check.status);
  } else {
    return fail("invalid_provider", 422);
  }

  const res = await activate({ userId, cycle, provider, billingKey, customerKey, priceKrw });
  if ("error" in res) return fail("db_error", 500, res.error);

  await audit({
    userId, actor: "user", action: "billing.subscribe", target: "subscriptions",
    detail: { plan: "pro", cycle, price: priceKrw, provider, test: false, subscription_id: res.id },
    ipHash,
  });

  return json({
    ok: true, test: false, provider, plan: "pro", status: "active", billing_cycle: cycle,
    price_krw: priceKrw, current_period_start: res.start, current_period_end: res.end,
  });
});
