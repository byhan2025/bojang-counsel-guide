/* 보장분석 라이프 리포트 v5.4 — 입력 방식 허브 (inputhub.js)

   상담을 시작할 때 "수기 입력 / 사진 즉시 촬영(휘발) / 보장분석 PDF·텍스트" 중
   무엇으로 입력할지 먼저 고르게 하고, 촬영·추출 화면과 검수 화면을 맡습니다.
   실제 파싱은 import-parser.js(BojangImport), 상태 반영은 app.js의 applyImport 콜백이 합니다.
   v5.4: 서버가 연결되고 로그인되어 있으면 촬영본을 실제 AI 비전 엔드포인트로 보내고,
        응답 텍스트를 같은 검수 화면에 넣습니다. 미연결이면 v5.3 정적 베타 안내를 유지합니다.

   휘발 원칙: 촬영 사진은 localStorage · sessionStorage · IndexedDB · 서버 어디에도 쓰지 않고,
   전처리 직후 canvas/bitmap/Blob 참조를 모두 버립니다. */
(function (root) {
  'use strict';

  const $ = (sel, r) => (r || document).querySelector(sel);
  const $$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  const won = (n) => Number(n || 0).toLocaleString('ko-KR');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const NOTICE = '이름·주민등록번호 등 민감정보는 가리고 담보표만 촬영해 주세요. 촬영된 사진은 기기와 자체 Supabase DB에 저장되지 않고 브라우저 메모리에서 즉시 파기됩니다. AI 인식 실행 시 공급자별 경로 — OpenAI 경로(단일 모델) / Gemini 경로(최대 4개 모델 후보) — 로 전송되며 공급자 정책이 적용됩니다.';
  const BETA_NOTE = '현재 정적 베타 버전에서는 AI 비전 서버 연결 전이라 사진 자동 숫자 추출이 제한됩니다. 3단계 백엔드 연동 시 95% 이상 자동 인식되며, 지금은 PDF 파일 올리기 또는 텍스트 붙여넣기·수기 보완을 함께 사용하실 수 있습니다.';
  const BADGE = '앱·자체 서버 미저장 · 메모리 파기 완료 ✓';

  let ctx = null;            /* { state, toast, applyImport, openView } */
  let lastResult = null;     /* 현재 검수 중인 파싱 결과 */
  let lastSource = '';
  let liveStream = null;
  let shotCount = 0;

  /* =========================================================
     허브 (입력 방식 선택)
     v5.9 — 마지막으로 쓴 입력 방식을 기억해 허브에 표시하고,
            첫 방문 가이드(투어)와 모달이 겹치지 않도록 순서를 지킵니다.
     ========================================================= */
  const LAST_KEY = 'bojang.lastmode.v1';
  const MODE_LABEL = { manual: '수기 입력', camera: '사진 즉시 촬영', pdf: '보장분석 PDF·텍스트', analysis: '6단계 입력실', quick: '한 화면 빠른 입력' };

  function readLast() {
    try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; }
  }
  function rememberLast(mode) {
    if (!MODE_LABEL[mode]) return;
    try { localStorage.setItem(LAST_KEY, mode); } catch (e) { /* private mode */ }
  }

  function paintLast() {
    const el = $('#ih-last');
    if (!el) return;
    const last = readLast();
    el.textContent = last ? '지난번에는 ' + MODE_LABEL[last] + '으로 입력했습니다' : '';
    el.hidden = !last;
  }

  function openHubNow() {
    const el = $('#input-hub');
    if (!el) return;
    el.hidden = false;
    $$('#input-hub .hub-opt').forEach((b) => b.classList.remove('is-open'));
    const manual = $('#ih-manual');
    if (manual) manual.hidden = true;
    paintLast();
    const first = $('#input-hub .hub-opt');
    if (first) first.focus({ preventScroll: true });
  }

  function openHub() {
    /* 가이드 투어가 떠 있으면 먼저 닫고, 그 뒤에 허브를 엽니다 */
    if (root.BojangTour && root.BojangTour.beforeInputHub) {
      if (root.BojangTour.beforeInputHub(openHubNow)) return;
    }
    openHubNow();
  }

  function closeHub() {
    const el = $('#input-hub');
    if (el) el.hidden = true;
  }

  function pickMode(mode) {
    if (mode === 'manual') {
      const m = $('#ih-manual');
      if (m) m.hidden = false;
      return;
    }
    rememberLast(mode);
    closeHub();
    if (mode === 'camera') { ctx.openView('capture'); return; }
    if (mode === 'pdf') { ctx.openView('import'); return; }
  }

  function goManual(where) {
    rememberLast(where === 'quick' ? 'quick' : 'analysis');
    /* v6.0 — '새 상담 시작' 경로에서 연습용 샘플(27만원·5,000만원)이 입력칸에 남지 않도록,
       샘플 상태이면 빈 상담으로 바꾼 뒤 화면을 엽니다. (실제 입력 중인 상담은 건드리지 않음) */
    if (ctx.startNewConsult) ctx.startNewConsult();
    closeHub();
    ctx.openView(where === 'quick' ? 'quick' : 'analysis');
    if (ctx.toast) ctx.toast(where === 'quick' ? '한 화면 빠른 입력으로 이동했습니다' : '6단계 입력실로 이동했습니다');
  }

  /* =========================================================
     사진 즉시 촬영 (휘발)
     ========================================================= */
  function setCapStatus(msg, tone) {
    const el = $('#cap-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'cap-status' + (tone ? ' tone-' + tone : '');
  }

  async function stopLive(hideBox) {
    if (liveStream) {
      liveStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
      liveStream = null;
    }
    const v = $('#cap-video');
    if (v) { try { v.pause(); } catch (e) {} v.srcObject = null; v.removeAttribute('src'); }
    if (hideBox !== false) {
      const box = $('#cap-live-box');
      if (box) box.hidden = true;
    }
  }

  async function startLive() {
    const box = $('#cap-live-box');
    const video = $('#cap-video');
    const note = $('#cap-live-note');
    if (!box || !video) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      box.hidden = false;
      if (note) note.textContent = '이 브라우저에서는 앱 내 카메라를 열 수 없습니다. 위의 “카메라로 바로 촬영”을 눌러 주세요 — 똑같이 바로 카메라가 열리고 사진은 저장되지 않습니다.';
      return;
    }
    try {
      liveStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false });
      video.srcObject = liveStream;
      box.hidden = false;
      if (note) note.textContent = '화면을 맞춘 뒤 촬영을 누르세요. 촬영본은 메모리에서만 처리되고 저장되지 않습니다.';
      await video.play().catch(() => {});
    } catch (e) {
      box.hidden = false;
      if (note) note.textContent = '앱 내 카메라를 열 수 없습니다(권한 거부 또는 카메라 없음). 위의 “카메라로 바로 촬영” 버튼을 사용해 주세요.';
    }
  }

  function resetCapResult() {
    const box = $('#cap-result');
    if (box) box.hidden = true;
  }

  /* 촬영본 처리 — 저장 없이 전처리하고 즉시 파기합니다 */
  async function handleShot(file, source) {
    if (!file) return;
    resetCapResult();
    setCapStatus('촬영본을 메모리에서만 처리하고 있습니다… (저장하지 않음)', 'work');
    let result = null;
    let err = null;
    try {
      result = await BojangImport.preprocessImage(file);
    } catch (e) {
      err = e;
    }
    /* 파일 핸들·원본 참조를 즉시 놓습니다 */
    const input = $('#cap-file');
    if (input) input.value = '';
    file = null;

    if (err) {
      setCapStatus(err.message || '사진을 처리하지 못했습니다.', 'warn');
      return;
    }

    let blob = result.blob;
    result.blob = null;   /* 화면·상태에는 축소본을 남기지 않습니다 */

    /* v5.4 — 실서버 모드 + 로그인 상태면 진짜 AI 비전 엔드포인트로 전송
       v5.9 — 공식 도메인이 아닌 복제본에서는 서버 호출을 차단합니다 */
    const backend = root.BojangBackend;
    const live = !!(backend && backend.isLive && backend.isLive());
    const networkOk = !(root.BojangGuard && root.BojangGuard.networkAllowed && !root.BojangGuard.networkAllowed());
    const canVision = networkOk && !!((backend && backend.canUseVision && backend.canUseVision()) || BojangImport.VISION_ENDPOINT);

    let vision = null;
    if (canVision) {
      setCapStatus('AI 비전 서버에서 담보표를 읽고 있습니다… (사진은 저장되지 않습니다)', 'work');
      vision = await BojangImport.parseWithVisionBackend(blob, BojangImport.VISION_ENDPOINT, { filename: 'capture.jpg' });
    }
    blob = null;   /* 전송 후 축소본 참조도 즉시 해제 */

    shotCount += 1;
    const visionOk = !!(vision && vision.ok && vision.items && vision.items.length);
    $('#cap-result').hidden = false;
    $('#cap-badge').textContent = BADGE;
    $('#cap-meta').innerHTML = `
      <span><b>${result.width}×${result.height}</b> 원본</span>
      <span><b>${result.scaledWidth}×${result.scaledHeight}</b> 전처리(메모리)</span>
      <span>대비 <b>${result.contrast == null ? '—' : result.contrast}</b></span>
      <span>밝기 <b>${result.mean == null ? '—' : result.mean}</b></span>`;
    const warn = [];
    if (result.contrast != null && !result.sharpEnough) warn.push('사진 대비가 낮습니다 — 그늘 없이 밝은 곳에서 다시 찍으면 인식률이 올라갑니다.');
    if (!result.bigEnough) warn.push('해상도가 낮습니다 — 담보표가 화면에 크게 차도록 다시 찍어 주세요.');
    if (vision && !vision.ok && vision.message && canVision) warn.push(vision.message);
    $('#cap-warn').innerHTML = warn.map((w) => `<li>${esc(w)}</li>`).join('');
    $('#cap-warn').hidden = !warn.length;
    if (!live) {
      $('#cap-beta').textContent = networkOk ? BETA_NOTE : '공식 배포처가 아닌 주소라 AI 사진 인식 서버 호출이 차단되었습니다 — PDF·텍스트·수기 입력을 이용해 주세요.';
    } else if (!networkOk) {
      $('#cap-beta').textContent = '공식 배포처가 아닌 주소라 AI 사진 인식 서버 호출이 차단되었습니다 — PDF·텍스트·수기 입력을 이용해 주세요.';
    } else if (visionOk) {
      const ms = vision.ms ? ` · ${vision.ms}ms` : '';
      $('#cap-beta').textContent = `AI 비전 인식 완료 · ${vision.model || 'vision'}${ms} · 사진은 서버에 저장되지 않았습니다(persisted:false)`;
    } else if (vision && vision.message) {
      $('#cap-beta').textContent = vision.message;
    } else {
      $('#cap-beta').textContent = '서버 연결됨 — 계정에 로그인하면 사진에서 담보 숫자를 자동으로 읽습니다.';
    }
    $('#cap-shot-count').textContent = String(shotCount);
    setCapStatus(source === 'live' ? '앱 내 카메라 촬영본을 파기했습니다.' : '카메라 촬영본을 파기했습니다.', 'ok');

    if (visionOk) {
      /* 사진 → AI 인식 → 같은 검수 화면(추출 결과)으로 이동 */
      if (ctx.openView) ctx.openView('import');
      renderReview(vision, '사진 AI 인식');
      if (ctx.toast) ctx.toast(`${vision.items.length}건을 사진에서 인식했습니다 — 검수 후 반영하세요`);
    }
  }

  async function captureLiveFrame() {
    const video = $('#cap-video');
    if (!video || !video.videoWidth) {
      setCapStatus('카메라 화면이 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요.', 'warn');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext('2d');
    g.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => { try { canvas.toBlob((b) => res(b), 'image/jpeg', 0.92); } catch (e) { res(null); } });
    g.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    await stopLive(false);
    if (!blob) { setCapStatus('촬영에 실패했습니다. 다시 시도해 주세요.', 'warn'); return; }
    await handleShot(blob, 'live');
  }

  /* =========================================================
     PDF · 텍스트 추출
     ========================================================= */
  function setImpStatus(msg, tone) {
    const el = $('#imp-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'imp-status' + (tone ? ' tone-' + tone : '');
  }

  function clearReview() {
    lastResult = null;
    const box = $('#imp-review');
    if (box) box.hidden = true;
    const pii = $('#imp-pii');
    if (pii) { pii.hidden = true; pii.innerHTML = ''; }
    const list = $('#imp-rows');
    if (list) list.innerHTML = '';
    const sum = $('#imp-summary');
    if (sum) sum.textContent = '';
  }

  function groupLabel(g) {
    return g || '기타';
  }

  /* v7.4 — 자동 추출된 마스킹 고객정보(이름·성별·생년월일·연령대)를 검수 화면 상단에 보여 줍니다 */
  function renderPii(result) {
    const box = $('#imp-pii');
    if (!box) return;
    const p = result && result.pii;
    if (!p || !p.found || (!p.name && !p.birth && !p.gender)) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const bits = [p.name, p.gender, p.birth, p.ageBand ? p.ageBand + '대' : ''].filter(Boolean);
    box.hidden = false;
    box.innerHTML = `
      <div class="pii-head"><span class="eyebrow">CLIENT</span> 자동 추출 고객정보 <em>이름 가운데 글자는 x로 마스킹</em></div>
      <div class="pii-line">${bits.map((b) => `<span class="pii-chip">${esc(b)}</span>`).join('<i>·</i>')}</div>
      <p class="pii-note">이름 · 성별 · 생년월일만 담습니다. 주민번호 뒤 6자리 · 주소 · 전화번호 · 이메일 · 설계번호는 추출하지 않고, 화면 텍스트에서도 가립니다. 반영을 누르면 기본정보 칸에 자동으로 채워집니다.</p>`;
  }

  function renderReview(result, sourceLabel) {
    if (!result) return;
    lastResult = result;
    lastSource = sourceLabel || '';
    const box = $('#imp-review');
    const list = $('#imp-rows');
    if (!box || !list) return;
    if (!result.items || !result.items.length) {
      box.hidden = true;
      const pb = $('#imp-pii');
      if (pb) { pb.hidden = true; pb.innerHTML = ''; }
      setImpStatus('담보 항목을 인식하지 못했습니다. 담보명과 금액이 함께 있는 표를 붙여넣었는지 확인해 주세요.', 'warn');
      lastResult = null;
      return;
    }
    const rows = result.items.map((it, i) => {
      const isBool = it.kind === 'bool';
      const unit = it.unit || '만원';
      const valueHtml = isBool
        ? '<span class="rv-yes">보장 있음</span>'
        : `<input type="number" class="rv-num" data-rvnum="${i}" min="0" step="1" value="${it.value}" aria-label="${esc(it.label)} 금액"><span class="rv-unit">${esc(unit)}</span>`;
      return `
        <div class="rv-row" data-rv="${i}">
          <label class="rv-check">
            <input type="checkbox" data-rvcheck="${i}" ${it.apply === false ? '' : 'checked'} aria-label="${esc(it.label)} 반영">
          </label>
          <span class="rv-main">
            <b>${esc(it.label)}</b>
            <em>${esc(groupLabel(it.group))}${it.apply === false ? ' · 참고' : ''}</em>
          </span>
          <span class="rv-val">${valueHtml}</span>
          <span class="rv-snip" title="매칭 근거 원문">${esc(it.snippet || '')}</span>
          ${it.note ? `<span class="rv-note">${esc(it.note)}</span>` : ''}
        </div>`;
    }).join('');
    list.innerHTML = `
      <div class="rv-head">
        <span></span><span>담보명</span><span>인식 금액</span><span>매칭 근거(원문)</span>
      </div>${rows}`;
    renderPii(result);
    box.hidden = false;
    const head = [];
    head.push(`${sourceLabel || '텍스트'}에서 ${result.items.length}건 인식`);
    if (result.premium != null) head.push(`월 보험료 ${won(result.premium)}만원`);
    if (result.silson) head.push(`실손 ${result.silson}세대`);
    $('#imp-summary').textContent = head.join(' · ');
    setImpStatus('인식 결과를 확인하고, 반영할 항목만 체크한 뒤 금액을 고쳐 주세요.', 'ok');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handlePdfFile(file) {
    if (!file) return;
    setImpStatus('PDF에서 글자를 추출하는 중입니다… (기기 안에서만 처리)', 'work');
    let buf = null;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      setImpStatus('파일을 읽지 못했습니다.', 'warn');
      return;
    }
    const res = await BojangImport.extractPdfText(buf);
    buf = null;
    const input = $('#imp-file');
    if (input) input.value = '';
    if (!res.ok) {
      setImpStatus(res.message || 'PDF에서 텍스트를 추출하지 못했습니다.', 'warn');
      const t = $('#imp-text');
      if (!t.value.trim() && t) t.focus();
      clearReview();
      return;
    }
    const textarea = $('#imp-text');
    const parsed = BojangImport.parseCoverageText(res.text);
    /* v7.4 — 화면 텍스트상자에는 개인정보를 가린 본문만 남깁니다 */
    if (textarea) textarea.value = parsed.safeText || res.text;
    renderReview(parsed, 'PDF');
    const chars = res.text.replace(/\s/g, '').length;
    const tail = res.garbled
      ? ' 글자가 일부 깨져 보입니다 — 깨진 항목은 빼고 텍스트 붙여넣기를 함께 써 주세요.'
      : (res.message ? ' ' + res.message : '');
    setImpStatus(`PDF ${res.pages}페이지에서 글자 ${chars}자를 추출해 ${parsed.items.length}건을 인식했습니다.${tail}`,
      res.garbled || !parsed.items.length ? 'warn' : 'ok');
  }

  function parsePasted() {
    const text = ($('#imp-text') && $('#imp-text').value) || '';
    if (!text.trim()) {
      setImpStatus('보장분석표 텍스트를 붙여넣거나 샘플을 불러와 주세요.', 'warn');
      return;
    }
    const parsed = BojangImport.parseCoverageText(text);
    /* v7.4 — 붙여넣은 본문도 민감정보를 가린 상태로 남깁니다 */
    if (parsed.safeText && parsed.safeText !== text) {
      const t = $('#imp-text');
      if (t) t.value = parsed.safeText;
    }
    renderReview(parsed, '붙여넣은 텍스트');
  }

  function loadSample() {
    const textarea = $('#imp-text');
    if (textarea) textarea.value = BojangImport.SAMPLE_TEXT;
    const parsed = BojangImport.parseCoverageText(BojangImport.SAMPLE_TEXT);
    renderReview(parsed, '샘플 보장분석표');
  }

  /* 검수 화면 → 상태 반영 */
  function applyReview() {
    if (!lastResult) {
      setImpStatus('먼저 담보표를 인식해 주세요.', 'warn');
      return;
    }
    const items = [];
    lastResult.items.forEach((it, i) => {
      const cb = $(`[data-rvcheck="${i}"]`);
      if (!cb || !cb.checked) return;
      let value = it.value;
      const num = $(`[data-rvnum="${i}"]`);
      if (num) {
        const n = Number(num.value);
        if (!isFinite(n) || n < 0) return;
        value = n;
      }
      items.push(Object.assign({}, it, { value }));
    });
    if (!items.length) {
      setImpStatus('반영할 항목을 하나 이상 체크해 주세요.', 'warn');
      return;
    }
    const meta = {
      source: lastSource,
      premium: lastResult.premium != null ? lastResult.premium : null,
      silson: lastResult.silson || null,
      checked: items.length,
      total: lastResult.items.length,
      /* v7.4 — 자동 추출한 마스킹 고객정보(이름·성별·생년월일·연령대) */
      client: (lastResult.pii && lastResult.pii.found) ? {
        name: lastResult.pii.name || '',
        gender: lastResult.pii.gender || '',
        birth: lastResult.pii.birth || '',
        ageBand: lastResult.pii.ageBand || ''
      } : null
    };
    /* 월 보험료·실손 세대를 체크 해제했다면 반영하지 않습니다 */
    if (meta.premium != null && !items.some((i) => i.kind === 'premium')) meta.premium = null;
    if (meta.silson && !items.some((i) => i.kind === 'silson')) meta.silson = null;
    ctx.applyImport(items, meta);
    setImpStatus(`${items.length}건을 입력칸에 반영했습니다. 6단계 입력실에서 확인·보완하세요.`, 'ok');
  }

  /* =========================================================
     초기화
     ========================================================= */
  function init(options) {
    ctx = options || {};
    if (!ctx.openView) ctx.openView = function () {};

    /* 허브 열기 — 메인 '새 상담 시작', 입력실 상단, 각 화면 진입점 */
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-inputhub]');
      if (open) { e.preventDefault(); openHub(); return; }
      const mode = e.target.closest('[data-mode]');
      if (mode && mode.closest('#input-hub')) { pickMode(mode.dataset.mode); return; }
      const man = e.target.closest('[data-manual]');
      if (man && man.closest('#input-hub')) { goManual(man.dataset.manual); return; }
    });

    const closeBtn = $('#ih-close');
    if (closeBtn) closeBtn.addEventListener('click', closeHub);
    const hub = $('#input-hub');
    if (hub) hub.addEventListener('click', (e) => { if (e.target.id === 'input-hub') closeHub(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && hub && !hub.hidden) closeHub();
    });

    /* 촬영 화면 */
    const capFile = $('#cap-file');
    if (capFile) capFile.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleShot(f, 'file');
    });
    const liveBtn = $('#cap-live');
    if (liveBtn) liveBtn.addEventListener('click', () => {
      const box = $('#cap-live-box');
      if (box && !box.hidden) { stopLive(); setCapStatus('카메라를 껐습니다. 사진은 저장되지 않았습니다.', 'ok'); return; }
      startLive();
    });
    const shotBtn = $('#cap-shot');
    if (shotBtn) shotBtn.addEventListener('click', captureLiveFrame);
    const stopBtn = $('#cap-live-stop');
    if (stopBtn) stopBtn.addEventListener('click', () => { stopLive(); setCapStatus('카메라를 껐습니다. 사진은 저장되지 않았습니다.', 'ok'); });
    const capToPdf = $('#cap-to-import');
    if (capToPdf) capToPdf.addEventListener('click', () => ctx.openView('import'));
    const capToPdf2 = $('#cap-to-import2');
    if (capToPdf2) capToPdf2.addEventListener('click', () => ctx.openView('import'));
    const capToManual = $('#cap-to-manual');
    if (capToManual) capToManual.addEventListener('click', () => ctx.openView('analysis'));

    /* 추출 화면 */
    const impFile = $('#imp-file');
    if (impFile) impFile.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handlePdfFile(f);
    });
    const parseBtn = $('#imp-parse');
    if (parseBtn) parseBtn.addEventListener('click', parsePasted);
    const sampleBtn = $('#imp-sample');
    if (sampleBtn) sampleBtn.addEventListener('click', loadSample);
    const clearBtn = $('#imp-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      const t = $('#imp-text');
      if (t) t.value = '';
      clearReview();
      setImpStatus('입력란을 비웠습니다.', 'ok');
    });
    const applyBtn = $('#imp-apply');
    if (applyBtn) applyBtn.addEventListener('click', applyReview);
    const toManual = $('#imp-to-manual');
    if (toManual) toManual.addEventListener('click', () => ctx.openView('analysis'));

    /* 화면을 떠나면 카메라는 반드시 끕니다 */
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopLive(); });
    const stopOnLeave = (e) => {
      const a = e.target.closest('[data-home], .tab, [data-home-go], [data-mode]');
      if (a) stopLive();
    };
    document.addEventListener('click', stopOnLeave, true);
  }

  root.BojangInputHub = {
    init, openHub, closeHub, pickMode, goManual,
    handleShot, handlePdfFile, parsePasted, loadSample, applyReview,
    renderReview, NOTICE, BETA_NOTE, BADGE,
    state: () => ({ lastResult, lastSource, shotCount })
  };
})(typeof window !== 'undefined' ? window : globalThis);
