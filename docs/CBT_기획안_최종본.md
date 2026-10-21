# CBT 학습 서비스 구축 기획안 — 최종본

작성일: 2026-10-21 · 근거: GPT 실행 검증 기록(CBT_3sites_analysis_and_plan) + REA 네트워크 재분석(`rea/REPORT.md`)

---

## 0. 증거 수준 표기

| 표기 | 의미 |
|---|---|
| **네트워크 확정** | HAR·쿠키·스토리지 수집으로 직접 확인 (이번 REA 재분석) |
| **실행 확인** | 정상 UI에서 직접 조작하고 화면/DOM 확인 (GPT 기록) |
| **코드 확인** | 공개 HTML·JS에서 문자열/로직 확인. 실제 전송과 다를 수 있음 |
| **사이트 안내** | 화면 문구로만 확인 |
| **미확인** | 접근 불가·로그인 필요로 확인 못 함 |
| **제안** | 우리 서비스 설계. 경쟁사 구현이라는 주장 아님 |

---

## 1. 핵심 요약

1. **경쟁사 비회원 학습은 "기록이 남지 않거나, 이름만으로 조회"하는 수준이다.**
   - CBTbank: 답안 저장 요청 0건, 브라우저 저장도 없음 → 새로고침 시 소실 (**네트워크 확정**)
   - COMCBT: 닉네임 입력 방식 서버 기록, 21일 보존 안내 (**실행 확인**)
   - 모두CBT: 풀이 시작부터 로그인 필요 (**실행 확인**)
2. **CBTbank는 정답을 서버 HTML에 담아 보내고 브라우저에서 채점한다.** 40문항 전부 정답 표시가 원본 응답에 포함 (**네트워크 확정**). 연습용으로는 빠르지만 시험모드·기록 신뢰성에는 부적합.
3. **COMCBT는 같은 시험 점수가 결과 2점 / 목록 3점으로 다르게 표시된다** (1/40 = 2.5점, **실행 확인**). 점수 표시 규칙 일관성이 차별화 포인트.
4. 따라서 우리 서비스의 차별점은 **① 끊김 없는 이어풀기(자동 저장) ② 서버 채점·정답 비노출 시험모드 ③ 일관된 점수·오답 복습 루프** 세 가지로 정한다.

---

## 2. 경쟁 사이트 비교

| 비교 축 | COMCBT | CBTbank | 모두CBT |
|---|---|---|---|
| 비회원 범위 | 풀이·채점·닉네임 기록 | 풀이·즉시 정오·해설. 종합채점 차단 | 목록·모드 선택까지. 시작 시 로그인 |
| 풀이 화면 | 문제/OMR iframe 2분할, 6문항 단위 | 회차 40문항 한 페이지 스크롤 | 미확인 |
| 채점 위치 | 서버 POST `s_odabcheck.php` (코드 확인) | **브라우저 (네트워크 확정)** | 미확인 |
| 정답 노출 | 제출 전 미노출로 보임 | **원본 HTML에 정답 포함 (네트워크 확정)** | 미확인 |
| 답안 저장 | 제출 후 닉네임 기록 저장 | **저장 없음 (네트워크 확정)** | 로그인 시 저장 (사이트 안내) |
| 오답 복습 | 결과·기록에서 해설, AI(오답 우선) 모의고사 | 문항별 해설 펼침 | 오답 메뉴 존재 (로그인 필요) |
| 기술 | PHP·form·iframe·inline JS, nginx | **GNUBoard5, jQuery 3.3.1, Bootstrap 5.1.3, MathJax 3 (확정)** | Next.js 번들, `api.moducbt.com` OAuth, Cloudflare |
| 수익 | 광고 시청 후 6시간 이용 (사이트 안내) | **AdSense + GA4×2 + GTM (확정)** | 무료(일일 리필) + 기간제 이용권 9,900~29,900원 |
| 약점 | 점수 표시 불일치, 이름 기반 기록 조회, 접근성 | 기록 없음, 정답 공개, 세션 쿠키 HttpOnly 미설정 | 체험 전 로그인 장벽 |

