-- 과목별 풀기: 한 과목만 담은 시도. NULL이면 회차 전체
ALTER TABLE attempts ADD COLUMN subject_id TEXT REFERENCES subjects(id);
