// Game layer: screens, Phaser battle scene, cut-ins, checkpoint modal, chart, result.
// The build concatenates engine.js + audio.js + this file into one inline module, so these imports
// exist for editors/tests only and are stripped at build time.
import { ROLES, ROLE_META, ReplayAdapter, defaultParty, validateParty, createBattle, step, intervene, nextCheckpoint, settle, coachText, contribution, applyExp, expNext, alternatives, gradeReason, benchmarkOf } from './engine.js';
import { unlock, setMuted, isMuted, sfx, startBgm, stopBgm } from './audio.js';

const TAPES = window.__TAPES__ || [];
// Weekly cadence preview. Real dates from the public calendars; the boss is generated after the event is scheduled and judged after it prints.
const UPCOMING = [
  { date: '2026-10-30T03:00:00+09:00', title: '10월 FOMC 금리 결정', boss: '금리 마법사', species: 'lich', note: '발표 후 실제 데이터로 판정' },
  { date: '2026-11-06T22:30:00+09:00', title: '미국 10월 고용보고서', boss: '뼈다귀', species: 'skeleton', note: '발표 후 실제 데이터로 판정' },
  { date: '2026-12-10T04:00:00+09:00', title: '12월 FOMC 금리 결정', boss: '동결이', species: 'minotaur', note: '2026년 마지막 회의' },
];
const adapter = new ReplayAdapter(TAPES);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtPct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
// The raid plays with a notional 1,000만원 of 모험단 자금. Equity is a constant-mix index (engine), so a role's
// current value is equity × its current weight — the number a brokerage user actually wants to see.
const SEED = 10_000_000;
const fmtKRW = n => Math.round(n).toLocaleString('ko-KR') + '원';
// tiny inline icons (currentColor) so labels read as game UI, not form labels
const ICON = {
  coin: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#FFD66B" stroke="#B9841A" stroke-width="2"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#B9841A" stroke-width="1.5"/><path d="M12 8.5v7M10 10.5h4M10 13.5h4" stroke="#B9841A" stroke-width="1.5" stroke-linecap="round"/></svg>',
  flag: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4" stroke="#7458C9" stroke-width="2.4" stroke-linecap="round"/><path d="M6 5h11l-3 4 3 4H6z" fill="#A58CF0" stroke="#7458C9" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  bolt: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="#FFD54A" stroke="#B9841A" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  chart: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16" stroke="#24405F" stroke-width="2" stroke-linecap="round"/><path d="M5 15l4-5 4 3 6-8" fill="none" stroke="#E0A72E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skull: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a8 8 0 0 0-8 8c0 3 1.5 5 3 6v3h10v-3c1.5-1 3-3 3-6a8 8 0 0 0-8-8z" fill="#fff" stroke="#8A2E2A" stroke-width="1.8"/><circle cx="9" cy="11" r="1.8" fill="#8A2E2A"/><circle cx="15" cy="11" r="1.8" fill="#8A2E2A"/><path d="M10 17h4" stroke="#8A2E2A" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const fmtKRWd = n => (n >= 0 ? '+' : '−') + Math.abs(Math.round(n)).toLocaleString('ko-KR') + '원';
const totalValue = () => SEED * battle.equity / 100;
const roleValue = role => totalValue() * battle.party.weights[role] / 100;
const roleStart = role => SEED * battle.party.weights[role] / 100;
/** price of an instrument at the current bar, and its change vs the previous bar / raid start */
function quote(id, bar = battle?.history.at(-1)?.bar ?? 0) {
  const bars = currentTape.bars, p = bars[bar].prices[id], prev = bars[Math.max(0, bar - 1)].prices[id], p0 = bars[0].prices[id];
  return { id, p, dBar: 100 * (p / prev - 1), dStart: 100 * (p / p0 - 1), cur: currentTape.instruments[id].currency, name: currentTape.instruments[id].name, kind: currentTape.instruments[id].kind };
}
function renderTicker(el, bar, flash = false) {
  const ids = Object.keys(currentTape.instruments);
  el.innerHTML = ids.map(id => { const q = quote(id, bar); const cls = q.dBar > 0 ? 'up' : q.dBar < 0 ? 'down' : '';
    return `<span class="tk ${cls} ${flash && q.dBar !== 0 ? 'flash' : ''}" title="${q.name}"><b>${id}</b> <span class="tabular">${fmtMoney(q.p, q.cur)}</span> <em class="tabular">${fmtPct(q.dBar)}</em></span>`; }).join('');
}
const fmtTime = iso => iso.slice(11, 16);
const fmtDate = iso => `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** Bar label: daily tapes print the trading date ("09/16(수)"), intraday tapes the KST clock time. */
const fmtBar = (iso, tape = currentTape) => tape?.daily ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}(${WD[new Date(iso.slice(0, 10) + 'T12:00:00Z').getUTCDay()]})` : iso.slice(11, 16);
/** when a checkpoint happens: daily tapes pause after the previous close, intraday tapes right before the next bar */
const cpWhen = (cp, tape = currentTape) => tape?.daily ? `${fmtBar(tape.bars[Math.max(0, cp.bar - 1)].t, tape)} 마감 후` : fmtBar(tape.bars[cp.bar].t, tape);
const unitNote = (tape = currentTape) => tape?.daily ? '뉴욕 종가' : 'KST';
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** heroes are called by their job; after 전직 by their new class */
const jobOf = role => ROLE_META[role].char;
const charOf = role => { const b = profile?.heroes?.[role]?.branch; return { name: b ? CLASSES[role][b] : ROLE_META[role].char, title: ROLE_META[role].title }; };
const portrait = unit => 'assets/anime/portrait_' + unit + '.png';
const cutArt = (unit, hit = false) => `assets/anime/${unit}_${hit ? 'hurt' : 'idle'}.png`;
const heroUnit = role => ({ tank: 'hero_tank', dealer: 'hero_dealer', healer: 'hero_healer', support: 'hero_support' })[role];
const bossUnit = species => ({ minotaur: 'boss_minotaur', wyvern: 'boss_wyvern', fireant: 'boss_fireant', skeleton: 'boss_skeleton', lich: 'boss_lich' })[species] || 'boss_minotaur';
const ROLE_COLOR = { tank: 'var(--tank)', dealer: 'var(--dealer)', healer: 'var(--healer)', support: 'var(--support)' };
const ROLE_HEX = { tank: 0x5B7693, dealer: 0x2F6BD0, healer: 0xC8921A, support: 0x2E9A58 };
const UNLOCKS = { 5: '폭주 돌진 (레버리지 ETF)', 10: '수호의 계약 (풋옵션)' };
const BOSS_MOVES = { minotaur: ['금리 동결 발표', '매파 발언', '점도표 충격'], wyvern: ['기대치 상향 부담', '설비투자 발표', '차익실현 매물'], fireant: ['물가 서프라이즈', '구매력 하락', '금리 인하 지연'], skeleton: ['고용 쇼크', '실업률 상승'], lich: ['금리 인상', '긴축 장기화 발언', '인하 기대 후퇴'] };
// a plain one-line description shown with the boss name
const BOSS_DESC = { minotaur: '금리 결정이 보스가 됐어요. 동결 발표와 강경한 발언으로 공격해요.', wyvern: '실적 발표가 보스가 됐어요. 높은 기대와 투자 계획 뉴스로 공격해요.', fireant: '물가 발표가 보스가 됐어요. 예상보다 높은 숫자로 공격해요.', skeleton: '고용 발표가 보스가 됐어요.', lich: '금리 인상이 보스가 됐어요. 금리를 오래 높게 두겠다는 말로 공격해요.' };

/* ------------------------------------------------------------------ */
/* Profile (per-viewer convenience only; wrapped in try/catch)         */
/* ------------------------------------------------------------------ */
const PROFILE_KEY = 'invest-rpg.profile.v1';
let profile = loadProfile();
function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY)); if (p && p.level) return { plays: {}, badges: {}, bosses: {}, streak: 0, lastDay: '', seenTutorial: false, ...p }; } catch {}
  return { level: 1, exp: 0, unlockAll: false, plays: {}, badges: {}, bosses: {}, streak: 0, lastDay: '', seenTutorial: false };
}
function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {} }
function effectiveLevel() { return profile.unlockAll ? 99 : profile.level; }
/** products open with the hero, not a player level: a stronger product unlocks when its holder changes class */
function skillOpen(s) { return !s.unlockLevel || profile.unlockAll || chartMode() || !!hero(s.role).branch; }
const lockLabel = s => `${charOf(s.role).name} 전직 후`;
/* ---------- product catalog (상품 도감) ----------
   Facts verified on stockanalysis.com, 2026-10-27. The game role line explains how the product behaved in raids. */
const PRODUCTS = {
  QQQ:  { name: 'Invesco QQQ Trust', issuer: 'Invesco', index: '나스닥100', fee: '0.18%', role: '미국 대형 기술주와 성장주 100곳에 나눠 담아요. 금리 소식과 실적 발표에 가장 크게 움직여요.', cls: 'dealer' },
  TQQQ: { name: 'ProShares UltraPro QQQ', issuer: 'ProShares', index: '나스닥100 · 일간 3배', fee: '0.78%', role: '나스닥100 하루 수익률의 3배로 움직여요. 맞히면 3배로 벌고, 틀리면 3배로 잃어요.', warn: '일간 배수라 여러 날 보유하면 지수×3과 결과가 달라질 수 있어요.', cls: 'dealer' },
  SOXX: { name: 'iShares Semiconductor ETF', issuer: 'BlackRock (iShares)', index: 'NYSE 반도체 지수 · 34종목', fee: '0.33%', role: '반도체 회사에만 모아 담아요. 지수보다 두 배쯤 크게 움직여요. 오를 때도, 내릴 때도요.', cls: 'dealer' },
  TLT:  { name: 'iShares 20+ Year Treasury Bond', issuer: 'BlackRock (iShares)', index: '미국 국채 20년 이상', fee: '0.15%', role: '주식이 흔들릴 때 버텨 주는 방패예요. 다만 금리가 더 오를 것 같으면 같이 떨어져요.', cls: 'tank' },
  SHY:  { name: 'iShares 1-3 Year Treasury Bond', issuer: 'BlackRock (iShares)', index: '미국 국채 1~3년', fee: '0.15%', role: '거의 흔들리지 않아요. 대신 크게 벌지도 않아요.', cls: 'tank' },
  GLD:  { name: 'SPDR Gold Shares', issuer: 'State Street', index: 'LBMA 금 가격 (실물 금 보관)', fee: '0.40%', role: '물가가 오르거나 시장이 불안할 때 강해요. 이자가 없어서 금리가 오르면 약해지기도 해요.', cls: 'healer' },
  BIL:  { name: 'SPDR Bloomberg 1-3 Month T-Bill', issuer: 'State Street', index: '미국 단기국채 1~3개월', fee: '0.14%', role: '현금과 거의 같아요. 잃지는 않지만 보스를 때리지도 못해요.', cls: 'healer' },
  PSQ:  { name: 'ProShares Short QQQ', issuer: 'ProShares', index: '나스닥100 · 일간 −1배', fee: '0.95%', role: '나스닥이 내리면 올라요. 떨어질 때를 대비하는 상품이라, 오르는 날엔 조금씩 깎여요.', warn: '방향이 틀리면 매일 손실이 쌓여요. 짧게 쓰는 도구예요.', cls: 'healer' },
  SQQQ: { name: 'ProShares UltraPro Short QQQ', issuer: 'ProShares', index: '나스닥100 · 일간 −3배', fee: '0.94%', role: '나스닥 하루 수익률과 반대로 3배 움직여요. 급락한 날 크게 벌고, 반등한 날 크게 잃어요.', warn: '고위험 상품. 일간 배수라 장기 보유에 맞지 않아요.', cls: 'healer' },
  SCHD: { name: 'Schwab U.S. Dividend Equity', issuer: 'Charles Schwab', index: 'Dow Jones U.S. Dividend 100', fee: '0.06%', role: '배당을 꾸준히 주는 회사 100곳에 담아요. 크게 오를 땐 덜 오르고, 급락할 땐 덜 빠져요.', cls: 'support' },
};
function productInfo(id, tape) {
  const ins = tape?.instruments[id] || {};
  if (PRODUCTS[id]) return { id, ...PRODUCTS[id], real: true };
  const DERIV = {
    NQF: { index: '나스닥100 지수 선물 · 근사치', role: '지수가 오르면 크게 벌고, 내리면 크게 잃어요. 여기서는 지수 등락의 5배로 계산했어요.', warn: '실제 선물은 증거금보다 큰 손실이 날 수 있고, 만기와 롤오버가 있어요. 이 화면의 값은 QQQ 종가로 계산한 근사치예요.' },
    NQFS: { index: '나스닥100 지수 선물 매도 · 근사치', role: '지수가 내리면 벌고, 오르면 잃어요. 지수 등락의 5배로 계산했어요.', warn: '매도 포지션은 지수가 오르는 만큼 손실이 계속 커질 수 있어요. 이 화면의 값은 QQQ 종가로 계산한 근사치예요.' },
    QQQP: { index: 'QQQ 등가격 풋옵션 · 30일 만기 · 모델 가격', role: '떨어질수록 값이 올라요. 아무 일 없으면 시간이 갈수록 값이 줄어요.', warn: '블랙숄즈 모델(내재변동성 22%, 금리 4% 가정)로 계산한 가격이에요. 실제 호가와 다를 수 있고, 프리미엄 전액을 잃을 수 있어요.' },
    QQQC: { index: 'QQQ 등가격 콜옵션 · 30일 만기 · 모델 가격', role: '오를수록 값이 크게 올라요. 안 오르면 프리미엄만큼 잃어요.', warn: '블랙숄즈 모델(내재변동성 22%, 금리 4% 가정)로 계산한 가격이에요. 실제 호가와 다를 수 있고, 프리미엄 전액을 잃을 수 있어요.' },
  };
  if (DERIV[id]) return { id, name: ins.name || id, issuer: '', fee: '', cls: null, real: false, ...DERIV[id] };
  return { id, name: ins.name || id, issuer: '', index: ins.kind === 'option' ? '옵션 계약' : '예시 상품', fee: '', role: ins.kind === 'option' ? '시장이 떨어질수록 값이 올라요. 대신 아무 일 없으면 시간이 갈수록 값이 줄어요.' : '훈련 레이드용 예시 상품이에요. 실제 상품 정보는 연결 후 표시돼요.', warn: ins.kind === 'option' ? '옵션은 만기와 행사가가 있고 원금 전액 손실이 가능해요.' : '', cls: null, real: false };
}
function usedInstruments(state) {
  const ids = new Set();
  const add = sk => (sk.blend ? Object.keys(sk.blend) : [sk.instrument]).forEach(i => ids.add(i));
  Object.values(state.party.skills).forEach(id => add(state.party._bySkill[id]));
  (state.actions || []).forEach(a => { if (a.type === 'equip') { add(state.party._bySkill[a.to]); add(state.party._bySkill[a.from]); } });
  return [...ids];
}
function productCardHTML(id, tape, opts = {}) {
  const p = productInfo(id, tape), bars = tape.bars;
  const mv = bars.at(-1).prices[id] / bars[0].prices[id] * 100 - 100;
  const rc = p.cls ? ROLE_COLOR[p.cls] : 'var(--line)';
  return `<div class="pcard" style="--rc:${rc}"><div class="ph"><b>${id}</b><span>${p.name}</span></div>
    <dl><dt>운용사</dt><dd>${p.issuer}</dd><dt>추종</dt><dd>${p.index}</dd><dt>총보수</dt><dd>${p.fee}</dd></dl>
    <div class="prole">${p.role}</div>${p.warn ? `<div class="warn">⚠ ${p.warn}</div>` : ''}
    <div class="move">이번 레이드 <span class="ret ${mv >= 0 ? 'up' : 'down'} tabular">${fmtPct(mv)}</span></div>
    ${p.real ? '<button type="button" class="go">상품 화면 보기</button>' : ''}</div>`;
}
function recordProducts(state) {
  profile.products = profile.products || {};
  usedInstruments(state).forEach(id => { if (!PRODUCTS[id]) return; const e = profile.products[id] || { uses: 0 }; e.uses++; profile.products[id] = e; });
}