### 2.1 CBTbank 네트워크 검증 상세 (REA)

| 항목 | 결과 |
|---|---|
| 답안 2개 선택 중 사이트 요청 | `img/correct.png`, `img/wrong.png` 이미지 2건뿐 |
| 채점 버튼 | alert "로그인후 사용가능합니다.", 서버 요청 없음 |
| `last.php` / `check.php` / `bookmark.php` | 비회원 흐름에서 호출 0건 |
| localStorage | Google 광고 설정 3개 키뿐 |
| sessionStorage | 분류 캐시 `cbt_search_categories`만 |
| IndexedDB | 없음 |
| 쿠키 | `PHPSESSID`(세션, HttpOnly 아님), GNUBoard 방문 쿠키(추정), GA·광고 |
| 구조화 데이터 | FAQPage(문제·정답) JSON-LD를 JS가 DOM 정답 class로 생성 → SEO 유입 전략 |
| 이미지 경로 | `/images/{종목}/{회차}/{회차}m{문항}[b{보기}].gif` |

**시사점**
- 연습모드의 "즉시 정오"는 사용자가 좋아하는 기능 → 유지하되 **문항별 피드백 API**로 서버에서 정답을 받는다.
- 문제·해설 FAQ 구조화 데이터는 검색 유입에 효과적인 방식 → 우리는 **공개 학습 페이지(해설 모드)에만** 적용하고 시험모드에는 넣지 않는다.

### 2.2 미확인 항목 (한국 IP·로그인 환경 필요)
- COMCBT 2점/3점 불일치 원인, 기록 저장 실제 요청 본문
- 모두CBT 로그인 후 풀이·채점·오답·기기 간 동기화
- CBTbank 회원 종합채점·오답노트

이번 재분석에서 COMCBT(nginx)·모두CBT(Cloudflare)는 해외 데이터센터 IP를 403으로 차단해 수집 불가. 위 항목은 출시 판단에 필수는 아니며, 경쟁 기능 벤치마크 용도로 후속 수집한다.

---

## 3. 서비스 목표와 설계 원칙 (제안)

**목표:** 자격증을 고른 이용자가 *풀이 → 채점 → 오답 확인 → 다시 풀기*를 한 흐름으로 마치고, 중간에 끊겨도 그대로 이어서 푼다.

| # | 원칙 | 경쟁사 근거 |
|---|---|---|
| P1 | 답안은 선택 즉시 서버 자동 저장, 새로고침·기기 변경 시 복원 | CBTbank 새로고침 소실 |
| P2 | 시험모드 정답·해설은 제출 전 어떤 응답·DOM·JSON-LD에도 없다 | CBTbank 원본 HTML 정답 포함 |
| P3 | 점수 원본은 소수 그대로 저장, 결과·목록·CSV 모두 같은 표시 규칙 | COMCBT 2점/3점 |
| P4 | 로그인 없이 샘플 1회차 체험 가능, 기록 보존은 로그인 유도 | 모두CBT 시작 장벽 |
| P5 | 기록 조회는 계정/추측 불가 게스트 토큰으로만, 이름 검색 금지 | COMCBT 닉네임 조회 |
| P6 | 실제 radio/label, 키보드 조작, 색 외 텍스트 정오 표시 | COMCBT 이미지 보기 번호 |
| P7 | 광고는 보기·제출 버튼과 분리, 광고로 학습 상태 손실 금지 | CBTbank 전면 광고·COMCBT 광고 게이트 |

### 3.1 초기 이용자
- 필기시험 1~2종목을 최근 회차 위주로 반복하는 수험생
- 틀린 문제만 다시 풀고 취약 과목을 확인하려는 이용자
- 휴대폰·PC를 오가며 이어풀기하는 이용자

### 3.2 초기 종목
권리 확보·검수 가능한 **1~3종목**으로 시작. 후보: 컴퓨터활용능력 2급(3사 공통 제공, 수요 검증됨), 산업안전기사 필기. 최종 선정은 콘텐츠 확보 가능성 확인 후 결정.

