/* ===== 미니게임: one button, real charts, high score (미니게임천국 style) =====
   Inlined after game.js by scripts/build.mjs, so it can use its globals ($, $$, TAPES, profile, saveProfile, sfx, toast,
   fmtDate, portrait, cutArt, ROLE_COLOR, josa, reduceMotion). Everything here is DOM + canvas; no Phaser. */

/* ---------- shared: real daily series pulled from the tapes ---------- */
const MG_KEY = 'minigames';
const mgStore = () => (profile[MG_KEY] = profile[MG_KEY] || { best: {}, plays: {} });
/** every daily-close tape, as one long QQQ path (date, close, label) in chronological order, de-duplicated by date */
function mgDailyPath() {
  const seen = new Set(), out = [];
  for (const t of TAPES.filter(x => x.daily && x.bars[0].prices.QQQ)) {
    for (const b of t.bars) { const d = b.t.slice(0, 10); if (seen.has(d)) continue; seen.add(d); out.push({ d, c: b.prices.QQQ, label: b.label, event: t.title.replace(/ 레이드$/, '') }); }
  }
  return out.sort((a, b) => a.d.localeCompare(b.d));
}
const PLAIN_MG = { QQQ: '나스닥100', TLT: '미국 장기채', GLD: '금', SCHD: '미국 배당주', SOXX: '미국 반도체', SHY: '미국 단기채', TQQQ: '나스닥100 3배', BIL: '현금' };
function mgSaveBest(game, score) { const s = mgStore(); s.plays[game] = (s.plays[game] || 0) + 1; const prev = s.best[game] || 0; if (score > prev) s.best[game] = score; saveProfile(); return { prev, best: Math.max(prev, score), isNew: score > prev && prev > 0, first: prev === 0 }; }

