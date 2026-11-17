/* 보장분석 상담 가이드 v7.2 — 사진 인식 안내 문구 (ocr.js)

   사진에서 담보표를 읽는 AI 경로는 두 가지입니다.
     · OpenAI 경로 — 모델 1개로 고정(대체 후보 없음)
     · Gemini 경로 — 모델 오류·요청 제한 시 최대 4개 모델 후보로 재시도
        (사용자 지정 Gemini → gemini-3.8-flash → gemini-4-hydrogen → gemini-flash-latest)

   v7.1.1까지는 이 둘을 한 문장에 섞어 적어, 고객이 "내 사진이 몇 개 모델로 가는지"를
   알 수 없었습니다. v7.2는 공급자별로 문구를 나눠 화면에 그대로 표시합니다.
   이 파일은 문구의 단일 출처입니다 — inputhub.js(촬영 안내)·app.js(개인정보처리방침)·
   index.html(정적 안내)이 모두 이 값을 씁니다. */
(function (root) {
  'use strict';

  const PROVIDERS = {
    openai: {
      key: 'openai',
      label: 'OpenAI 경로',
      models: 1,
      modelLabel: '단일 모델',
      modelsText: '모델 1개로 고정 — 오류 시 자동 대체 없이 실패를 알리고, 재시도는 사용자가 직접 누릅니다.',
      notice: 'OpenAI 경로(단일 모델): 사진은 자체 서버(Supabase Edge Function)를 거쳐 OpenAI 모델 1개로 전송됩니다. 모델 오류 시 다른 모델로 자동 전환하지 않습니다.',
      dataText: '전송 대상: OpenAI · 모델 1개 · 공급자 API 보관 정책 적용'
    },
    gemini: {
      key: 'gemini',
      label: 'Gemini 경로',
      models: 4,
      modelLabel: '최대 4개 모델 후보',
      modelsText: '오류·요청 제한 시 최대 4개 모델 후보로 순서대로 재시도(사용자 지정 Gemini → gemini-3.8-flash → gemini-4-hydrogen → gemini-flash-latest).',
      notice: 'Gemini 경로(최대 4개 모델 후보): 사진은 자체 서버(Supabase Edge Function)를 거쳐 Google Gemini로 전송되며, 오류·요청 제한 시 최대 4개 모델 후보로 재시도합니다.',
      dataText: '전송 대상: Google Gemini · 최대 4개 모델 후보 · 공급자 API 보관 정책 적용'
    }
  };

  const COMMON = '사진은 이 기기와 자체 서버 DB에 저장하지 않고 메모리에서 처리합니다. AI 인식 실행 시에만 외부로 전송됩니다.';
  const NO_AI = '사진 인식을 쓰지 않으면 어떤 이미지도 외부로 나가지 않습니다.';

  function notice(provider) { return (PROVIDERS[provider] || PROVIDERS.gemini).notice; }
  function short(provider) { const p = PROVIDERS[provider] || PROVIDERS.gemini; return p.label + '(' + p.modelLabel + ')'; }
  function both() { return [PROVIDERS.openai.notice, PROVIDERS.gemini.notice]; }
  function summary() {
    return '공급자별 경로 — ' + PROVIDERS.openai.label + '(' + PROVIDERS.openai.modelLabel + ') · ' +
      PROVIDERS.gemini.label + '(' + PROVIDERS.gemini.modelLabel + ')';
  }
  function providerOf(text) {
    const s = String(text || '').toLowerCase();
    if (/openai|gpt/.test(s) && !/gemini/.test(s)) return 'openai';
    return 'gemini';
  }

  function paint(doc) {
    doc = doc || root.document;
    if (!doc) return;
    Array.prototype.forEach.call(doc.querySelectorAll('[data-ocr-notice]'), (el) => {
      const p = el.getAttribute('data-ocr-notice') || 'gemini';
      const mode = el.getAttribute('data-ocr-mode') || 'full';
      el.textContent = mode === 'short' ? short(p) : notice(p);
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', () => paint(root.document));
    else paint(root.document);
  }

  root.BojangOcr = { PROVIDERS, COMMON, NO_AI, notice, short, both, summary, providerOf, paint };
})(typeof window !== 'undefined' ? window : globalThis);
