// 사람이 쓰기 쉬운 텍스트 형식 → 회차 JSON(import-paper.mjs 입력)
// 사용: node scripts/txt-to-paper.mjs content/2020-1.txt > content/2020-1.json
// 형식은 content/TEMPLATE.txt 참고
import fs from 'node:fs';

const MARKS = '①②③④⑤⑥';
const lines = fs.readFileSync(process.argv[2], 'utf8').replace(/\r/g, '').split('\n');
const meta = {};
const subjects = [];
const questions = [];
const errors = [];
let subject = null;
let q = null;
let field = null; // 'body' | 'explanation' — 여러 줄 이어붙일 대상
let inBox = false; // <보기> … </보기> 안: 줄을 그대로 보존

// 보기: ① 또는 1) 또는 (1)
const choiceRe = new RegExp(`^\\s*(?:([${MARKS}])|\\(?([1-6])\\))\\s*(.*)$`);

function finish() {
  if (!q) return;
  if (!q.choices.length) errors.push(`${q.no}번: 보기가 없습니다`);
  if (!q.answer) errors.push(`${q.no}번: "정답:" 줄이 없습니다`);
  questions.push(q);
  q = null;
}

lines.forEach((raw, idx) => {
  const line = raw.trimEnd();
  const at = `${idx + 1}번째 줄`;
  let m;
  if (inBox) {
    if (line.trim() === '</보기>') { q.body += '\n[/보기]'; inBox = false; }
    else q.body += '\n' + line.trimEnd();
    return;
  }
  if (line.trim() === '<보기>') {
    if (!q || field !== 'body') { errors.push(`${at}: <보기>는 문제 본문 바로 아래에만 쓸 수 있습니다`); return; }
    q.body += '\n[보기]'; inBox = true;
    return;
  }
  if (!line.trim()) { if (field && q) q[field] += '\n'; return; }
  if (!subject && !q && (m = line.match(/^(종목|종목ID|회차ID|제목|시험일|회차|출처|출처설명)\s*:\s*(.*)$/))) { meta[m[1]] = m[2].trim(); return; }
  if ((m = line.match(/^\[과목\s*(\d+)\]\s*(.+)$/))) {
    finish();
    subject = `s${m[1]}-${m[2].trim().replace(/\s+/g, '')}`;
    if (!subjects.some(s => s.key === subject)) subjects.push({ key: subject, name: m[2].trim() });
    field = null;
    return;
  }
  // 문제 번호는 "N." 형식. 해설 안의 "1." 목록과 구분하려고, 해설 중에는 다음 번호(N+1)일 때만 새 문제로 본다
  if ((m = line.match(/^(\d{1,3})\.\s*(.*)$/)) && (!q || field !== 'explanation' || Number(m[1]) === q.no + 1)) {
    if (!subject) { errors.push(`${at}: [과목 N] 줄보다 문제가 먼저 나왔습니다`); return; }
    finish();
    q = { no: Number(m[1]), subject, body: m[2], choices: [], answer: null, explanation: '' };
    field = 'body';
    return;
  }
  if (!q) { errors.push(`${at}: 알 수 없는 줄 "${line}"`); return; }
  if ((m = line.match(/^정답\s*:\s*(.*)$/))) {
    const v = m[1].trim();
    if (/전원\s*정답/.test(v)) q.answer = [];
    else {
      q.answer = [...v.matchAll(new RegExp(`[${MARKS}]|[1-6]`, 'g'))].map(x => (MARKS.includes(x[0]) ? MARKS.indexOf(x[0]) + 1 : Number(x[0])));
      if (!q.answer.length) errors.push(`${at}: 정답을 읽을 수 없습니다 "${v}"`);
    }
    field = null;
    return;
  }
  if ((m = line.match(/^해설\s*:\s*(.*)$/))) { q.explanation = m[1]; field = 'explanation'; return; }
  if (field !== 'explanation' && (m = line.match(choiceRe))) {
    const n = m[1] ? MARKS.indexOf(m[1]) + 1 : Number(m[2]);
    if (n !== q.choices.length + 1) errors.push(`${at}: ${q.no}번 보기 순서가 맞지 않습니다`);
    q.choices.push(m[3].trim());
    field = null;
    return;
  }
  if (field) q[field] += (q[field] ? '\n' : '') + line.trim();
  else errors.push(`${at}: ${q.no}번 어디에 속하는 줄인지 모르겠습니다 "${line}"`);
});
finish();

if (inBox) errors.push('</보기>로 닫지 않은 보기 박스가 있습니다');
for (const k of ['회차ID', '제목']) if (!meta[k]) errors.push(`맨 위에 "${k}:" 줄이 필요합니다`);
const nums = questions.map(x => x.no);
nums.forEach((n, i) => { if (n !== i + 1) errors.push(`문제 번호가 ${i + 1}이어야 하는데 ${n}입니다(빠졌거나 중복)`); });
if (errors.length) {
  console.error(errors.slice(0, 30).join('\n'));
  process.exit(1);
}

const paperId = meta['회차ID'];
// [그림: 파일] → {{img:/q-img/<회차ID>/파일}} (파일은 public/q-img/<회차ID>/에 둔다)
const imgDir = new URL(`../public/q-img/${paperId}/`, import.meta.url);
const withImages = (text, where) => text.replace(/\[그림:\s*([\w.-]+)\]/g, (_, file) => {
  if (!fs.existsSync(new URL(file, imgDir))) errors.push(`${where}: 그림 파일 없음 public/q-img/${paperId}/${file}`);
  return `{{img:/q-img/${paperId}/${file}}}`;
});
const converted = questions.map(x => ({
  ...x,
  body: withImages(x.body.trim(), `${x.no}번`),
  choices: x.choices.map(c => withImages(c, `${x.no}번 보기`)),
}));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const doc = {
  certification: { id: meta['종목ID'] || 'isafety-written', name: meta['종목'] || '산업안전기사 필기', policy: 'kr-qnet-written-v1' },
  subjects,
  paper: {
    id: paperId, title: meta['제목'], examDate: meta['시험일'] || null, round: meta['회차'] || null,
    sourceType: meta['출처'] || 'official', isSample: false, sourceNote: meta['출처설명'] || null,
  },
  questions: converted.map(x => ({
    key: `${paperId}-${String(x.no).padStart(3, '0')}`, subject: x.subject, body: x.body,
    choices: x.choices, answer: x.answer, explanation: x.explanation.trim() || null,
  })),
};
process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
console.error(`OK: ${subjects.length}과목, ${questions.length}문항`);