/* ---------- 1. 달려달려: run along the real price line, jump the crash gaps ---------- */
function runRunner(host, onEnd) {
  const real = mgDailyPath(); if (real.length < 20) { onEnd({ score: 0 }); return () => {}; }
  // a short flat run-up before the first real day, so the first hole is never the first thing you see
  const path = [...Array.from({ length: 8 }, (_, k) => ({ d: real[0].d, c: real[0].c, label: '출발', event: '준비' })), ...real];
  const cv = host.querySelector('canvas'), ctx = cv.getContext('2d');
  const W = cv.width = 720, H = cv.height = 360;
  const SEG = 56, GROUND_Y = 240, SCALE = 420;               // px per day, baseline, px per 100% return (gentle hills; the gaps are the game)
  // terrain: y of the line at each day, relative to a slowly re-centred baseline so the path stays on screen
  const ys = []; let base = 0;
  for (let i = 0; i < path.length; i++) {
    const r = i ? Math.log(path[i].c / path[i - 1].c) : 0; base += r;
    ys.push(base);
  }
  const yAt = i => { const a = Math.max(0, i - 10); let m = 0; for (let k = a; k <= i; k++) m += ys[k]; m /= (i - a + 1); return GROUND_Y - Math.max(-80, Math.min(80, (ys[i] - m) * SCALE)); };   // hills around a rolling 10-day mean, clamped
  const gaps = path.map((b, i) => i > 0 && b.c / path[i - 1].c - 1 <= -0.03); for (let i = 1; i < gaps.length; i++) if (gaps[i] && gaps[i - 1]) gaps[i] = false;   // a 3%+ drop is a hole, never two in a row
  const gapAt = i => !!gaps[i];
  const bigUp = i => i > 0 && path[i].c / path[i - 1].c - 1 >= 0.03;
  const img = new Image(); img.src = cutArt('hero_dealer');
  let x = 0, speed = 190, t0 = performance.now(), last = t0, py = 0, vy = 0, onGround = true, alive = true, days = 0, coins = 0, raf = 0, hurtUntil = 0;
  const jump = () => { if (!alive) return; if (onGround) { vy = -560; onGround = false; sfx.select(); } };
  const key = e => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); } };
  cv.addEventListener('pointerdown', jump); document.addEventListener('keydown', key);
  const hud = host.querySelector('.mg-hud');
  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (alive) { speed = 190 + Math.min(200, (now - t0) / 1000 * 8); x += speed * dt; }
    const i = Math.floor(x / SEG), frac = (x % SEG) / SEG;
    if (i >= path.length - 2) { alive = false; finish(true); return; }
    days = i;
    // player physics on the line
    const lineY = yAt(i) * (1 - frac) + yAt(i + 1) * frac;
    vy += 1500 * dt; py += vy * dt;
    const feet = py;                                     // py is offset above the line (0 = on the line), negative = in the air
    const overHole = gapAt(i + 1) && frac > 0.3 && frac < 0.85;
    if (feet >= 0 && !overHole) { py = 0; vy = 0; onGround = true; }
    if (overHole && feet >= 0) { alive = false; finish(false); return; }
    if (bigUp(i + 1) && frac > 0.45 && frac < 0.55 && now > hurtUntil) { coins++; hurtUntil = now + 300; sfx.crit?.(); }
    // draw
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#CFE9F8'); g.addColorStop(1, '#EAF4EC'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const PX = 160;                                      // player's screen x
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.strokeStyle = '#E0A72E';
    ctx.beginPath();
    for (let k = -4; k < 16; k++) { const j = i + k; if (j < 0 || j >= path.length) continue; const sx = PX + (j - i - frac) * SEG, sy = yAt(j); if (gapAt(j)) { ctx.moveTo(sx, sy); continue; } k === -4 || gapAt(j - 1) ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy); }
    ctx.stroke();
    for (let k = -4; k < 16; k++) { const j = i + k; if (j <= 0 || j >= path.length) continue; const sx = PX + (j - i - frac) * SEG, sy = yAt(j);
      if (gapAt(j)) { ctx.fillStyle = 'rgba(214,69,63,.85)'; ctx.fillRect(sx - SEG + 6, sy - 6, SEG - 12, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${(100 * (path[j].c / path[j - 1].c - 1)).toFixed(1)}%`, sx - SEG / 2, sy + 26); }
      if (bigUp(j)) { ctx.fillStyle = '#2E9A58'; ctx.beginPath(); ctx.arc(sx - SEG / 2, (yAt(j - 1) + sy) / 2 - 40, 9, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Jua, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('+', sx - SEG / 2, (yAt(j - 1) + sy) / 2 - 36); } }
    // player
    const s = 84, cy = lineY + py;
    ctx.drawImage(img, PX - s / 2, cy - s + 4, s, s);
    // date strip
    ctx.fillStyle = 'rgba(36,64,95,.85)'; ctx.fillRect(0, 0, W, 34); ctx.fillStyle = '#fff'; ctx.font = '15px Jua, "Noto Sans KR", sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${path[i].d.replace(/-/g, '.')}  ${path[i].event} · ${path[i].label}`, 12, 23);
    ctx.textAlign = 'right'; ctx.fillText(`${days}일 버팀  +${coins}`, W - 12, 23);
    hud.textContent = `${days}일 · 보너스 ${coins}`;
    raf = requestAnimationFrame(draw);
  }
  function finish(won) {
    cancelAnimationFrame(raf); cv.removeEventListener('pointerdown', jump); document.removeEventListener('keydown', key);
    const i = Math.min(path.length - 1, Math.floor(x / SEG) + 1);
    onEnd({ score: Math.max(0, days - 8) * 10 + coins * 25, days: Math.max(0, days - 8), coins, won, where: won ? '' : `${path[i].d.replace(/-/g, '.')} ${path[i].event}, 하루 ${(100 * (path[i].c / path[i - 1].c - 1)).toFixed(1)}%에 빠졌어요` });
  }
  raf = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(raf); cv.removeEventListener('pointerdown', jump); document.removeEventListener('keydown', key); };
}

