import type { Context } from 'hono';

// 애드센스 설정은 wrangler vars 한 곳에서 관리한다. 비어 있으면 레이아웃 확인용 자리표시만 그린다.
export type AdEnv = {
  SITE_NAME?: string;
  SITE_URL?: string;
  CONTACT_EMAIL?: string;
  ADSENSE_CLIENT?: string; // ca-pub-xxxxxxxxxxxxxxxx
  ADSENSE_SLOT_DISPLAY?: string; // 디스플레이(반응형) 광고 단위
  ADSENSE_SLOT_INARTICLE?: string; // 콘텐츠 내 자동 삽입 광고 단위
};

type Ctx = Context<{ Bindings: { DB: D1Database } & AdEnv; Variables: any }>;
export type AdKind = 'display' | 'inarticle';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// 문항 본문 표기: [보기]…[/보기] 박스(모든 줄에 " | "가 있으면 표), {{img:/q-img/…}} 그림, 줄바꿈
export function rich(text: string): string {
  return esc(text)
    .replace(/\[보기\]\n?([\s\S]*?)\n?\[\/보기\]/g, (_: string, inner: string) => {
      const rows = inner.split('\n');
      if (rows.every(r => r.includes(' | '))) {
        const [head, ...body] = rows.map(r => r.split(' | '));
        return `<table class="qtable"><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      return `<div class="qbox">${rows.join('<br>')}</div>`;
    })
    .replace(/\{\{img:(\/q-img\/[\w./-]+)\}\}/g, '<img class="qimg" src="$1" alt="문항 그림" loading="lazy">')
    .replace(/\n/g, '<br>');
}

export function adsConfig(env: AdEnv) {
  return {
    client: env.ADSENSE_CLIENT ?? '',
    slots: { display: env.ADSENSE_SLOT_DISPLAY ?? '', inarticle: env.ADSENSE_SLOT_INARTICLE ?? '' },
  };
}

// 광고 단위 HTML. 애드센스 정책상 "광고"/"스폰서" 외 문구로 클릭을 유도하지 않는다.
export function adHtml(env: AdEnv, kind: AdKind): string {
  const { client, slots } = adsConfig(env);
  const use: AdKind = slots[kind] ? kind : 'display'; // 콘텐츠 내 단위가 없으면 디스플레이로 대체
  const slot = slots[use];
  if (!client || !slot) return `<div class="ad ad-placeholder" data-kind="${kind}">광고 자리 (${kind})</div>`;
  const attrs = use === 'inarticle'
    ? `style="display:block;text-align:center" data-ad-layout="in-article" data-ad-format="fluid"`
    : `style="display:block" data-ad-format="auto" data-full-width-responsive="true"`;
  return `<div class="ad"><ins class="adsbygoogle" ${attrs} data-ad-client="${esc(client)}" data-ad-slot="${esc(slot)}"></ins></div>`;
}

function siteName(env: AdEnv) {
  return env.SITE_NAME || 'CBT 기출 학습';
}

function layout(env: AdEnv, opts: { title: string; description: string; canonical?: string; head?: string; body: string }) {
  const { client } = adsConfig(env);
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">` : ''}
${opts.head ?? ''}
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/style.css">
${client ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(client)}" crossorigin="anonymous"></script>` : ''}
</head>
<body>
<header class="top"><a href="/#/" class="brand">${esc(siteName(env))}</a><nav><a href="/#/records">내 기록</a></nav></header>
<main>${opts.body}</main>
<footer class="foot"><a href="/privacy">개인정보처리방침</a></footer>
${client ? `<script>document.querySelectorAll('ins.adsbygoogle').forEach(function(){(adsbygoogle=window.adsbygoogle||[]).push({})});</script>` : ''}
</body>
</html>`;
}

type PaperRow = { id: string; title: string; certification: string; exam_date: string | null; source_type: string; source_note: string | null };
type QRow = { ord: number; subject: string; body: string; choices_json: string; answers_json: string; explanation: string | null };

const SOURCE_LABEL: Record<string, string> = { official: '공식 공개 기출', restored: '복원 기출', original: '모의고사', sample: '샘플' };

// 회차별 기출 해설 페이지. 정답·해설은 접힌 상태로 제공(먼저 풀어보도록), 문항 사이에 광고.
export const PER_PAGE = 5; // 해설 페이지: 5문항씩 한 페이지

// 회차별 기출 해설 페이지(5문항씩 나눔). 정답·해설은 접힌 상태로 제공(먼저 풀어보도록).
// 페이지마다 광고 2개(3번째 문항 뒤 콘텐츠 내 + 페이지 끝), 페이지 이동은 실제 링크라 전면 광고 기회가 된다.
export async function paperPage(c: Ctx, paperId: string, pageParam?: string) {
  const notFound = () => c.html(layout(c.env, { title: '찾을 수 없음', description: '', body: '<h1>페이지를 찾을 수 없습니다</h1>' }), 404);
  const page = pageParam === undefined ? 1 : Number(pageParam);
  if (!/^\d+$/.test(pageParam ?? '1') || page < 1) return notFound();
  if (pageParam !== undefined && page === 1) return c.redirect(`/p/${encodeURIComponent(paperId)}`, 301); // 1페이지는 대표 주소로

  const paper = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.exam_date, p.source_type, p.source_note, c.name AS certification
       FROM exam_papers p JOIN certifications c ON c.id = p.certification_id WHERE p.id = ? AND p.status = 'published'`,
  ).bind(paperId).first<PaperRow>();
  if (!paper) return notFound();

  const { results: all } = await c.env.DB.prepare(
    `SELECT ei.ord, s.name AS subject, qv.body, qv.choices_json, qv.answers_json, qv.explanation
       FROM exam_items ei JOIN question_versions qv ON qv.id = ei.question_version_id
       JOIN questions q ON q.id = qv.question_id JOIN subjects s ON s.id = q.subject_id
      WHERE ei.paper_id = ? ORDER BY ei.ord`,
  ).bind(paperId).all<QRow>();
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  if (page > pages) return notFound();
  const qs = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const pageUrl = (n: number) => `/p/${encodeURIComponent(paper.id)}${n === 1 ? '' : `/${n}`}`;

  const marks = '①②③④⑤⑥';
  const parts: string[] = [];
  qs.forEach((q, i) => {
    const choices = JSON.parse(q.choices_json) as string[];
    const answers = JSON.parse(q.answers_json) as number[];
    if (i === 0 || q.subject !== qs[i - 1].subject) parts.push(`<h2 class="subject-head">${esc(q.subject)}</h2>`);
    parts.push(`<section class="card">
  <p><strong>${q.ord}.</strong> ${rich(q.body)}</p>
  <ol class="plain">${choices.map((ch, k) => `<li>${marks[k] ?? k + 1} ${rich(ch)}</li>`).join('')}</ol>
  <details><summary>정답 및 해설 보기</summary>
    <p><strong>정답: ${answers.length ? answers.map(a => marks[a - 1] ?? a).join(', ') : '전원 정답'}</strong></p>
    ${q.explanation ? `<p>${rich(q.explanation)}</p>` : ''}
  </details>
</section>`);
    if (i === 2 && qs.length > 3) parts.push(adHtml(c.env, 'inarticle'));
  });

  const first = qs[0]?.ord ?? 0;
  const last = qs[qs.length - 1]?.ord ?? 0;
  const pager = `<nav class="card pager" aria-label="문항 페이지">
  <div class="row pager-main">
    ${page > 1 ? `<a class="btn" href="${pageUrl(page - 1)}" rel="prev">← 이전 5문제</a>` : '<span></span>'}
    <span class="muted">${page} / ${pages}</span>
    ${page < pages ? `<a class="btn primary" href="${pageUrl(page + 1)}" rel="next">다음 5문제 →</a>` : `<a class="btn primary" href="/start/${encodeURIComponent(paper.id)}/exam">CBT로 풀어보기</a>`}
  </div>
  <details class="page-index"><summary>전체 문항 바로가기</summary>
    <div class="page-grid">${Array.from({ length: pages }, (_, k) => {
      const from = k * PER_PAGE + 1;
      const to = Math.min((k + 1) * PER_PAGE, all.length);
      return `<a href="${pageUrl(k + 1)}"${k + 1 === page ? ' aria-current="page"' : ''}>${from}~${to}</a>`;
    }).join('')}</div>
  </details>
</nav>`;

  const base = c.env.SITE_URL || '';
  const range = `${first}~${last}번`;
  // 모의고사를 기출로 오인하지 않도록, 공식·복원 기출에만 "기출문제"라고 쓴다
  const kind = paper.source_type === 'official' || paper.source_type === 'restored' ? '기출문제' : '문제';
  const title = `${paper.title} ${kind} 해설 ${range} | ${siteName(c.env)}`;
  const body = `
<h1>${esc(paper.title)} 문제 및 해설 <span class="muted">${range}</span></h1>
<p class="muted">${esc(paper.certification)} · 전체 ${all.length}문항 · ${esc(SOURCE_LABEL[paper.source_type] ?? paper.source_type)}${paper.source_note ? ` · ${esc(paper.source_note)}` : ''}</p>
${page === 1 ? `<div class="card row">
  <a class="btn primary" href="/start/${encodeURIComponent(paper.id)}/exam">CBT 시험모드로 풀기</a>
  <a class="btn" href="/start/${encodeURIComponent(paper.id)}/practice">연습모드로 풀기</a>
  <a class="btn" href="/s/${encodeURIComponent(paper.id)}">과목별로 풀기</a>
</div>` : ''}
${parts.join('\n')}
${adHtml(c.env, 'display')}
${pager}`;
  return c.html(layout(c.env, {
    title,
    description: `${paper.certification} ${paper.title} ${range} ${kind}와 정답·해설. CBT 모의시험과 오답 다시 풀기 제공.`,
    canonical: base ? `${base}${pageUrl(page)}` : undefined,
    head: [page > 1 ? `<link rel="prev" href="${base}${pageUrl(page - 1)}">` : '', page < pages ? `<link rel="next" href="${base}${pageUrl(page + 1)}">` : ''].join(''),
    body,
  }));
}

// 애드센스 심사·운영에 필요한 개인정보처리방침. 운영자 정보는 실제 값으로 바꿔야 한다.
export function privacyPage(c: Ctx) {
  const name = siteName(c.env);
  const contact = c.env.CONTACT_EMAIL || '(운영자 연락처 입력 필요)';
  const body = `
<h1>개인정보처리방침</h1>
<div class="card">
<p>${esc(name)}(이하 "서비스")는 회원가입 없이 이용할 수 있으며, 이름·연락처 등 개인을 식별하는 정보를 수집하지 않습니다.</p>
<h2>1. 쿠키 사용</h2>
<p>풀이 기록을 이어서 보기 위해 브라우저에 무작위 식별 쿠키(cbt_gid, 30일)를 저장합니다. 서버에는 이 값의 해시만 저장하며, 쿠키를 삭제하면 이전 기록과 연결되지 않습니다.</p>
<h2>2. 광고</h2>
<p>서비스는 Google AdSense 광고를 게재합니다. Google을 포함한 제3자 광고 사업자는 쿠키를 사용하여 이용자의 이 사이트 및 다른 사이트 방문 기록을 바탕으로 광고를 게재할 수 있습니다.
이용자는 <a href="https://adssettings.google.com" rel="nofollow">Google 광고 설정</a>에서 맞춤 광고를 해제할 수 있습니다.
자세한 내용은 <a href="https://policies.google.com/technologies/ads" rel="nofollow">Google 광고 정책</a>을 참고하십시오.</p>
<h2>3. 보관 기간</h2>
<p>풀이 기록은 마지막 이용일로부터 일정 기간 보관 후 삭제합니다.</p>
<h2>4. 문의</h2>
<p>${esc(contact)}</p>
</div>`;
  return c.html(layout(c.env, { title: `개인정보처리방침 | ${name}`, description: `${name} 개인정보처리방침`, body }));
}

export async function sitemap(c: Ctx) {
  const base = c.env.SITE_URL || new URL(c.req.url).origin;
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, (SELECT COUNT(*) FROM exam_items ei WHERE ei.paper_id = p.id) AS n
       FROM exam_papers p WHERE p.status = 'published' AND p.is_sample = 0 ORDER BY p.exam_date DESC`,
  ).all<{ id: string; n: number }>();
  const urls = [`${base}/`];
  for (const r of results) {
    const id = encodeURIComponent(r.id);
    urls.push(`${base}/p/${id}`);
    for (let k = 2; k <= Math.ceil(r.n / PER_PAGE); k++) urls.push(`${base}/p/${id}/${k}`);
  }
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>`,
    200, { 'content-type': 'application/xml; charset=utf-8' },
  );
}

export function robotsTxt(c: Ctx) {
  const base = c.env.SITE_URL || new URL(c.req.url).origin;
  return c.text(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`);
}

// 애드센스 필수 파일. 게시자 ID는 ca-pub-XXXX에서 pub-XXXX 부분
export function adsTxt(c: Ctx) {
  const client = c.env.ADSENSE_CLIENT ?? '';
  if (!client) return c.text('# ADSENSE_CLIENT 미설정\n');
  return c.text(`google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
}

// SPA가 같은 설정을 쓰도록 window.ADS로 내려준다
export function adsConfigScript(c: Ctx) {
  return c.body(`window.ADS = ${JSON.stringify(adsConfig(c.env))};\n`, 200, {
    'content-type': 'application/javascript; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
}
