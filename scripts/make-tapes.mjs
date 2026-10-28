// Builds example replay tapes into data/tapes/*.json
// Prices are hand-authored, event-shaped EXAMPLE paths (clearly flagged `example: true`).
// Replace with real intraday bars from the data adapter when available; the shape stays identical.
import { writeFileSync, mkdirSync } from 'node:fs';
import { calibrate } from './calibrate.mjs';

function build({ id, title, boss, bossSpecies, market, example, start, labels, instruments, skills, checkpoints, lesson, briefing, concepts = [], event }) {
  // instruments: { ID: { name, kind, start, path: [pct per bar...] } }
  const n = labels.length;
  const bars = labels.map((label, i) => ({ t: start[i], label, prices: {} }));
  for (const [iid, ins] of Object.entries(instruments)) {
    if (ins.path.length !== n - 1) throw new Error(`${id}: ${iid} path length ${ins.path.length} != ${n - 1}`);
    let p = ins.start;
    bars[0].prices[iid] = round(p, ins.dp ?? 2);
    ins.path.forEach((pct, i) => { p = p * (1 + pct / 100); bars[i + 1].prices[iid] = round(p, ins.dp ?? 2); });
  }
  const insMeta = Object.fromEntries(Object.entries(instruments).map(([k, v]) => [k, { name: v.name, kind: v.kind, currency: v.currency || (market === 'KR' ? 'KRW' : 'USD') }]));
  return { id, title, boss, bossSpecies, market, example, settled: true, event, briefing, lesson, concepts, instruments: insMeta, skills, checkpoints, bars };
}
const round = (v, dp) => Math.round(v * 10 ** dp) / 10 ** dp;
const kst = (d, hm) => `${d}T${hm}:00+09:00`;

