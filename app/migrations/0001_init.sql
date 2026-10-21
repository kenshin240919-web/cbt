-- 콘텐츠: 종목·과목·회차·문항(버전 관리)
CREATE TABLE certifications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL REFERENCES certifications(id),
  name TEXT NOT NULL,
  ord INTEGER NOT NULL
);

CREATE TABLE exam_papers (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL REFERENCES certifications(id),
  title TEXT NOT NULL,
  exam_date TEXT,
  round TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('official', 'restored', 'original', 'sample')),
  source_note TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published'
);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_key TEXT NOT NULL UNIQUE,
  subject_id TEXT NOT NULL REFERENCES subjects(id)
);

-- 수정 시 새 버전을 만들고, 진행 중·완료된 시도는 원래 버전을 계속 참조한다
CREATE TABLE question_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  choices_json TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  explanation TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (question_id, version),
  UNIQUE (question_id, content_hash)
);

CREATE TABLE exam_items (
  paper_id TEXT NOT NULL REFERENCES exam_papers(id),
  ord INTEGER NOT NULL,
  question_version_id INTEGER NOT NULL REFERENCES question_versions(id),
  PRIMARY KEY (paper_id, ord)
);

-- 학습: 시도·답안·채점
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  guest_hash TEXT,
  paper_id TEXT NOT NULL REFERENCES exam_papers(id),
  mode TEXT NOT NULL CHECK (mode IN ('practice', 'exam')),
  policy_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'submitted', 'graded', 'abandoned')),
  parent_attempt_id TEXT REFERENCES attempts(id),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  CHECK (user_id IS NOT NULL OR guest_hash IS NOT NULL)
);
CREATE INDEX attempts_guest ON attempts (guest_hash, started_at);
CREATE INDEX attempts_user ON attempts (user_id, started_at);

CREATE TABLE attempt_items (
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  ord INTEGER NOT NULL,
  question_version_id INTEGER NOT NULL REFERENCES question_versions(id),
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  PRIMARY KEY (attempt_id, ord)
);

-- selected NULL = 미응답 (0번 보기로 저장하지 않는다)
CREATE TABLE answers (
  attempt_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  selected INTEGER,
  marked INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, ord),
  FOREIGN KEY (attempt_id, ord) REFERENCES attempt_items(attempt_id, ord)
);

CREATE TABLE grading_results (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
  raw_score REAL,
  subject_scores_json TEXT NOT NULL,
  verdict TEXT,
  correct INTEGER NOT NULL,
  wrong INTEGER NOT NULL,
  unanswered INTEGER NOT NULL,
  grader_version TEXT NOT NULL,
  graded_at TEXT NOT NULL
);
