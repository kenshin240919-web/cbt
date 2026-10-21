// 회차 JSON(content/*.json) → D1 SQL. 같은 내용을 다시 넣으면 변화 없음,
// 문항 내용이 바뀌면 새 버전을 만들고 회차 구성만 새 버전으로 교체한다(기존 시도는 원버전 유지).
// 사용: node scripts/import-paper.mjs content/xxx.json > out.sql
import fs from 'node:fs';
import crypto from 'node:crypto';

const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const q = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const errors = [];
const out = [];

const { certification: cert, subjects, paper, questions } = doc;
const subjectId = key => `${cert.id}:${key}`;
const subjectKeys = new Set(subjects.map(s => s.key));

questions.forEach((x, i) => {
  const where = `questions[${i}] (${x.key})`;
  if (!subjectKeys.has(x.subject)) errors.push(`${where}: unknown subject ${x.subject}`);
  if (!x.body?.trim()) errors.push(`${where}: empty body`);
  if (!Array.isArray(x.choices) || x.choices.length < 2) errors.push(`${where}: choices must have 2+ items`);
  if (!Array.isArray(x.answer) || x.answer.some(a => !Number.isInteger(a) || a < 1 || a > x.choices.length)) {
    errors.push(`${where}: answer must be choice numbers within 1..${x.choices?.length}`);
  }
});
const dupKeys = questions.map(x => x.key).filter((k, i, a) => a.indexOf(k) !== i);
if (dupKeys.length) errors.push(`duplicate question keys: ${dupKeys.join(', ')}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

out.push(`INSERT INTO certifications (id, name, policy_id) VALUES (${q(cert.id)}, ${q(cert.name)}, ${q(cert.policy)}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, policy_id = excluded.policy_id;`);
subjects.forEach((s, i) => {
  out.push(`INSERT INTO subjects (id, certification_id, name, ord) VALUES (${q(subjectId(s.key))}, ${q(cert.id)}, ${q(s.name)}, ${i + 1}) ON CONFLICT (id) DO UPDATE SET name = excluded.name, ord = excluded.ord;`);
});
out.push(`INSERT INTO exam_papers (id, certification_id, title, exam_date, round, source_type, source_note, is_sample) VALUES (${[paper.id, cert.id, paper.title, paper.examDate, paper.round, paper.sourceType, paper.sourceNote].map(q).join(', ')}, ${paper.isSample ? 1 : 0}) ON CONFLICT (id) DO UPDATE SET title = excluded.title, exam_date = excluded.exam_date, round = excluded.round, source_type = excluded.source_type, source_note = excluded.source_note, is_sample = excluded.is_sample;`);
out.push(`DELETE FROM exam_items WHERE paper_id = ${q(paper.id)};`);

questions.forEach((x, i) => {
  const choices = JSON.stringify(x.choices);
  const answers = JSON.stringify(x.answer);
  const hash = crypto.createHash('sha256').update(JSON.stringify([x.body, choices, answers, x.explanation ?? null])).digest('hex');
  const qid = `(SELECT id FROM questions WHERE canonical_key = ${q(x.key)})`;
  out.push(`INSERT INTO questions (canonical_key, subject_id) VALUES (${q(x.key)}, ${q(subjectId(x.subject))}) ON CONFLICT (canonical_key) DO UPDATE SET subject_id = excluded.subject_id;`);
  out.push(`INSERT OR IGNORE INTO question_versions (question_id, version, content_hash, body, choices_json, answers_json, explanation) VALUES (${qid}, (SELECT COALESCE(MAX(version), 0) + 1 FROM question_versions WHERE question_id = ${qid}), ${q(hash)}, ${q(x.body)}, ${q(choices)}, ${q(answers)}, ${q(x.explanation ?? null)});`);
  out.push(`INSERT INTO exam_items (paper_id, ord, question_version_id) VALUES (${q(paper.id)}, ${i + 1}, (SELECT id FROM question_versions WHERE question_id = ${qid} AND content_hash = ${q(hash)}));`);
});

process.stdout.write(out.join('\n') + '\n');