/* ------------------------------------------------------------------ */
/* Tape 1: FOMC (US) — 동결 + 매파 기자회견 시나리오                     */
/* ------------------------------------------------------------------ */
const D1 = '2026-10-29';
const fomc = build({
  id: 'fomc-2026-10-29', title: '10월 FOMC 레이드', boss: '동결이',
  event: { kind: 'fomc', company: '미국 연준 FOMC', ticker: 'FOMC', logo: null, example: true, source: '일정은 실제, 시세 흐름은 예시 시나리오',
    facts: [{ at: 0, label: '회의 일정', value: '10/28~29, 결정 10/30 03:00 한국시간' }, { at: 0, label: '현재 기준금리', value: '3.75~4.00%' }, { at: 0, label: '시나리오(예시)', value: '동결 + 매파 기자회견' }] },
  bossSpecies: 'minotaur', market: 'US', example: true,
  briefing: 'FOMC는 동결이 유력해요. 진짜 승부는 결정 뒤 기자회견이에요. "더 올릴 수도 있다"는 한마디가 가장 큰 변수예요.',
  lesson: '시장은 결과보다 예상과 얼마나 다른지에 반응해요. 동결은 다들 예상했고, 기자회견 말투가 새 소식이었어요.',
  concepts: [
    { name: '이미 가격에 반영된 뉴스', text: '90%가 예상한 동결은 발표 순간 거의 움직임이 없었어요. 시장은 "예상과 다른 것"에만 반응해요.' },
    { name: '금리와 성장주', text: '성장주는 먼 미래의 이익을 기대받는 자산이라, 금리 전망이 올라가면 가장 먼저 흔들려요.' },
    { name: '레버리지의 반동', text: '3배 레버리지는 같은 방향이면 3배 벌지만, 반대 방향이면 3배로 맞아요. 하루 안에서도요.' },
    { name: '헤지와 프리미엄', text: '풋옵션은 프리미엄을 내고 사요. 기초자산이 행사가 아래로 충분히 빠져야 이익이 나고, 그 전엔 시간이 지날수록 가치가 줄어요. 얼마나 빠져야 손익이 맞는지는 행사가와 프리미엄에 달려 있어요.' },
  ],
  start: ['02:00', '02:30', '03:00', '03:30', '04:00', '04:30', '05:00', '05:30', '06:00', '06:30'].map(h => kst(D1, h)),
  labels: ['장중 대기', '발표 1시간 전', '발표 30분 전', '금리 결정 발표', '결정 소화', '기자회견 시작', '매파 발언', '발언 확산', '진정 국면', '마감'],
  //                 02:30  03:00  03:30  04:00  04:30  05:00  05:30  06:00  06:30
  instruments: {
    QQQ:   { name: '나스닥100 ETF',          kind: 'etf',    start: 482.10, path: [ 0.05, -0.10,  0.35,  0.10, -0.25, -1.20, -0.60,  0.30,  0.10] },
    TQQQ:  { name: '나스닥100 3배 레버리지',  kind: 'lev',    start: 71.40,  path: [ 0.15, -0.31,  1.04,  0.29, -0.76, -3.62, -1.82,  0.88,  0.28] },
    TLT:   { name: '미국 장기채 ETF',         kind: 'etf',    start: 92.30,  path: [ 0.02, -0.05,  0.20, -0.05, -0.15, -0.70, -0.30,  0.15,  0.05] },
    SHY:   { name: '미국 단기채 ETF',         kind: 'etf',    start: 82.60,  path: [ 0.00, -0.01,  0.03,  0.00, -0.02, -0.08, -0.03,  0.02,  0.01] },
    GLD:   { name: '금 ETF',                 kind: 'etf',    start: 251.80, path: [ 0.03, -0.04,  0.15,  0.02, -0.12, -0.55, -0.20,  0.18,  0.06] },
    BIL:   { name: '현금성 단기국채 ETF',     kind: 'cash',   start: 91.52,  path: [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00], dp: 3 },
    SCHD:  { name: '미국 배당 ETF',           kind: 'etf',    start: 28.40,  path: [ 0.02, -0.06,  0.18,  0.04, -0.14, -0.60, -0.28,  0.16,  0.06] },
    QQQ_P: { name: 'QQQ 풋옵션 (행사가 480, 2주물)', kind: 'option', start: 4.20, path: [-1.50,  1.20, -9.00, -3.00,  8.00, 42.00, 22.00, -9.00, -3.50] },
  },
  skills: [
    { id: 'tank_tlt',   role: 'tank',    instrument: 'TLT',   name: '장기채 ETF',  default: true,  lesson: '장기채는 금리 전망에 민감해서, 매파 발언엔 같이 빠질 수 있어요.' },
    { id: 'tank_shy',   role: 'tank',    instrument: 'SHY',   name: '단기채 ETF',                   lesson: '단기채는 거의 안 흔들리지만 크게 벌지도 않아요.' },
    { id: 'dealer_qqq', role: 'dealer',  instrument: 'QQQ',   name: '나스닥100 ETF',    default: true,  lesson: '성장주는 금리 신호에 가장 민감한 자산이에요.' },
    { id: 'dealer_tqqq',role: 'dealer',  instrument: 'TQQQ',  name: '나스닥100 3배',    unlockLevel: 5, lesson: '3배 레버리지는 같은 방향이면 3배로 벌고, 반대면 3배로 잃어요.' },
    { id: 'healer_gld', role: 'healer',  instrument: 'GLD',   name: '금 ETF',    default: true,  lesson: '금은 금리가 오를 땐 이자를 못 줘서 약해지기도 해요.' },
    { id: 'healer_cash',role: 'healer',  instrument: 'BIL',   name: '현금 대기',                   lesson: '현금은 잃지 않지만 벌지도 않아요.' },
    { id: 'healer_put', role: 'healer',  instrument: 'QQQ_P', blend: { QQQ_P: 0.25, BIL: 0.75 }, name: 'QQQ 풋옵션',  unlockLevel: 10, lesson: '슬롯의 25%만 풋옵션에 쓰고 나머지는 현금으로 뒀어요. 시장이 크게 빠지면 풋옵션 값이 오르고, 그대로면 시간이 갈수록 가치가 줄어요.' },
    { id: 'support_schd',role:'support', instrument: 'SCHD',  name: '배당 ETF',    default: true,  lesson: '배당주도 주식이라 하락장에선 같이 밀려요. 대신 덜 밀려요.' },
  ],
  checkpoints: [
    { bar: 3, title: '금리 결정 발표 1분 전', hint: '시장은 동결을 90% 예상하고 있어요. 지금 바꿀까요, 그대로 갈까요?', bull: '동결에 부드러운 말까지 나오면 안도하며 올라요. 레버리지가 가장 크게 벌어요.', bear: '앞으로도 금리를 높게 두겠다는 신호가 나오면 성장주부터 빠져요. 현금은 거의 안 빠져요.', allow: ['hold', 'equip', 'rebalance'] },
    { bar: 5, title: '기자회견 시작', hint: '곧 의장이 첫마디를 해요. 강하게 나올까요, 부드럽게 나올까요?', bull: '"금리 인하를 논의하기 시작했다"는 말 한마디면 지수가 튀어요. 성장주와 레버리지가 유리해요.', bear: '"서두르지 않겠다"고 하면 발표 전에 오른 만큼 다시 빠져요. 배당주와 현금은 덜 빠져요.', allow: ['hold', 'equip', 'rebalance'] },
  ],
});

