// CBT 3개 사이트 비회원 흐름 수집기: HAR(민감 헤더 제거), 스토리지 전후 스냅샷, 공개 JS 엔드포인트 문자열.
// 사용: node rea/capture.mjs [comcbt|cbtbank|moducbt|all]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require('/opt/node-tools/node_modules/playwright'); }

const OUT = path.resolve(process.argv[3] || 'rea/out');
const SENSITIVE = /^(cookie|set-cookie|authorization|x-csrf-token|x-xsrf-token)$/i;

async function snapshot(context, page, label, log) {
  const cookies = (await context.cookies()).map(c => ({
    name: c.name, domain: c.domain, path: c.path, expires: c.expires,
    httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, valueLength: c.value.length,
  }));
  const storage = await page.evaluate(async () => {
    const dump = s => Object.fromEntries(Object.keys(s).map(k => [k, String(s.getItem(k)).slice(0, 200)]));
    let idb = [];
    try { idb = (await indexedDB.databases()).map(d => d.name); } catch {}
    return { url: location.href, localStorage: dump(localStorage), sessionStorage: dump(sessionStorage), indexedDB: idb };
  }).catch(e => ({ error: String(e) }));
  log.push({ step: label, at: new Date().toISOString(), cookies, ...storage });
}

async function scriptInfo(page) {
  return page.evaluate(() => ({
    title: document.title,
    scripts: [...document.scripts].map(s => s.src || `inline:${s.textContent.length}`),
    forms: [...document.forms].map(f => ({ action: f.action, method: f.method, inputs: [...f.elements].map(e => e.name).filter(Boolean) })),
    iframes: [...document.querySelectorAll('iframe')].map(f => f.src),
  }));
}

// 공개 JS 본문에서 API 경로처럼 보이는 문자열만 추출 (요청은 보내지 않음)
async function endpointsFromScripts(context, srcs) {
  const found = {};
  for (const src of srcs.filter(s => s.startsWith('http'))) {
    try {
      const body = await (await context.request.get(src)).text();
      const hits = body.match(/["'`](\/(?:api|v\d|oauth|graphql)[\w\-./{}:$]*|https?:\/\/api\.[\w.\-/]+)["'`]/g) || [];
      if (hits.length) found[src] = [...new Set(hits.map(h => h.slice(1, -1)))];
    } catch (e) { found[src] = [`fetch-error: ${e.message}`]; }
  }
  return found;
}

const FLOWS = {
  async comcbt(page, context, log, notes) {
    await page.goto('https://www.comcbt.com/', { waitUntil: 'domcontentloaded' });
    await snapshot(context, page, 'home', log);
    notes.home = await scriptInfo(page);
    await page.goto('https://www.comcbt.com/cbt/index2.php?hack_number=29', { waitUntil: 'domcontentloaded' });
    await snapshot(context, page, 'cbt-index', log);
    notes.cbtIndex = await scriptInfo(page);
    // 광고 단계·종목 선택은 화면 구성이 바뀌기 쉬워 자동화하지 않음. 이후 단계는 --headed 수동 조작 + HAR로 수집.
  },
  async cbtbank(page, context, log, notes) {
    await page.goto('https://cbtbank.kr/exam/c220200704', { waitUntil: 'domcontentloaded' });
    await snapshot(context, page, 'exam-loaded', log);
    notes.exam = await scriptInfo(page);
    const choices = page.locator('.question-choice');
    for (let i = 0; i < 2 && i < await choices.count(); i++) {
      await choices.nth(i).locator('li').nth(1).click().catch(e => notes[`click${i}`] = String(e));
    }
    notes.markBeforeReload = await page.locator('.question-choice li.mark').count();
    await snapshot(context, page, 'after-2-answers', log);
    page.once('dialog', d => { notes.scoreDialog = d.message(); d.dismiss(); });
    await page.locator('.score').first().click({ timeout: 5000 }).catch(e => notes.scoreClick = String(e));
    await page.reload({ waitUntil: 'domcontentloaded' });
    notes.markAfterReload = await page.locator('.question-choice li.mark').count();
    await snapshot(context, page, 'after-reload', log);
  },
  async moducbt(page, context, log, notes) {
    await page.goto('https://www.moducbt.com/', { waitUntil: 'networkidle' });
    await snapshot(context, page, 'home', log);
    notes.home = await scriptInfo(page);
    await page.goto('https://www.moducbt.com/pricing', { waitUntil: 'networkidle' });
    await snapshot(context, page, 'pricing', log);
    notes.nextData = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      const d = JSON.parse(el.textContent);
      return { page: d.page, buildId: d.buildId, propKeys: Object.keys(d.props?.pageProps || {}) };
    });
    notes.endpoints = await endpointsFromScripts(context, notes.home.scripts);
  },
};

function redactHar(file) {
  const har = JSON.parse(fs.readFileSync(file, 'utf8'));
  const clean = hs => hs.map(h => SENSITIVE.test(h.name) ? { ...h, value: '[REDACTED]' } : h);
  for (const e of har.log.entries) {
    e.request.headers = clean(e.request.headers);
    e.response.headers = clean(e.response.headers);
    e.request.cookies = []; e.response.cookies = [];
  }
  fs.writeFileSync(file, JSON.stringify(har, null, 1));
  return har.log.entries.map(e => ({
    method: e.request.method, url: e.request.url, status: e.response.status,
    type: e.response.content?.mimeType, postData: e.request.postData?.text?.slice(0, 500),
  }));
}

async function run(site) {
  const dir = path.join(OUT, site);
  fs.mkdirSync(dir, { recursive: true });
  const browser = await playwright.chromium.launch({ headless: !process.env.HEADED });
  const context = await browser.newContext({
    locale: 'ko-KR',
    recordHar: { path: path.join(dir, 'network.har'), content: 'embed', urlFilter: new RegExp(site) },
  });
  const page = await context.newPage();
  const log = [], notes = {};
  try { await FLOWS[site](page, context, log, notes); }
  catch (e) { notes.error = String(e); }
  await context.close();
  await browser.close();
  const requests = redactHar(path.join(dir, 'network.har'));
  fs.writeFileSync(path.join(dir, 'storage.json'), JSON.stringify(log, null, 2));
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(notes, null, 2));
  fs.writeFileSync(path.join(dir, 'requests.json'), JSON.stringify(requests, null, 2));
  console.log(`${site}: ${requests.length} requests, ${log.length} snapshots${notes.error ? `, error: ${notes.error}` : ''}`);
}

const target = process.argv[2] || 'all';
for (const site of target === 'all' ? Object.keys(FLOWS) : [target]) await run(site);