---

## 4. MVP 범위

| 우선 | 기능 | 완료 조건 |
|---|---|---|
| P0 | 자격증 검색·회차 목록·과목 선택 | 선택 → 시작까지 3클릭 이내 |
| P0 | 비회원 샘플 체험 + 회원 학습 | 샘플 기록을 가입 시 이관 |
| P0 | 연습모드(즉시 정오·해설) / 시험모드(제출 후 공개) | 시험모드 정답 비노출 검사 통과 |
| P0 | 답안 변경·미응답·검토 표시, 자동 저장 | 새로고침·다른 기기에서 복원 |
| P0 | 서버 채점, 과목별·전체 점수, 과락·합격 | 결과·목록 점수 동일 |
| P0 | 오답/미응답 분리, 해설, 오답만 다시 풀기 | 재풀이는 새 기록, 원기록 보존 |
| P0 | 내 기록·북마크 | 타인 기록 접근 차단 |
| P0 | 관리자 문항·정답·해설 검수, 오류 신고 | 버전·출처·이력 보존 |
| P1 | 취약 과목 통계, 복습 일정(1·3·7일) | 통계 분모 고정 |
| P1 | 해설 모드 공개 페이지 + 구조화 데이터(SEO) | 시험모드와 분리 |
| P1 | 기간제 이용권·광고 제거·PDF 출력 | 무료 학습 안정화 후 |
| P2 | 실기(주관식), AI 보조 해설, 기관 클래스 | 객관식 안정화 후 |

---

## 5. 화면 명세

| 화면 | 주요 정보 | 주요 행동 | 예외 상태 |
|---|---|---|---|
| 홈 | 자격증 검색, 이어풀기, 오늘의 복습 | 종목 선택·이어풀기 | 비회원·기록 없음 |
| 자격증 상세 | 과목, 회차, 기출/복원 구분 | 회차·모의고사 선택 | 구기준 회차 안내 |
| 시작 설정 | 모드, 과목, 문항 수, 시간, 셔플 | 시작 | 이용권 부족 |
| 문제풀이 | 본문·이미지·보기·OMR·시간·저장 상태 | 선택·변경·검토·이동 | 저장 실패·오프라인 |
| 제출 확인 | 응답/미응답/검토 수 | 미응답 이동·제출 | 중복 제출 |
| 결과 | 과목별·전체 점수, 정답/오답/미응답, 시간 | 해설 보기·오답 다시 풀기 | 채점 중·실패 |
| 오답 복습 | 내 답, 정답, 해설, 오류 신고 | 정답 가리기·다시 풀기 | 정답 정정 안내 |
| 내 기록 | 회차, 모드, 날짜, 점수 | 조회·필터·CSV | 기기 간 충돌 |
| 관리자 | 출처·문항·정답·검수·신고·버전 | 발행·정정·회수 | 검수 미완·중복 |

PC는 본문 + OMR 병렬, 모바일은 본문 중심 + 문항 이동 패널 접기. iframe 분할은 쓰지 않는다. 수식은 MathJax/KaTeX, 이미지는 대체텍스트·확대 보기 제공.

---

## 6. 풀이·채점·오답 규칙

### 6.1 시도(attempt) 상태
`in_progress → submitted → graded` (+ `abandoned`, `expired`)
- graded 이후 답안 수정 불가. 다시 풀기는 새 attempt + `parent_attempt_id`
- 미응답은 `null` (0번 보기로 저장 금지)

### 6.2 채점
- 시작 시 고정한 문항 버전과 정답으로 **서버가** 채점. 클라이언트의 점수·정답·시간은 신뢰하지 않음
- 배점·과락·합격 기준은 `scoring_policy_version`으로 관리
- **원점수(예: 2.5) 저장, 표시 규칙 1개를 결과·목록·CSV 공통 적용**, 합격 판정은 원점수 기준
- 복수정답·전원정답·문항 제외·정답 정정 재채점 지원 (원점수·정정점수·사유 보존)