/* ---------- 2. 시총 더높이더낮게: Higher or Lower with real market caps ---------- */
// Market caps in USD billions, stockanalysis.com biggest-companies list, checked 2026-10-27. Rounded; the game only compares.
const CAPS = [
  ['엔비디아', 5220, '미국 · 반도체'], ['애플', 5020, '미국 · 스마트폰'], ['마이크로소프트', 3960, '미국 · 소프트웨어'], ['알파벳(구글)', 3870, '미국 · 검색·광고'], ['아마존', 2690, '미국 · 전자상거래'],
  ['TSMC', 1900, '대만 · 반도체 위탁생산'], ['아람코', 1650, '사우디 · 석유'], ['메타', 1610, '미국 · SNS'], ['브로드컴', 1570, '미국 · 반도체'], ['테슬라', 1550, '미국 · 전기차'],
  ['일라이 릴리', 1140, '미국 · 제약'], ['삼성전자', 1070, '한국 · 반도체·가전'], ['마이크론', 1020, '미국 · 메모리'], ['월마트', 954, '미국 · 유통'], ['JP모건', 887, '미국 · 은행'],
  ['AMD', 867, '미국 · 반도체'], ['엑슨모빌', 759, '미국 · 석유'], ['SK하이닉스', 745, '한국 · 메모리'], ['비자', 742, '미국 · 결제'], ['존슨앤드존슨', 641, '미국 · 제약'],
  ['ASML', 615, '네덜란드 · 반도체 장비'], ['마스터카드', 537, '미국 · 결제'], ['팔란티어', 478, '미국 · 데이터 소프트웨어'], ['셰브론', 455, '미국 · 석유'], ['코스트코', 445, '미국 · 유통'],
  ['텐센트', 444, '중국 · 게임·메신저'], ['시스코', 435, '미국 · 네트워크 장비'], ['코카콜라', 399, '미국 · 음료'], ['오라클', 382, '미국 · 소프트웨어'], ['P&G', 371, '미국 · 생활용품'],
  ['HSBC', 345, '영국 · 은행'], ['넷플릭스', 300, '미국 · 스트리밍'], ['알리바바', 289, '중국 · 전자상거래'], ['셸', 269, '영국 · 석유'], ['도요타', 228, '일본 · 자동차'],
  ['세일즈포스', 192, '미국 · 소프트웨어'], ['디즈니', 179, '미국 · 미디어'], ['맥도날드', 177, '미국 · 외식'], ['노보 노디스크', 175, '덴마크 · 제약'], ['화이자', 159, '미국 · 제약'],
  ['보잉', 156, '미국 · 항공기'], ['우버', 143, '미국 · 모빌리티'], ['소니', 138, '일본 · 전자·게임'], ['스타벅스', 108, '미국 · 커피'], ['스포티파이', 103, '스웨덴 · 음악'],
  ['에어비앤비', 95, '미국 · 숙박'], ['어도비', 95, '미국 · 소프트웨어'], ['페라리', 79, '이탈리아 · 자동차'], ['GM', 73, '미국 · 자동차'], ['나이키', 54, '미국 · 스포츠'],
  ['코인베이스', 53, '미국 · 코인 거래소'], ['포드', 52, '미국 · 자동차'], ['KB금융', 46, '한국 · 은행'], ['페이팔', 45, '미국 · 결제'], ['신한지주', 39, '한국 · 은행'],
];
const capText = b => b >= 1000 ? `${(b / 1000).toFixed(2).replace(/\.?0+$/, '')}조 달러` : `${Math.round(b * 10).toLocaleString('ko-KR')}억 달러`;
/* Other measures. Sources, checked 2026-10-27: revenue (TTM, USD) and employees = stockanalysis.com lists and company pages;
   store counts and founding years = Wikipedia infoboxes. All approximate; the game only compares. */
const REV = [['아마존', 776], ['월마트', 736], ['아람코', 486], ['애플', 467], ['유나이티드헬스', 450], ['알파벳(구글)', 446], ['CVS헬스', 413], ['삼성전자', 367], ['엑슨모빌', 361], ['폭스바겐', 360],
  ['마이크로소프트', 332], ['도요타', 331], ['코스트코', 303], ['엔비디아', 303], ['셸', 299], ['메타', 242], ['셰브론', 209], ['JP모건', 191], ['포드', 188], ['GM', 187], ['홈디포', 169], ['스타벅스', 37.2], ['맥도날드', 26.9]];
