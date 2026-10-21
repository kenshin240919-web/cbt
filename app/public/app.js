const view = document.getElementById('view');

const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ---------- 광고 ----------
// 정책: 보기·제출·다시풀기 버튼 바로 옆에는 두지 않는다(실수 클릭 방지), "광고" 표기만 하고 클릭 유도 문구 금지.
const ADS = window.ADS ?? { client: '', slots: {} };
if (ADS.client) {
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS.client)}`;
  document.head.appendChild(s);
}

function ad(kind = 'display', extraClass = '') {
  const use = ADS.slots?.[kind] ? kind : 'display'; // 콘텐츠 내 단위가 없으면 디스플레이로 대체
  const slot = ADS.slots?.[use];
  if (!ADS.client || !slot) return `<div class="ad ad-placeholder ${extraClass}" data-kind="${kind}">광고 자리 (${kind})</div>`;
  const attrs = use === 'inarticle'
    ? 'style="display:block;text-align:center" data-ad-layout="in-article" data-ad-format="fluid"'
    : 'style="display:block" data-ad-format="auto" data-full-width-responsive="true"';
  return `<div class="ad ${extraClass}"><ins class="adsbygoogle" ${attrs} data-ad-client="${esc(ADS.client)}" data-ad-slot="${esc(slot)}"></ins></div>`;
}

// 화면을 새로 그릴 때마다 새 광고 단위만 채운다(SPA에서 같은 단위를 두 번 push하면 오류)
function fillAds() {
  if (!ADS.client) return;
  view.querySelectorAll('ins.adsbygoogle:not([data-pushed])').forEach(el => {
    el.dataset.pushed = '1';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* 광고 실패가 학습을 막지 않게 */ }
  });
}

const QUESTION_AD_EVERY = 10; // 풀이 화면: 10문항마다 1개
const REVIEW_AD_EVERY = 5; // 오답 해설: 5문항마다 1개

const MODE = { practice: '연습', exam: '시험' };
const RESULT = { correct: '정답', wrong: '오답', unanswered: '미응답' };

// ---------- 홈 ----------
async function home() {
  const [{ data: p }, { data: mine }] = await Promise.all([api('GET', '/api/papers'), api('GET', '/api/me/attempts')]);
  const resume = (mine.attempts ?? []).filter(a => a.status === 'in_progress');
  view.innerHTML = `
    ${resume.length ? `<div class="card"><h2 style="margin-top:0">이어풀기</h2>
      ${resume.map(a => `<p><a href="#/a/${a.id}">${esc(a.paper_title)} (${MODE[a.mode]}모드)</a> <span class="muted">${new Date(a.started_at).toLocaleString('ko-KR')} 시작</span></p>`).join('')}
    </div>` : ''}
    <h1>회차 선택</h1>
    <p class="muted">회원가입 없이 모든 회차를 무료로 풀 수 있습니다.</p>
    ${(p.papers ?? []).map((paper, i) => `
      ${i === 3 ? ad('display') : ''}
      <div class="card">
        <strong>${esc(paper.title)}</strong>${paper.is_sample ? '<span class="badge">샘플</span>' : ''}
        <div class="muted">${esc(paper.certification)} · ${paper.question_count}문항 · <a href="/p/${esc(paper.id)}">문제·해설 보기</a></div>
        <div class="row" style="margin-top:10px">
          <button data-start="${esc(paper.id)}" data-mode="practice">연습모드 <span class="muted">(바로 정답·해설)</span></button>
          <button class="primary" data-start="${esc(paper.id)}" data-mode="exam">시험모드</button>
        </div>
      </div>`).join('') || '<p class="muted">등록된 회차가 없습니다.</p>'}
    ${ad('display')}`;
  fillAds();
  view.querySelectorAll('[data-start]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const r = await api('POST', '/api/attempts', { paperId: btn.dataset.start, mode: btn.dataset.mode });
    if (r.ok) location.hash = `#/a/${r.data.id}`;
    else { alert('시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'); btn.disabled = false; }
  }));
}