### 6.3 연습모드 즉시 피드백
- 보기 선택 → 답안 저장 API → 응답으로 해당 문항 정오·해설 반환
- 페이지 로딩 응답에는 정답 없음 (CBTbank 방식과의 차이)

### 6.4 오답 복습
- 결과에서 오답/미응답/검토 표시를 골라 재풀이 세트 생성, 원순서·무작위 선택
- 같은 문제가 여러 회차에 있으면 `canonical_question_id`로 중복 제거
- 복습 정답은 원기록을 바꾸지 않고 `review_state`(오답 횟수·다음 복습일)만 갱신

---

## 7. 데이터 모델

| 엔터티 | 핵심 필드 |
|---|---|
| certifications | id, name, alias, status |
| syllabus_versions | certification_id, effective_from/to, scoring_policy |
| subjects | syllabus_version_id, name, order |
| exam_papers | certification_id, exam_date, round, source_type(공식/복원/자체) |
| questions | id, canonical_id, subject_id, status |
| question_versions | question_id, version, body, choices, answer, explanation |
| exam_items | paper_id, question_version_id, order, points |
| content_sources | owner, origin, license, verified_at |
| attempts | id, owner_id / guest_token_hash, mode, policy_version, status, started_at, submitted_at, parent_attempt_id |
| attempt_items | attempt_id, question_version_id, choice_order, points |
| answers | attempt_item_id, selected_choice, marked, revision, saved_at |
| grading_results | attempt_id, raw_score, subject_scores, verdict, grader_version |
| review_events / review_state | user_id, question_id, correctness, wrong_count, next_due_at |
| bookmarks / notes | user_id, question_id, content |
| issue_reports | question_version_id, category, detail, state |
| entitlements | user_id, product_id, starts_at, expires_at |
| audit_events | actor, action, entity, version, at |

---

## 8. API·저장 전략

| API | 기능 | 조건 |
|---|---|---|
| GET /api/certifications | 종목·검색 | 캐시 |
| GET /api/exam-papers | 회차·과목 | 출처 구분 |
| POST /api/attempts | 시작 | 문항·정책 스냅샷, **정답 제외** |
| GET /api/attempts/{id} | 이어풀기 | 소유자 확인, 정답 제외 |
| PUT /api/attempts/{id}/answers/{item} | 답안 저장 | revision·멱등, 연습모드면 정오·해설 반환 |
| POST /api/attempts/{id}/submit | 제출 | 중복 방지, 서버 시각 |
| GET /api/attempts/{id}/result | 결과 | graded 이후만 |
| POST /api/review-sessions | 오답 재풀이 | 원기록 연결 |
| GET /api/me/reviews | 오늘의 복습 | |
| PUT /api/me/bookmarks/{question} | 북마크 | 유일키 |
| POST /api/question-reports | 오류 신고 | 문항 버전 포함 |

- 원본은 서버 DB. 브라우저 IndexedDB는 오프라인 재전송 대기열로만 사용 (`client_event_id` + `revision`)
- 선택 후 짧은 debounce 저장, 화면에 저장중/저장됨/재시도 표시. `beforeunload`에 의존하지 않음
- 비회원: 추측 불가 게스트 토큰(HttpOnly 쿠키)으로 저장, 가입 시 명시적 병합
- 세션 쿠키는 HttpOnly·Secure·SameSite 설정 (CBTbank `PHPSESSID` 미설정 사례 참고)
- 타이머: 서버가 started_at·deadline 결정, 화면은 표시만

---

## 9. 기술 구성 — 보유 구독 기준 권장

| 영역 | 권장 | 비고 |
|---|---|---|
| 프런트·API | Next.js(TypeScript) 또는 Hono on **Cloudflare Workers** | 이미 Cloudflare 유료(Workers Paid) 구독 중 → 추가 서버비 없이 시작 가능 |
| DB | **Cloudflare D1**(SQLite) 로 MVP 시작 → 규모 커지면 PostgreSQL(Hyperdrive 연결) | D1은 초기 비용·운영 부담 최소. 대규모 동시 쓰기 한계는 사전 부하 테스트 |
| 이미지 | **Cloudflare R2** + CDN | 문항 이미지 다량 |
| 인증 | 이메일 + 카카오·구글 OAuth | 모두CBT와 동일 수준 |
| 개발 | Claude Max(Claude Code)로 구현 | API 비용 없이 구독 범위 |