const EMP = [['월마트', 2100000], ['아마존', 1576000], ['BYD', 911900], ['징둥닷컴', 900000], ['폭스콘', 826608], ['액센츄어', 814000], ['폭스바겐', 594022], ['페덱스', 530000], ['홈디포', 472400], ['UPS', 460000],
  ['타깃', 415000], ['메리어트', 414000], ['스타벅스', 381000], ['도요타', 367990], ['코스트코', 355000], ['마이크로소프트', 223000], ['알파벳(구글)', 190820], ['애플', 166000], ['맥도날드', 150000], ['테슬라', 134785], ['삼성전자', 128612], ['메타', 75472], ['나이키', 73000], ['코카콜라', 65900], ['엔비디아', 42000], ['넷플릭스', 16000]];
const STORES = [['세븐일레븐', 85000], ['맥도날드', 45356], ['스타벅스', 40990], ['서브웨이', 37000], ['월마트', 10974], ['코스트코', 924]];
const FOUNDED = [['코카콜라', 1886], ['IBM', 1911], ['디즈니', 1923], ['도요타', 1937], ['페라리', 1939], ['소니', 1946], ['맥도날드', 1955], ['비자', 1958], ['월마트', 1962], ['나이키', 1964], ['현대자동차', 1967], ['인텔', 1968], ['삼성전자', 1969],
  ['스타벅스', 1971], ['마이크로소프트', 1975], ['애플', 1976], ['코스트코', 1983], ['SK하이닉스', 1983], ['엔비디아', 1993], ['아마존', 1994], ['넷플릭스', 1997], ['구글', 1998], ['네이버', 1999], ['테슬라', 2003], ['메타(페이스북)', 2004], ['카카오', 2010], ['쿠팡', 2010]];
