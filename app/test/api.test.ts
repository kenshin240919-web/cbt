import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';
import app from '../src/index.ts';

let proxy: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let env: { DB: D1Database };
let tmp: string;

function statements(sql: string): string[] {
  return sql.split(/;\s*$/m).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbt-test-'));
  proxy = await getPlatformProxy<{ DB: D1Database }>({ persist: { path: tmp } });
  env = proxy.env;
  const migration = fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  for (const s of statements(migration)) await env.DB.prepare(s).run();
  const seed = execFileSync('node', ['scripts/import-paper.mjs', 'content/sample-paper.json'], { encoding: 'utf8' });
  for (const s of statements(seed)) await env.DB.prepare(s).run();
});

after(async () => {
  await proxy?.dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
});

class Client {
  cookie = '';
  async call(method: string, url: string, body?: unknown) {
    const res = await app.request(url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, setCookie: set, text: await res.text() };
  }
  async json(method: string, url: string, body?: unknown) {
    const r = await this.call(method, url, body);
    return { status: r.status, body: JSON.parse(r.text), raw: r.text, setCookie: r.setCookie };
  }
}

async function start(client: Client, mode: 'practice' | 'exam') {
  const r = await client.json('POST', '/api/attempts', { paperId: 'isafety-sample', mode });
  assert.equal(r.status, 201);
  return r;
}

test('비회원 쿠키는 HttpOnly·Secure·SameSite', async () => {
  const r = await new Client().call('GET', '/api/papers');
  assert.match(r.setCookie ?? '', /HttpOnly/);
  assert.match(r.setCookie ?? '', /Secure/);
  assert.match(r.setCookie ?? '', /SameSite=Lax/);
});

test('시험모드: 시작·조회·저장 응답 어디에도 정답·해설 없음 (CBTbank 회귀)', async () => {
  const c = new Client();
  const s = await start(c, 'exam');
  const id = s.body.id;
  const saved = await c.json('PUT', `/api/attempts/${id}/answers/1`, { selected: 1, baseRevision: 0 });
  const fetched = await c.json('GET', `/api/attempts/${id}`);
  for (const raw of [s.raw, saved.raw, fetched.raw]) {
    assert.doesNotMatch(raw, /"answers?"\s*:/);
    assert.doesNotMatch(raw, /explanation|feedback|샘플 해설/);
  }
});

test('연습모드: 저장 응답으로 해당 문항 정오·해설만 받음', async () => {
  const c = new Client();
  const s = await start(c, 'practice');
  assert.doesNotMatch(s.raw, /explanation/);
  const r = await c.json('PUT', `/api/attempts/${s.body.id}/answers/1`, { selected: 1, baseRevision: 0 });
  assert.equal(r.body.feedback.correct, true);
  assert.match(r.body.feedback.explanation, /정답은 1번/);
  const again = await c.json('GET', `/api/attempts/${s.body.id}`);
  assert.equal(again.body.items[0].feedback.correct, true);
  assert.equal(again.body.items[1].feedback, undefined);
});

test('새로고침(재조회) 시 마지막 저장 답안 복원 (CBTbank 회귀)', async () => {
  const c = new Client();
  const { body } = await start(c, 'exam');
  await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 3, baseRevision: 0 });
  await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 2, marked: true, baseRevision: 1 });
  await c.json('PUT', `/api/attempts/${body.id}/answers/5`, { selected: 4, baseRevision: 0 });
  const r = await c.json('GET', `/api/attempts/${body.id}`);
  assert.deepEqual([r.body.items[0].selected, r.body.items[0].marked, r.body.items[0].revision], [2, true, 2]);
  assert.equal(r.body.items[4].selected, 4);
  assert.equal(r.body.items[1].selected, null);
});

test('다른 탭·기기의 오래된 수정은 409 충돌로 거절', async () => {
  const c = new Client();
  const { body } = await start(c, 'exam');
  await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 1, baseRevision: 0 });
  const stale = await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 2, baseRevision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.selected, 1);
});

test('잘못된 보기 번호는 거절', async () => {
  const c = new Client();
  const { body } = await start(c, 'exam');
  assert.equal((await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 9, baseRevision: 0 })).status, 400);
  assert.equal((await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 0, baseRevision: 0 })).status, 400);
});

test('타인의 시도는 조회·저장·제출 불가', async () => {
  const owner = new Client();
  const { body } = await start(owner, 'exam');
  const other = new Client();
  await other.call('GET', '/api/papers');
  assert.equal((await other.json('GET', `/api/attempts/${body.id}`)).status, 404);
  assert.equal((await other.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 1, baseRevision: 0 })).status, 404);
  assert.equal((await other.json('POST', `/api/attempts/${body.id}/submit`)).status, 404);
});

test('비회원도 모든 회차를 시작할 수 있음', async () => {
  await env.DB.prepare(`INSERT INTO exam_papers (id, certification_id, title, source_type, is_sample) VALUES ('isafety-real', 'isafety-written', '실제 회차', 'official', 0)`).run();
  const r = await new Client().json('POST', '/api/attempts', { paperId: 'isafety-real', mode: 'exam' });
  assert.equal(r.status, 201);
});