// ---------- 풀이 ----------
function solve(attempt) {
  if (attempt.status !== 'in_progress') { location.hash = `#/r/${attempt.id}`; return; }
  const items = new Map(attempt.items.map(i => [i.ord, i]));
  const pending = new Map(); // ord -> timer
  const inflight = new Set();
  let failed = false;

  view.innerHTML = `
    <h1>${esc(attempt.paperTitle)} <span class="badge">${MODE[attempt.mode]}모드</span></h1>
    <div class="solve">
      <div id="questions"></div>
      <aside class="omr card">
        <div class="row" style="justify-content:space-between"><strong>답안표</strong><span id="save" class="status">저장됨</span></div>
        <p class="muted" id="counts"></p>
        <button class="primary" id="submit" style="width:100%;margin-bottom:12px">제출하고 채점</button>
        <div class="omr-grid" id="grid"></div>
        ${matchMedia('(min-width: 801px)').matches ? ad('display') : ''}
      </aside>
    </div>`;
  const qBox = view.querySelector('#questions');
  qBox.innerHTML = attempt.items.map((item, i) =>
    renderQuestion(item) + ((i + 1) % QUESTION_AD_EVERY === 0 && i + 1 < attempt.items.length ? ad('inarticle') : '')).join('');
  fillAds();
  attempt.items.forEach(paintFeedback);
  refreshSide();

  qBox.addEventListener('change', e => {
    const ord = Number(e.target.closest('[data-ord]')?.dataset.ord);
    const item = items.get(ord);
    if (!item) return;
    if (e.target.name === `q${ord}`) item.selected = Number(e.target.value);
    if (e.target.classList.contains('mark-box')) item.marked = e.target.checked;
    schedule(ord);
    refreshSide();
  });
  view.querySelector('#submit').addEventListener('click', submit);

  function renderQuestion(item) {
    return `<section class="card" id="q${item.ord}" data-ord="${item.ord}">
      <div class="q-head"><span class="q-subject">${esc(item.subjectName)}</span>
        <label class="mark"><input type="checkbox" class="mark-box" ${item.marked ? 'checked' : ''}> 다시 보기</label></div>
      <fieldset style="border:0;padding:0;margin:0">
        <legend><strong>${item.ord}.</strong> ${esc(item.body)}</legend>
        <ul class="choices">${item.choices.map((ch, i) => `
          <li><label data-choice="${i + 1}"><input type="radio" name="q${item.ord}" value="${i + 1}" ${item.selected === i + 1 ? 'checked' : ''}>
          <span>${'①②③④⑤⑥'[i] ?? i + 1} ${esc(ch)}</span></label></li>`).join('')}</ul>
      </fieldset>
      <div class="fb-slot"></div>
    </section>`;
  }

  // 연습모드에서만 서버가 돌려준 피드백을 표시(색과 함께 텍스트로도 정오 표시)
  function paintFeedback(item) {
    const box = qBox.querySelector(`#q${item.ord}`);
    box.querySelectorAll('label[data-choice]').forEach(l => l.classList.remove('is-answer', 'is-wrong'));
    const slot = box.querySelector('.fb-slot');
    if (!item.feedback) { slot.innerHTML = ''; return; }
    const { correct, answers, explanation } = item.feedback;
    answers.forEach(a => box.querySelector(`label[data-choice="${a}"]`)?.classList.add('is-answer'));
    if (!correct) box.querySelector(`label[data-choice="${item.selected}"]`)?.classList.add('is-wrong');
    slot.innerHTML = `<div class="fb ${correct ? 'ok' : 'bad'}"><strong>${correct ? '정답입니다' : `오답입니다 · 정답 ${answers.join(', ')}번`}</strong>
      ${explanation ? `<p>${esc(explanation)}</p>` : ''}</div>`;
  }

  function refreshSide() {
    const all = [...items.values()];
    const answered = all.filter(i => i.selected !== null).length;
    view.querySelector('#counts').textContent = `응답 ${answered} · 미응답 ${all.length - answered} · 다시 보기 ${all.filter(i => i.marked).length}`;
    view.querySelector('#grid').innerHTML = all.map(i =>
      `<a href="#q${i.ord}" data-jump="${i.ord}" class="${i.selected !== null ? 'done' : ''} ${i.marked ? 'marked' : ''}" aria-label="${i.ord}번 ${i.selected !== null ? '응답함' : '미응답'}">${i.ord}</a>`).join('');
    view.querySelectorAll('[data-jump]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      qBox.querySelector(`#q${a.dataset.jump}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function setStatus() {
    const el = view.querySelector('#save');
    if (!el) return;
    const busy = pending.size + inflight.size > 0;
    el.className = `status ${failed ? 'error' : ''}`;
    el.textContent = failed ? '저장 실패 · 재시도 중' : busy ? '저장 중…' : '저장됨';
  }

  function schedule(ord) {
    clearTimeout(pending.get(ord));
    pending.set(ord, setTimeout(() => save(ord), 250));
    setStatus();
  }

  async function save(ord, attemptNo = 0) {
    pending.delete(ord);
    if (inflight.has(ord)) { schedule(ord); return; }
    inflight.add(ord);
    setStatus();
    const item = items.get(ord);
    const sent = { selected: item.selected, marked: item.marked };
    try {
      const r = await api('PUT', `/api/attempts/${attempt.id}/answers/${ord}`, { ...sent, baseRevision: item.revision });
      if (r.ok) {
        item.revision = r.data.revision;
        failed = false;
        if (attempt.mode === 'practice') { item.feedback = r.data.feedback; paintFeedback(item); }
        // 저장 도중 또 바꿨다면 최신 값으로 한 번 더 저장
        if (item.selected !== sent.selected || item.marked !== sent.marked) schedule(ord);
      } else if (r.status === 409 && r.data.error === 'conflict') {
        Object.assign(item, { selected: r.data.selected, marked: r.data.marked, revision: r.data.revision });
        qBox.querySelector(`#q${ord}`).outerHTML = renderQuestion(item);
        alert(`${ord}번 답안이 다른 화면에서 먼저 변경되어 최신 답안으로 바꿨습니다.`);
        refreshSide();
      } else if (r.status === 409) {
        location.hash = `#/r/${attempt.id}`;
      } else throw new Error(String(r.status));
    } catch {
      failed = true;
      setTimeout(() => save(ord, attemptNo + 1), Math.min(1000 * 2 ** attemptNo, 15000));
    } finally {
      inflight.delete(ord);
      setStatus();
    }
  }

  async function flush() {
    for (const [ord, timer] of pending) { clearTimeout(timer); await save(ord); }
    while (inflight.size) await new Promise(r => setTimeout(r, 100));
  }

  async function submit() {
    await flush();
    if (failed) { alert('저장되지 않은 답안이 있습니다. 연결을 확인한 뒤 다시 제출해 주세요.'); return; }
    const all = [...items.values()];
    const unanswered = all.filter(i => i.selected === null).map(i => i.ord);
    const marked = all.filter(i => i.marked).length;
    const msg = `응답 ${all.length - unanswered.length}문항 · 미응답 ${unanswered.length}문항 · 다시 보기 ${marked}문항\n` +
      (unanswered.length ? `미응답: ${unanswered.slice(0, 15).join(', ')}${unanswered.length > 15 ? ' …' : ''}\n` : '') + '제출하면 답안을 바꿀 수 없습니다. 제출할까요?';
    if (!confirm(msg)) return;
    const r = await api('POST', `/api/attempts/${attempt.id}/submit`);
    if (r.ok) location.hash = `#/r/${attempt.id}`;
    else alert('제출하지 못했습니다. 다시 시도해 주세요.');
  }
}

// ---------- 결과 ----------
async function result(id) {
  const r = await api('GET', `/api/attempts/${id}/result`);
  if (!r.ok) { view.innerHTML = '<p>결과를 찾을 수 없습니다.</p>'; return; }
  const d = r.data;
  const misses = d.items.filter(i => i.result !== 'correct');
  view.innerHTML = `
    <h1>채점 결과 <span class="badge">${MODE[d.mode]}모드${d.parentAttemptId ? ' · 다시 풀기' : ''}</span></h1>
    <div class="card">
      ${d.score ? `<div class="big">${d.score.display}점 <span class="${d.verdict}">${d.verdict === 'pass' ? '합격' : '불합격'}</span></div>` : '<div class="muted">일부 문항 다시 풀기는 합격 판정을 하지 않습니다.</div>'}
      <p>정답 ${d.counts.correct} · 오답 ${d.counts.wrong} · 미응답 ${d.counts.unanswered}</p>
      <table><thead><tr><th>과목</th><th>맞힌 수</th><th>점수</th><th></th></tr></thead><tbody>
        ${d.subjects.map(s => `<tr><td>${esc(s.name)}</td><td>${s.correct}/${s.total}</td><td>${s.display}</td><td>${s.failed && d.score ? '<span class="fail">과락</span>' : ''}</td></tr>`).join('')}
      </tbody></table>
      <div class="row" style="margin-top:12px">
        ${d.counts.wrong + d.counts.unanswered ? `<button class="primary" data-retry='["wrong","unanswered"]'>오답·미응답 다시 풀기</button>` : ''}
        ${d.counts.wrong ? `<button data-retry='["wrong"]'>오답만</button>` : ''}
        ${d.items.some(i => i.marked) ? `<button data-retry='["marked"]'>다시 보기 표시만</button>` : ''}
      </div>
    </div>
    <h2>틀린 문제 · 미응답 (${misses.length})</h2>
    ${misses.map((i, idx) => `
      ${idx % REVIEW_AD_EVERY === 2 ? ad('inarticle') : ''}
      <section class="card">
        <div class="q-subject">${esc(i.subjectName)} · <strong class="${i.result === 'wrong' ? 'fail' : ''}">${RESULT[i.result]}</strong></div>
        <p><strong>${i.ord}.</strong> ${esc(i.body)}</p>
        <ul class="choices">${i.choices.map((ch, k) => `<li><label class="${i.answers.includes(k + 1) ? 'is-answer' : i.selected === k + 1 ? 'is-wrong' : ''}">
          <span>${'①②③④⑤⑥'[k] ?? k + 1} ${esc(ch)}${i.answers.includes(k + 1) ? ' <strong>(정답)</strong>' : ''}${i.selected === k + 1 ? ' <strong>(내 답)</strong>' : ''}</span></label></li>`).join('')}</ul>
        ${i.explanation ? `<div class="fb ok"><strong>해설</strong><p>${esc(i.explanation)}</p></div>` : ''}
      </section>`).join('') || '<p class="muted">모두 맞혔습니다.</p>'}
    ${misses.length < 3 ? ad('display') : ''}`;
  fillAds();
  view.querySelectorAll('[data-retry]').forEach(btn => btn.addEventListener('click', async () => {
    const res = await api('POST', `/api/attempts/${id}/retry`, { include: JSON.parse(btn.dataset.retry), mode: 'practice' });
    if (res.ok) location.hash = `#/a/${res.data.id}`;
  }));
}

// ---------- 내 기록 ----------
async function records() {
  const { data } = await api('GET', '/api/me/attempts');
  const rows = data.attempts ?? [];
  view.innerHTML = `<h1>내 기록</h1>
    <p class="muted">로그인 전 기록은 이 브라우저에만 연결됩니다. 회원가입 시 계정으로 옮길 수 있습니다(예정).</p>
    <div class="card"><table><thead><tr><th>회차</th><th>모드</th><th>점수</th><th>정답/오답/미응답</th><th>날짜</th></tr></thead><tbody>
    ${rows.map(a => `<tr>
      <td><a href="#/${a.status === 'graded' ? 'r' : 'a'}/${a.id}">${esc(a.paper_title)}</a>${a.parent_attempt_id ? ' <span class="badge">다시 풀기</span>' : ''}</td>
      <td>${MODE[a.mode]}</td>
      <td>${a.status !== 'graded' ? '진행 중' : a.score ? `${a.score.display}점 ${a.verdict === 'pass' ? '<span class="pass">합격</span>' : '<span class="fail">불합격</span>'}` : '-'}</td>
      <td>${a.status === 'graded' ? `${a.correct}/${a.wrong}/${a.unanswered}` : ''}</td>
      <td class="muted">${new Date(a.started_at).toLocaleString('ko-KR')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">기록이 없습니다.</td></tr>'}
    </tbody></table></div>
    ${ad('display')}`;
  fillAds();
}

// ---------- 라우터 ----------
async function route() {
  const [, page, id] = location.hash.split('/');
  view.innerHTML = '<p class="muted">불러오는 중…</p>';
  try {
    if (page === 'start' && id) {
      // 공개 해설 페이지(/p/:id)에서 바로 풀기
      const mode = location.hash.split('/')[3] === 'practice' ? 'practice' : 'exam';
      const r = await api('POST', '/api/attempts', { paperId: id, mode });
      if (r.ok) location.replace(`#/a/${r.data.id}`);
      else view.innerHTML = '<p>시작하지 못했습니다.</p>';
    } else if (page === 'a' && id) {
      const r = await api('GET', `/api/attempts/${id}`);
      if (!r.ok) { view.innerHTML = '<p>시험을 찾을 수 없습니다.</p>'; return; }
      solve(r.data);
    } else if (page === 'r' && id) await result(id);
    else if (page === 'records') await records();
    else await home();
    window.scrollTo(0, 0);
  } catch {
    view.innerHTML = '<p>연결에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>';
  }
}
// 문항 앵커(#q3)는 라우팅하지 않는다
window.addEventListener('hashchange', () => { if (!/^#q\d+$/.test(location.hash)) route(); });
route();