const PER_EMP = (() => { const e = Object.fromEntries(EMP); return REV.filter(([n]) => e[n]).map(([n, r]) => [n, Math.round(r * 1e9 / e[n] / 1000)]); })();   // revenue per employee, $K
const CATS = [
  { id: 'cap', name: '시가총액', q: n => `${n}의 시가총액은`, up: '더 높다', dn: '더 낮다', rows: CAPS.map(c => [c[0], c[1], c[2]]), fmt: capText, ratio: true },
  { id: 'rev', name: '1년 매출', q: n => `${n}의 1년 매출은`, up: '더 많다', dn: '더 적다', rows: REV, fmt: capText, ratio: true },
  { id: 'emp', name: '임직원 수', q: n => `${n}의 임직원은`, up: '더 많다', dn: '더 적다', rows: EMP, fmt: v => `${v.toLocaleString('ko-KR')}명`, ratio: true },
  { id: 'store', name: '매장 수', q: n => `${n}의 매장은`, up: '더 많다', dn: '더 적다', rows: STORES, fmt: v => `${v.toLocaleString('ko-KR')}곳`, ratio: true },
  { id: 'found', name: '창업 연도', q: n => `${n}${josa(n, '은', '는')} 창업이`, up: '더 최근', dn: '더 먼저', rows: FOUNDED, fmt: v => `${v}년`, ratio: false },
  { id: 'peremp', name: '직원 1명당 매출', q: n => `${n}의 직원 1명당 매출은`, up: '더 많다', dn: '더 적다', rows: PER_EMP, fmt: v => v >= 1000 ? `${(v / 1000).toFixed(1)}백만 달러` : `${v}천 달러`, ratio: true },
];
let hiloCat = 'cap';
function runHiLo(host, onEnd) {
  const cat = CATS.find(c => c.id === hiloCat) || CATS[0], box = host.querySelector('.mg-pick');
  const rows = cat.rows, order = rows.map((_, i) => i).sort(() => Math.random() - 0.5);
  let k = 0, streak = 0, lives = 3, correct = 0, best = 0, timer = 0, locked = false, cancelled = false;
  const card = (c, reveal, cls = '') => `<div class="cap-card ${cls}"><small>${c[2] || cat.name}</small><b>${c[0]}</b><span class="cap">${reveal ? cat.fmt(c[1]) : '?'}</span></div>`;
  function show() {
    if (cancelled) return;
    if (lives <= 0 || k + 1 >= order.length) { onEnd({ score: correct * 100 + best * 30, correct, total: k, best, lives, cat: cat.name }); return; }
    const A = rows[order[k]], B = rows[order[k + 1]]; locked = false;
    box.innerHTML = `<div class="mg-q"><small>${cat.name} 비교 · ${k + 1}번째</small><b>${cat.q(B[0])} ${A[0]}보다?</b><i class="mg-timer"><em style="width:100%"></em></i></div>
      <div class="mg-two caps">${card(A, true, 'known')}${card(B, false, 'ask')}</div>
      <div class="mg-two"><button type="button" class="mg-btn up" data-k="up">▲ ${cat.up}</button><button type="button" class="mg-btn dn" data-k="dn">▼ ${cat.dn}</button></div>
      <div class="mg-score">${'♥'.repeat(lives)}${'♡'.repeat(3 - lives)} · 연속 ${streak}</div>`;
    const bar = box.querySelector('.mg-timer em'); clearInterval(timer); const t0 = performance.now();
    timer = setInterval(() => { const el = (performance.now() - t0) / 1000; bar.style.width = Math.max(0, 100 - el / 5 * 100) + '%'; if (el >= 5 && !locked) answer(null); }, 50);
    box.querySelectorAll('.mg-btn').forEach(b => b.onclick = () => answer(b.dataset.k));
  }
  function answer(ans) {
    if (locked) return; locked = true; clearInterval(timer);
    const A = rows[order[k]], B = rows[order[k + 1]], right = B[1] >= A[1] ? 'up' : 'dn', ok = ans === right;
    if (ok) { correct++; streak++; best = Math.max(best, streak); sfx.crit?.(); } else { lives--; streak = 0; sfx.faint?.(); }
    box.querySelector('.cap-card.ask').outerHTML = card(B, true, 'ask ' + (ok ? 'win' : 'lose'));
    box.querySelectorAll('.mg-btn').forEach(b => { b.disabled = true; b.classList.add(b.dataset.k === right ? 'win' : 'lose'); });
    const ratio = B[1] / A[1];
    const note = cat.ratio ? `${B[0]}${josa(B[0], '은', '는')} ${A[0]}의 ${ratio >= 1 ? `${ratio.toFixed(1)}배` : `${Math.round(ratio * 100)}%`}예요` : `${Math.abs(B[1] - A[1])}년 차이예요`;
    box.querySelector('.mg-score').innerHTML = `${ans === null ? '시간이 다 됐어요' : ok ? '맞았어요!' : '아쉬워요'} · ${note}`;
    setTimeout(() => { k++; show(); }, 1500);
  }
  show();
  return () => { cancelled = true; clearInterval(timer); };
}

