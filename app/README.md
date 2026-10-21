# CBT 학습 서비스 (MVP 1단계)

Cloudflare Workers + D1 + Hono. 기획안: `../docs/CBT_기획안_최종본.md`

## 로컬 실행
```
npm install
npm run db:migrate     # D1 테이블 생성(로컬)
npm run db:import      # 샘플 회차 넣기
npm run dev            # http://localhost:8787
npm test               # 채점 규칙 + API 테스트
```

## 지금 되는 것
- 회차 선택 → 연습/시험 모드 → 풀이 → 자동 저장 → 제출 → 서버 채점 → 오답·미응답 해설 → 다시 풀기 → 내 기록
- 회원가입 없음: 모든 회차 무료, HttpOnly 쿠키 토큰으로 기록 저장(DB에는 해시만)
- 시험모드는 제출 전 정답·해설을 응답에 넣지 않음 / 연습모드는 답 저장 시 그 문항만 정오·해설 반환
- 점수는 원점수 저장, 표시는 `formatScore` 하나로 통일(결과·목록 동일)
- 과락(과목 40 미만)·합격(평균 60 이상), 복수정답·전원정답, 중복 제출 방지, 다른 탭 충돌(409)

## 기출 입력 방법
1. `content/TEMPLATE.txt`를 복사해 `content/2020-1.txt`처럼 만들고 문제를 텍스트로 입력
   - 문제 번호 `1.` / 보기 `①` 또는 `1)` / `정답: ③` (복수정답 `정답: 1, 3`, `정답: 전원정답`) / `해설:` (선택)
   - 과목이 바뀌면 `[과목 2] 과목명` 줄, 문제 번호는 1~120 계속 이어서
2. 변환·검사: `node scripts/txt-to-paper.mjs content/2020-1.txt > content/2020-1.json`
   - 틀린 곳이 있으면 몇 번째 줄인지 알려주고 멈춤
3. DB에 넣기: `node scripts/import-paper.mjs content/2020-1.json > import.sql` 후
   `npx wrangler d1 execute cbt --local --file import.sql` (배포 서버는 `--remote`)

- 같은 회차ID로 다시 넣으면 고친 문항만 새 버전이 되고, 이미 푼 기록은 예전 버전을 유지
- 그림이 있는 문항은 아직 미지원(다음 작업)

## 애드센스 광고
`wrangler.jsonc`의 `vars`에 승인 후 값 입력: `ADSENSE_CLIENT`(ca-pub-…), `ADSENSE_SLOT_DISPLAY`, `ADSENSE_SLOT_INARTICLE`, `SITE_URL`, `CONTACT_EMAIL`.
비어 있으면 화면에 점선 "광고 자리"만 표시됩니다. `/ads.txt`는 자동 생성됩니다.

| 화면 | 위치 | 이유 |
|---|---|---|
| 공개 해설 `/p/:id`, `/p/:id/:쪽` (검색 유입, 5문제씩) | 3번째 문제 뒤 콘텐츠 내 + 페이지 끝 디스플레이 | 수익 핵심. 쪽 이동이 실제 페이지 이동이라 전면 광고 기회 |
| 홈 | 회차 3개 뒤, 목록 끝 | |
| 풀이 | 10문항마다 콘텐츠 내 / PC는 답안표 아래 사이드 | 보기·제출 버튼과 최소 49px 이상 간격 |
| 결과 요약 `/r/:id` | 과목 목록 3개 뒤, 끝 | 전체 시험은 오답 해설을 과목별 페이지 `/r/:id/:과목번호`로 나눔 |
| 과목별 오답 해설 | 해설 3번째 앞, 이후 5개마다, 끝 | 다음 과목 해설은 실제 페이지 이동 |
| 내 기록 | 표 아래 | |

**과목별 풀기:** 홈/해설 페이지 → 과목 선택(`/s/:회차`) → 과목 20문항 풀기(`/start/:회차/:모드/:과목`) → 제출 → 결과(`/r/:id`, 과목 점수·과락) → [다음 과목 풀기]. 모든 이동이 실제 페이지 이동이라 이동마다 전면 광고 기회가 생긴다(회차당 최대 약 12번, 실제 노출 빈도는 구글이 결정).

**전면 광고(비네트):** 제출 → "채점 완료" 화면 → [채점 결과 보기] 링크 → `/r/:id` 실제 페이지 이동. 구글 전면 광고는 사이트 안 링크로 페이지가 바뀔 때만 끼어들 수 있어서 이렇게 만들었다(버튼 클릭에 직접 광고를 띄우는 건 정책 위반). 애드센스 → 광고 → 사이트 기준 → cbt.guidejung.com 수정 → 자동 광고 켜기 → 광고 형식에서 **전면 광고만 켜고** 나머지 자동 형식은 끄기(수동 배치와 겹치지 않게). 표시 여부·빈도는 구글이 정함.

지키는 규칙: 버튼·보기 바로 옆 금지(실수 클릭), "광고" 표기 외 클릭 유도 문구 금지, 광고 높이 미리 확보(화면 밀림 방지), 광고 클릭으로 이탈해도 답안은 자동 저장되어 있음.

## 배포 (cbt.guidejung.com)
조건: guidejung.com DNS가 Cloudflare에 있어야 함. 사용자 PC에서:
```
cd app
npm install
npx wrangler login                       # 브라우저로 Cloudflare 로그인
npx wrangler d1 create cbt               # 출력된 database_id를 wrangler.jsonc에 붙여넣기
npx wrangler d1 migrations apply cbt --remote
node scripts/import-paper.mjs content/sample-paper.json > import.sql && npx wrangler d1 execute cbt --remote --file import.sql
npx wrangler deploy                      # cbt.guidejung.com 자동 연결(routes.custom_domain)
```
- `ads.txt`는 **루트 도메인 guidejung.com/ads.txt**에 이미 있어야 함(하위 도메인은 루트의 ads.txt를 따름).

## 다음 단계
1. 실제 기출 1회차 입력(사용자) → 이미지 문항 지원(R2)
2. 애드센스 신청(실제 기출 콘텐츠 충분히 확보 후)
3. Cloudflare 배포(`wrangler d1 create cbt` 후 database_id 교체 → `npm run deploy`)