test('공개 해설 페이지는 서버에서 렌더링되고 광고 자리가 5문항마다 들어감', async () => {
  const res = await app.request('/p/isafety-sample', {}, { ...env, ADSENSE_CLIENT: '' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>산업안전기사 필기 체험용 샘플 기출문제 및 해설<\/h1>/);
  assert.equal((html.match(/data-kind="inarticle"/g) ?? []).length, 2); // 12문항 → 5, 10번 뒤
  assert.match(html, /정답 및 해설 보기/);
  assert.equal((await app.request('/p/nope', {}, env)).status, 404);
});

test('ads.txt·robots·sitemap·개인정보처리방침', async () => {
  const adEnv = { ...env, ADSENSE_CLIENT: 'ca-pub-1234567890', ADSENSE_SLOT_INARTICLE: '' };
  const blank = { ...env, SITE_URL: '' };
  assert.equal(await (await app.request('/ads.txt', {}, adEnv)).text(), 'google.com, pub-1234567890, DIRECT, f08c47fec0942fa0\n');
  assert.match(await (await app.request('http://x.test/robots.txt', {}, blank)).text(), /Sitemap: http:\/\/x\.test\/sitemap\.xml/);
  const sm = await (await app.request('http://x.test/sitemap.xml', {}, blank)).text();
  assert.match(sm, /\/p\/isafety-real/);
  assert.doesNotMatch(sm, /isafety-sample/);
  assert.match(await (await app.request('/privacy', {}, env)).text(), /Google AdSense/);
  // 실제 설정(wrangler.jsonc) 값 확인
  assert.equal(await (await app.request('/ads.txt', {}, env)).text(), 'google.com, pub-3087515825675332, DIRECT, f08c47fec0942fa0\n');
  assert.match(await (await app.request('/p/isafety-sample', {}, env)).text(), /<link rel="canonical" href="https:\/\/cbt\.guidejung\.com\/p\/isafety-sample">/);
  const ads = await (await app.request('/p/isafety-sample', {}, { ...adEnv, ADSENSE_SLOT_DISPLAY: '111' })).text();
  assert.equal((ads.match(/data-ad-slot="111"/g) ?? []).length, 4); // 콘텐츠 내 단위 미설정 → 디스플레이로 대체
  assert.doesNotMatch(ads, /광고 자리/);
  const cfg = await (await app.request('/ads-config.js', {}, { ...adEnv, ADSENSE_SLOT_DISPLAY: '111' })).text();
  assert.match(cfg, /"client":"ca-pub-1234567890"/);
});

test('제출 → 채점: 중복 제출해도 결과 1개, 결과·목록 점수 표시 동일', async () => {
  const c = new Client();
  const { body } = await start(c, 'exam');
  // 1번 정답(1), 2번 오답(정답 2 → 1 선택), 나머지 미응답
  await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 1, baseRevision: 0 });
  await c.json('PUT', `/api/attempts/${body.id}/answers/2`, { selected: 1, baseRevision: 0 });
  const [a, b] = await Promise.all([
    c.json('POST', `/api/attempts/${body.id}/submit`),
    c.json('POST', `/api/attempts/${body.id}/submit`),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM grading_results WHERE attempt_id = ?').bind(body.id).first<{ n: number }>();
  assert.equal(rows!.n, 1);

  const result = await c.json('GET', `/api/attempts/${body.id}/result`);
  assert.deepEqual(result.body.counts, { correct: 1, wrong: 1, unanswered: 10 });
  assert.equal(result.body.verdict, 'fail');
  assert.equal(result.body.items[1].result, 'wrong');
  assert.equal(result.body.items[2].result, 'unanswered');

  const list = await c.json('GET', '/api/me/attempts');
  const mine = list.body.attempts.find((x: { id: string }) => x.id === body.id);
  assert.equal(mine.score.display, result.body.score.display);

  const late = await c.json('PUT', `/api/attempts/${body.id}/answers/3`, { selected: 1, baseRevision: 0 });
  assert.equal(late.status, 409);
});

test('채점 전에는 결과를 볼 수 없음', async () => {
  const c = new Client();
  const { body } = await start(c, 'exam');
  assert.equal((await c.json('GET', `/api/attempts/${body.id}/result`)).status, 409);
});

test('오답 다시 풀기: 오답·미응답만 새 시도로, 원래 기록은 그대로', async () => {
  const c = new Client();
  const { body } = await start(c, 'exam');
  await c.json('PUT', `/api/attempts/${body.id}/answers/1`, { selected: 1, baseRevision: 0 });
  await c.json('PUT', `/api/attempts/${body.id}/answers/2`, { selected: 1, baseRevision: 0 });
  await c.json('POST', `/api/attempts/${body.id}/submit`);
  const before = (await c.json('GET', `/api/attempts/${body.id}/result`)).body;

  const retry = await c.json('POST', `/api/attempts/${body.id}/retry`, { include: ['wrong'] });
  assert.equal(retry.status, 201);
  const child = await c.json('GET', `/api/attempts/${retry.body.id}`);
  assert.equal(child.body.items.length, 1);
  assert.equal(child.body.parentAttemptId, body.id);
  assert.equal(child.body.mode, 'practice');

  await c.json('PUT', `/api/attempts/${retry.body.id}/answers/1`, { selected: 2, baseRevision: 0 });
  await c.json('POST', `/api/attempts/${retry.body.id}/submit`);
  const childResult = (await c.json('GET', `/api/attempts/${retry.body.id}/result`)).body;
  assert.equal(childResult.counts.correct, 1);
  assert.equal(childResult.verdict, null);

  const after = (await c.json('GET', `/api/attempts/${body.id}/result`)).body;
  assert.deepEqual(after.counts, before.counts);
});