/* ---------- shell: list, play, result ---------- */
const MINIGAMES = [
  { id: 'runner', name: '달려달려', how: '화면을 탭하면 점프해요. 실제 나스닥 차트 위를 달리다가, 하루 3% 넘게 빠진 날(빨간 구멍)은 뛰어넘으세요.', learn: '폭락은 예고 없이 와요. 2020년 3월과 2025년 4월 구간을 지나 보세요.', art: 'hero_dealer', run: runRunner, unit: '점' },
  { id: 'hilo', name: '더높이 더낮게', how: '회사 하나의 숫자를 보여 줘요. 다음 회사가 그보다 높은지 낮은지 5초 안에 고르세요. 맞히면 그 회사가 다음 기준이 돼요. 목숨은 셋이에요.', learn: '엔비디아 직원 한 명이 1년에 720만 달러를 벌고, 세븐일레븐 매장은 8만 5천 곳이에요. 회사의 크기를 숫자로 익혀요.', art: 'hero_healer', run: runHiLo, unit: '점', cats: true },
];
let mgStop = null;
function openMinigame(id) {
  const g = MINIGAMES.find(x => x.id === id), m = $('#mg'), best = mgStore().best[id] || 0;
  m.hidden = false; $('#tip').hidden = true;
  m.querySelector('.box').innerHTML = `<div class="mg-head"><img src="${portrait(g.art)}" alt=""><div><small>미니게임</small><h2>${g.name}</h2></div><span class="mg-best">최고 ${best}${g.unit}</span><button type="button" class="iconbtn" id="mgClose">닫기</button></div>
    <p class="mg-how">${g.how}</p>
    <div class="mg-stage" id="mgStage">${id === 'runner' ? '<canvas></canvas><div class="mg-hud"></div>' : '<div class="mg-pick"></div>'}${g.cats ? `<div class="mg-cats" id="mgCats">${CATS.map(c => `<button type="button" class="chipbtn ${c.id === hiloCat ? 'on' : ''}" data-cat="${c.id}">${c.name}</button>`).join('')}</div>` : ''}<button type="button" class="btn mg-start" id="mgStart">시작</button></div>
    <div class="mg-end" id="mgEnd" hidden></div>`;
  const close = () => { mgStop?.(); mgStop = null; m.hidden = true; renderMinigames?.(); };
  m.querySelectorAll('#mgCats .chipbtn').forEach(b => b.onclick = () => { hiloCat = b.dataset.cat; m.querySelectorAll('#mgCats .chipbtn').forEach(x => x.classList.toggle('on', x === b)); sfx.select(); });
  $('#mgClose').onclick = close;
  $('#mgStart').onclick = () => {
    sfx.select(); $('#mgStart').hidden = true; $('#mgEnd').hidden = true; const cats = $('#mgCats'); if (cats) cats.hidden = true;
    mgStop = g.run($('#mgStage'), res => {
      mgStop = null; const r = mgSaveBest(id, res.score);
      const line = id === 'runner' ? (res.won ? `끝까지 달렸어요! ${res.days}일을 버텼어요.` : `${res.days}일 버텼어요. ${res.where}`) : `${res.cat ? res.cat + ' · ' : ''}${res.total}문제 중 ${res.correct}개를 맞혔어요. 최고 연속 ${res.best}개예요.`;
      $('#mgEnd').hidden = false;
      $('#mgEnd').innerHTML = `<b>${res.score}${g.unit}</b><p>${line}</p><p class="small muted">${r.first ? '첫 기록이에요.' : r.isNew ? `최고 기록을 넘었어요! (전 ${r.prev}${g.unit})` : `최고 기록 ${r.best}${g.unit}`}</p><p class="small muted">${g.learn}</p>
        <div class="row" style="justify-content:center"><button type="button" class="btn" id="mgAgain">다시 하기</button><button type="button" class="btn secondary" id="mgDone">그만하기</button></div>`;
      $('#mgAgain').onclick = () => $('#mgStart').click(); $('#mgDone').onclick = close; if (cats) cats.hidden = false;
      if (r.isNew) sfx.level?.();
    });
  };
}
function renderMinigames() {
  const el = $('#minigames'); if (!el) return;
  el.innerHTML = MINIGAMES.map(g => { const best = mgStore().best[g.id] || 0, n = mgStore().plays[g.id] || 0;
    return `<button type="button" class="mgcard" data-mg="${g.id}"><img src="${portrait(g.art)}" alt=""><span class="tx"><b>${g.name}</b><small>${g.how.split('.')[0]}.</small></span><span class="mgbest">${best ? `최고 ${best}` : n ? '' : 'NEW'}</span></button>`; }).join('');
  el.querySelectorAll('.mgcard').forEach(b => b.onclick = () => { unlock(); sfx.select(); openMinigame(b.dataset.mg); });
}
renderMinigames();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#mg').hidden) $('#mgClose')?.click(); });