> 요금·무료 한도는 Cloudflare 공식 페이지에서 착수 시점에 재확인 필요 (이 문서에 가격을 기입하지 않음).

---

## 10. 콘텐츠·운영·정책

- 흐름: 수집 → **권리 확인** → OCR/입력 → 문항 분리 → 정답 대조 → 해설 검수 → 미리보기 → 발행
- 공식 기출 / 복원 / 자체 제작 / AI 보조 해설을 이용자에게 표시
- 경쟁사 문제 이미지·해설은 재사용하지 않음 (CBTbank·모두CBT도 출처·저작권 안내 표시)
- 문항 정정은 새 버전 생성, 과거 attempt는 원버전 유지
- 수익화 가설: 무료 기본 학습 + 기간제 이용권(광고 제거·무제한 모의고사·출력). 가격은 전환 실험 후 결정
- 개인정보 보유기간·계정 삭제·환불·사업자 표시는 운영 형태 확정 후 작성 (법률 검토 별도)

---

## 11. 출시 전 검증 기준

| 검증 | 테스트 | 합격 기준 |
|---|---|---|
| 기본 여정 | 종목→회차→40문항→제출→오답 재풀이 | 전 단계 연결 |
| 점수 경계 | 0/1/39/40 정답, 2.5점 | 결과·목록·CSV 동일 (COMCBT 회귀 케이스) |
| 합격 경계 | 과락·합격선 전후 | 정책 버전과 일치 |
| **정답 비노출** | 시험모드 시작 응답·DOM·JSON-LD·JS 번들 검사 | 정답·해설 0건 (CBTbank 회귀 케이스) |
| **새로고침 복원** | 선택 후 새로고침·다른 브라우저 | 마지막 저장 상태 복원 (CBTbank 회귀 케이스) |
| 오프라인 | 연결 끊김·재전송 | 중복 없이 복구 |
| 다중 기기 | 같은 문항 동시 수정 | 충돌 알림, 무음 유실 없음 |
| 중복 제출 | 연타·타임아웃 재시도 | 결과 1개 |
| 권한 | 타인 attempt ID 조회 | 403 |
| 쿠키 보안 | 세션 쿠키 속성 | HttpOnly·Secure·SameSite |
| 접근성 | 키보드·모바일·수식·이미지 | 전 기능 사용 가능 |

**지표:** 시작 전환율, 제출 완료율, 저장 오류율, 7일 재학습률, 오답 재풀이 정답률

---

## 12. 일정·의사결정

| 단계 | 산출물 | 다음 단계 조건 |
|---|---|---|
| 1. 콘텐츠·정책 | 초기 종목, 권리 근거, 채점 정책, 샘플 문항 | 검수 가능한 1회차 확보 |
| 2. 학습 골격 | 종목·회차·풀이·OMR·제출 UI | 모바일 포함 왕복 동선 |
| 3. 저장·채점 | 인증, attempt, 자동 저장, 서버 채점 | 점수·권한·정답 비노출 검증 |
| 4. 복습·운영 | 오답 큐, 기록, 관리자, 신고 | 정정·복원·재풀이 검증 |
| 5. 수익·출시 | 이용권·광고·지표 | 무료 학습 안정화 |

**결정 필요:** ① 초기 종목 ② 콘텐츠 확보 방식(직접 입력/제휴/자체 제작) ③ 비회원 저장 범위 ④ 시험 타이머 강제 여부 ⑤ 기록 보존 기간 ⑥ 유료 권한 범위

**후속 조사(선택):** 한국 IP 개인 PC에서 `rea/capture.mjs` 또는 Claude in Chrome으로 COMCBT 점수 불일치, 모두CBT 회원 흐름 수집
