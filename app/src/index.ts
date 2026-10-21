import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { GRADER_VERSION, POLICIES, formatScore, grade, isCorrect, type GradeResult } from './scoring.ts';

import { adsConfigScript, adsTxt, paperPage, privacyPage, robotsTxt, sitemap, type AdEnv } from './pages.ts';

type Env = { DB: D1Database } & AdEnv;
type Owner = { userId: string | null; guestHash: string | null };
type Vars = { owner: Owner };

const GUEST_COOKIE = 'cbt_gid';
const GUEST_MAX_AGE = 60 * 60 * 24 * 30;

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const now = () => new Date().toISOString();

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 비회원은 추측 불가능한 토큰(HttpOnly 쿠키)으로만 식별하고, DB에는 해시만 저장한다.
// 회원 로그인은 3단계에서 붙인다(그때 userId를 채움).
app.use('/api/*', async (c, next) => {
  let token = getCookie(c, GUEST_COOKIE);
  if (!token || token.length < 32) {
    token = randomToken();
    setCookie(c, GUEST_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: GUEST_MAX_AGE });
  }
  c.set('owner', { userId: null, guestHash: await sha256(token) });
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

type AttemptRow = {
  id: string; user_id: string | null; guest_hash: string | null; paper_id: string; mode: 'practice' | 'exam';
  policy_id: string; status: string; parent_attempt_id: string | null; started_at: string; submitted_at: string | null;
  subject_id: string | null;
};

type ItemRow = {
  ord: number; subject_id: string; subject_name: string; body: string; choices_json: string;
  answers_json: string; explanation: string | null; selected: number | null; marked: number | null; revision: number | null;
};

async function loadOwnedAttempt(c: { env: Env; get: (k: 'owner') => Owner }, id: string): Promise<AttemptRow | null> {
  const row = await c.env.DB.prepare('SELECT * FROM attempts WHERE id = ?').bind(id).first<AttemptRow>();
  if (!row) return null;
  const owner = c.get('owner');
  const mine = (owner.userId && row.user_id === owner.userId) || (owner.guestHash && row.guest_hash === owner.guestHash);
  // 남의 시도는 존재 여부도 알려주지 않는다
  return mine ? row : null;
}

async function loadItems(db: D1Database, attemptId: string): Promise<ItemRow[]> {
  const { results } = await db.prepare(
    `SELECT ai.ord, ai.subject_id, s.name AS subject_name, qv.body, qv.choices_json, qv.answers_json, qv.explanation,
            a.selected, a.marked, a.revision
       FROM attempt_items ai
       JOIN question_versions qv ON qv.id = ai.question_version_id
       JOIN subjects s ON s.id = ai.subject_id
       LEFT JOIN answers a ON a.attempt_id = ai.attempt_id AND a.ord = ai.ord
      WHERE ai.attempt_id = ? ORDER BY ai.ord`,
  ).bind(attemptId).all<ItemRow>();
  return results;
}

function feedback(item: ItemRow) {
  const answers = JSON.parse(item.answers_json) as number[];
  return { correct: isCorrect(answers, item.selected), answers, explanation: item.explanation };
}

// 풀이 화면용 응답. 시험모드는 제출 전 정답·해설을 절대 포함하지 않는다.
// 연습모드는 이미 답한 문항에 한해 피드백을 포함한다(새로고침 후에도 동일하게 보이도록).
function attemptView(attempt: AttemptRow, paperTitle: string, items: ItemRow[]) {
  return {
    id: attempt.id,
    paperId: attempt.paper_id,
    paperTitle,
    mode: attempt.mode,
    status: attempt.status,
    parentAttemptId: attempt.parent_attempt_id,
    subjectId: attempt.subject_id,
    startedAt: attempt.started_at,
    items: items.map(item => ({
      ord: item.ord,
      subjectId: item.subject_id,
      subjectName: item.subject_name,
      body: item.body,
      choices: JSON.parse(item.choices_json) as string[],
      selected: item.selected,
      marked: item.marked === 1,
      revision: item.revision ?? 0,
      ...(attempt.mode === 'practice' && item.selected !== null ? { feedback: feedback(item) } : {}),
    })),
  };
}

app.get('/api/papers', async c => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.exam_date, p.round, p.source_type, p.is_sample, c.name AS certification,
            (SELECT COUNT(*) FROM exam_items ei WHERE ei.paper_id = p.id) AS question_count
       FROM exam_papers p JOIN certifications c ON c.id = p.certification_id
      WHERE p.status = 'published'
      ORDER BY p.is_sample DESC, p.exam_date DESC`,
  ).all();
  return c.json({ papers: results });
});

// 회차의 과목 목록(과목별 풀기 선택용)
async function paperSubjects(db: D1Database, paperId: string) {
  const { results } = await db.prepare(
    `SELECT s.id, s.name, COUNT(*) AS question_count
       FROM exam_items ei JOIN question_versions qv ON qv.id = ei.question_version_id
       JOIN questions q ON q.id = qv.question_id JOIN subjects s ON s.id = q.subject_id
      WHERE ei.paper_id = ? GROUP BY s.id, s.name ORDER BY MIN(ei.ord)`,
  ).bind(paperId).all<{ id: string; name: string; question_count: number }>();
  return results;
}

app.get('/api/papers/:id/subjects', async c => {
  const paper = await c.env.DB.prepare(`SELECT id, title FROM exam_papers WHERE id = ? AND status = 'published'`)
    .bind(c.req.param('id')).first<{ id: string; title: string }>();
  if (!paper) return c.json({ error: 'paper_not_found' }, 404);
  return c.json({ paper, subjects: await paperSubjects(c.env.DB, paper.id) });
});

app.post('/api/attempts', async c => {
  type StartBody = { paperId?: string; mode?: string; subjectId?: string };
  const body = await c.req.json<StartBody>().catch(() => ({} as StartBody));
  if (body.mode !== 'practice' && body.mode !== 'exam') return c.json({ error: 'invalid_mode' }, 400);

  const paper = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.is_sample, c.policy_id FROM exam_papers p JOIN certifications c ON c.id = p.certification_id
      WHERE p.id = ? AND p.status = 'published'`,
  ).bind(body.paperId ?? '').first<{ id: string; title: string; is_sample: number; policy_id: string }>();
  if (!paper) return c.json({ error: 'paper_not_found' }, 404);

  const subjectId = body.subjectId ?? null;
  if (subjectId && !(await paperSubjects(c.env.DB, paper.id)).some(s => s.id === subjectId)) {
    return c.json({ error: 'subject_not_found' }, 404);
  }

  const owner = c.get('owner');
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO attempts (id, user_id, guest_hash, paper_id, mode, policy_id, status, started_at, subject_id)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`,
    ).bind(id, owner.userId, owner.userId ? null : owner.guestHash, paper.id, body.mode, paper.policy_id, now(), subjectId),
    // 시작 시점의 문항 버전을 고정(이후 문항이 정정돼도 이 시도는 영향 없음)
    c.env.DB.prepare(
      `INSERT INTO attempt_items (attempt_id, ord, question_version_id, subject_id)
       SELECT ?, ei.ord, ei.question_version_id, q.subject_id
         FROM exam_items ei JOIN question_versions qv ON qv.id = ei.question_version_id JOIN questions q ON q.id = qv.question_id
        WHERE ei.paper_id = ? AND (? IS NULL OR q.subject_id = ?)`,
    ).bind(id, paper.id, subjectId, subjectId),
  ]);

  const attempt = (await loadOwnedAttempt(c, id))!;
  return c.json(attemptView(attempt, paper.title, await loadItems(c.env.DB, id)), 201);
});

app.get('/api/attempts/:id', async c => {
  const attempt = await loadOwnedAttempt(c, c.req.param('id'));
  if (!attempt) return c.json({ error: 'not_found' }, 404);
  const paper = await c.env.DB.prepare('SELECT title FROM exam_papers WHERE id = ?').bind(attempt.paper_id).first<{ title: string }>();
  return c.json(attemptView(attempt, paper?.title ?? '', await loadItems(c.env.DB, attempt.id)));
});

// 답안 저장. baseRevision이 서버 값과 다르면(다른 탭·기기에서 먼저 바꿈) 409로 최신 상태를 돌려준다.
app.put('/api/attempts/:id/answers/:ord', async c => {
  const attempt = await loadOwnedAttempt(c, c.req.param('id'));
  if (!attempt) return c.json({ error: 'not_found' }, 404);
  if (attempt.status !== 'in_progress') return c.json({ error: 'already_submitted' }, 409);

  const ord = Number(c.req.param('ord'));
  const body = await c.req.json<{ selected?: number | null; marked?: boolean; baseRevision?: number }>().catch(() => null);
  if (!body || !Number.isInteger(ord)) return c.json({ error: 'invalid_request' }, 400);

  const item = (await loadItems(c.env.DB, attempt.id)).find(i => i.ord === ord);
  if (!item) return c.json({ error: 'item_not_found' }, 404);

  const choiceCount = (JSON.parse(item.choices_json) as string[]).length;
  const selected = body.selected ?? null;
  if (selected !== null && (!Number.isInteger(selected) || selected < 1 || selected > choiceCount)) {
    return c.json({ error: 'invalid_choice' }, 400);
  }

  const current = item.revision ?? 0;
  if ((body.baseRevision ?? 0) !== current) {
    return c.json({ error: 'conflict', selected: item.selected, marked: item.marked === 1, revision: current }, 409);
  }

  const revision = current + 1;
  const savedAt = now();
  const res = await c.env.DB.prepare(
    `INSERT INTO answers (attempt_id, ord, selected, marked, revision, saved_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (attempt_id, ord) DO UPDATE SET selected = excluded.selected, marked = excluded.marked,
       revision = excluded.revision, saved_at = excluded.saved_at
     WHERE answers.revision = ?`,
  ).bind(attempt.id, ord, selected, body.marked ? 1 : 0, revision, savedAt, current).run();
  if (res.meta.changes === 0) return c.json({ error: 'conflict' }, 409);

  const saved = { ...item, selected, marked: body.marked ? 1 : 0, revision };
  return c.json({
    ord, selected, marked: !!body.marked, revision, savedAt,
    ...(attempt.mode === 'practice' && selected !== null ? { feedback: feedback(saved) } : {}),
  });
});

async function storeGrade(db: D1Database, attempt: AttemptRow): Promise<GradeResult> {
  const items = await loadItems(db, attempt.id);
  const result = grade(
    items.map(i => ({ subjectId: i.subject_id, subjectName: i.subject_name, answers: JSON.parse(i.answers_json), selected: i.selected })),
    POLICIES[attempt.policy_id],
    // 다시 풀기·과목별 풀기는 일부 문항만 풀었으므로 합격 판정을 하지 않는다(과목 점수·과락만)
    attempt.parent_attempt_id === null && attempt.subject_id === null,
  );
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO grading_results
         (attempt_id, raw_score, subject_scores_json, verdict, correct, wrong, unanswered, grader_version, graded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(attempt.id, result.raw, JSON.stringify(result.subjects), result.verdict, result.correct, result.wrong, result.unanswered, GRADER_VERSION, now()),
    db.prepare(`UPDATE attempts SET status = 'graded' WHERE id = ? AND status = 'submitted'`).bind(attempt.id),
  ]);
  return result;
}

// 중복 제출(연타·재시도)에도 채점 결과는 하나만 남는다
app.post('/api/attempts/:id/submit', async c => {
  const attempt = await loadOwnedAttempt(c, c.req.param('id'));
  if (!attempt) return c.json({ error: 'not_found' }, 404);

  await c.env.DB.prepare(`UPDATE attempts SET status = 'submitted', submitted_at = ? WHERE id = ? AND status = 'in_progress'`)
    .bind(now(), attempt.id).run();
  const fresh = (await loadOwnedAttempt(c, attempt.id))!;
  if (fresh.status === 'submitted') await storeGrade(c.env.DB, fresh);
  return c.json({ id: attempt.id, status: 'graded' });
});

app.get('/api/attempts/:id/result', async c => {
  const attempt = await loadOwnedAttempt(c, c.req.param('id'));
  if (!attempt) return c.json({ error: 'not_found' }, 404);
  if (attempt.status !== 'graded') return c.json({ error: 'not_graded' }, 409);

  const g = await c.env.DB.prepare('SELECT * FROM grading_results WHERE attempt_id = ?').bind(attempt.id).first<{
    raw_score: number | null; subject_scores_json: string; verdict: string | null; correct: number; wrong: number; unanswered: number;
  }>();
  const items = await loadItems(c.env.DB, attempt.id);
  return c.json({
    id: attempt.id,
    mode: attempt.mode,
    paperId: attempt.paper_id,
    parentAttemptId: attempt.parent_attempt_id,
    subjectId: attempt.subject_id,
    // 과목별 풀기: 다음 과목 바로가기
    nextSubject: attempt.subject_id && !attempt.parent_attempt_id
      ? (await paperSubjects(c.env.DB, attempt.paper_id)).find((s, i, all) => all[i - 1]?.id === attempt.subject_id) ?? null
      : null,
    startedAt: attempt.started_at,
    submittedAt: attempt.submitted_at,
    score: g!.raw_score === null ? null : { raw: g!.raw_score, display: formatScore(g!.raw_score) },
    verdict: g!.verdict,
    counts: { correct: g!.correct, wrong: g!.wrong, unanswered: g!.unanswered },
    subjects: JSON.parse(g!.subject_scores_json),
    items: items.map(i => {
      const f = feedback(i);
      return {
        ord: i.ord, subjectName: i.subject_name, body: i.body, choices: JSON.parse(i.choices_json),
        selected: i.selected, marked: i.marked === 1, answers: f.answers, explanation: f.explanation,
        result: f.correct ? 'correct' : i.selected === null ? 'unanswered' : 'wrong',
      };
    }),
  });
});

// 오답/미응답만 다시 풀기: 새 시도로 만들고 원래 기록은 건드리지 않는다
app.post('/api/attempts/:id/retry', async c => {
  const parent = await loadOwnedAttempt(c, c.req.param('id'));
  if (!parent) return c.json({ error: 'not_found' }, 404);
  if (parent.status !== 'graded') return c.json({ error: 'not_graded' }, 409);

  const body = await c.req.json<{ include?: string[]; mode?: string }>().catch(() => ({} as { include?: string[]; mode?: string }));
  const include = new Set(body.include?.length ? body.include : ['wrong', 'unanswered']);
  const mode = body.mode === 'exam' ? 'exam' : 'practice';

  const picked = (await loadItems(c.env.DB, parent.id)).filter(i => {
    const f = feedback(i);
    const kind = f.correct ? 'correct' : i.selected === null ? 'unanswered' : 'wrong';
    return include.has(kind) || (include.has('marked') && i.marked === 1);
  });
  if (picked.length === 0) return c.json({ error: 'nothing_to_retry' }, 400);

  const id = crypto.randomUUID();
  const owner = c.get('owner');
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO attempts (id, user_id, guest_hash, paper_id, mode, policy_id, status, parent_attempt_id, started_at, subject_id)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?, ?, ?)`,
    ).bind(id, parent.user_id, parent.guest_hash ?? owner.guestHash, parent.paper_id, mode, parent.policy_id, parent.id, now(), parent.subject_id),
    ...picked.map((item, idx) =>
      c.env.DB.prepare(
        `INSERT INTO attempt_items (attempt_id, ord, question_version_id, subject_id)
         SELECT ?, ?, question_version_id, subject_id FROM attempt_items WHERE attempt_id = ? AND ord = ?`,
      ).bind(id, idx + 1, parent.id, item.ord),
    ),
  ]);
  return c.json({ id }, 201);
});