/* ------------------------------------------------------------------ */
/* Tape 2: 반도체 실적 (KR) — 기대치 상회 + 차익실현 시나리오              */
/* ------------------------------------------------------------------ */
const D2 = '2026-10-28';
const semi = build({
  id: 'semi-earnings-2026-10-28', title: '반도체 실적 레이드', boss: '불꽃이',
  event: { kind: 'earnings', company: '반도체 대형주 실적 (예시 시나리오)', ticker: 'KSEMI', logo: 'assets/logos/samsung.png', example: true, logos: [{ src: 'assets/logos/samsung.png', name: '삼성전자' }, { src: 'assets/logos/skhynix.png', name: 'SK하이닉스' }], source: 'ETF 주요 구성 종목은 실제, 실적 숫자와 시세 흐름은 예시',
    facts: [{ at: 0, label: 'ETF 주요 구성', value: '삼성전자, SK하이닉스' }, { at: 0, label: '시나리오(예시)', value: '영업이익 컨센서스 상회, 가이던스는 유지' }, { at: 1, label: '시초가 반응(예시)', value: '반도체 ETF +2.6%', good: true }] },
  bossSpecies: 'wyvern', market: 'KR', example: true,
  briefing: 'SK하이닉스 3분기 실적이 장 시작 전에 나와요. 시장 기대가 이미 높아서, 좋은 정도로는 부족하고 기대보다 좋아야 올라요.',
  lesson: '기대가 이미 높으면 좋은 뉴스도 차익실현의 빌미가 돼요.',
  concepts: [
    { name: '기대치 대비 실적', text: '좋은 실적이 아니라 "기대보다 좋은" 실적이어야 올라요. 기대가 이미 높으면 좋은 뉴스도 매물의 빌미가 돼요.' },
    { name: '업종 집중의 위험', text: '반도체 ETF는 여러 종목이지만 결국 한 업종이에요. 업종 뉴스 하나에 다 같이 움직여요.' },
    { name: '차익실현', text: '급등 직후엔 먼저 산 사람들이 이익을 챙기며 팔아요. 첫 10분의 방향이 하루를 결정하지 않아요.' },
  ],
  start: ['08:30', '09:00', '09:10', '09:30', '10:00', '11:00', '13:00', '14:30', '15:30'].map(h => kst(D2, h)),
  labels: ['실적 발표', '장 시작', '첫 10분', '초반 소화', '차익실현', '오전 마감', '오후 시작', '막판 반등', '마감'],
  //                 09:00  09:10  09:30  10:00  11:00  13:00  14:30  15:30
  instruments: {
    K200:  { name: '코스피200 ETF',           kind: 'etf',  start: 56800, path: [ 1.10,  0.40, -0.60, -0.90, -0.30,  0.10,  0.50,  0.20], dp: 0 },
    K200L: { name: '코스피200 2배 레버리지',   kind: 'lev',  start: 41250, path: [ 2.18,  0.79, -1.21, -1.81, -0.61,  0.19,  0.99,  0.39], dp: 0 },
    KSEMI: { name: '반도체 ETF',              kind: 'etf',  start: 78400, path: [ 2.60,  0.90, -1.80, -2.40, -0.70,  0.20,  1.10,  0.40], dp: 0 },
    KBOND: { name: '국고채 10년 ETF',          kind: 'etf',  start: 121300, path: [-0.05, -0.02,  0.04,  0.08,  0.03, -0.01, -0.04, -0.02], dp: 0 },
    KGOLD: { name: '금 현물 ETF',             kind: 'etf',  start: 31900, path: [-0.10, -0.05,  0.10,  0.15,  0.05,  0.00, -0.05,  0.00], dp: 0 },
    KCASH: { name: '머니마켓 ETF',            kind: 'cash', start: 105320, path: [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00], dp: 0 },
    KDIV:  { name: '고배당 ETF',              kind: 'etf',  start: 17840, path: [ 0.40,  0.10, -0.20, -0.30, -0.10,  0.05,  0.20,  0.10], dp: 0 },
    K200_P:{ name: '코스피200 풋옵션 (행사가 560)', kind: 'option', start: 3.85, path: [-14.00, -5.00, 9.00, 16.00, 5.00, -2.00, -8.00, -3.00] },
  },
  skills: [
    { id: 'tank_kbond',  role: 'tank',    instrument: 'KBOND', name: '국고채 ETF',  default: true,  lesson: '국내 금리 이벤트가 아닌 날, 채권은 거의 움직이지 않아요.' },
    { id: 'dealer_k200', role: 'dealer',  instrument: 'K200',  name: '코스피200 ETF',  default: true,  lesson: '지수 ETF는 업종 뉴스를 희석해서 받아요.' },
    { id: 'dealer_ksemi',role: 'dealer',  instrument: 'KSEMI', name: '반도체 ETF',                 lesson: '업종 ETF는 그 업종 뉴스에 지수보다 2배쯤 크게 움직여요.' },
    { id: 'dealer_k200l',role: 'dealer',  instrument: 'K200L', name: '나스닥100 3배',    unlockLevel: 5, lesson: '2배 레버리지는 하루 안에서도 손익이 두 배예요.' },
    { id: 'healer_kgold',role: 'healer',  instrument: 'KGOLD', name: '금 ETF',    default: true,  lesson: '금은 주식과 따로 움직이는 날이 많아요.' },
    { id: 'healer_kcash',role: 'healer',  instrument: 'KCASH', name: '현금 대기',                   lesson: '현금은 잃지 않지만 벌지도 않아요.' },
    { id: 'healer_kput', role: 'healer',  instrument: 'K200_P', blend: { K200_P: 0.25, KCASH: 0.75 }, name: 'QQQ 풋옵션',  unlockLevel: 10, lesson: '슬롯의 25%만 풋옵션, 나머지는 현금이에요. 시장이 오르면 풋옵션 가치가 빠르게 줄어요.' },
    { id: 'support_kdiv',role: 'support', instrument: 'KDIV',  name: '배당 ETF',    default: true,  lesson: '고배당주는 성장주보다 덜 흔들려요.' },
  ],
  checkpoints: [
    { bar: 1, title: '장 시작 직전', hint: '실적은 기대보다 좋았어요. 그런데 기대가 원래 높았어요. 반도체에 더 실을까요?', bull: '예상보다 좋은 실적에 다음 분기 전망까지 올리면 반도체와 레버리지가 크게 올라요.', bear: '이미 다 아는 호재라면 아침에 오르고 바로 팔자가 나와요. 배당주와 채권은 덜 빠질 수 있어요.', allow: ['hold', 'equip', 'rebalance'] },
    { bar: 4, title: '차익실현 조짐', hint: '아침에 크게 오른 뒤 파는 사람이 늘고 있어요. 번 걸 지킬까요, 더 갈까요?', bull: '외국인이 계속 사면 잠깐 쉬었다가 다시 올라요. 반도체를 그대로 둬요.', bear: '너무 빨리 올랐다면 오후까지 밀려요. 현금이나 배당주로 옮기면 번 돈을 덜 잃어요.', allow: ['hold', 'equip', 'rebalance'] },
  ],
});

