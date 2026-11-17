/* 보장분석 라이프 리포트 v6.0 — 버전 단일 상수 (version.js)

   v5.9: 버전 표기가 헤더·입력 영역·모달·PDF·서비스워커·manifest 에 흩어져
   v5.2 / v5.5 / v5.8 이 섞여 보이던 문제를 없앱니다.
   이 파일의 APP_VERSION 하나만 고치면 화면에 보이는 모든 표기가 함께 바뀝니다.
   · HTML 정적 표기는 data-app-version / data-app-version-eyebrow / data-app-version-label 로 표시하고
     syncDom() 이 시작할 때 APP_VERSION 으로 다시 채웁니다. */
(function (root) {
  'use strict';

  const APP_VERSION = 'v6.1';
  const APP_VERSION_NUM = APP_VERSION.replace(/^v/, '');
  const APP_VERSION_MONTH = '2026.11';
  const APP_TAGLINE = '고객 맞춤형 보장 점검 · 리모델링 상담 가이드';

  function label() { return APP_VERSION + ' · ' + APP_VERSION_MONTH; }
  function eyebrow() { return 'LIFE REPORT · BETA ' + APP_VERSION.toUpperCase(); }
  function short() { return APP_VERSION; }
  function title(name) { return (name || '보장분석 라이프 리포트') + ' ' + APP_VERSION + ' · ' + APP_TAGLINE; }
  function cacheName() { return 'bojang-guide-' + APP_VERSION; }

  function syncDom(doc) {
    doc = doc || root.document;
    if (!doc) return;
    const setText = (sel, text) => {
      Array.prototype.forEach.call(doc.querySelectorAll(sel), (el) => { el.textContent = text; });
    };
    setText('[data-app-version]', short());
    setText('[data-app-version-label]', label());
    setText('[data-app-version-eyebrow]', eyebrow());
    setText('[data-app-version-full]', APP_VERSION + ' (' + APP_VERSION_MONTH + ')');
    if (doc.title) doc.title = doc.title.replace(/\bv\d+\.\d+\b/, APP_VERSION);
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => syncDom(root.document));
    } else {
      syncDom(root.document);
    }
  }

  root.APP_VERSION = APP_VERSION;
  root.BojangVersion = {
    value: APP_VERSION, num: APP_VERSION_NUM, month: APP_VERSION_MONTH,
    label, eyebrow, short, title, cacheName, syncDom
  };
})(typeof window !== 'undefined' ? window : globalThis);
