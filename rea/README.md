# REA 수집기 (CBT 3개 사이트 비회원 흐름)

GPT 보고서에서 "미수집"으로 남은 항목(HAR, 쿠키·스토리지 전후 변화, 공개 JS 엔드포인트)을 채우기 위한 스크립트입니다.

## 실행 전 조건
클라우드 환경 Network access → Allowed domains에 다음을 추가한 **새 세션**에서 실행:
`comcbt.com, www.comcbt.com, img.comcbt.com, cbtbank.kr, moducbt.com, www.moducbt.com, api.moducbt.com`

## 실행
```
node rea/capture.mjs all            # 또는 comcbt | cbtbank | moducbt
HEADED=1 node rea/capture.mjs comcbt  # 로컬 PC에서 화면을 보며 수동 조작 수집
```

## 산출물 (rea/out/<site>/)
- `network.har` — 요청/응답 (Cookie·Set-Cookie·Authorization 값 제거)
- `requests.json` — method/URL/status/POST 본문 요약
- `storage.json` — 단계별 쿠키(이름·플래그·길이만), localStorage, sessionStorage, IndexedDB 이름
- `notes.json` — script src, form action, iframe, 채점 alert, 새로고침 전후 선택 수, 공개 JS의 API 경로 문자열

## 범위
비회원 공개 화면만 다룹니다. 로그인·결제·임의 payload 전송은 하지 않습니다.