/* ---------- badges · boss collection · streak ---------- */
const BADGES = [
  { id: 'first', name: '첫 레이드', desc: '레이드를 처음 끝까지 해냈어요.', test: ctx => true },
  { id: 'slayer', name: '보스 격파', desc: '보스를 쓰러뜨렸어요.', test: ctx => ctx.r.bossDown },
  { id: 'perfect', name: '완벽 방어', desc: '네 명 모두 체력 60 넘게 남기고 끝냈어요.', test: ctx => ROLES.every(r => ctx.s.partyHp[r] >= 60) },
  { id: 'srank', name: 'S 랭크', desc: 'S 등급을 받았어요.', test: ctx => ctx.r.grade === 'S' },
  { id: 'combo3', name: '3연속 반격', desc: '세 구간 연속으로 돈을 벌었어요.', test: ctx => ctx.drama.maxCombo >= 3 },
  { id: 'guard', name: '가드 마스터', desc: '한 판에 가드를 세 번 성공했어요.', test: ctx => ctx.drama.guards >= 3 },
  { id: 'insurer', name: '보험 설계사', desc: '옵션이나 인버스를 들고 돈을 벌었어요.', test: ctx => ROLES.some(r => { const k = ctx.s.party._bySkill[ctx.s.party.skills[r]]; return (k.blend || currentTape.instruments[k.instrument].kind === 'option'); }) && ctx.r.returnPct > 0 },
  { id: 'lever', name: '레버리지 조련사', desc: '레버리지를 들고 A 이상을 받았어요.', test: ctx => ROLES.some(r => currentTape.instruments[ctx.s.party._bySkill[ctx.s.party.skills[r]].instrument].kind === 'lev') && 'SA'.includes(ctx.r.grade) },
  { id: 'real', name: '실전 모험가', desc: '실제 시장 데이터로 한 판을 끝냈어요.', test: ctx => !currentTape.example },
  { id: 'streak3', name: '3일 연속 출석', desc: '사흘 연속으로 레이드를 했어요.', test: ctx => profile.streak >= 3 },
];
const SPECIES_ALL = ['minotaur', 'wyvern', 'fireant', 'lich', 'skeleton'];
const SPECIES_NAME = { minotaur: '동결이', wyvern: '불꽃이', fireant: '불개미', lich: '금리 마법사', skeleton: '뼈다귀' };
const today = () => new Date().toISOString().slice(0, 10);
function bumpStreak() {
  const d = today(); if (profile.lastDay === d) return;
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  profile.streak = profile.lastDay === y ? (profile.streak || 0) + 1 : 1; profile.lastDay = d;
}
/** returns the badges newly earned this raid */
function awardBadges(ctx) {
  const got = [];
  BADGES.forEach(b => { if (!profile.badges[b.id] && b.test(ctx)) { profile.badges[b.id] = today(); got.push(b); } });
  return got;
}
function recordBoss(species, grade, bossDown) {
  const order = ['F', 'D', 'C', 'B', 'A', 'S'];
  const e = profile.bosses[species] || { met: 0, down: 0, best: null };
  e.met++; if (bossDown) e.down++; if (!e.best || order.indexOf(grade) > order.indexOf(e.best)) e.best = grade;
  profile.bosses[species] = e;
}
function renderCollection() {
  $('#dexBosses').innerHTML = SPECIES_ALL.map(sp => { const e = profile.bosses[sp];
    return `<div class="dex ${e ? '' : 'unknown'}"><img src="${portrait(bossUnit(sp))}" alt=""><b>${e ? SPECIES_NAME[sp] : '???'}</b><span class="small muted">${e ? `조우 ${e.met} · 격파 ${e.down}` : '아직 만나지 못함'}</span>${e?.best ? `<i class="stamp-mini ${e.best}">${e.best}</i>` : ''}</div>`; }).join('');
  $('#dexClasses').innerHTML = ROLES.map(role => Object.entries(CLASSES[role]).map(([br, name]) => { const got = hero(role).branch === br;
    return `<div class="dex ${got ? '' : 'unknown'}" style="--bc:${BRANCH_COLOR[br]}"><img src="${portrait(heroUnit(role))}" alt=""><b>${got ? name : '???'}</b><span class="small muted">${charOf(role).name} · ${got ? '전직 완료' : `${STAT_LABEL[br === 'def' ? 'def' : br]} 성향으로 키우면`}</span></div>`; }).join('')).join('');
  const pr = profile.products || {};
  $('#dexProducts').innerHTML = Object.keys(PRODUCTS).map(id => pr[id] ? `<div class="pcard" style="--rc:${ROLE_COLOR[PRODUCTS[id].cls]}" title="${PRODUCTS[id].role}"><div class="ph"><b>${id}</b></div><span class="small muted">${PRODUCTS[id].index}</span><span class="small">${pr[id].uses}회 사용 · 보수 ${PRODUCTS[id].fee}</span></div>` : `<div class="pcard locked"><div class="ph"><b>???</b></div><span class="small muted">레이드에서 써보면 열려요</span></div>`).join('');
  const met = Object.keys(profile.bosses).length, cls = ROLES.filter(r => hero(r).branch).length;
  $('#dexSummary').textContent = `전직 ${cls}/12 · 만난 보스 ${met}/${SPECIES_ALL.length} · 써 본 상품 ${Object.keys(pr).length}/${Object.keys(PRODUCTS).length}`;
}
function renderProfile() {
  const got = ROLES.filter(r => hero(r).branch).length;
  $('#dexBtn').textContent = got ? `도감 ${got}/12` : '도감';
  $('#unlockBtn').setAttribute('aria-pressed', String(!!profile.unlockAll));
  $('#unlockBtn').textContent = profile.unlockAll ? '체험 모드 ON' : '체험 모드';
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */
const SCREENS = ['select', 'brief', 'party', 'battle', 'result'];
const chartMode = () => profile.mode === 'chart';
/** swaps game words for plain market words in chart mode (elements carry data-chart) */
function applyMode() {
  document.body.classList.toggle('mode-chart', chartMode());
  $$('[data-chart]').forEach(el => { if (el.dataset.game === undefined) el.dataset.game = el.textContent; el.textContent = chartMode() ? el.dataset.chart : el.dataset.game; });
  $$('.mode-seg [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === (profile.mode || 'game'))));
}
function showScreen(name) {
  SCREENS.forEach(s => { const el = $('#screen-' + s); el.hidden = s !== name; el.classList.remove('enter'); });
  if (!reduceMotion) { const el = $('#screen-' + name); void el.offsetWidth; el.classList.add('enter'); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#tip').hidden = true;
  if (name === 'brief' || name === 'party' || name === 'result') setTimeout(() => showTip(name), 450);
  if (name === 'battle') setTimeout(() => showTip('battle'), 1800);
}
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg;
  gsap.killTweensOf(t);
  gsap.fromTo(t, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .25, onComplete: () => gsap.to(t, { opacity: 0, y: 10, duration: .3, delay: ms / 1000 }) });
}

/* ---------- 1. raid select ---------- */
let currentTape = null, party = null;
function renderSelect() {
  renderHome();
  $('#raids').innerHTML = ''; $('#raidsExample').innerHTML = ''; $('#raidsUpcoming').innerHTML = '';
  // real tapes first (most recent on top), then the hand-made training scenarios
  const real = TAPES.filter(t => !t.example && !t.dailyRaid).slice().reverse(), examples = TAPES.filter(t => t.example);
  renderRhythm();
  [...real, ...examples].forEach(t => {
    const best = profile.plays[t.id]?.best;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'raid';
    const span = t.daily ? `${fmtDate(t.bars[0].t)} ~ ${fmtDate(t.bars.at(-1).t).slice(5)}` : fmtDate(t.bars[0].t);
    b.innerHTML = `<img src="${portrait(bossUnit(t.bossSpecies))}" alt="" class="pf">
      <div class="meta"><h3>${evTitle(t.title)}</h3>
      <div class="row" style="gap:6px"><span class="chip ${t.market === 'US' ? 'us' : 'kr'}">${t.market === 'US' ? '미국' : '국내'} · ${span}</span></div>
      ${best ? `<span class="small"><span class="best">최고 ${best}</span></span>` : ''}</div>`;
    b.addEventListener('click', () => { unlock(); sfx.select(); openBrief(t.id); });
    $(t.example ? '#raidsExample' : '#raids').appendChild(b);
  });
  UPCOMING.forEach(u => {
    const d = document.createElement('div'); d.className = 'raid upcoming';
    d.innerHTML = `<img src="${portrait(bossUnit(u.species))}" alt="" class="pf" style="filter:brightness(.25) contrast(1.2) sepia(.4)">
      <div class="meta"><h3>${u.title}</h3><div class="row" style="gap:6px"><span class="chip">${fmtDate(u.date)} ${fmtTime(u.date)}</span></div><span class="small muted">${chartMode() ? u.note : '보스 ' + u.boss}</span></div>`;
    $('#raidsUpcoming').appendChild(d);
  });
}

/* ---------- rhythm: a short raid every day, a boss every week, a class change every few weeks ---------- */
const evTitle = t => chartMode() ? t.replace(/ 레이드$/, '') : t;
function renderRhythm() {
  const t = TAPES.find(x => x.dailyRaid), done = t && profile.plays[t.id]?.count;
  const tc = $('#todayCard');
  if (t) {
    tc.hidden = false; tc.classList.toggle('done', !!done);
    tc.innerHTML = `<img src="${portrait(bossUnit(t.bossSpecies))}" alt="" class="pf">
      <div class="tx"><small>오늘의 한 판</small><b>${done ? '오늘 판은 끝났어요' : t.headline || t.title}</b><span>${done ? `내일 아침에 새 판이 열려요` : `3턴${chartMode() ? '' : ' · 보스 ' + t.boss}`}</span></div>
      <span class="go">${done ? '다시 하기' : '시작'}</span>`;
    tc.onclick = async () => { unlock(); sfx.select(); await openBrief(t.id); openParty(); };
  } else tc.hidden = true;
  const now = Date.now(), up = UPCOMING.map(u => ({ ...u, t: Date.parse(u.date) })).filter(u => u.t > now).sort((a, b) => a.t - b.t)[0];
  const wc = $('#weekCard');
  if (up) { const days = Math.ceil((up.t - now) / 86400000), d = new Date(up.t + 9 * 3600000);
    wc.innerHTML = `<img src="${portrait(bossUnit(up.species))}" alt="" class="pf">
      <div class="tx"><small>${chartMode() ? '이번 주 이벤트' : '이번 주 보스'}</small><b>${chartMode() ? up.title : up.boss}</b><span>${chartMode() ? up.note : up.title}</span></div>
      <span class="dday"><b>${days <= 0 ? '오늘' : 'D-' + days}</b><small>${WD[d.getUTCDay()]}요일</small></span>`; }
}

/* ---------- event facts (what a brokerage user expects to see next to the chart) ---------- */
const visibleFacts = (tape, nextBar) => (tape.event?.facts || []).filter(f => f.at <= nextBar);
function eventCardHTML(tape, nextBar, opts = {}) {
  const ev = tape.event; if (!ev) return '';
  const facts = visibleFacts(tape, nextBar);
  const logos = ev.logos?.length ? ev.logos : ev.logo ? [{ src: ev.logo, name: ev.company }] : [];
  const head = `<div class="eh">${logos.length ? `<span class="logos">${logos.map(l => `<img src="${l.src}" alt="${l.name}" title="${l.name}">`).join('')}</span>` : `<img src="${portrait(bossUnit(tape.bossSpecies))}" alt="">`}<div><b>${ev.company}</b><small>${ev.kind === 'earnings' ? '실적 발표' : ev.kind === 'fomc' ? '금리 결정' : '경제 지표'}${ev.example ? ' · 예시' : ''}${facts.length < (ev.facts || []).length ? ' · 발표 전' : ''}</small></div></div>`;
  const body = `<div class="facts">${facts.map(f => `<div class="fact ${f.good === true ? 'good' : f.good === false ? 'bad' : ''} ${opts.newAt !== undefined && f.at === opts.newAt ? 'new' : ''}"><small>${f.label}</small><b>${f.value}</b>${f.note ? `<em>${f.note}</em>` : ''}</div>`).join('')}</div>`;
  return head + body + (opts.source !== false && ev.source ? `<div class="src">출처 · ${ev.source}</div>` : '');
}
/** a one-line "속보" under the battle chart when a new fact becomes known at this bar */
/** the one new fact of this bar, if any — shown in the arena banner (one message at a time), not as a second strip */
function freshFact(nextBar) {
  const ev = currentTape.event; if (!ev) return null;
  const fresh = (ev.facts || []).filter(f => f.at === nextBar);
  return fresh.length ? `${fresh[0].label} ${fresh[0].value}${fresh.length > 1 ? ` 외 ${fresh.length - 1}건` : ''}` : null;
}
function renderNewsline() { $('#newsline').hidden = true; }

/* ---------- 2. briefing ---------- */
let bChart = null;
async function openBrief(id) {
  if ($('#bMore')) $('#bMore').open = chartMode();
  currentTape = await adapter.load(id);
  if (!chartMode()) currentTape = { ...currentTape, skills: currentTape.skills.filter(k => !k.chartOnly) };   // futures and options live in chart mode
  const t = currentTape;
  $('#bArt').src = cutArt(bossUnit(t.bossSpecies));
  $('#bArt').alt = t.boss;
  $('#bTag').textContent = `${t.market === 'US' ? '미국' : '국내'} 레이드 · ${t.example ? '예시 데이터' : '실제 종가 데이터'}`;
  $('#bDate').textContent = t.daily ? `${fmtDate(t.bars[0].t)} ~ ${fmtDate(t.bars.at(-1).t)} · 뉴욕 종가 기준 ${t.bars.length - 1}거래일${t.source ? ' · 출처 ' + t.source : ''}` : `${fmtDate(t.bars[0].t)} ${fmtTime(t.bars[0].t)} ~ ${fmtTime(t.bars.at(-1).t)} (한국시간)`;
  $('#bTitle').textContent = chartMode() ? evTitle(t.title) : `${t.boss} 출현`;
  $('#bBrief').textContent = t.briefing;
  // labels after the first checkpoint describe what happened; keep them hidden until the raid reaches them
  const reveal = Math.min(...t.checkpoints.map(c => c.bar), t.bars.length - 1);
  $('#bEvent').innerHTML = eventCardHTML(t, reveal);
  $('#bTimeline').innerHTML = t.bars.map((b, i) => { const cp = t.checkpoints.find(c => c.bar === i); return `<span class="${cp ? 'cp' : ''}">${fmtBar(b.t, t)} ${cp ? cp.title : i <= reveal ? b.label : '???'}</span>`; }).join('');
  $('#bConcepts').innerHTML = (t.concepts || []).map(c => `<span class="chip" style="color:var(--gold)">${c.name}</span>`).join('');
  const main = mainInstrument(t);
  $('#bChartTitle').innerHTML = `${main} ${t.instruments[main].name} <span class="muted">· ${t.example ? '예시 시세' : '실제 종가'} · 첫 체크포인트까지</span>`;
  bChart?.remove(); bChart = new BattleChart($('#bChart'), t, 'price', { upto: reveal, quiet: true, futureShade: true }); $('#bMore').open = chartMode(); if (chartMode()) setTimeout(() => bChart?.c.timeScale().fitContent(), 80); $('#bMore').ontoggle = () => { if ($('#bMore').open) setTimeout(() => bChart?.c.timeScale().fitContent(), 50); };
  showScreen('brief');
  gsap.fromTo('#bArt', { scale: .6, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: .6, ease: 'back.out(1.6)' });
  if (!reduceMotion) gsap.fromTo('.boss-stage', { x: -6 }, { x: 6, duration: .06, repeat: 5, yoyo: true, clearProps: 'x', delay: .35 });
  sfx.roar();
}

/* ---------- 3. party setup ---------- */
/** Four plain stats per instrument (0-5), read off its kind/name. 공격 = how much it moves with a rally,
 *  방어 = how little it loses in a sell-off, 안정 = day-to-day calm, 보험 = pays out when things go wrong. */
function instStats(ins) {
  const n = ins.name || '', k = ins.kind;
  if (k === 'cash') return { atk: 0, def: 5, stab: 5, ins: 1 };
  if (k === 'lev') return /인버스/.test(n) ? { atk: 1, def: 2, stab: 1, ins: 4 } : { atk: 5, def: 0, stab: 1, ins: 0 };
  if (k === 'option') return /인버스/.test(n) ? { atk: 1, def: 3, stab: 2, ins: 4 } : { atk: 0, def: 4, stab: 1, ins: 5 };
  if (/반도체/.test(n)) return { atk: 4, def: 1, stab: 2, ins: 0 };
  if (/장기채|국고채/.test(n)) return { atk: 2, def: 3, stab: 3, ins: 2 };
  if (/단기채/.test(n)) return { atk: 0, def: 4, stab: 5, ins: 1 };
  if (/금/.test(n) && !/금리/.test(n)) return { atk: 2, def: 4, stab: 3, ins: 3 };
  if (/배당/.test(n)) return { atk: 2, def: 3, stab: 4, ins: 1 };
  return { atk: 3, def: 2, stab: 3, ins: 0 };
}
function skillStats(sk) {
  const parts = sk.blend ? Object.entries(sk.blend) : [[sk.instrument, 1]];
  const out = { atk: 0, def: 0, stab: 0, ins: 0 };
  parts.forEach(([id, w]) => { const st = instStats(currentTape.instruments[id]); for (const k in out) out[k] += st[k] * w; });
  return out;
}
function partyStats(p = party) {
  const out = { atk: 0, def: 0, stab: 0, ins: 0 };
  ROLES.forEach(r => { const st = skillStats(p._bySkill[p.skills[r]]); for (const k in out) out[k] += st[k] * p.weights[r] / 100; });
  return out;
}
function partyType(st) {
  if (st.ins >= 2.2) return ['헤지형', '보험을 두껍게 든 파티예요. 급락할 땐 빛나고, 오를 땐 비용이 들어요.'];
  if (st.atk >= 3.4) return ['공격형', '오를 때 크게 버는 대신, 빠질 때도 크게 맞는 파티예요.'];
  if (st.def >= 3.0 && st.atk < 2.4) return ['안정형', '덜 벌고 덜 잃는 파티예요. 보스를 쓰러뜨리긴 어려워요.'];
  return ['균형형', '공격과 방어를 고르게 나눈 파티예요. 중간 선택에서 방향을 정해요.'];
}
const STAT_LABEL = { atk: '공격', def: '방어', stab: '안정', ins: '보험' };
const STAT_KEYS = ['atk', 'def', 'stab', 'ins'];
const STAT_COLOR = { atk: '#D6453F', def: '#2F6BD0', stab: '#2E9A58', ins: '#7458C9' };
// one icon per stat, used everywhere the stat appears (choices, party, status windows, pop-ups)
const STAT_SVG = {
  atk: '<path d="M14.5 3.5 20.5 3.5 20.5 9.5 10 20 4 14z" fill="#FFB3AE" stroke="#D6453F" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 20l3-3" stroke="#D6453F" stroke-width="2.4" stroke-linecap="round"/>',
  def: '<path d="M12 3 19 6v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="#B9D0F5" stroke="#2F6BD0" stroke-width="1.8" stroke-linejoin="round"/>',
  stab: '<circle cx="12" cy="12" r="8.5" fill="#BFE8CC" stroke="#2E9A58" stroke-width="1.8"/><path d="M7.5 12h9" stroke="#2E9A58" stroke-width="2.2" stroke-linecap="round"/>',
  ins: '<path d="M3.5 12a8.5 8.5 0 0 1 17 0z" fill="#D9CCFA" stroke="#7458C9" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 12v6.5a2 2 0 0 1-4 0" fill="none" stroke="#7458C9" stroke-width="1.8" stroke-linecap="round"/>',
};
const statIcon = (k, size = 16) => `<svg class="sti" width="${size}" height="${size}" viewBox="0 0 24 24" aria-label="${STAT_LABEL[k]}">${STAT_SVG[k]}</svg>`;
/** the two strongest stats of a skill, as icons — "이걸 고르면 이게 오른다" without reading */
function skillStatChips(sk) { const st = skillStats(sk); return STAT_KEYS.filter(k => st[k] >= 2.5).sort((a, b) => st[b] - st[a]).slice(0, 2).map(k => `<span class="stchip">${statIcon(k, 14)}</span>`).join(''); }

/* ---------- hero growth & 전직 ----------
   Each raid adds to every hero's four stats from the product it ended with (scaled by weight) plus a bonus for a
   checkpoint swap. At EVO_PTS total a hero changes class by its strongest stat group. */
const EVO_PTS = 30, STEPS = 5;   // 전직 when a hero's four stats add up to EVO_PTS; heavier-weighted heroes get there first
const CLASSES = {
  tank: { def: '철벽 채권', atk: '돌격 채권', ins: '수호 채권' },
  dealer: { def: '냉철한 성장주', atk: '폭주 성장주', ins: '신중한 성장주' },
  healer: { def: '든든한 금고', atk: '연금술 금고', ins: '예언의 금고' },
  support: { def: '뿌리 깊은 배당주', atk: '날쌘 배당주', ins: '파수꾼 배당주' },
};
const BRANCH_COLOR = { def: '#2F6BD0', atk: '#D6453F', ins: '#7458C9' };
const STAT_GROW = { atk: '날카로워졌어요.', def: '단단해졌어요.', stab: '침착해졌어요.', ins: '신중해졌어요.' };
const josa = (word, a, b) => { const c = word.charCodeAt(word.length - 1) - 0xAC00; return c >= 0 && c <= 11171 && c % 28 ? a : b; };
function hero(role) { profile.heroes = profile.heroes || {}; return profile.heroes[role] ||= { raids: 0, st: { atk: 0, def: 0, stab: 0, ins: 0 }, branch: null, last: 0 }; }
const KNUM = n => ['', '한', '두', '세', '네', '다섯'][n] || String(n);
const heroPts = h => STAT_KEYS.reduce((a, k) => a + h.st[k], 0);
/** raids left until 전직, estimated from the last raid's gain */
const raidsLeft = role => { const h = hero(role); if (h.branch) return 0; const need = EVO_PTS - heroPts(h); return need <= 0 ? 0 : Math.ceil(need / Math.max(4, h.last || 8)); };
const branchOf = st => { const g = { atk: st.atk, ins: st.ins, def: (st.def + st.stab) / 2 }; return Object.keys(g).sort((a, b) => g[b] - g[a])[0]; };
const ROLE_DESC = { tank: '지키는 자산', dealer: '버는 자산', healer: '피난처', support: '받쳐 주는 자산' };
const heroTitle = role => ROLE_DESC[role];
function raidGains(state) {
  const out = {};
  ROLES.forEach(role => {
    const sk = state.party._bySkill[state.party.skills[role]], st = skillStats(sk), w = state.party.weights[role];
    const g = Object.fromEntries(STAT_KEYS.map(k => [k, Math.round(st[k] * (0.4 + w / 50))]));
    (state.actions || []).filter(a => a.type === 'equip' && state.party._bySkill[a.to]?.role === role).forEach(a => { const st2 = skillStats(state.party._bySkill[a.to]); const top = STAT_KEYS.slice().sort((x, y) => st2[y] - st2[x])[0]; g[top] += 2; });
    out[role] = g;
  });
  return out;
}
/** applies gains; returns { gains, evolved: [role...] } */
function growHeroes(state) {
  const gains = raidGains(state), evolved = [];
  ROLES.forEach(role => { const h = hero(role); STAT_KEYS.forEach(k => { h.st[k] += gains[role][k]; }); h.last = STAT_KEYS.reduce((a, k) => a + gains[role][k], 0); h.raids++; if (!h.branch && heroPts(h) >= EVO_PTS) { h.branch = branchOf(h.st); evolved.push(role); } });
  return { gains, evolved };
}
function statusWindowHTML(role, opts = {}) {
  const h = hero(role), left = raidsLeft(role), on = Math.min(STEPS, Math.floor(heroPts(h) / EVO_PTS * STEPS));
  const steps = Array.from({ length: STEPS }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('');
  return `<div class="stwin ${h.branch ? 'evo' : ''}" style="--rc:${ROLE_COLOR[role]};--bc:${h.branch ? BRANCH_COLOR[h.branch] : 'transparent'}">
    <div class="sw-h"><img src="${portrait(heroUnit(role))}" alt=""><div><b>${charOf(role).name}</b><span>${heroTitle(role)}</span></div></div>
    <div class="sw-st">${STAT_KEYS.map(k => { const mx = Math.max(12, ...STAT_KEYS.map(x => h.st[x])); return `<div>${statIcon(k, 14)}<i><em style="width:${(h.st[k] / mx * 100).toFixed(1)}%;background:${STAT_COLOR[k]}"></em></i><b class="tabular">${h.st[k]}</b><u>${opts.gains?.[k] ? `+${opts.gains[k]}` : ''}</u></div>`; }).join('')}</div>
    <div class="sw-ev">${h.branch ? `<span class="done">전직 완료</span>` : `<span class="steps">${steps}</span><small>${!h.raids ? '레이드를 하면 자라요' : left ? `${KNUM(left)} 판 더 하면 전직` : '전직 준비 완료'}</small>`}</div></div>`;
}
/* ---------- home: the party on stage; tap one to see how it is growing ---------- */
let homeSel = null;
const LEAN = { atk: '공격 쪽으로', def: '단단한 쪽으로', ins: '신중한 쪽으로' };
const BRANCH_ICON = { atk: 'atk', def: 'def', ins: 'ins' };
function renderHome() {
  if (!homeSel) homeSel = ROLES.filter(r => !hero(r).branch && hero(r).raids).sort((a, b) => raidsLeft(a) - raidsLeft(b))[0] || 'dealer';
  const plays = Object.values(profile.plays || {}).reduce((a, p) => a + p.count, 0), tp = profile.totalPnl || 0;
  $('#homeChip').innerHTML = plays ? `레이드 ${plays}판 <i></i> 지금까지 <b class="${tp >= 0 ? 'up' : 'down'}">${tp >= 0 ? '+' : '−'}${wonWords(tp)}</b>` : '첫 레이드를 기다리고 있어요';
  $('#homeCast').innerHTML = ROLES.map((r, i) => { const h = hero(r), sel = r === homeSel;
    return `<button type="button" class="cast ${sel ? 'sel' : ''} ${h.branch ? 'evo' : ''}" data-role="${r}" style="--rc:${ROLE_COLOR[r]};--bc:${h.branch ? BRANCH_COLOR[h.branch] : ROLE_COLOR[r]};--d:${-i * .45}s" aria-pressed="${sel}">
      <span class="tag"><b>${charOf(r).name}</b>${sel || h.branch ? `<small>${heroTitle(r)}</small>` : ''}</span>
      <img src="${cutArt(heroUnit(r))}" alt="${charOf(r).name}"><span class="ring"></span></button>`; }).join('');
  $$('#homeCast .cast').forEach(b => b.onclick = () => { homeSel = b.dataset.role; sfx.select?.(); renderHome(); });
  $('#heroSheet').innerHTML = heroSheetHTML(homeSel);
}
function heroSheetHTML(role) {
  const h = hero(role), name = charOf(role).name, lead = h.branch || branchOf(h.st), started = h.raids > 0;
  const max = Math.max(12, ...STAT_KEYS.map(k => h.st[k]));
  const line = h.branch ? `${CLASSES[role][h.branch]}${josa(CLASSES[role][h.branch], '으로', '로')} 전직했어요.`
    : !started ? '레이드에서 어떤 상품을 들었는지에 따라 성격이 달라져요.'
    : `${LEAN[lead]} 자라고 있어요. 이대로면 <b style="color:${BRANCH_COLOR[lead]}">${CLASSES[role][lead]}</b>${josa(CLASSES[role][lead], '이', '가')} 돼요.`;
  const left = raidsLeft(role), on = h.branch ? STEPS : Math.min(STEPS, Math.floor(heroPts(h) / EVO_PTS * STEPS));
  return `<div class="hs-head" style="--rc:${ROLE_COLOR[role]}"><b>${name}</b><span>${heroTitle(role)}</span></div>
    <p class="hs-line">${line}</p>
    <div class="hs-stats">${STAT_KEYS.map(k => `<div class="hs-stat">${statIcon(k, 18)}<span>${STAT_LABEL[k]}</span><i><em style="width:${(h.st[k] / max * 100).toFixed(1)}%;background:${STAT_COLOR[k]}"></em></i><b class="tabular">${h.st[k]}</b></div>`).join('')}</div>
    <div class="hs-path">${Object.keys(CLASSES[role]).map(br => { const known = h.branch === br || (started && lead === br);
      return `<div class="${br === lead && started ? 'lead' : ''} ${h.branch && h.branch !== br ? 'off' : ''}" style="--bc:${BRANCH_COLOR[br]}">${statIcon(BRANCH_ICON[br], 16)}<span>${known ? CLASSES[role][br] : '???'}</span></div>`; }).join('')}</div>
    <div class="hs-evo">${h.branch ? '<span class="done">전직 완료</span>' : `<span>전직까지</span><span class="feet">${Array.from({ length: STEPS }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span><small>${!started ? '' : left ? `${KNUM(left)} 판 더` : '다음 판에 전직'}</small>`}</div>`;
}

function nextBossSentence() {
  const now = Date.now(), up = UPCOMING.map(u => ({ ...u, t: Date.parse(u.date) })).filter(u => u.t > now).sort((a, b) => a.t - b.t)[0];
  if (!up) return '';
  const days = Math.ceil((up.t - now) / 86400000), d = new Date(up.t + 9 * 3600000);
  const when = days <= 6 ? `${WD[d.getUTCDay()]}요일` : `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
  return `다음 보스 ${up.boss}${josa(up.boss, '은', '는')} ${when}에 와요.`;
}
const wonWords = v => { const a = Math.abs(Math.round(v)); return a >= 10000 ? `${Math.round(a / 10000).toLocaleString('ko-KR')}만원` : a >= 1000 ? `${Math.round(a / 1000)}천원` : `${a}원`; };
function radarSVG(st, size = 150) {
  const c = size / 2, R = c - 22, keys = ['atk', 'def', 'stab', 'ins'];
  const pt = (i, v) => { const a = -Math.PI / 2 + i * Math.PI / 2; return [c + Math.cos(a) * R * v / 5, c + Math.sin(a) * R * v / 5]; };
  const ring = v => keys.map((_, i) => pt(i, v).join(',')).join(' ');
  const poly = keys.map((k, i) => pt(i, Math.max(.3, st[k])).join(',')).join(' ');
  const labels = keys.map((k, i) => { const [x, y] = pt(i, 6.3); return `<text x="${x}" y="${y + 4}" text-anchor="middle" font-size="13" font-family="Jua, sans-serif" fill="${STAT_COLOR[k]}">${STAT_LABEL[k]} ${st[k].toFixed(1)}</text>`; }).join('');
  return `<svg viewBox="-28 0 ${size + 56} ${size}" width="${size + 56}" height="${size}" role="img" aria-label="파티 스탯">
    ${[1, 2, 3, 4, 5].map(v => `<polygon points="${ring(v)}" fill="none" stroke="#D8C9A3" stroke-width="${v === 5 ? 1.5 : .8}"/>`).join('')}
    ${keys.map((_, i) => `<line x1="${c}" y1="${c}" x2="${pt(i, 5)[0]}" y2="${pt(i, 5)[1]}" stroke="#D8C9A3" stroke-width=".8"/>`).join('')}
    <polygon points="${poly}" fill="rgba(224,167,46,.35)" stroke="#E0A72E" stroke-width="2.5" stroke-linejoin="round"/>
    ${labels}</svg>`;
}
/** one-tap formations; locked skills fall back to the role's default */
const PRESETS = {
  balanced: { name: '균형형', weights: { tank: 25, dealer: 40, healer: 20, support: 15 }, pick: {} },
  safe: { name: '안정형', weights: { tank: 40, dealer: 20, healer: 20, support: 20 }, pick: { healer: ['cash'] } },
  aggro: { name: '공격형', weights: { tank: 10, dealer: 60, healer: 10, support: 20 }, pick: { dealer: ['lev', 'sector'], healer: ['cash'] } },
  hedge: { name: '헤지형', weights: { tank: 30, dealer: 30, healer: 25, support: 15 }, pick: { healer: ['option', 'gold'] } },
};
/* ---------- 내 계좌로 편성 ----------
   A sample brokerage account (in the real app: the user's holdings via the account API). Each holding is mapped to a
   role by asset class, weights are summed per role and rounded to 5%, and each role equips the tape's skill closest to
   what the user actually holds. The raid then answers: "how did MY portfolio take this event?" */
const SAMPLE_ACCOUNT = [
  { name: 'QQQ 나스닥100', cls: 'growth', pct: 35 },
  { name: 'NVIDIA', cls: 'growth', pct: 10 },
  { name: 'TLT 미국 장기채', cls: 'bond', pct: 15 },
  { name: 'SCHD 미국 배당', cls: 'dividend', pct: 15 },
  { name: 'GLD 금', cls: 'gold', pct: 10 },
  { name: '예수금(현금)', cls: 'cash', pct: 15 },
];
const CLS_ROLE = { growth: 'dealer', bond: 'tank', dividend: 'support', gold: 'healer', cash: 'healer' };
function accountParty() {
  const w = { tank: 0, dealer: 0, healer: 0, support: 0 }, healerMix = { gold: 0, cash: 0 };
  SAMPLE_ACCOUNT.forEach(h => { w[CLS_ROLE[h.cls]] += h.pct; if (h.cls in healerMix) healerMix[h.cls] += h.pct; });
  ROLES.forEach(r => { w[r] = Math.round(w[r] / 5) * 5; });
  const diff = 100 - ROLES.reduce((a, r) => a + w[r], 0); w.dealer += diff;
  const lvl = effectiveLevel();
  const skills = {
    dealer: pickSkill('dealer', [], lvl),                                         // the default index skill = 지수 ETF
    tank: pickSkill('tank', ['longbond'], lvl),
    support: pickSkill('support', [], lvl),
    healer: pickSkill('healer', healerMix.cash > healerMix.gold ? ['cash', 'gold'] : ['gold', 'cash'], lvl),
  };
  return { weights: w, skills };
}
function applyAccount() {
  const a = accountParty();
  party = Object.assign(defaultParty(currentTape), { _tapeId: currentTape.id });
  party.weights = a.weights; Object.assign(party.skills, a.skills);
  presetKey = 'account'; renderPartyScreen();
  toast('내 계좌 비중으로 편성했어요');
}
function pickSkill(role, prefs, lvl) {
  const list = currentTape.skills.filter(k => k.role === role), open = k => skillOpen(k);
  const by = { longbond: k => /장기채|국고채/.test(currentTape.instruments[k.instrument].name), lev: k => currentTape.instruments[k.instrument].kind === 'lev', sector: k => /반도체/.test(currentTape.instruments[k.instrument].name), cash: k => currentTape.instruments[k.instrument].kind === 'cash', option: k => k.blend || currentTape.instruments[k.instrument].kind === 'option', gold: k => /금/.test(currentTape.instruments[k.instrument].name) };
  for (const pref of prefs) { const hit = list.find(k => by[pref]?.(k) && open(k)); if (hit) return hit.id; }
  return (list.find(k => k.default) || list[0]).id;
}
let presetKey = 'balanced';
function applyPreset(key) {
  const pr = PRESETS[key], lvl = effectiveLevel();
  party = Object.assign(defaultParty(currentTape), { _tapeId: currentTape.id });
  party.weights = { ...pr.weights };
  ROLES.forEach(r => { if (pr.pick[r]) party.skills[r] = pickSkill(r, pr.pick[r], lvl); });
  presetKey = key; renderPartyScreen(); toast(`${pr.name} 편성`);
}
/** which preset (if any) the current party equals — manual edits clear the highlight */
function matchPreset() {
  const lvl = effectiveLevel();
  return Object.keys(PRESETS).find(k => { const pr = PRESETS[k]; return ROLES.every(r => party.weights[r] === pr.weights[r] && party.skills[r] === (pr.pick[r] ? pickSkill(r, pr.pick[r], lvl) : (currentTape.skills.find(x => x.role === r && x.default) || {}).id)); }) || null;
}
function renderPresets() {
  const cur = matchPreset() || (presetKey === 'account' && (() => { const a = accountParty(); return ROLES.every(r => party.weights[r] === a.weights[r] && party.skills[r] === a.skills[r]); })() ? 'account' : null);
  const acc = $('#accountBtn'); if (acc) { acc.setAttribute('aria-pressed', String(cur === 'account')); const a = accountParty(); acc.querySelector('.mini-alloc').innerHTML = ROLES.map(r => `<i style="width:${a.weights[r]}%;background:${ROLE_COLOR[r]}"></i>`).join(''); acc.querySelector('.hold').textContent = '샘플 계좌 · ' + SAMPLE_ACCOUNT.map(h => `${h.name.split(' ')[0]} ${h.pct}`).join(' · '); }
  $$('.preset').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.preset === cur)); const pr = PRESETS[b.dataset.preset]; b.querySelector('.mini-alloc').innerHTML = ROLES.map(r => `<i style="width:${pr.weights[r]}%;background:${ROLE_COLOR[r]}"></i>`).join(''); });
}
function renderPartyMeta() {
  const st = partyStats(), [type, desc] = partyType(st);
  $('#partyRadar').innerHTML = radarSVG(st);
  $('#partyType').textContent = type; $('#partyTypeDesc').textContent = '';
  renderPresets();
}
function openParty() {
  party = party && party._tapeId === currentTape.id ? party : Object.assign(defaultParty(currentTape), { _tapeId: currentTape.id });
  renderPartyScreen();
  showScreen('party');
}
function renderPartyScreen() {
  const t = currentTape, lvl = effectiveLevel();
  $('#roles').innerHTML = '';
  ROLES.forEach(role => {
    const m = ROLE_META[role], c = charOf(role);
    const card = document.createElement('div'); card.className = 'role'; card.style.setProperty('--rc', ROLE_COLOR[role]);
    card.innerHTML = `<img src="${cutArt(heroUnit(role))}" alt="${c.name}">
      <h3>${c.name} <small>${ROLE_DESC[role]}</small></h3>
      <div class="wctl"><button type="button" class="wbtn" data-w="${role}" data-d="-5" aria-label="${c.name} 비중 줄이기">−</button><output id="o-${role}">${party.weights[role]}%</output><button type="button" class="wbtn" data-w="${role}" data-d="5" aria-label="${c.name} 비중 늘리기">+</button></div>
      <div class="skills" id="sk-${role}"></div>`;
    $('#roles').appendChild(card);
    card.querySelectorAll('.wbtn').forEach(b => b.addEventListener('click', () => { sfx.select(); stepWeight(party.weights, role, +b.dataset.d); ROLES.forEach(r => { $('#o-' + r).value = party.weights[r] + '%'; }); renderSum(); }));
    renderSkillList(card.querySelector('#sk-' + role), role, lvl);
  });
  renderSum(); renderPartyMeta();
}
function renderSkillList(box, role, lvl) {
  box.innerHTML = '';
  currentTape.skills.filter(s => s.role === role).forEach(s => {
    const locked = !skillOpen(s);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'skill'; if (s.lesson) b.title = s.lesson;
    b.setAttribute('aria-pressed', String(party.skills[role] === s.id));
    const ins = currentTape.instruments[s.instrument];
    const tick = s.blend ? Object.entries(s.blend).map(([id, w]) => `${id === 'BIL' || id === 'KCASH' ? '현금' : id.endsWith('_P') ? id.slice(0, -2) + ' 풋' : id} ${Math.round(w * 100)}%`).join(' + ') : s.instrument;
    b.innerHTML = `<span style="min-width:0"><span class="n">${s.name}</span><span class="i">${tick}</span></span><span class="chips">${locked ? `<span class="lock">${lockLabel(s)}</span>` : skillStatChips(s)}</span>`;
    b.addEventListener('click', () => {
      if (locked) { sfx.back(); toast(`${charOf(role).name}${josa(charOf(role).name, '이', '가')} 전직하면 열려요. 위쪽 '체험 모드'로 미리 써 볼 수 있어요.`, 2800); return; }
      sfx.select(); party.skills[role] = s.id;
      box.querySelectorAll('.skill').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
      renderPartyMeta();
    });
    box.appendChild(b);
  });
}
/** ＋ takes 5 from whoever holds the most (so the total never exceeds 100); − frees 5 into a visible pool. */
function stepWeight(w, role, d) {
  if (d > 0) {
    const pool = 100 - ROLES.reduce((a, r) => a + w[r], 0);
    if (w[role] >= 100) return;
    if (pool >= 5) { w[role] += 5; return; }
    const donor = ROLES.filter(r => r !== role && w[r] >= 5).sort((a, b) => w[b] - w[a])[0];
    if (!donor) return; w[donor] -= 5; w[role] += 5;
  } else if (w[role] >= 5) w[role] -= 5;
}
function allocHTML(w) {
  const pool = 100 - ROLES.reduce((a, r) => a + w[r], 0);
  return ROLES.map(r => `<i style="width:${w[r]}%;background:${ROLE_COLOR[r]}" title="${charOf(r).name} ${w[r]}%"></i>`).join('') + (pool > 0 ? `<i class="pool-seg" style="width:${pool}%" title="미배정 ${pool}%"></i>` : '');
}
function renderSum() {
  const sum = ROLES.reduce((a, r) => a + party.weights[r], 0), pool = 100 - sum;
  const el = $('#sumTxt'); el.innerHTML = pool > 0 ? `<span class="pool">남은 비중 ${pool}%</span>` : '비중 100%'; el.classList.toggle('bad', sum !== 100);
  $('#alloc').innerHTML = allocHTML(party.weights);
  $('#startBattle').disabled = sum !== 100;
  $$('.wbtn[data-d="-5"]').forEach(b => { b.disabled = party.weights[b.dataset.w] <= 0; });
  if (sum === 100 && $('#partyRadar')) renderPartyMeta();
}

/* ------------------------------------------------------------------ */
/* Phaser battle scene — cute anime pose sprites (assets/anime, see CREDITS.txt)          */
/* Each unit has 3 still poses (idle / attack / hurt) on a shared baseline; motion comes    */
/* from tweens (bob, dash, knock-back, squash) + VFX sprites, creature-collector style.     */
/* ------------------------------------------------------------------ */
const W = 1280, H = 720;
const ASSET = 'assets/anime/';
const UNIT_OF_ROLE = { tank: 'hero_tank', dealer: 'hero_dealer', healer: 'hero_healer', support: 'hero_support' };
const UNIT_OF_BOSS = { minotaur: 'boss_minotaur', wyvern: 'boss_wyvern', fireant: 'boss_fireant', skeleton: 'boss_skeleton', lich: 'boss_lich' };
const POSES = ['idle', 'attack', 'hurt'];
const FX = ['slash', 'burst', 'heal', 'shield', 'star', 'bolt'];
const ATTACK_KIND = { tank: 'melee', dealer: 'melee', healer: 'cast', support: 'shoot' };
// feet position + target height on the 1280x720 stage
const FORMATION = { tank: { x: 575, y: 600, h: 300 }, dealer: { x: 395, y: 515, h: 285 }, support: { x: 225, y: 615, h: 285 }, healer: { x: 400, y: 705, h: 300 } };
const BOSS_POS = { x: 950, y: 650, h: 400 };
const BOSS_STYLE = { minotaur: { h: 420, float: 0, fx: 'slash', tint: 0x9fd8ff }, wyvern: { h: 400, float: 24, fx: 'burst', tint: 0xffa040 }, fireant: { h: 380, float: 0, fx: 'burst', tint: 0xff6a3a }, skeleton: { h: 360, float: 0, fx: 'slash', tint: 0xc9b9ff }, lich: { h: 400, float: 30, fx: 'bolt', tint: 0xffe066 } };

class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); this.sprites = {}; }
  preload() {
    const bar = $('#arenaLoadingBar'), txt = $('#arenaLoadingTxt');
    this.load.on('progress', v => { if (bar) bar.style.width = Math.round(v * 100) + '%'; });
    this.load.on('fileprogress', f => { if (txt) txt.textContent = `전장 불러오는 중… ${f.key}`; });
    this.load.on('loaderror', f => { console.error('asset failed', f.key, f.src); if (txt) txt.textContent = `에셋을 불러오지 못했습니다: ${f.key}`; this.loadFailed = true; });
    this.load.image('bg', ASSET + 'bg_meadow.jpg');
    this.load.json('manifest', ASSET + 'manifest.json');
    for (const u of [...Object.values(UNIT_OF_ROLE), ...Object.values(UNIT_OF_BOSS)]) for (const p of POSES) this.load.image(`${u}_${p}`, `${ASSET}${u}_${p}.png`);
    for (const f of FX) this.load.image('fx_' + f, `${ASSET}fx_${f}.png`);
  }
  create() {
    if (this.loadFailed || !this.cache.json.get('manifest')) { this.ready = 'failed'; return; }
    this.add.image(W / 2, H / 2, 'bg').setDisplaySize(W, H).setDepth(0);
    const top = this.add.graphics().setDepth(1); top.fillGradientStyle(0x1E3A5F, 0x1E3A5F, 0x1E3A5F, 0x1E3A5F, .3, .3, 0, 0); top.fillRect(0, 0, W, 100);
    $('#arenaLoading')?.remove();
    this.manifest = this.cache.json.get('manifest');
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8); g.generateTexture('spark', 16, 16); g.destroy();
    this.flashRect = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0).setDepth(50);
    this.ready = true;
  }
  /** a pose-swapping unit anchored at the feet */
  unit(key, x, y, targetH, float = 0) {
    const m = this.manifest[key];
    const s = targetH / m.h;
    const sp = this.add.image(x, y - float, `${key}_idle`).setOrigin(.5, 1).setScale(s).setDepth(10 + y / 100);
    sp.unitKey = key; sp.home = { x, y: y - float, s, float }; sp.dead = false; sp.pose = 'idle';
    this.idle(sp);
    return sp;
  }
  /** idle loop: gentle bob (floaters hover higher and slower) */
  idle(sp) {
    sp.idleTw?.forEach(t => t.remove()); sp.idleTw = [];
    if (reduceMotion || sp.dead) return;
    const fl = sp.home.float > 0;
    sp.idleTw.push(this.tweens.add({ targets: sp, y: sp.home.y - (fl ? 14 : 5), duration: fl ? 1400 : 700 + Math.random() * 200, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: Math.random() * 400 }));
    if (!fl) sp.idleTw.push(this.tweens.add({ targets: sp, scaleY: sp.home.s * .975, scaleX: sp.home.s * 1.02, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: Math.random() * 400 }));
  }
  pose(sp, name) { sp.pose = name; sp.setTexture(`${sp.unitKey}_${name}`); }
  /** show a pose for `ms`, then back to idle (unless dead) */
  act(sp, name, ms) {
    sp.idleTw?.forEach(t => t.remove()); sp.idleTw = [];
    sp.setScale(sp.home.s); sp.y = sp.home.y;
    this.pose(sp, name);
    return new Promise(res => this.time.delayedCall(ms, () => { if (!sp.dead) { this.pose(sp, 'idle'); this.idle(sp); } res(); }));
  }
  /** VFX sprite: pops in with a bounce and fades */
  fx(name, x, y, size = 160, opts = {}) {
    const sp = this.add.image(x, y, 'fx_' + name).setDepth(opts.depth ?? 45).setAlpha(0);
    const s = size / Math.max(sp.width, sp.height); sp.setScale(s * .4); if (opts.flipX) sp.setFlipX(true); if (opts.angle) sp.setAngle(opts.angle); if (opts.tint) sp.setTint(opts.tint);
    this.tweens.add({ targets: sp, alpha: 1, scale: s, duration: opts.inMs ?? 120, ease: 'back.out(2.5)' });
    this.tweens.add({ targets: sp, alpha: 0, scale: s * (opts.grow ?? 1.25), angle: (opts.angle ?? 0) + (opts.spin ?? 0), duration: opts.outMs ?? 260, delay: (opts.inMs ?? 120) + (opts.hold ?? 120), onComplete: () => sp.destroy() });
    return sp;
  }
  shadow(x, y, w) { return this.add.ellipse(x, y + 4, w, w * .3, 0x1E3A2A, .22).setDepth(5); }
  async setup(tape) {
    this.tweens.killAll();
    Object.values(this.sprites).forEach(s => s.destroy()); this.sprites = {};
    this.shadows?.forEach(s => s.destroy()); this.shadows = [];
    this.emitter?.destroy(); this.emitter = null;
    ROLES.forEach(role => {
      const f = FORMATION[role];
      this.shadows.push(this.shadow(f.x, f.y, f.h * .42));
      this.sprites[role] = this.unit(UNIT_OF_ROLE[role], f.x, f.y, f.h);
    });
    const bk = UNIT_OF_BOSS[tape.bossSpecies] || 'boss_minotaur', st = BOSS_STYLE[tape.bossSpecies] || BOSS_STYLE.minotaur;
    this.shadows.push(this.shadow(BOSS_POS.x, BOSS_POS.y, st.h * .55));
    const b = this.unit(bk, BOSS_POS.x, BOSS_POS.y, st.h, st.float); b.setDepth(9); b.style = st; this.sprites.boss = b;
    this.emitter = this.add.particles(0, 0, 'spark', { speed: { min: 90, max: 320 }, angle: { min: 0, max: 360 }, scale: { start: .8, end: 0 }, lifespan: { min: 300, max: 650 }, gravityY: 300, emitting: false }).setDepth(40);
    // entrance: drop in with a squash, sparkle ring
    b.idleTw?.forEach(t => t.remove()); b.idleTw = [];
    b.alpha = 0; b.y = b.home.y - 160; b.setScale(b.home.s * .6);
    await this.tw({ targets: b, alpha: 1, y: b.home.y, scale: b.home.s, duration: 420, ease: 'bounce.out' });
    this.fx('star', b.x - 110, this.top(b) + 40, 90, { spin: 40 }); this.fx('star', b.x + 120, this.top(b) + 120, 70, { spin: -40 });
    this.idle(b);
  }
  tw(cfg) { return new Promise(res => this.tweens.add({ ...cfg, onComplete: () => { cfg.onComplete?.(); res(); } })); }
  /** Top banner inside the arena: "05:00 매파 발언 · 동결이의 매파 발언!" */
  banner(main, sub, color, speed = 1) {
    this.bannerObjs?.forEach(o => o.destroy());
    const bg = this.add.rectangle(W / 2, 54, W, 80, 0x1E3A5F, .78).setDepth(70);
    const t1 = this.add.text(W / 2, 40, main, { fontFamily: '"Jua", "Do Hyeon", sans-serif', fontSize: '32px', color, stroke: '#0E1C2E', strokeThickness: 3 }).setOrigin(.5).setDepth(71);
    const t2 = this.add.text(W / 2, 74, sub, { fontFamily: '"Noto Sans KR", sans-serif', fontSize: '18px', color: '#F4F7FB' }).setOrigin(.5).setDepth(71);
    this.bannerObjs = [bg, t1, t2];
    this.bannerObjs.forEach(o => { o.alpha = 0; o.y -= 20; });
    this.tweens.add({ targets: this.bannerObjs, alpha: 1, y: '+=20', duration: 180 / speed, ease: 'power2.out' });
    this.time.delayedCall(1400 / speed, () => this.tweens.add({ targets: this.bannerObjs, alpha: 0, duration: 250 / speed }));
  }
  number(x, y, text, color, size = 34) {
    const t = this.add.text(x, y, text, { fontFamily: '"Black Han Sans", "Do Hyeon", sans-serif', fontSize: size + 'px', color, stroke: '#17253A', strokeThickness: 7 }).setOrigin(.5).setDepth(60);
    this.tweens.add({ targets: t, y: y - 70, alpha: { from: 1, to: 0 }, scale: { from: .6, to: 1.15 }, duration: 950, ease: 'cubic.out', onComplete: () => t.destroy() });
  }
  flash(color, alpha, dur) { this.flashRect.setFillStyle(color, alpha); this.tweens.add({ targets: this.flashRect, fillAlpha: 0, duration: dur }); }
  shake(dur, intensity) { if (!reduceMotion) this.cameras.main.shake(dur, intensity); }
  top(sp) { return sp.y - sp.displayHeight; }
  mid(sp) { return sp.y - sp.displayHeight * .5; }
  /** speech bubble above a unit (anime-style, 1 line) */
  say(sp, text, ms = 1100, color = '#24405F') {
    const x = sp.x, y = this.top(sp) - 26;
    const t = this.add.text(0, 0, text, { fontFamily: '"Jua", sans-serif', fontSize: '22px', color }).setOrigin(.5).setDepth(66);
    const w = t.width + 26, h = t.height + 14;
    const g = this.add.graphics().setDepth(65);
    g.fillStyle(0xffffff, .96); g.lineStyle(3, 0x24405F, 1);
    g.fillRoundedRect(x - w / 2, y - h, w, h, 12); g.strokeRoundedRect(x - w / 2, y - h, w, h, 12);
    g.fillTriangle(x - 8, y - 1, x + 8, y - 1, x, y + 10); g.lineStyle(3, 0x24405F, 1); g.lineBetween(x - 8, y - 1, x, y + 10); g.lineBetween(x + 8, y - 1, x, y + 10);
    g.fillStyle(0xffffff, 1); g.fillRect(x - 7, y - 4, 14, 4);
    t.setPosition(x, y - h / 2);
    const objs = [g, t]; objs.forEach(o => { o.alpha = 0; o.scale = .6; });
    this.tweens.add({ targets: objs, alpha: 1, scale: 1, duration: 160, ease: 'back.out(2)' });
    this.time.delayedCall(ms, () => this.tweens.add({ targets: objs, alpha: 0, y: '-=12', duration: 200, onComplete: () => objs.forEach(o => o.destroy()) }));
  }
  /** big centre-stage callout: 콤보, 격노, 가드 */
  callout(text, color = '#FFD54A', sub = '') {
    const t = this.add.text(W / 2, H * .36, text, { fontFamily: '"Black Han Sans", "Jua", sans-serif', fontSize: '72px', color, stroke: '#24405F', strokeThickness: 10 }).setOrigin(.5).setDepth(80).setAngle(-5);
    const s2 = sub ? this.add.text(W / 2, H * .36 + 54, sub, { fontFamily: '"Jua", sans-serif', fontSize: '26px', color: '#fff', stroke: '#24405F', strokeThickness: 6 }).setOrigin(.5).setDepth(80) : null;
    const objs = s2 ? [t, s2] : [t];
    objs.forEach(o => { o.alpha = 0; o.scale = 2.2; });
    this.tweens.add({ targets: objs, alpha: 1, scale: 1, duration: 220, ease: 'back.out(2.5)' });
    this.tweens.add({ targets: objs, alpha: 0, y: '-=40', duration: 300, delay: 900, onComplete: () => objs.forEach(o => o.destroy()) });
  }
  /** guard window: a big button over the arena; resolves true if tapped in time */
  guardWindow(ms) {
    return new Promise(res => {
      const btn = $('#guardBtn'); if (!btn || reduceMotion) { res(false); return; }
      let done = false; btn.hidden = false; btn.classList.remove('hit'); btn.style.setProperty('--ms', ms + 'ms'); void btn.offsetWidth; btn.classList.add('arm');
      const finish = ok => { if (done) return; done = true; btn.hidden = true; btn.classList.remove('arm'); btn.onclick = null; res(ok); };
      btn.onclick = () => { btn.classList.add('hit'); finish(true); };
      setTimeout(() => finish(false), ms);
    });
  }
  /** hero takes a hit: hurt pose, red flash, knock-back, small burst */
  hurt(s, d, loss, mag) {
    s.setTint(0xff8a8a); this.act(s, 'hurt', d(520)).then(() => s.clearTint());
    this.tweens.add({ targets: s, x: s.home.x - 26, duration: d(80), yoyo: true, repeat: 1, ease: 'power1.out', onComplete: () => { s.x = s.home.x; } });
    this.fx('burst', s.x + 30, this.mid(s), 110 + 80 * mag, { spin: 20 });
    this.number(s.x, this.top(s) - 10, '-' + Math.max(1, loss), '#FF6B6B', 28 + 24 * Math.min(1, loss / 40));
    this.emitter.explode(6 + Math.round(10 * mag), s.x, this.mid(s));
  }
  /** Plays one engine turn. speed >= 1 shortens every duration. */
  async playTurn(turn, speed = 1, hooks = {}) {
    const d = ms => Math.max(30, ms / speed);
    const boss = this.sprites.boss, ret = turn.boss.portfolioRet;
    const mag = Math.min(1, Math.abs(ret) / 1.5);
    const moves = BOSS_MOVES[currentTape.bossSpecies] || BOSS_MOVES.minotaur;
    const bossMove = moves[turn.bar % moves.length];
    this.banner(turn.label, hooks.news ? `속보 · ${hooks.news}` : ret < 0 ? `${currentTape.boss}의 ${bossMove} · 파티 ${fmtPct(ret)}` : `모험단의 반격 · 파티 ${fmtPct(ret)}`, ret < 0 ? '#FF9A94' : '#FFD54A', speed);
    await sleep(d(200));
    await hooks.onMarket?.();   // the chart moves first; the characters answer the market
    await sleep(d(120));
    if (ret < 0) {
      // boss attack: wind-up squash, lunge toward the party, attack pose + species VFX, impact on party
      sfx.roar();
      if (mag > .5) this.say(boss, bossMove + '!', 900, '#B9343C');
      boss.idleTw?.forEach(t => t.remove()); boss.idleTw = [];
      // guard window opens with the wind-up; a tap in time = 가드 (경험치 보너스, 수익률은 그대로)
      const guardP = (speed < 4 && hooks.onGuard) ? this.guardWindow(Math.round(d(900))) : Promise.resolve(false);
      await this.tw({ targets: boss, scaleX: boss.home.s * 1.08, scaleY: boss.home.s * .9, duration: d(240), ease: 'sine.out' });
      await this.tw({ targets: boss, x: boss.home.x - 150 - 90 * mag, scaleX: boss.home.s, scaleY: boss.home.s, duration: d(260), ease: 'power2.in' });
      const swing = this.act(boss, 'attack', d(620));
      await sleep(d(160));
      const guarded = await guardP;
      if (guarded) { const tk = this.sprites.tank.dead ? this.sprites.dealer : this.sprites.tank; this.fx('shield', 470, 520, 360, { inMs: 80, hold: 420, outMs: 240, depth: 46 }); this.callout('가드!', '#9FE8FF', '타이밍 성공 · 경험치 보너스'); this.say(tk, '막았다!', 900); sfx.shield(); hooks.onGuard?.(); }
      const st = boss.style, hitX = 470, hitY = 520;
      if (st.fx === 'slash') this.fx('slash', hitX + 40, hitY - 40, 300 + 120 * mag, { flipX: true, angle: -20, spin: -15, tint: st.tint });
      else if (st.fx === 'bolt') { this.fx('bolt', hitX + 20, hitY - 140, 320, { angle: 25, spin: 0, inMs: 60, hold: 200 }); this.fx('bolt', hitX - 120, hitY - 60, 220, { angle: -15, inMs: 90, hold: 180 }); }
      else { const ball = this.add.image(boss.x - 140, this.mid(boss), 'fx_burst').setDepth(44).setScale(.25).setTint(st.tint); await this.tw({ targets: ball, x: hitX + 40, y: hitY - 40, scale: .55, duration: d(170), ease: 'power1.in', onComplete: () => ball.destroy() }); this.fx('burst', hitX + 40, hitY - 40, 300 + 140 * mag, { spin: 30, grow: 1.5 }); }
      this.shake(d(300), .004 + .016 * mag); if (mag > .4) this.flash(0xff4d4d, .12 + .2 * mag, d(300)); (mag > .5 ? sfx.bigHit : sfx.hit)();
      ROLES.forEach((role, i) => {
        const r = turn.roles[role], s = this.sprites[role];
        if (s.dead) return;
        if (r.ret < 0) this.time.delayedCall(d(50 * i), () => this.hurt(s, d, Math.round(r.hpBefore - r.hpAfter), mag));
        else if (r.ret > 0) this.time.delayedCall(d(140), () => { this.fx('heal', s.x, this.mid(s), 120, { hold: 200, grow: 1.1 }); this.number(s.x, this.top(s) - 10, '+' + Math.max(1, Math.round(r.hpAfter - r.hpBefore)), '#5FE39A', 24); });
      });
      hooks.onImpact?.();
      await swing;
      await this.tw({ targets: boss, x: boss.home.x, duration: d(360), ease: 'power2.out' });
      this.idle(boss);
    } else {
      // party attack: each gaining role strikes in turn; boss takes the portfolio gain
      const attackers = ROLES.filter(r => turn.roles[r].ret > 0 && !this.sprites[r].dead);
      const target = { x: boss.home.x - 40, y: this.mid(boss) };
      const LINES = { tank: ['방패 돌격!', '내 차례!'], dealer: ['간다!', '한 방 더!', '베어버린다!'], healer: ['빛이여!', '모두 힘내!'], support: ['조준… 발사!', '맞아라!'] };
      if (attackers.length) { const lead = attackers[0]; this.say(this.sprites[lead], LINES[lead][turn.bar % LINES[lead].length], 900); }
      if (hooks.combo >= 3) this.time.delayedCall(d(300), () => this.callout(`${hooks.combo}연속!`, '#FFD54A', ''));
      for (let i = 0; i < attackers.length; i++) {
        const role = attackers[i], s = this.sprites[role], r = turn.roles[role];
        const str = Math.min(1, r.ret / 1.2), kind = ATTACK_KIND[role];
        s.idleTw?.forEach(t => t.remove()); s.idleTw = [];
        if (kind === 'melee') {
          await this.tw({ targets: s, scaleY: s.home.s * .9, scaleX: s.home.s * 1.06, duration: d(90) });
          await this.tw({ targets: s, x: boss.home.x - 230, y: boss.home.y - 10, scaleX: s.home.s, scaleY: s.home.s, duration: d(170), ease: 'power2.in' });
        }
        const anim = this.act(s, 'attack', d(kind === 'melee' ? 420 : 520));
        await sleep(d(kind === 'melee' ? 120 : 220));
        if (kind === 'melee') { sfx.slash(); this.fx('slash', target.x, target.y, 260 + 120 * str, { angle: 10, spin: 25, tint: ROLE_HEX[role] }); }
        else if (kind === 'shoot') { sfx.slash(); const arrow = this.add.rectangle(s.x + 60, this.mid(s) - 10, 70, 6, 0xF2C14E).setDepth(44).setAngle(-8); await this.tw({ targets: arrow, x: target.x, y: target.y, duration: d(150), ease: 'power1.in', onComplete: () => arrow.destroy() }); this.fx('star', target.x, target.y, 150 + 80 * str, { spin: 90 }); }
        else { sfx.crit(); this.fx('heal', s.x, this.mid(s) - 20, 170, { hold: 260, grow: 1.15 }); const orb = this.add.circle(s.x + 50, this.mid(s) - 40, 14, 0x7FE3D1).setDepth(44); await this.tw({ targets: orb, x: target.x, y: target.y, duration: d(200), ease: 'sine.in', onComplete: () => orb.destroy() }); this.fx('bolt', target.x, target.y - 40, 200 + 100 * str, { angle: 15, tint: 0x9FE8FF }); }
        this.emitter.explode(8 + Math.round(14 * str), target.x, target.y);
        boss.setTint(0xffffff); this.act(boss, 'hurt', d(380)).then(() => boss.clearTint());
        this.tweens.add({ targets: boss, x: boss.home.x + 18, duration: d(70), yoyo: true, repeat: 1, onComplete: () => { boss.x = boss.home.x; } });
        this.number(boss.home.x, this.top(boss) - 20, '+' + fmtPct(r.ret * r.weight / 100).replace('+', '').replace('%', ''), '#FFD54A', 26 + 26 * str);
        if (i === 0) hooks.onImpact?.();
        await anim;
        if (kind === 'melee') this.tw({ targets: s, x: s.home.x, y: s.home.y, duration: d(220), ease: 'power2.out' }).then(() => this.idle(s));
        await sleep(d(80));
      }
      ROLES.filter(r => turn.roles[r].ret < 0 && !this.sprites[r].dead).forEach(role => { const s = this.sprites[role]; s.setTint(0xffb0b0); this.time.delayedCall(d(220), () => s.clearTint()); this.number(s.x, this.top(s) - 10, '-' + Math.max(1, Math.round(turn.roles[role].hpBefore - turn.roles[role].hpAfter)), '#ff9b9b', 22); });
      if (attackers.length === 0) hooks.onImpact?.();
      if (ret >= 1) { this.shake(d(200), .005); sfx.crit(); for (let k = 0; k < 2; k++) this.fx('star', boss.home.x - 120 + k * 200, this.top(boss) + 60 + k * 120, 90, { spin: 60, hold: 200 + k * 80 }); }
      await sleep(d(260));
    }
    // 격노: the boss crosses half HP for the first time — darker tint, red aura, one-time callout
    if (hooks.rageNow) { sfx.roar(); this.shake(d(350), .012); this.flash(0xB9343C, .35, d(400)); boss.setTint(0xffb0a0); this.callout('격노!', '#FF8A80', `${currentTape.boss}의 HP가 절반 아래로`); this.say(boss, '아직이다!', 1200, '#B9343C'); await sleep(d(600)); boss.clearTint(); boss.rage = true; }
    // shields and faints
    const shielded = ROLES.filter(role => { const r = turn.roles[role]; return r.shield > 0 && r.hpAfter >= 100 && r.ret > 0 && !this.sprites[role].dead; });
    if (shielded.length) { const s0 = this.sprites[shielded[0]]; this.fx('shield', s0.x, this.mid(s0), s0.displayHeight * .9, { inMs: 160, hold: 320, outMs: 260, grow: 1.08, depth: 30 }); sfx.shield(); }
    ROLES.forEach(role => {
      const r = turn.roles[role], s = this.sprites[role];
      if (r.fainted && !s.dead) { s.dead = true; sfx.faint(); s.idleTw?.forEach(t => t.remove()); this.pose(s, 'hurt'); s.setTint(0xaab0c0); this.tweens.add({ targets: s, angle: -80, x: s.home.x - 40, alpha: .75, duration: d(500), ease: 'bounce.out' }); }
    });
    await sleep(d(200));
  }
  async bossDefeated(speed = 1) {
    const b = this.sprites.boss; sfx.win(); this.shake(400 / speed, .01); this.flash(0xffffff, .8, 600 / speed);
    b.dead = true; b.idleTw?.forEach(t => t.remove()); this.pose(b, 'hurt');
    this.tweens.add({ targets: b, angle: 12, duration: 90 / speed, yoyo: true, repeat: 5 });
    for (let i = 0; i < 6; i++) { this.emitter.explode(24, b.home.x - 120 + Math.random() * 240, this.top(b) + Math.random() * b.displayHeight); this.fx('star', b.home.x - 160 + Math.random() * 320, this.top(b) + Math.random() * b.displayHeight, 80 + Math.random() * 80, { spin: 120, hold: 150 }); await sleep(110 / speed); }
    // creature-collector style faint: drop down and fade out
    await this.tw({ targets: b, y: b.home.y + 120, alpha: 0, scaleY: b.home.s * .7, duration: 800 / speed, delay: 300 / speed, ease: 'sine.in' });
  }
  async partyWiped(speed = 1) { sfx.lose(); this.flash(0x000000, .6, 900 / speed); await sleep(900 / speed); }
}

let game = null, scene = null;
async function ensureGame() {
  if (game) return scene;
  try { await Promise.all([document.fonts.load('20px "Do Hyeon"'), document.fonts.load('20px "Black Han Sans"'), document.fonts.load('16px "Noto Sans KR"')]); } catch {}
  game = new Phaser.Game({ type: Phaser.AUTO, parent: 'arena', width: W, height: H, backgroundColor: '#BFE1F7', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [BattleScene], render: { antialias: true, pixelArt: false } });
  scene = game.scene.getScene('battle');
  while (!scene?.ready) { await sleep(30); scene = game.scene.getScene('battle'); }
  if (scene.ready === 'failed') throw new Error('전장 에셋(assets/anime)을 불러오지 못했습니다. 페이지를 새로고침하거나 네트워크를 확인해 주세요.');
  return scene;
}

/* ------------------------------------------------------------------ */
/* Cut-in (webtoon panel)                                              */
/* ------------------------------------------------------------------ */
function cutIn({ text, sub, bg, artL, artR, hit }, speed = 1) {
  return new Promise(res => {
    const c = $('#cutin'); c.hidden = false; c.style.setProperty('--cut-bg', bg);
    $('#cutText').textContent = text; $('#cutSub').textContent = sub || '';
    const L = $('#cutArtL'), R = $('#cutArtR'); L.hidden = !artL; R.hidden = !artR; if (artL) L.src = artL; if (artR) R.src = artR;
    sfx.cutin();
    const tl = gsap.timeline({ onComplete: () => { c.hidden = true; res(); } }); tl.timeScale(speed);
    tl.fromTo('#cutin .band', { scaleY: 0 }, { scaleY: 1, duration: .16, ease: 'power3.out' })
      .fromTo('#cutin .lines', { opacity: 0, rotate: 0 }, { opacity: 1, rotate: 25, duration: 1.1, ease: 'none' }, 0)
      .fromTo(L, { opacity: 0, x: -120 }, { opacity: 1, x: 0, duration: .22, ease: 'power3.out' }, .08)
      .fromTo(R, { opacity: 0, x: 120 }, { opacity: 1, x: 0, duration: .22, ease: 'power3.out' }, .08)
      .fromTo('#cutText', { opacity: 0, scale: 2.4, rotate: -6 }, { opacity: 1, scale: 1, rotate: -6, duration: .28, ease: 'back.out(2.5)' }, .18)
      .fromTo('#cutSub', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .2 }, .4);
    if (hit && !reduceMotion) tl.fromTo(L, { x: -10, rotate: -4 }, { x: 10, rotate: 4, duration: .05, repeat: 7, yoyo: true }, .3);
    tl.to({}, { duration: .75 })
      .to('#cutin .band, #cutin .lines, #cutin .art, #cutText, #cutSub', { opacity: 0, duration: .18 });
  });
}
function cutForTurn(turn) {
  const cut = turn.cut; if (!cut) return null;
  const sub = `${fmtBar(turn.t)} ${turn.label} · 파티 ${fmtPct(turn.boss.portfolioRet)}`;
  const bossArt = cutArt(bossUnit(currentTape.bossSpecies)), roleArt = cutArt(heroUnit(cut.role)), hurtArt = cutArt(heroUnit(cut.role), true);
  if (cut.kind === 'critical_hit') return { text: cut.text, sub, bg: '#B9343C', artL: hurtArt, artR: bossArt, hit: true };
  if (cut.kind === 'role_crushed') return { text: cut.text, sub, bg: '#8E3A7C', artL: hurtArt, artR: bossArt, hit: true };
  if (cut.kind === 'critical_deal') return { text: cut.text, sub, bg: '#1F9663', artL: roleArt, artR: null };
  return { text: cut.text, sub, bg: '#4C9A2E', artL: roleArt, artR: null };
}

function evolveCut(role) {
  const h = hero(role); sfx.level();
  return cutIn({ text: '전직!', sub: `${jobOf(role)} → ${charOf(role).name}`, bg: BRANCH_COLOR[h.branch], artL: cutArt(heroUnit(role)), artR: null }, 1);
}

/* ---------- VS intro: party vs boss, 1.6s ---------- */
function vsIntro(speed = 1) {
  return new Promise(res => {
    const v = $('#vs'); v.hidden = false;
    $('#vsParty').innerHTML = ROLES.map(r => `<img src="${cutArt(heroUnit(r))}" alt="${charOf(r).name}">`).join('');
    $('#vsPartyName').textContent = `${partyType(partyStats(party))[0]} 모험단`;
    $('#vsBoss').src = cutArt(bossUnit(currentTape.bossSpecies)); $('#vsBossName').textContent = currentTape.boss;
    $('#vsSub').textContent = `${currentTape.title} · ${fmtDate(currentTape.bars[0].t)}`;
    sfx.cutin();
    const tl = gsap.timeline({ onComplete: () => { v.hidden = true; res(); } }); tl.timeScale(speed);
    tl.fromTo('#vs .vs-l', { x: -200, opacity: 0 }, { x: 0, opacity: 1, duration: .35, ease: 'power3.out' })
      .fromTo('#vs .vs-r', { x: 200, opacity: 0 }, { x: 0, opacity: 1, duration: .35, ease: 'power3.out' }, 0)
      .fromTo('#vsMark', { scale: 3, opacity: 0, rotate: -20 }, { scale: 1, opacity: 1, rotate: -8, duration: .3, ease: 'back.out(2.5)' }, .25)
      .fromTo('#vsSub', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .25 }, .45)
      .to({}, { duration: .9 })
      .to('#vs > *', { opacity: 0, duration: .2 });
  });
}

/* ------------------------------------------------------------------ */
/* Battle flow                                                         */
/* ------------------------------------------------------------------ */
let battle = null, speed = 2, userPaused = false, aborted = false, resumeWaiters = [], skipping = false;
const speedFactor = () => skipping ? 8 : reduceMotion ? Math.max(4, speed) : speed;
$('#skipBtn').addEventListener('click', () => { skipping = true; $('#skipBtn').disabled = true; nextWaiter?.(); sfx.select(); toast('다음 체크포인트까지 빠르게'); });
// turn pacing: by default each turn waits for a tap ("다음 턴"), so the chart can be read; 자동 plays through
let autoMode = false, nextWaiter = null, justDecided = false;
function setAuto(v) { autoMode = v; $('#autoBtn').setAttribute('aria-pressed', String(v)); $('#autoBtn').textContent = v ? '자동 재생 중' : '자동 재생'; if (v) nextWaiter?.(); }
$('#autoBtn').addEventListener('click', () => { sfx.select(); setAuto(!autoMode); });
$('#nextBtn').addEventListener('click', () => { sfx.select(); nextWaiter?.(); });
document.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !$('#nextBtn').hidden && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); nextWaiter?.(); } });
function waitNext(label) {
  if (autoMode || skipping || justDecided) { justDecided = false; return Promise.resolve(); }
  return new Promise(r => { nextWaiter = () => { nextWaiter = null; $('#nextBtn').hidden = true; r(); }; $('#nextBtn').hidden = false; $('#nextBtn').querySelector('b').textContent = label; });
}

$$('.seg [data-speed]').forEach(b => b.addEventListener('click', () => { speed = +b.dataset.speed; $$('.seg [data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); sfx.select(); }));
$('#pauseBtn').addEventListener('click', () => { userPaused = !userPaused; $('#pauseBtn').textContent = userPaused ? '계속' : '일시정지'; if (!userPaused) { resumeWaiters.splice(0).forEach(r => r()); } sfx.select(); });
let abortArmed = 0;
$('#abortBtn').addEventListener('click', () => {
  if (Date.now() - abortArmed < 3000) { aborted = true; userPaused = false; clearInterval(cpTimer); $('#cp').hidden = true; nextWaiter?.(); resumeWaiters.splice(0).forEach(r => r()); $('#abortBtn').textContent = '레이드 포기'; stopBgm(); showScreen('select'); return; }
  abortArmed = Date.now(); $('#abortBtn').textContent = '정말 포기? (한 번 더)'; setTimeout(() => { $('#abortBtn').textContent = '레이드 포기'; }, 3000);
});
const waitResume = () => userPaused ? new Promise(r => resumeWaiters.push(r)) : Promise.resolve();

function hpClass(v) { return v > 50 ? '' : v > 20 ? 'mid' : 'low'; }
/** after each hit: the stat a hero just showed pops up over its card (same icons as the choices) */
function popStats(turn) {
  if (reduceMotion) return;
  const mkt = turn.boss.portfolioRet;
  ROLES.forEach((role, i) => {
    const r = turn.roles[role]?.ret; if (r === undefined) return;
    const st = skillStats(battle.party._bySkill[battle.party.skills[role]]);
    let k = null;
    if (r > 0.05) k = STAT_KEYS.slice().sort((a, b) => st[b] - st[a])[0];
    else if (mkt < 0 && r >= -0.05) k = ['def', 'ins', 'stab'].sort((a, b) => st[b] - st[a])[0];
    if (!k) return;
    const card = $('#phud-' + role); if (!card) return;
    const el = document.createElement('span'); el.className = 'statpop'; el.innerHTML = statIcon(k, 22) + '<b>+1</b>';
    el.style.color = STAT_COLOR[k]; el.style.animationDelay = (i * 90) + 'ms'; card.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  });
}
function renderPartyHud(turn) {
  const s = battle;
  $('#partyhud').innerHTML = ROLES.map(role => {
    const sk = s.party._bySkill[s.party.skills[role]], hp = s.partyHp[role], sh = s.shield[role];
    const r = turn?.roles[role]?.ret;
    const h = hero(role);
    return `<div class="phud ${hp <= 0 ? 'dead' : ''} ${h.branch ? 'evo' : ''}" id="phud-${role}" style="--rc:${ROLE_COLOR[role]};--bc:${h.branch ? BRANCH_COLOR[h.branch] : 'transparent'}">
      <div class="t"><img src="${portrait(heroUnit(role))}" alt=""><b>${charOf(role).name}</b><small>${heroTitle(role)}</small>${r === undefined ? '' : `<span class="delta ${r >= 0 ? 'up' : 'down'}">${fmtPct(r)}</span>`}</div>
      <div class="hp"><i class="${hpClass(hp)}" style="width:${hp}%"></i><em style="width:${Math.min(100, sh)}%"></em></div>
      <div class="num"><span>${skillStatChips(sk)}<b>${sk.name}</b> ${s.party.weights[role]}%</span><b class="tabular">${fmtKRW(roleValue(role))}</b></div></div>`;
  }).join('');
}
function renderBossHud() {
  $('#hBossName').textContent = (drama.rage && battle.bossHp > 0 ? '격노한 ' : '') + currentTape.boss; $('#hBossPf').src = portrait(bossUnit(currentTape.bossSpecies));
  $('#hBossHp').style.width = battle.bossHp + '%'; $('#hBossHpTxt').textContent = Math.round(battle.bossHp);
  const goal = SEED * (1 + 1 / battle.bossScale);
  $('#hBreak').innerHTML = battle.bossHp <= 0 ? `${ICON.skull} 격파!` : `${ICON.coin} 격파까지 ${fmtKRW(Math.max(0, goal - totalValue()))}`;
  const cps = currentTape.checkpoints || [], passed = cps.filter(c => c.bar <= battle.bar).length;
  $('#hPhase').innerHTML = `<span>페이즈 ${Math.min(passed + 1, cps.length + 1)}/${cps.length + 1}</span>` + Array.from({ length: cps.length + 1 }, (_, i) => `<i class="${i < passed ? 'done' : i === passed ? 'now' : ''}"></i>`).join('');
}
function renderTurnLine(turn) {
  const renderBalance = () => {
    const c = battle.equity - 100, v = totalValue(), el = $('#hMoney');
    const from = +(el.dataset.v || SEED); el.dataset.v = v;
    const o = { v: from }; gsap.to(o, { v, duration: reduceMotion ? 0 : .6, ease: 'power2.out', onUpdate: () => { el.textContent = fmtKRW(o.v); } });
    if (v !== from && !reduceMotion) gsap.fromTo(el, { scale: 1.08 }, { scale: 1, duration: .35, ease: 'back.out(3)' });
    $('#hMoneyD').textContent = `${fmtKRWd(v - SEED)} (${fmtPct(c)})`; $('#hMoneyD').className = 'ret tabular ' + (c >= 0 ? 'up' : 'down');
  };
  if (!turn) { $('#hLabel').textContent = `${fmtBar(currentTape.bars[0].t)} ${currentTape.bars[0].label}`; $('#hTime').textContent = ''; $('#hRet').textContent = '0.00%'; $('#hRet').className = 'ret tabular'; renderBalance(); return; }
  $('#hLabel').textContent = turn.label; $('#hTime').textContent = `${fmtBar(turn.t)} ${unitNote()}`;
  const r = turn.boss.portfolioRet; $('#hRet').textContent = fmtPct(r); $('#hRet').className = 'ret tabular ' + (r >= 0 ? 'up' : 'down');
  renderBalance();
}

/* ------------------------------------------------------------------ */
/* Battle chart — the centre of every turn. One class, three views:                       */
/*   price   : the raid's main instrument, real closes (what a brokerage user recognises)  */
/*   compare : every instrument the party has equipped, % from raid start                 */
/*   equity  : party % vs default party, boss HP area, 격파선                               */
/* A transparent "ghost" series spans the whole raid so the axis always shows the full     */
/* timeline (past, now, hidden future) and carries the checkpoint / action markers.        */
/* ------------------------------------------------------------------ */
const INS_COLORS = ['#C8921A', '#2F6BD0', '#2E9A58', '#7458C9', '#D6453F', '#5B7693'];
const mainInstrument = tape => (tape.skills.find(k => k.role === 'dealer' && k.default) || tape.skills[0]).instrument;
// intraday: shift so the axis prints KST clock times; daily: plain UTC date of the New York close
const tsOf = (iso, tape) => Math.floor(Date.parse(iso) / 1000) + (tape?.daily ? 0 : 9 * 3600);
const fmtMoney = (v, cur) => cur === 'KRW' ? Math.round(v).toLocaleString('ko-KR') + '원' : '$' + v.toFixed(2);
const easeOut = t => 1 - Math.pow(1 - t, 3);

class BattleChart {
  /** @param mode 'price' | 'compare' | 'equity'  @param opts { ids, state, upto, height } */
  constructor(container, tape, mode, opts = {}) {
    this.tape = tape; this.mode = mode; this.container = container; this.state = opts.state || null; this.quiet = !!opts.quiet; this.futureShade = !!opts.futureShade;
    this.ids = mode === 'price' ? [opts.main || mainInstrument(tape)] : mode === 'compare' ? (opts.ids || [mainInstrument(tape)]) : [];
    this.upto = opts.upto ?? 0;
    const withLeft = false;
    this.c = LightweightCharts.createChart(container, {
      autoSize: true, layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#5A5244', fontFamily: '"Noto Sans KR", sans-serif', fontSize: 13 },
      grid: { vertLines: { visible: false }, horzLines: { color: '#EFE8D6', style: 0 } },
      rightPriceScale: { borderColor: '#D9CDAE', scaleMargins: { top: .18, bottom: .2 }, ticksVisible: false, minimumWidth: 74 }, leftPriceScale: { visible: withLeft, borderColor: '#D9CDAE', scaleMargins: { top: .06, bottom: 0 } },
      timeScale: { borderColor: '#D9CDAE', timeVisible: !tape.daily, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, rightOffset: 0, ticksVisible: false, visible: !opts.noTime },
      crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } }, handleScroll: false, handleScale: false, localization: { locale: 'ko-KR', dateFormat: 'MM-dd' },
    });
    const pct = { type: 'custom', formatter: v => fmtPct(v), minMove: .01 };
    const cur = tape.instruments[this.ids[0]]?.currency || 'USD';
    const money = { type: 'custom', formatter: v => fmtMoney(v, cur), minMove: .01 };
    // ghost: full timeline, invisible, excluded from autoscale, carries markers
    const wonFmt = { type: 'custom', formatter: v => (v / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '만', minMove: 1000 };
    this.ghost = this.c.addLineSeries({ color: 'rgba(0,0,0,0)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null, priceFormat: mode === 'price' ? money : pct });
    this.series = [];
    if (mode === 'equity') {
      // one chart: my return vs the default party's return, both in %, with the 0 line and the 격파선
      this.bm = this.c.addLineSeries({ color: '#9AA0AA', lineWidth: 2, lineStyle: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: pct });
      this.eq = this.c.addAreaSeries({ lineColor: '#E0A72E', topColor: 'rgba(224,167,46,.30)', bottomColor: 'rgba(224,167,46,0)', lineWidth: 4, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: pct });
      this.series = [this.eq, this.bm];
      const breakPct = this.state ? 100 / this.state.bossScale : 100 / (tape.scale?.bossHpPerPct || 40);
      if (!chartMode()) this.eq.createPriceLine({ price: breakPct, color: '#D6453F', lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: '보스 격파' });
      this.eq.createPriceLine({ price: 0, color: '#8E8676', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '' });
      this.eq.applyOptions({ autoscaleInfoProvider: orig => { const r = orig(); if (!r) return r; const span = Math.max(r.priceRange.maxValue - r.priceRange.minValue, .6); const mid = (r.priceRange.maxValue + r.priceRange.minValue) / 2; return { priceRange: { minValue: Math.min(mid - span / 2, -span * .1), maxValue: Math.max(mid + span / 2, span * .1) }, margins: r.margins }; } });
    } else {
      this.lines = this.ids.map((id, i) => (mode === 'price' && i === 0)
        ? this.c.addAreaSeries({ lineColor: '#E0A72E', topColor: 'rgba(224,167,46,.28)', bottomColor: 'rgba(224,167,46,0)', lineWidth: 4, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: money })
        : this.c.addLineSeries({ color: INS_COLORS[i % INS_COLORS.length], lineWidth: i === 0 ? 4 : 3, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: mode === 'price' ? money : pct }));
      this.series = this.lines;
      if (mode === 'price') this.lines[0].createPriceLine({ price: tape.bars[0].prices[this.ids[0]], color: '#B9AE91', lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: '시작' });
      else this.lines[0].createPriceLine({ price: 0, color: '#B9AE91', lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: '' });
    }
    this.draw();
  }
  t(i) { return tsOf(this.tape.bars[i].t, this.tape); }
  /** value of a series at bar i (from the tape, or from battle history for equity) */
  valueAt(kind, i) {
    const b = this.tape.bars[i];
    if (kind === 'eq' || kind === 'bm') {
      if (i === 0) return 0;
      const h = this.state?.history.find(p => p.bar === i); if (!h) return null;
      return (kind === 'eq' ? h.equity : h.benchmark) - 100;
    }
    const p = b.prices[kind]; return this.mode === 'price' ? p : 100 * (p / this.tape.bars[0].prices[kind] - 1);
  }
  kinds() { return this.mode === 'equity' ? ['eq', 'bm'] : this.ids; }
  draw() {
    const n = this.tape.bars.length, up = Math.min(this.upto, n - 1);
    const ghostVal = this.mode === 'price' ? this.tape.bars[0].prices[this.ids[0]] : 0;
    this.ghost.setData(this.tape.bars.map((b, i) => ({ time: this.t(i), value: ghostVal })));
    this.kinds().forEach((k, j) => {
      const pts = []; for (let i = 0; i <= up; i++) { const v = this.valueAt(k, i); if (v !== null && v !== undefined) pts.push({ time: this.t(i), value: v }); }
      this.series[j].setData(pts);
    });
    this.markers(); this.c.timeScale().fitContent();
  }
  markers() {
    const up = this.upto, cps = this.tape.checkpoints || [], acts = this.state?.actions || [];
    const m = [];
    if (this.futureShade) this.shadeFuture();
    if (this.quiet) { this.ghost.setMarkers([]); return; }
    cps.forEach(cp => { if (cp.bar > up) m.push({ time: this.t(cp.bar), position: 'inBar', color: '#7458C9', shape: 'circle', text: '', size: 1.4 }); });
    acts.filter(a => a.type !== 'hold').forEach(a => m.push({ time: this.t(a.at), position: 'belowBar', color: '#C8921A', shape: 'arrowUp', text: a.type === 'equip' ? '교체' : '비중' }));
    if (up > 0 && up < this.tape.bars.length - 1) m.push({ time: this.t(up), position: 'aboveBar', color: '#24405F', shape: 'arrowDown', text: '지금' });
    if (this.state) (this.state.log || []).forEach(h => { const r = h.boss.portfolioRet; if (h.bar < up && Math.abs(r) >= 1) m.push({ time: this.t(h.bar), position: r < 0 ? 'aboveBar' : 'belowBar', color: r < 0 ? '#D6453F' : '#2E9A58', shape: r < 0 ? 'arrowDown' : 'arrowUp', text: fmtPct(r) }); });
    m.sort((a, b) => a.time - b.time);
    this.ghost.setMarkers(m);
  }
  /** grey hatched overlay over the bars not yet revealed, with a "?" — what the player is deciding about */
  shadeFuture() {
    const el = this.container;
    if (!this.shadeEl) { el.style.position = 'relative'; this.shadeEl = document.createElement('div'); this.shadeEl.className = 'future-shade'; if (this.c.options().timeScale.visible === false) this.shadeEl.style.bottom = '0'; this.shadeEl.innerHTML = '<span>?</span><small>아직 모름</small>'; el.appendChild(this.shadeEl); this.ro = new ResizeObserver(() => this.shadeFuture()); this.ro.observe(el); }
    requestAnimationFrame(() => { const x = this.c.timeScale().timeToCoordinate(this.t(Math.min(this.upto, this.tape.bars.length - 1))); const W = el.clientWidth - (this.c.priceScale('right').width() || 60); if (x === null || this.upto >= this.tape.bars.length - 1) { this.shadeEl.style.display = 'none'; return; } this.shadeEl.style.display = ''; this.shadeEl.style.left = Math.round(x) + 'px'; this.shadeEl.style.width = Math.max(0, Math.round(W - x)) + 'px'; });
  }
  setUpto(upto) { this.upto = upto; this.draw(); }
  /** animate the newest bar growing from the previous value — the "market moves" beat of a turn */
  reveal(bar, ms = 420) {
    return new Promise(res => {
      this.upto = bar;
      const kinds = this.kinds();
      const from = kinds.map(k => this.valueAt(k, bar - 1)), to = kinds.map(k => this.valueAt(k, bar));
      const time = this.t(bar), start = performance.now();
      const frame = now => {
        const p = Math.min(1, (now - start) / ms), e = easeOut(p);
        kinds.forEach((k, j) => { if (to[j] === null || from[j] === null) return; this.series[j].update({ time, value: from[j] + (to[j] - from[j]) * e }); });
        if (p < 1) requestAnimationFrame(frame); else { this.markers(); this.c.timeScale().fitContent(); res(); }
      };
      requestAnimationFrame(frame);
    });
  }
  legend() {
    const up = Math.min(this.upto, this.tape.bars.length - 1);
    if (this.mode === 'equity') { const h = this.state?.history.find(p => p.bar === up); const eq = h ? h.equity - 100 : 0, bm = h ? h.benchmark - 100 : 0;
      const goal = this.state ? 100 / this.state.bossScale : 100 / (this.tape.scale?.bossHpPerPct || 40);
      return `<span><i style="background:#E0A72E"></i>${chartMode() ? '내 포트폴리오' : '내 파티'} <b class="ret tabular ${eq >= 0 ? 'up' : 'down'}">${fmtPct(eq)}</b> <span class="muted tabular">(${fmtKRW(SEED * (1 + eq / 100))})</span></span><span><i style="background:#9AA0AA"></i>시장 ${benchmarkOf(this.tape)} <b class="tabular">${fmtPct(bm)}</b></span>${chartMode() ? '' : `<span><i style="background:#D6453F"></i>격파 ${fmtPct(goal)}</span>`}`; }
    return this.ids.map((id, i) => { const p0 = this.tape.bars[0].prices[id], p = this.tape.bars[up].prices[id], ins = this.tape.instruments[id];
      return `<span><i style="background:${INS_COLORS[i % INS_COLORS.length]}"></i>${id} ${ins.name} <b class="tabular">${fmtMoney(p, ins.currency)}</b> <span class="${p >= p0 ? 'ret up' : 'ret down'} tabular" style="font-size:12px">${fmtPct(100 * (p / p0 - 1))}</span></span>`; }).join('');
  }
  remove() { try { this.ro?.disconnect(); this.shadeEl?.remove(); this.c.remove(); } catch {} }
}

// Two panes, always both visible, same timeline: the real price on top, my money below (brokerage-app layout).
let battleChart = null, battleChartEq = null;
function battleInstruments() { return [...new Set([mainInstrument(currentTape), ...ROLES.map(r => battle.party._bySkill[battle.party.skills[r]]).flatMap(k => k.blend ? Object.keys(k.blend) : [k.instrument])])].slice(0, 6); }
function rebuildBattleChart() {
  battleChart?.remove(); battleChartEq?.remove(); battleChart = null;
  const upto = battle.history.length ? battle.history.at(-1).bar : 0;
  battleChartEq = new BattleChart($('#chartEq'), currentTape, 'equity', { state: battle, upto, quiet: true, futureShade: true });
  renderChartLegends();
}
function renderChartLegends() { $('#chartLegendEq').innerHTML = battleChartEq.legend(); }
function flashChart(ret) { const box = $('#battleChartBox'); box.classList.remove('flash-up', 'flash-down'); void box.offsetWidth; box.classList.add(ret >= 0 ? 'flash-up' : 'flash-down'); }

async function startBattle() {
  const errs = validateParty(party, currentTape); if (errs.length) { toast(errs[0]); return; }
  unlock(); sfx.select();
  $('#hMoney').dataset.v = SEED; $('#hMoney').textContent = fmtKRW(SEED);
  battle = createBattle(currentTape, party); aborted = false; userPaused = false; skipping = false; justDecided = false; nextWaiter = null; $('#nextBtn').hidden = true; $('#skipBtn').disabled = false; $('#pauseBtn').textContent = '일시정지';
  showScreen('battle');
  if (chartMode()) { renderBossHud(); renderPartyHud(); renderTurnLine(null); rebuildBattleChart(); renderNewsline(); await raidLoop(); return; }
  let sc; try { sc = await ensureGame(); } catch (e) { toast(e.message, 5000); try { game?.destroy(true); } catch {} game = null; scene = null; showScreen('party'); return; }
  game.scale.refresh();
  await sc.setup(currentTape);
  renderBossHud(); renderPartyHud(); renderTurnLine(null);
  rebuildBattleChart(); renderNewsline();
  $('#chartNote').textContent = currentTape.daily ? `${currentTape.bars.length - 1}거래일 · 일별 종가 · 실제 데이터` : `${currentTape.bars.length - 1}구간 · 30분~1시간 단위${currentTape.example ? ' · 예시 데이터' : ''}`;
  startBgm(.3);
  await vsIntro(Math.max(1, speedFactor() / 2));
  await sleep(200 / speedFactor());
  await raidLoop();
}
let drama = { combo: 0, maxCombo: 0, guards: 0, rage: false };
async function raidLoop() {
  drama = { combo: 0, maxCombo: 0, guards: 0, rage: false };
  while (!battle.done && !aborted) {
    await waitResume(); if (aborted) return;
    const nb = currentTape.bars[battle.bar + 1];
    if (nb && !battle.paused) await waitNext(chartMode() ? `다음 ▶ ${fmtBar(nb.t)}` : `다음 턴 ▶ ${fmtBar(nb.t)} ${nb.label}`);
    if (aborted) return;
    const turn = step(battle);
    if (!turn) { if (battle.paused) { skipping = false; $('#skipBtn').disabled = false; await showCheckpoint(battle.paused); continue; } break; }
    const sp = speedFactor();
    const ret = turn.boss.portfolioRet;
    drama.combo = ret > 0 ? drama.combo + 1 : 0; drama.maxCombo = Math.max(drama.maxCombo, drama.combo);
    const rageNow = !drama.rage && battle.bossHp > 0 && battle.bossHp <= 50; if (rageNow) drama.rage = true;
    if (chartMode()) { flashChart(ret); await battleChartEq.reveal(turn.bar, 520 / sp); renderChartLegends(); renderTurnLine(turn); renderPartyHud(turn); renderBossHud(); battleChartEq.markers(); continue; }
    await scene.playTurn(turn, sp, {
      combo: drama.combo, rage: drama.rage && !rageNow, rageNow,
      news: freshFact(turn.bar + 1),
      onMarket: async () => { flashChart(ret); await battleChartEq.reveal(turn.bar, 520 / sp); renderChartLegends(); renderTurnLine(turn); },
      onImpact: () => { renderPartyHud(turn); renderBossHud(); popStats(turn); },
      onGuard: () => { drama.guards++; },
    });
    battleChartEq.markers();
    const cut = cutForTurn(turn);
    if (cut && speed < 4 && !skipping) await cutIn(cut, sp);
    if (battle.bossHp <= 0 && !battle._bossShown) { battle._bossShown = true; startBgm(.8); }
  }
  if (aborted) return;
  skipping = false; $('#skipBtn').disabled = false;
  stopBgm();
  const r = battle.result;
  if (chartMode()) await sleep(200); else if (r.bossDown) await scene.bossDefeated(speedFactor()); else if (r.alive === 0) await scene.partyWiped(speedFactor()); else await sleep(400);
  showResult();
}

/* ---------- what is at stake: rough payoff preview per choice ----------
   Each instrument gets a rough sensitivity to the raid's main instrument (βup when the main rises, βdown when it falls).
   Preview = Σ weight × β × assumed move, in won. Deliberately simple and labelled "대략"; it shows the shape of the
   trade-off (symmetric / levered / insured), not a forecast. */
function betaOf(id) {
  const ins = currentTape.instruments[id], n = ins.name || '', k = ins.kind;
  if (id === mainInstrument(currentTape)) return { up: 1, down: 1 };
  if (k === 'cash') return { up: 0, down: 0 };
  if (k === 'future') return /매도/.test(n) ? { up: -5, down: -5 } : { up: 5, down: 5 };
  if (k === 'option' && /콜/.test(n)) return { up: 8, down: 3 };
  if (k === 'lev') { const x = /2배/.test(n) ? 2 : 3; return /인버스/.test(n) ? { up: -x, down: -x } : { up: x, down: x }; }
  if (k === 'option') return /인버스/.test(n) ? { up: -(/3배/.test(n) ? 3 : 1), down: -(/3배/.test(n) ? 3 : 1) } : { up: -3, down: -8 };   // put: premium melts on the way up, pays big on the way down
  if (/반도체/.test(n)) return { up: 1.8, down: 1.8 };
  if (/장기채|국고채/.test(n)) return { up: 0.3, down: 0.3 };
  if (/단기채/.test(n)) return { up: 0.05, down: 0.05 };
  if (/금/.test(n) && !/금리/.test(n)) return { up: 0.2, down: 0.1 };
  if (/배당/.test(n)) return { up: 0.6, down: 0.6 };
  return { up: 1, down: 1 };
}
function skillBeta(sk) { const parts = sk.blend ? Object.entries(sk.blend) : [[sk.instrument, 1]]; return parts.reduce((a, [id, w]) => { const b = betaOf(id); return { up: a.up + b.up * w, down: a.down + b.down * w }; }, { up: 0, down: 0 }); }
function partyBeta(weights, skills) { return ROLES.reduce((a, r) => { const b = skillBeta(battle.party._bySkill[skills[r]]); return { up: a.up + b.up * weights[r] / 100, down: a.down + b.down * weights[r] / 100 }; }, { up: 0, down: 0 }); }
/** assumed size of the next move: average |move| of the main instrument over the bars seen so far, floored */
function moveSize(upto) {
  const main = mainInstrument(currentTape), bars = currentTape.bars; let sum = 0, n = 0;
  for (let i = 1; i <= upto; i++) { sum += Math.abs(100 * (bars[i].prices[main] / bars[i - 1].prices[main] - 1)); n++; }
  const floor = currentTape.daily ? 1 : 0.5;
  return Math.max(floor, Math.round((n ? sum / n : floor) * 10) / 10);
}
const fmtMan = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v) / 10000).toLocaleString('ko-KR') + '만원';
function payoffHTML(weights, skills, m) {
  const b = partyBeta(weights, skills), v = totalValue();
  const up = v * b.up * m / 100, dn = -v * b.down * m / 100;
  return `<span class="pay"><em class="up">▲ ${fmtMan(up)}</em><em class="dn">▼ ${fmtMan(dn)}</em></span>`;
}

/* ---------- checkpoint modal ---------- */
const CP_SECONDS = 30;
/** what each hero says at a checkpoint — reacts to their own HP and the last bar */
function heroLines(cp) {
  const last = battle.history.at(-1), lvl = effectiveLevel();
  const hp = r => battle.partyHp[r], ret = r => last?.roles?.[r]?.ret ?? 0;
  const lockedOpt = currentTape.skills.find(k => k.role === 'healer' && !skillOpen(k));
  return [
    ['tank', hp('tank') <= 0 ? '…(기절)' : hp('tank') < 50 ? '방패가 무거워… 그래도 버틴다!' : ret('tank') < 0 ? '다음 공격은 내가 막을게.' : '이대로 가도 괜찮아 보여.'],
    ['dealer', hp('dealer') <= 0 ? '…(기절)' : ret('dealer') > 0 ? '기세 좋아! 더 밀어붙이자!' : ret('dealer') < 0 ? '한 방 맞았지만 역전 가능해.' : '시장이 조용하네. 다음은 크게 움직일걸?'],
    ['healer', hp('healer') <= 0 ? '…(기절)' : lockedOpt ? `${lockedOpt.name}${josa(lockedOpt.name, '은', '는')} 내가 전직하면 쓸 수 있어.` : '보험을 들지 말지는 네 선택이야.'],
    ['support', `체크포인트는 딱 한 번. ${CP_SECONDS}초 안에 정하자.`],
  ];
}
let cpChart = null, cpTimer = null;
async function showCheckpoint(cp) {
  if (speed < 4) await cutIn({ text: '체크포인트!', sub: `${cpWhen(cp)} · ${cp.title}`, bg: '#2F6BD0', artL: null, artR: null }, Math.max(1.6, speedFactor()));
  return new Promise(resolve => {
    sfx.pause();
    const m = $('#cp'); m.hidden = false;
    setTimeout(() => showTip('cp'), 300);
    const cps = currentTape.checkpoints, idx = cps.indexOf(cp);
    $('#cpStep').innerHTML = `${ICON.flag} 체크포인트 ${idx + 1} / ${cps.length} · ${cpWhen(cp)}`;
    $('#cpTitle span:last-child').textContent = cp.title;
    const cum = battle.equity - 100, next = currentTape.bars[cp.bar];
    $('#cpHint').innerHTML = `${cp.hint}<br><span class="muted small">다음 구간 <b>${fmtBar(next.t)} ${next.label}</b></span>`;
    $('#cpMore').open = false;
    // the chart is the question: real closes up to now, the rest still hidden
    const main = mainInstrument(currentTape);
    $('#cpChartTitle').innerHTML = `${main} ${currentTape.instruments[main].name} <span class="muted">· 지금까지의 실제 흐름</span>`;
    cpChart?.remove(); cpChart = new BattleChart($('#cpChart'), currentTape, 'price', { state: battle, upto: cp.bar - 1, quiet: true, futureShade: true });
    const v = totalValue();
    $('#cpMoney').textContent = fmtKRW(v); $('#cpMoneyD').textContent = `${fmtKRWd(v - SEED)} (${fmtPct(cum)})`; $('#cpMoneyD').className = 'ret tabular ' + (v >= SEED ? 'up' : 'down');
    $('#cpParty').innerHTML = ROLES.map(role => { const sk = battle.party._bySkill[battle.party.skills[role]], rv = roleValue(role), r0 = roleStart(role), dead = battle.partyHp[role] <= 0;
      return `<div style="--rc:${ROLE_COLOR[role]};${dead ? 'opacity:.45' : ''}" title="${sk.name} · ${currentTape.instruments[sk.instrument].name}"><img src="${portrait(heroUnit(role))}" alt=""><b>${charOf(role).name}</b><span class="w">${battle.party.weights[role]}%</span><span class="pr">${sk.instrument}</span><span class="pl ${rv >= r0 ? 'ret up' : 'ret down'}">${fmtKRWd(rv - r0)}</span></div>`; }).join('');
    renderTicker($('#cpTicker'), cp.bar - 1);
    const mv = moveSize(cp.bar - 1), mainId = mainInstrument(currentTape);
    $('#cpBull').textContent = cp.bull || '좋은 쪽으로 가면 공격적인 상품이 크게 벌어요.';
    $('#cpBear').textContent = cp.bear || '나쁜 쪽으로 가면 현금, 채권, 보험이 막아 줘요.';
    $('#cpScenNote').textContent = `${mainId}가 ±${mv}% 움직인다고 가정한 대략의 예상치예요. 상품별 민감도(레버리지 3배, 풋옵션 역방향 등)로 계산합니다.`;
    $('#cpHoldPay').innerHTML = payoffHTML(battle.party.weights, battle.party.skills, mv);
    $('#cpEvent').innerHTML = eventCardHTML(currentTape, cp.bar, { source: false, newAt: cp.bar });
    $('#cpSay').innerHTML = heroLines(cp).slice(0, 2).map(([r, line]) => `<span><img src="${portrait(heroUnit(r))}" alt=""><b>${charOf(r).name}</b> ${line}</span>`).join('');
    // countdown: time out = hold (a decision not taken is still a decision)
    clearInterval(cpTimer); let left = CP_SECONDS; const tEl = $('#cpTimer');
    const tick = () => { $('#cpTimerTxt').textContent = left; $('#cpTimerBar').style.width = (100 * left / CP_SECONDS) + '%'; tEl.classList.toggle('hot', left <= 10); if (left <= 10 && left > 0) sfx.select(); if (left <= 0) { clearInterval(cpTimer); done({ type: 'hold' }, '시간이 다 돼서 그대로 가요'); } left--; };
    tick(); cpTimer = setInterval(tick, 1000);
    const tabs = $$('#cp .choices [data-tab]');
    let openTab = null;
    const setTab = name => { openTab = name; tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name))); $('#cpEquip').hidden = name !== 'equip'; $('#cpRebal').hidden = name !== 'rebalance'; };
    tabs.forEach(t => { t.onclick = () => { sfx.select(); setTab(openTab === t.dataset.tab ? null : t.dataset.tab); }; });
    setTab(null);
    const done = (action, msg) => { try { intervene(battle, action); } catch (e) { toast(e.message); return; } clearInterval(cpTimer); m.hidden = true; $('#tip').hidden = true; if (msg) toast(msg); renderPartyHud(); battleChart?.markers(); battleChartEq?.markers(); justDecided = true; resolve(); };
    $('#cpHoldBtn').onclick = () => { sfx.select(); done({ type: 'hold' }, chartMode() ? '그대로 둘게요' : '그대로 간다!'); };
    // equip
    const lvl = effectiveLevel();
    $('#cpEquip').innerHTML = '';
    ROLES.forEach(role => {
      const cur = battle.party._bySkill[battle.party.skills[role]];
      const box = document.createElement('div'); box.className = 'cp-role'; box.style.setProperty('--rc', ROLE_COLOR[role]);
      box.innerHTML = `<img src="${portrait(heroUnit(role))}" alt="" class="pf"><div><div class="hdr"><b>${charOf(role).name} <span class="muted small">${battle.party.weights[role]}%</span></b><span>지금 ${cur.name} (${cur.instrument})</span></div><div class="opts"></div></div>`;
      const opts = box.querySelector('.opts');
      currentTape.skills.filter(s => s.role === role && s.id !== cur.id).forEach(s => {
        const locked = !skillOpen(s);
        const b = document.createElement('button'); b.type = 'button'; b.className = 'skill'; b.disabled = !!locked; if (s.lesson) b.title = s.lesson;
        const skills2 = { ...battle.party.skills, [role]: s.id };
        b.innerHTML = `<span class="n">${s.name} ${locked ? '' : skillStatChips(s)}</span><span class="i">${s.instrument}${locked ? ` · ${lockLabel(s)}` : ''}</span>${locked ? '' : payoffHTML(battle.party.weights, skills2, mv)}`;
        b.onclick = () => { sfx.select(); done({ type: 'equip', role, skill: s.id, level: 99 }, `${charOf(role).name} → ${s.name}`); };
        opts.appendChild(b);
      });
      if (!opts.children.length) opts.innerHTML = '<span class="small muted">바꿀 상품이 없어요</span>';
      $('#cpEquip').appendChild(box);
    });
    // rebalance
    const w = { ...battle.party.weights };
    const renderSl = () => {
      $('#cpSliders').innerHTML = ROLES.map(role => `<div class="weight" style="--rc:${ROLE_COLOR[role]}"><label><span><img src="${portrait(heroUnit(role))}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:4px">${charOf(role).name} · ${battle.party._bySkill[battle.party.skills[role]].name}</span></label><div class="wctl"><button type="button" class="wbtn" data-cw="${role}" data-d="-5" aria-label="${charOf(role).name} 비중 줄이기">−</button><output id="cw-${role}">${w[role]}%</output><button type="button" class="wbtn" data-cw="${role}" data-d="5" aria-label="${charOf(role).name} 비중 늘리기">+</button></div></div>`).join('');
      const sync = () => { ROLES.forEach(r => { $('#cw-' + r).value = w[r] + '%'; }); const sum = ROLES.reduce((a, r) => a + w[r], 0), pool = 100 - sum; $('#cpSum').innerHTML = (pool > 0 ? `<span class="pool">남은 비중 ${pool}%</span>` : '비중 100%') + (sum === 100 ? ' ' + payoffHTML(w, battle.party.skills, mv) : ''); $('#cpSum').classList.toggle('bad', sum !== 100); $('#cpRebalBtn').disabled = sum !== 100; $$('#cpSliders .wbtn[data-d="-5"]').forEach(b => { b.disabled = w[b.dataset.cw] <= 0; }); };
      $$('#cpSliders .wbtn').forEach(b => b.addEventListener('click', () => { sfx.select(); stepWeight(w, b.dataset.cw, +b.dataset.d); sync(); }));
      sync();
    };
    renderSl();
    $('#cpRebalBtn').onclick = () => { sfx.select(); done({ type: 'rebalance', weights: w }, '비중 조정!'); };
    $('#cpHoldBtn').focus();
  });
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */
let rChart = null, rPriceChart = null;
async function showResult() {
  const s = battle, r = s.result;
  showScreen('result');
  // persist play & exp (+ drama bonus: combos and guards add exp, never return)
  const bonus = Math.min(30, drama.maxCombo * 3 + drama.guards * 4);
  const before = { ...profile };
  bumpStreak(); recordBoss(currentTape.bossSpecies, r.grade, r.bossDown); recordProducts(s);
  const growth = chartMode() ? { gains: Object.fromEntries(ROLES.map(x => [x, { atk: 0, def: 0, stab: 0, ins: 0 }])), evolved: [] } : growHeroes(s);
  profile.totalPnl = (profile.totalPnl || 0) + (totalValue() - SEED);
  const after = { ...profile };
  const play = profile.plays[currentTape.id] || { count: 0 };
  const order = ['F', 'D', 'C', 'B', 'A', 'S'];
  play.count++; if (!play.best || order.indexOf(r.grade) > order.indexOf(play.best)) play.best = r.grade;
  profile = { ...after, plays: { ...profile.plays, [currentTape.id]: play }, badges: profile.badges, bosses: profile.bosses, products: profile.products, heroes: profile.heroes, totalPnl: profile.totalPnl, streak: profile.streak, lastDay: profile.lastDay, seenTutorial: profile.seenTutorial }; saveProfile();

  const stamp = $('#rStamp'); stamp.textContent = r.grade; stamp.className = 'stamp ' + r.grade;
  $('#rVerdict').textContent = r.bossDown ? `${currentTape.boss}${josa(currentTape.boss, '을', '를')} 쓰러뜨렸어요!` : r.alive === 0 ? '모두 쓰러졌어요' : r.returnPct >= 0 ? '보스는 남았지만 돈은 지켰어요' : '이번엔 보스가 더 셌어요';
  $('#rWhy').textContent = gradeReason(r);
  // next raid: the first one not yet played (real first), else the next in the list
  const order2 = [...TAPES.filter(t => !t.example).slice().reverse(), ...TAPES.filter(t => t.example)];
  const next = order2.find(t => !profile.plays[t.id] && t.id !== currentTape.id) || order2[(order2.findIndex(t => t.id === currentTape.id) + 1) % order2.length];
  $('#nextRaidBtn').innerHTML = `${chartMode() ? '다음 이벤트' : '다음 레이드'} ▶ ${evTitle(next.title)}${next.example ? '' : ' <span class="chip real" style="margin-left:4px">실제</span>'}`;
  $('#nextRaidBtn').onclick = () => { sfx.select(); party = null; openBrief(next.id); };
  $('#rRet').textContent = `${fmtKRWd(totalValue() - SEED)} (${fmtPct(r.returnPct)})`; $('#rRet').style.color = r.returnPct >= 0 ? 'var(--green)' : 'var(--red)';
  $('#rMoney').textContent = fmtKRW(totalValue());
  $('#rAlphaLabel').textContent = `시장(${benchmarkOf(currentTape)})에 넣었다면`;
  $('#rAlpha').textContent = `${fmtKRW(SEED * s.benchmark / 100)}`; $('#rAlpha').style.color = r.alpha >= 0 ? 'var(--green)' : 'var(--red)'; $('#rAlpha').style.fontSize = '16px';
  $('#rMore').open = true;
  $('#rBoss').textContent = r.bossDown ? '격파' : `체력 ${Math.round(s.bossHp)} 남았어요`;
  $('#rAlive').textContent = `${r.alive} / 4`;
  const cs = ROLES.map(role => ({ role, c: contribution(s, role) })); const mx = Math.max(.2, ...cs.map(x => Math.abs(x.c)));
  $('#rContribs').innerHTML = cs.map(({ role, c }) => `<div class="contrib" style="--rc:${ROLE_COLOR[role]}"><span>${charOf(role).name}</span><div class="bar"><i style="${c >= 0 ? 'left:50%' : 'right:50%'};width:${50 * Math.abs(c) / mx}%"></i></div><span class="v tabular" style="color:${c >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(c)}</span></div>`).join('');
  const acts = (s.actions || []);
  $('#rDecisions').innerHTML = acts.length ? acts.map(a => {
    const bar = currentTape.bars[a.at]; const after = s.log.filter(t => t.bar >= a.at).reduce((x, t) => x + t.boss.portfolioRet, 0);
    const what = a.type === 'hold' ? '그대로' : a.type === 'equip' ? `${charOf(ROLES.find(r => s.party._bySkill[a.to]?.role === r) || 'dealer').name} → ${s.party._bySkill[a.to].name}` : '비중 조정 ' + ROLES.map(r => a.to[r]).join('/');
    return `<div><span class="t">${fmtBar(bar.t)}</span><span>${what}</span><span class="muted">· 이후 ${chartMode() ? "포트폴리오" : "파티"} ${fmtPct(after)}</span></div>`;
  }).join('') : '<span class="muted">체크포인트 없음</span>';
  // what-if: best / worst single-action strategies from the same starting party
  const alts = alternatives(currentTape, { weights: { ...party.weights }, skills: { ...party.skills }, _bySkill: party._bySkill });
  const best = alts[0], worst = alts.at(-1), lvl = effectiveLevel();
  const row = (k, cls, a, v) => `<div><span class="k ${cls}">${k}</span><span>${a}</span><span class="v" style="color:${v >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(v)}</span></div>`;
  const lockNote = a => a.detail.unlockLevel && !skillOpen(a.detail) ? `<span class="lock">${lockLabel(a.detail)}</span>` : '';
  $('#rWhatIf').innerHTML = [
    row('내 선택', 'me', acts.some(a => a.type !== 'hold') ? '체크포인트 선택대로' : '끝까지 그대로', r.returnPct),
    row('최고', 'best', best.label + lockNote(best), best.returnPct),
    row('최악', 'worst', worst.label + lockNote(worst), worst.returnPct),
  ].join('');
  $('#rConcepts').innerHTML = (currentTape.concepts || []).map((c, i) => `<details${i === 0 ? ' open' : ''}><summary>${c.name}</summary><p>${c.text}</p></details>`).join('');
  rChart?.remove(); rChart = new BattleChart($('#rChart'), currentTape, 'equity', { state: s, upto: currentTape.bars.length - 1 });
  $('#rChartLegend').innerHTML = rChart.legend();
  $('#rMore').ontoggle = () => { if ($('#rMore').open) setTimeout(() => { rChart?.c.timeScale().fitContent(); rPriceChart?.c.timeScale().fitContent(); }, 50); };
  rPriceChart?.remove(); rPriceChart = new BattleChart($('#rPriceChart'), currentTape, 'compare', { state: s, upto: currentTape.bars.length - 1, ids: battleInstruments().slice(0, 5) });
  $('#rPriceLegend').innerHTML = rPriceChart.legend();
  $('#coachAv').src = portrait('hero_healer');
  // growth: plain sentences + status windows with this raid's gains
  const pnl = totalValue() - SEED, top = ROLES.map(role => { const g = growth.gains[role], k = STAT_KEYS.slice().sort((a, b) => g[b] - g[a])[0]; return { role, k, v: g[k] }; }).sort((a, b) => b.v - a.v)[0];
  const nm = charOf(top.role).name, soon = ROLES.filter(r => !hero(r).branch).sort((a, b) => raidsLeft(a) - raidsLeft(b))[0];
  const nameList = rs => rs.map(r => jobOf(r)).reduce((a, n, i, arr) => i === 0 ? n : a + (i === arr.length - 1 ? josa(arr[i - 1], '과', '와') + ' ' : ', ') + n, '');
  const evoNames = nameList(growth.evolved), evoLast = jobOf(growth.evolved[growth.evolved.length - 1] || 'tank');
  const soonN = soon ? raidsLeft(soon) : 0, soonName = soon ? charOf(soon).name : '';
  const lines2 = [
    pnl >= 0 ? `${wonWords(pnl)}을 벌었어요.` : r.alpha > 0 ? `이번엔 ${wonWords(pnl)}을 잃었지만, 시장보다는 덜 잃었어요.` : `이번엔 ${wonWords(pnl)}을 잃었어요.`,
    growth.evolved.length === 1 ? `${evoNames}${josa(evoLast, '이', '가')} ${heroTitle(growth.evolved[0])}${josa(heroTitle(growth.evolved[0]), '으로', '로')} 전직했어요!`
      : growth.evolved.length ? `${evoNames}${josa(evoLast, '이', '가')} 전직했어요!` : `${nm}${josa(nm, '이', '가')} 한층 ${STAT_GROW[top.k]}`,
    (() => { const opened = currentTape.skills.filter(k => k.unlockLevel && growth.evolved.includes(k.role)).map(k => k.name); return opened.length ? `이제 ${opened.join(', ')}${josa(opened.at(-1), '을', '를')} 쓸 수 있어요.` : ''; })(),
    soon && soonN ? `${KNUM(soonN)} 판만 더 하면 ${soonName}${josa(soonName, '이', '가')} 전직해요. ${nextBossSentence()}` : nextBossSentence(),
  ].filter(Boolean);
  $('#rGrowthText').innerHTML = lines2.map(l => `<p>${l}</p>`).join('');
  $('#rGrowth').innerHTML = ROLES.map(role => statusWindowHTML(role, { gains: growth.gains[role] })).join('');
  if (growth.evolved.length) setTimeout(() => evolveCut(growth.evolved[0]), 900);
  // animations
  sfx.stamp();
  gsap.fromTo(stamp, { scale: 3, opacity: 0, rotate: -30 }, { scale: 1, opacity: 1, rotate: -12, duration: .45, ease: 'back.out(1.2)' });
  if (!reduceMotion) gsap.fromTo('.stamp-wrap', { x: -8 }, { x: 8, duration: .05, repeat: 5, yoyo: true, clearProps: 'x', delay: .35 });
  // coach typing
  const bubble = $('#coachBubble'); bubble.innerHTML = '';
  const lines = coachText(s);
  (async () => { for (const line of lines) { const p = document.createElement('p'); p.className = 'typing'; bubble.appendChild(p); for (const ch of line) { p.textContent += ch; if (!reduceMotion) await sleep(14); } p.classList.remove('typing'); await sleep(200); } })();
  renderProfile();
}
function animBar(el, pct, ms) { return new Promise(res => { el.style.transition = `width ${ms}ms cubic-bezier(.2,.8,.2,1)`; requestAnimationFrame(() => { el.style.width = pct + '%'; setTimeout(res, ms); }); }); }

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
$('#toParty').addEventListener('click', () => { sfx.select(); openParty(); });
$('#backToSelect').addEventListener('click', () => { sfx.back(); showScreen('select'); });
$('#backToBrief').addEventListener('click', () => { sfx.back(); showScreen('brief'); });
$$('[data-preset]').forEach(b => b.addEventListener('click', () => { sfx.select(); applyPreset(b.dataset.preset); }));
$('#accountBtn').addEventListener('click', () => { sfx.select(); applyAccount(); });
$('#startBattle').addEventListener('click', startBattle);
$('#retryBtn').addEventListener('click', () => { sfx.select(); openParty(); });
$('#otherBtn').addEventListener('click', () => { sfx.select(); renderSelect(); showScreen('select'); });
$('#etfBtn').addEventListener('click', () => {
  sfx.select();
  const ids = usedInstruments(battle);
  $('#pdSub').textContent = `${currentTape.title} · ${fmtDate(currentTape.bars[0].t)} ~ ${fmtDate(currentTape.bars.at(-1).t).slice(5)}`;
  $('#pdCards').innerHTML = ids.map(id => productCardHTML(id, currentTape)).join('');
  $$('#pdCards .go').forEach(b => b.addEventListener('click', () => toast('실제 앱에서는 이 버튼이 유진 앱의 상품 상세 화면으로 연결돼요', 2600)));
  $('#tip').hidden = true; $('#etfModal').hidden = false;
});
$('#etfClose').addEventListener('click', () => { sfx.back(); $('#etfModal').hidden = true; });
$('#dexBtn').addEventListener('click', () => { sfx.select(); renderCollection(); $('#tip').hidden = true; $('#dex').hidden = false; });
$('#dexClose').addEventListener('click', () => { sfx.back(); $('#dex').hidden = true; });
let tutStep = 0;
const TUT = [
  { art: 'hero_tank', title: '파티 비중 = 포트폴리오', text: '채권·성장주·금·현금·배당주에게 비중을 나눠요. 기술은 전부 실제 ETF·채권·금·옵션이에요. 비중을 어떻게 나누느냐가 곧 투자 포트폴리오예요.' },
  { art: 'boss_lich', title: '보스 = 실제 시장 이벤트', text: 'FOMC, 실적 발표, 물가 지표가 보스로 나타나요. 데미지는 전부 그날 실제 가격 변동으로 계산돼요. 난수는 없어요.' },
  { art: 'hero_healer', title: '체크포인트에서 개입', text: '레이드는 자동으로 흘러가다 중요한 순간에 멈춰요. 30초 안에 버티기·기술 교체·비중 조정 중 하나를 고르세요. 차트와 자금 평가를 보고 결정하면 돼요.' },
];
function renderTut() { const t = TUT[tutStep]; $('#tutArt').src = cutArt(t.art); $('#tutTitle').textContent = t.title; $('#tutText').textContent = t.text; $('#tutDots').innerHTML = TUT.map((_, i) => `<i class="${i === tutStep ? 'on' : ''}"></i>`).join(''); $('#tutNext').textContent = tutStep === TUT.length - 1 ? '시작하기' : '다음'; }
function openTutorial() { tutStep = 0; renderTut(); $('#tut').hidden = false; }
$('#tutNext').addEventListener('click', () => { sfx.select(); if (tutStep < TUT.length - 1) { tutStep++; renderTut(); } else { $('#tut').hidden = true; profile.seenTutorial = true; saveProfile(); } });
$('#tutSkip').addEventListener('click', () => { sfx.back(); $('#tut').hidden = true; profile.seenTutorial = true; saveProfile(); });
$('#helpBtn').addEventListener('click', () => { sfx.select(); openTutorial(); });
// ---- guided first raid: one coach tip per screen, shown once (replaces the up-front modal) ----
const TIPS = {
  select: ['먼저 <b>훈련 레이드</b> 하나를 골라 보세요. 예시 시세라 부담 없이 연습할 수 있어요.', 'raidsExample'],
  brief: ['보스 = 실제 시장 이벤트예요. 이벤트 자료와 지금까지의 차트를 보고 <b>파티 짜기</b>를 누르세요.', 'toParty'],
  party: ['비중 = 포트폴리오, 상품 = 실제 ETF·채권·옵션. 처음엔 <b>프리셋 하나</b>만 고르고 출발해도 돼요.', 'startBattle'],
  battle: ['턴마다 <b>차트가 먼저</b> 움직이고 캐릭터가 반응해요. 내 자금 칸에서 돈이 어떻게 변하는지 보세요.', null],
  cp: ['여기가 핵심. 선택지마다 <b>▲ 오르면 / ▼ 내리면 걸린 돈</b>이 적혀 있어요. 30초 안에 하나를 고르세요.', 'cpHoldBtn'],
  result: ['<b>같은 시장, 다른 선택이었다면</b>이 복기예요. 최고 선택과 내 선택의 차이가 곧 배울 점이에요.', 'rWhatIf'],
};
function showTip(key) {
  if (profile.seenTutorial || profile.tips?.[key]) return;
  const [html, anchor] = TIPS[key]; const el = $('#tip');
  el.querySelector('p').innerHTML = html; el.hidden = false;
  const a = anchor && $('#' + anchor); el.style.setProperty('--tip-top', '');
  if (a && window.innerWidth > 700) { const r = a.getBoundingClientRect(); el.style.top = Math.max(8, r.top + window.scrollY - el.offsetHeight - 14) + 'px'; el.classList.add('anchored'); } else { el.style.top = ''; el.classList.remove('anchored'); }
  profile.tips = { ...(profile.tips || {}), [key]: true }; saveProfile();
  if (Object.keys(profile.tips).length >= Object.keys(TIPS).length) { profile.seenTutorial = true; saveProfile(); }
}
$('#tipClose').addEventListener('click', () => { $('#tip').hidden = true; });
setTimeout(() => showTip('select'), 600);
$('#muteBtn').addEventListener('click', () => { unlock(); const m = !isMuted(); setMuted(m); $('#muteBtn').textContent = m ? '소리 끔' : '소리'; $('#muteBtn').setAttribute('aria-pressed', String(m)); });
$('#resetBtn').addEventListener('click', () => {
  if (Date.now() - (window.__resetArmed || 0) < 3000) { profile = { level: 1, exp: 0, unlockAll: false, plays: {}, badges: {}, bosses: {}, streak: 0, lastDay: '', seenTutorial: true }; saveProfile(); renderProfile(); renderSelect(); toast('진행 상황을 초기화했어요'); $('#resetBtn').textContent = '진행 초기화'; return; }
  window.__resetArmed = Date.now(); $('#resetBtn').textContent = '정말 초기화? (한 번 더)'; setTimeout(() => { $('#resetBtn').textContent = '진행 초기화'; }, 3000);
});
$('#unlockBtn').addEventListener('click', () => { profile.unlockAll = !profile.unlockAll; saveProfile(); renderProfile(); sfx.select(); toast(profile.unlockAll ? '체험 모드: 모든 상품을 쓸 수 있어요' : '체험 모드를 껐어요'); if (!$('#screen-party').hidden) renderPartyScreen(); });
document.addEventListener('keydown', e => { if (e.key === ' ' && !$('#screen-battle').hidden && $('#cp').hidden && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); $('#pauseBtn').click(); } });

renderProfile(); renderSelect(); showScreen('select');

// test/automation hooks (not used by the UI)
window.__rpg = { TAPES, vsIntro, get dbg() { return { userPaused, skipping, autoMode, justDecided, hasWaiter: !!nextWaiter, aborted, sceneReady: scene?.ready, paused: battle?.paused }; }, previewCut: kind => cutIn(kind === 'deal' ? { text: '크리티컬!', sub: '05:00 기자회견 시작 · 파티 +1.24%', bg: '#1F9663', artL: cutArt('hero_dealer'), artR: null } : { text: '필살기!', sub: '05:00 매파 발언 · 파티 -1.20%', bg: '#B9343C', artL: cutArt('hero_dealer', true), artR: cutArt('boss_minotaur'), hit: true }, 1), get battle() { return battle; }, get profile() { return profile; }, openBrief, openParty, startBattle, setSpeed: v => { speed = v; if (v >= 4) setAuto(true); }, setAuto, setParty: p => { party = Object.assign(p, { _tapeId: currentTape.id }); } };

// phone battle menu
$('#bmenuBtn').addEventListener('click', e => { e.stopPropagation(); const m = $('#bmenu'), o = !m.classList.contains('open'); m.classList.toggle('open', o); $('#bmenuBtn').setAttribute('aria-expanded', String(o)); });
document.addEventListener('click', e => { if (!e.target.closest('#bmenu')) { $('#bmenu').classList.remove('open'); $('#bmenuBtn').setAttribute('aria-expanded', 'false'); } else if (e.target.closest('button')) setTimeout(() => $('#bmenu').classList.remove('open'), 0); });

// mode switch (게임 / 차트)
$$('.mode-seg [data-mode]').forEach(b => b.addEventListener('click', () => { profile.mode = b.dataset.mode; saveProfile(); applyMode(); sfx.select(); if (!$('#screen-battle').hidden) { aborted = true; nextWaiter?.(); stopBgm(); } party = null; renderSelect(); showScreen('select'); }));
applyMode();