/* ------------------------------------------------------------------ */
/* Tape 3: 미국 PCE 물가 (US) — 예상 상회 + 장 초반 회복 시나리오           */
/* ------------------------------------------------------------------ */
const D3 = '2026-10-29';
const pce = build({
  id: 'pce-2026-10-29', title: '물가 지표(PCE) 레이드', boss: '불개미',
  event: { kind: 'macro', company: '미국 9월 PCE 물가', ticker: 'PCE', logo: null, example: true, source: '일정은 실제, 숫자와 시세 흐름은 예시 시나리오',
    facts: [{ at: 0, label: '발표 일정', value: '10/29(목) 21:30 한국시간' }, { at: 0, label: '예상치(예시)', value: '전년 대비 3.7%' }, { at: 1, label: '발표(예시)', value: '3.9%, 예상 상회', good: false }] },
  bossSpecies: 'fireant', market: 'US', example: true,
  briefing: '9월 PCE 물가가 미국 장 시작 한 시간 전에 나와요. 예상은 3.7%예요. 예상보다 높으면 금리 인하 기대가 줄어요.',
  lesson: '현금은 그대로여도 물가가 오르면 살 수 있는 게 줄어요. 그래서 물가가 오를 때 금 같은 실물자산을 함께 보기도 해요.',
  concepts: [
    { name: '인플레이션과 구매력', text: '물가가 오르면 현금의 실질 가치는 줄어요.' },
    { name: '물가와 금리 기대', text: '물가가 예상보다 높으면 "금리를 더 올리겠구나"로 이어져서 채권과 성장주가 같이 흔들려요.' },
    { name: '안전자산의 종류', text: '현금, 단기채, 금은 모두 안전자산이지만 물가 앞에서는 다르게 반응해요.' },
  ],
  start: ['21:00', '21:30', '22:00', '22:30', '23:00', '23:30', '00:30', '01:30', '02:30'].map((h, i) => kst(i >= 6 ? '2026-10-30' : D3, h)),
  labels: ['발표 1시간 전', 'PCE 발표', '프리마켓 반응', '장 시작', '첫 30분', '소화 국면', '반등 시도', '오후장', '마감 전'],
  //                 21:30  22:00  22:30  23:00  23:30  00:30  01:30  02:30
  instruments: {
    QQQ:   { name: '나스닥100 ETF',          kind: 'etf',    start: 474.30, path: [-0.70, -0.30, -0.45,  0.20,  0.35,  0.40, -0.15,  0.10] },
    TQQQ:  { name: '나스닥100 3배 레버리지',  kind: 'lev',    start: 67.90,  path: [-2.12, -0.91, -1.36,  0.59,  1.04,  1.19, -0.46,  0.29] },
    TLT:   { name: '미국 장기채 ETF',         kind: 'etf',    start: 91.40,  path: [-0.55, -0.20, -0.25,  0.05,  0.10,  0.15, -0.05,  0.05] },
    SHY:   { name: '미국 단기채 ETF',         kind: 'etf',    start: 82.55,  path: [-0.06, -0.02, -0.02,  0.01,  0.01,  0.01,  0.00,  0.00] },
    GLD:   { name: '금 ETF',                 kind: 'etf',    start: 250.60, path: [ 0.45,  0.15,  0.10, -0.05,  0.05,  0.10,  0.05,  0.00] },
    BIL:   { name: '현금성 단기국채 ETF',     kind: 'cash',   start: 91.52,  path: [ 0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00,  0.00], dp: 3 },
    SCHD:  { name: '미국 배당 ETF',           kind: 'etf',    start: 28.20,  path: [-0.40, -0.15, -0.20,  0.10,  0.20,  0.20, -0.05,  0.05] },
    QQQ_P: { name: 'QQQ 풋옵션 (행사가 470, 2주물)', kind: 'option', start: 4.60, path: [ 26.00, 9.00, 12.00, -6.00, -9.00, -10.00, 3.00, -2.50] },
  },
  skills: [
    { id: 'tank_tlt',   role: 'tank',    instrument: 'TLT',   name: '장기채 ETF',  default: true,  lesson: '물가 서프라이즈는 금리 기대를 올려서 장기채도 같이 맞아요.' },
    { id: 'tank_shy',   role: 'tank',    instrument: 'SHY',   name: '단기채 ETF',                   lesson: '단기채는 거의 안 흔들리지만 크게 벌지도 않아요.' },
    { id: 'dealer_qqq', role: 'dealer',  instrument: 'QQQ',   name: '나스닥100 ETF',    default: true,  lesson: '성장주는 금리 기대가 올라가면 먼저 밀려요. 대신 회복도 빨라요.' },
    { id: 'dealer_tqqq',role: 'dealer',  instrument: 'TQQQ',  name: '나스닥100 3배',    unlockLevel: 5, lesson: '3배 레버리지는 반등 구간에선 3배로 벌고, 급락 구간에선 3배로 잃어요.' },
    { id: 'healer_gld', role: 'healer',  instrument: 'GLD',   name: '금 ETF',    default: true,  lesson: '금은 물가가 오를 때 함께 오르는 경우가 있어서, 물가 발표에 주식과 다르게 움직이기도 해요.' },
    { id: 'healer_cash',role: 'healer',  instrument: 'BIL',   name: '현금 대기',                   lesson: '현금은 숫자는 안 변하지만, 물가가 오르면 살 수 있는 게 줄어요.' },
    { id: 'healer_put', role: 'healer',  instrument: 'QQQ_P', blend: { QQQ_P: 0.25, BIL: 0.75 }, name: 'QQQ 풋옵션',  unlockLevel: 10, lesson: '발표 전엔 변동성이 높아 풋옵션 프리미엄이 비쌌지만, 하락 구간에서 값이 올랐어요. 반등하면 다시 가치가 줄어요.' },
    { id: 'support_schd',role:'support', instrument: 'SCHD',  name: '배당 ETF',    default: true,  lesson: '배당주는 성장주보다 덜 밀리고 덜 올라요.' },
  ],
  checkpoints: [
    { bar: 1, title: 'PCE 발표 직전', hint: '예상치는 3.7%로, 지난달보다 높아요. 풋옵션을 살까요, 금을 늘릴까요?', bull: '예상보다 낮게 나오면 물가가 잡힌다는 안도감에 성장주가 올라요.', bear: '예상보다 높으면 금리 인하가 늦어진다고 보고 나스닥과 장기채가 함께 빠져요. 이때는 풋옵션과 현금이 덜 빠져요.', allow: ['hold', 'equip', 'rebalance'] },
    { bar: 3, title: '장 시작 직전', hint: '장 전에 이미 많이 빠졌어요. 더 줄일까요, 반등을 노릴까요?', bull: '나쁜 소식이 다 반영됐다고 보면 장이 열리고 싸게 사려는 사람이 들어와요. 레버리지가 반등을 크게 타요.', bear: '장 전보다 장중에 더 빠지는 날도 많아요. 금과 현금 비중이 크면 덜 잃어요.', allow: ['hold', 'equip', 'rebalance'] },
  ],
});

mkdirSync('data/tapes', { recursive: true });
for (const t of [fomc, semi, pce]) { calibrate(t); writeFileSync(`data/tapes/${t.id}.json`, JSON.stringify(t, null, 1)); console.log(t.id, t.scale.note); }
writeFileSync('data/tapes/index.json', JSON.stringify([fomc, semi, pce].map(t => ({ id: t.id, title: t.title, boss: t.boss, market: t.market, date: t.bars[0].t })), null, 1));
console.log('wrote', [fomc, semi, pce].map(t => t.id).join(', '));