app.get('/api/me/attempts', async c => {
  const owner = c.get('owner');
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.mode, a.status, a.parent_attempt_id, a.started_at, a.submitted_at, p.title AS paper_title,
            (SELECT name FROM subjects WHERE id = a.subject_id) AS subject_name,
            g.raw_score, g.verdict, g.correct, g.wrong, g.unanswered
       FROM attempts a JOIN exam_papers p ON p.id = a.paper_id LEFT JOIN grading_results g ON g.attempt_id = a.id
      WHERE (a.user_id IS NOT NULL AND a.user_id = ?) OR (a.guest_hash IS NOT NULL AND a.guest_hash = ?)
      ORDER BY a.started_at DESC LIMIT 50`,
  ).bind(owner.userId, owner.guestHash).all<Record<string, unknown> & { raw_score: number | null }>();
  return c.json({
    attempts: results.map(({ raw_score, ...rest }) => ({
      ...rest,
      score: raw_score === null ? null : { raw: raw_score, display: formatScore(raw_score) },
    })),
  });
});

// 검색 유입용 공개 페이지(서버 렌더링). 시험모드 API와 분리되어 있어 응시 중 정답 노출과 무관하다.
app.get('/p/:paperId', c => paperPage(c, c.req.param('paperId')));
app.get('/p/:paperId/:page', c => paperPage(c, c.req.param('paperId'), c.req.param('page')));
app.get('/privacy', c => privacyPage(c));
app.get('/sitemap.xml', c => sitemap(c));
app.get('/robots.txt', c => robotsTxt(c));
app.get('/ads.txt', c => adsTxt(c));
app.get('/ads-config.js', c => adsConfigScript(c));

export default app;
