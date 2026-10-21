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
- 비회원: 샘플 회차만, HttpOnly 쿠키 토큰으로 기록 임시 저장(DB에는 해시만)
- 시험모드는 제출 전 정답·해설을 응답에 넣지 않음 / 연습모드는 답 저장 시 그 문항만 정오·해설 반환
- 점수는 원점수 저장, 표시는 `formatScore` 하나로 통일(결과·목록 동일)
- 과락(과목 40 미만)·합격(평균 60 이상), 복수정답·전원정답, 중복 제출 방지, 다른 탭 충돌(409)

## 기출 입력 방법
`content/sample-paper.json` 형식을 복사해 회차 파일을 만든 뒤:
```
node scripts/import-paper.mjs content/2022-2.json > .wrangler/import.sql
npx wrangler d1 execute cbt --local --file .wrangler/import.sql
```
- `answer`는 정답 보기 번호 배열(`[3]`, 복수정답 `[1,3]`, 전원정답 `[]`)
- 같은 `key` 문항 내용을 고쳐 다시 넣으면 새 버전이 생기고, 이미 푼 기록은 예전 버전을 유지
- `sourceType`: `official`(공식 공개) / `restored`(복원) / `original`(자체) / `sample`
- 과목명은 현행 출제기준으로 확인 후 수정 필요

## 다음 단계
1. 실제 기출 1회차 입력(사용자) → 이미지 문항 지원(R2)
2. 회원가입·로그인(이메일 + 카카오/구글) 및 비회원 기록 이관
3. Cloudflare 배포(`wrangler d1 create cbt` 후 database_id 교체 → `npm run deploy`)
