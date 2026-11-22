# bojang-guide — 작업 규칙

보장분석 라이프 리포트. 현장에서 설계사가 고객과 마주 앉아 보여주는 모바일 PWA. 빌드 도구 없는 Vanilla JS 이고 `build_single.py` 가 단일 HTML 을 만든다.

## 도메인 언어

`README.md` 의 v7.5 절이 정본: **충족도**, **터치 우선순위**, **HOLD**, **코드밴드**, **3칸 사례**, **제도 팩**. 새 개념은 README 에 먼저 정의하고 코드에서 그 이름을 쓴다.

## 검증

```bash
scripts/dev-gate.sh --app bojang-guide --fast                     # js 구문 + py 컴파일
scripts/dev-gate.sh --app bojang-guide --full --allow-build       # 단일 HTML + 회귀 테스트(playwright)
```

- 단일 HTML 계약: 외부 참조 0, 버전 마커, 핵심 모듈 존재. `build_single.py` 뒤 `dist/bojang-guide.single.html` 로 확인한다.
- 회귀 테스트는 회차마다 `tests/test_v<버전>.py` 로 추가한다. 최신 회차가 정본이다.
- 인쇄·PDF 는 실제 PDF 를 만들어 페이지 수와 텍스트 레이어를 확인한다.
- 저장소 CI: `.github/workflows/dev-gate.yml` — `gate`(js·py 구문 → 단일 HTML 빌드·계약) + `regression`(`tests/test_v7_5.py`, Chromium·한글 글꼴). push·PR 마다 돈다(2026-11-22 적용).

## 경계

- 앱 표시 버전 마커(`v7.2`)와 README 의 회차 설명은 별개 규칙이다. 마커를 임의로 올리지 않는다.
- 금소법 안전선: 판정·지급 단정 표현을 쓰지 않고 "먼저 확인할 항목" 표현을 유지한다. 우선순위 점수는 질병위험이 아니다.
- 고객 실데이터(증권·주민번호·병력)를 저장소·테스트 픽스처에 넣지 않는다. 픽스처는 가상 인물로 만든다.
- 저장소 루트가 곧 앱 폴더다. CI 워크플로우의 경로는 루트 기준으로 쓴다(2026-11-22 이전 초안 `bojang-ci.yml` 은 `apps/bojang-guide` 를 전제해 동작하지 않았다 — 삭제하고 `dev-gate.yml` 로 대체).
