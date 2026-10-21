# REA 재분석 결과 (2026-10-21, 클라우드 컨테이너 + Playwright Chromium)

## 수집 성공 여부
| 사이트 | 결과 | 원인 |
|---|---|---|
| CBTbank | 성공 (요청 109건, 스토리지 스냅샷 3회) | - |
| COMCBT | 실패: 모든 페이지 403 | 서버(nginx)가 접속 IP 차단 (curl도 동일) |
| 모두CBT | 실패: 모든 페이지 403 | Cloudflare가 접속 IP 차단 (curl도 동일, `api.moducbt.com`만 200) |

데이터센터(미국) IP 차단으로 판단되며, 봇 차단 우회는 시도하지 않았습니다.

## CBTbank — GPT 보고서 대비 새로 확인된 사실 (네트워크·스토리지 근거)
| 항목 | 결과 | GPT 보고서 대비 |
|---|---|---|
| 답안 선택 시 서버 통신 | 2문항 선택 동안 cbtbank.kr로 보낸 요청은 `img/correct.png`, `img/wrong.png` 이미지 2건뿐. 답안 저장 요청 없음 | "코드 확인"→**네트워크로 확정** |
| 정오 판단 위치 | 100% 브라우저. 서버가 보낸 원본 HTML에 이미 정답 표시 존재 (`ol[correct]` 40개, `li.correct` 40개 / 40문항) | JS 처리 후 DOM이 아니라 **서버 응답 자체에 정답 포함** 확정 |
| 채점 버튼 | alert "로그인후 사용가능합니다." / 서버 요청 없음 | 일치 |
| 새로고침 후 | 선택 표시 2개 → 0개 | 일치 |
| localStorage | Google 광고 설정 키 3개만. 답안 관련 키 없음 | 신규 |
| sessionStorage | 새로고침 후 `cbt_search_categories` 생성 (분류 캐시) | 일치 |
| IndexedDB | 없음 | 신규 |
| 쿠키 | `PHPSESSID`(세션 쿠키, HttpOnly 아님), 32자 hex 이름 쿠키(GNUBoard 방문 쿠키로 추정), GA·광고 쿠키 | 신규 |
| `get_categories.php` | 1회 GET 200, 응답 본문 비어 있음(HAR 기록상) | 요청 실발생 확정 |
| `last.php`, `check.php`, `bookmark.php` | 비회원 흐름에서 **호출 0건** | "도달 안 됨" 추정→확정 |
| JSON-LD | 원본 HTML엔 BreadcrumbList만, FAQPage(문제·정답)는 JS가 DOM의 정답 class로 생성 | 일치 |
| 기술 스택 | GNUBoard5(g5_* 변수, `/bbs`), 테마 bs4_v3.0, jQuery 3.3.1, Bootstrap 5.1.3, Summernote 0.8.18, MathJax 3, Kakao SDK | 버전 신규 |
| 이미지 경로 | `/images/c2/c220200704/c220200704m{문항}[b{보기}].gif` | 신규 |
| 수익화 | AdSense(ca-pub-7330555383100077), GA4 2개, GTM 1개 | 신규 |

## 결론
- CBTbank 비회원 모드는 **서버 저장 0, 클라이언트 정오 판단, 정답이 HTML에 공개**인 구조. 우리 서비스 시험모드에서 피해야 할 패턴(GPT 보고서 §10~12 제안과 일치).
- COMCBT 2점/3점 불일치, 모두CBT 로그인 이후 흐름은 이번에도 미확인. 한국 IP의 개인 PC에서 수집 필요.
