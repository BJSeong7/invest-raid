// Historical scenarios (chapters 2 and 3 of the map). Daily closes from Yahoo Finance chart data, collected 2026-10-27
// (split-adjusted, not dividend-adjusted), stored in data/history/<id>.txt as "TICKER:close close ..." in cut order.
// Event facts are public record; price moves in facts are computed from the same closes, never typed by hand.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildTape } from './tape-from-bars.mjs';
import { calibrate } from './calibrate.mjs';

const SOURCE = 'Yahoo Finance 일별 종가 (2026-10-27 수집)';
const off = d => { const m = new Date(`${d}T12:00:00Z`).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/); return `${m[1][0]}0${m[1].slice(1)}:00`; };
const T = d => `${d}T16:00:00${off(d)}`;

/* ---------- derivatives (chart mode only): QQQ-based approximations ---------- */
const FUT_X = 5, RATE = 0.04, DTE = 30;
const ncdf = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function bs(S, K, Ty, iv, call) {
  if (Ty <= 0) return Math.max(0, call ? S - K : K - S);
  const d1 = (Math.log(S / K) + (RATE + iv * iv / 2) * Ty) / (iv * Math.sqrt(Ty)), d2 = d1 - iv * Math.sqrt(Ty);
  return call ? S * ncdf(d1) - K * Math.exp(-RATE * Ty) * ncdf(d2) : K * Math.exp(-RATE * Ty) * ncdf(-d2) - S * ncdf(-d1);
}
function derivSeries(q, iv) {
  const K = q[0].c, t0 = q[0].t; let fl = 100, fs = 100;
  const NQF = [{ t: q[0].t, c: 100 }], NQFS = [{ t: q[0].t, c: 100 }];
  for (let i = 1; i < q.length; i++) { const r = q[i].c / q[i - 1].c - 1; fl *= 1 + FUT_X * r; fs *= 1 - FUT_X * r; NQF.push({ t: q[i].t, c: +fl.toFixed(4) }); NQFS.push({ t: q[i].t, c: +Math.max(0.01, fs).toFixed(4) }); }
  const Ty = b => Math.max(0, DTE - (b.t - t0) / 86400000) / 365;
  return { NQF, NQFS, QQQP: q.map(b => ({ t: b.t, c: Math.max(0.01, +bs(b.c, K, Ty(b), iv, false).toFixed(3)) })), QQQC: q.map(b => ({ t: b.t, c: Math.max(0.01, +bs(b.c, K, Ty(b), iv, true).toFixed(3)) })) };
}

/* ---------- shared instruments and skills ---------- */
const INSTRUMENTS = {
  QQQ: { name: '나스닥100 ETF (QQQ)', kind: 'etf' }, TQQQ: { name: '나스닥100 3배 레버리지 (TQQQ)', kind: 'lev' }, SOXX: { name: '미국 반도체 ETF (SOXX)', kind: 'etf' },
  TLT: { name: '미국 장기채 ETF (TLT)', kind: 'etf' }, SHY: { name: '미국 단기채 ETF (SHY)', kind: 'etf' }, GLD: { name: '금 ETF (GLD)', kind: 'etf' },
  BIL: { name: '초단기 국채 ETF (BIL)', kind: 'cash' }, SQQQ: { name: '나스닥100 3배 인버스 (SQQQ)', kind: 'option' }, SCHD: { name: '미국 배당 ETF (SCHD)', kind: 'etf' },
  NQF: { name: '나스닥100 선물 매수 (근사치)', kind: 'future' }, NQFS: { name: '나스닥100 선물 매도 (근사치)', kind: 'future' },
  QQQP: { name: 'QQQ 풋옵션 (모델 가격)', kind: 'option' }, QQQC: { name: 'QQQ 콜옵션 (모델 가격)', kind: 'option' },
};
const SKILLS = () => [
  { id: 'tank_tlt', role: 'tank', instrument: 'TLT', name: '장기채 방패', default: true, lesson: '장기채는 금리가 내릴 것 같을 때 오르고, 오를 것 같을 때 떨어져요.' },
  { id: 'tank_shy', role: 'tank', instrument: 'SHY', name: '단기채 벽', lesson: '단기채는 거의 안 흔들리지만 크게 벌지도 않아요.' },
  { id: 'dealer_qqq', role: 'dealer', instrument: 'QQQ', name: '질주 베기', default: true, lesson: '나스닥100은 금리와 경기 소식에 가장 크게 반응해요.' },
  { id: 'dealer_soxx', role: 'dealer', instrument: 'SOXX', name: '반도체 돌격', lesson: '반도체는 지수보다 두 배쯤 크게 움직여요.' },
  { id: 'dealer_tqqq', role: 'dealer', instrument: 'TQQQ', name: '폭주 돌진', unlockLevel: 5, lesson: '3배 레버리지는 하루 움직임을 세 배로 키워요. 급락장에선 순식간에 크게 잃어요.' },
  { id: 'healer_gld', role: 'healer', instrument: 'GLD', name: '황금 가호', default: true, lesson: '금은 불안할 때 오르는 경우가 많지만, 현금이 급할 땐 같이 팔리기도 해요.' },
  { id: 'healer_cash', role: 'healer', instrument: 'BIL', name: '현금 대기', lesson: '현금은 안 다치지만 반등도 못 타요.' },
  { id: 'healer_sqqq', role: 'healer', instrument: 'SQQQ', blend: { SQQQ: 0.25, BIL: 0.75 }, name: '역방향 부적', unlockLevel: 10, lesson: '이 자리의 25%만 3배 인버스에 뒀어요. 급락하면 크게 벌고, 반등하면 크게 잃어요.' },
  { id: 'support_schd', role: 'support', instrument: 'SCHD', name: '배당의 축복', default: true, lesson: '배당주는 급락 때 덜 빠지는 편이지만, 금융주 비중이 있어 은행 위기엔 흔들려요.' },
  { id: 'dealer_nqf', role: 'dealer', instrument: 'NQF', name: '나스닥100 선물 매수', chartOnly: true, lesson: '선물은 증거금보다 훨씬 큰 금액이 움직여요. 여기서는 지수 등락의 5배로 계산했어요.' },
  { id: 'dealer_call', role: 'dealer', instrument: 'QQQC', blend: { QQQC: 0.2, BIL: 0.8 }, name: 'QQQ 콜옵션 + 현금', chartOnly: true, lesson: '이 자리의 20%로 콜옵션을 사요. 오르면 크게 벌고, 안 오르면 프리미엄만큼 잃어요.' },
  { id: 'healer_put', role: 'healer', instrument: 'QQQP', blend: { QQQP: 0.2, BIL: 0.8 }, name: 'QQQ 풋옵션 + 현금', chartOnly: true, lesson: '이 자리의 20%로 풋옵션을 사요. 떨어질 때 보험이 되고, 아무 일 없으면 프리미엄이 줄어요.' },
  { id: 'healer_nqfs', role: 'healer', instrument: 'NQFS', blend: { NQFS: 0.2, BIL: 0.8 }, name: '나스닥100 선물 매도 + 현금', chartOnly: true, lesson: '선물 매도는 지수가 내리면 벌고 오르면 잃어요. 이 자리의 20%만 썼어요.' },
];

/* ---------- scenarios ---------- */
// cut labels: [date, label]; facts may use {calc:[ticker, fromCut, toCut]} to compute a % move from the closes
const S = [
  { id: 'svb-2023', file: 'svb', title: '2023 SVB 은행 위기', boss: '뱅크런 소', bossSpecies: 'minotaur', iv: 0.25,
    cuts: [['2023-03-03', '평온한 금요일'], ['2023-03-06', '관망'], ['2023-03-07', '파월 의회 증언'], ['2023-03-08', '은행 한 곳 청산'], ['2023-03-09', 'SVB 주가 폭락'], ['2023-03-10', 'SVB 파산'], ['2023-03-13', '예금 보호 발표 다음 날'], ['2023-03-14', '은행주 반등'], ['2023-03-16', '대형 은행 공동 지원'], ['2023-03-17', '주말 전']],
    event: { kind: 'crisis', company: '실리콘밸리은행(SVB) 파산', facts: [
      { at: 2, label: '파월 의회 증언', value: '금리를 예상보다 더 올릴 수 있다', good: false },
      { at: 4, label: 'SVB 주가', value: '하루 약 −60%', note: '채권 손실과 증자 발표', good: false },
      { at: 5, label: '미국 예금보험공사', value: 'SVB 폐쇄, 관리 시작', good: false },
      { at: 6, label: '정부 발표 (3/12 일요일)', value: '예금 전액 보호 + 은행 긴급 대출', good: true },
      { at: 9, label: '이 구간 장기채(TLT)', calc: ['TLT', 0, 9] }, { at: 9, label: '이 구간 금(GLD)', calc: ['GLD', 0, 9] }] },
    briefing: '2023년 3월, 미국 실리콘밸리은행이 이틀 만에 무너졌어요. 금리가 빠르게 오르면서 은행이 들고 있던 채권 값이 떨어진 게 시작이었어요.',
    lesson: '위기 때 안전자산이 제 역할을 했어요. 장기채와 금이 오르고, 금리 인상이 멈출 거라는 기대에 나스닥도 반등했어요.',
    concepts: [{ name: '안전자산으로의 이동', text: '불안이 커지면 돈이 국채와 금으로 몰려요. 이 주에 장기채와 금이 함께 올랐어요.' }, { name: '금리와 채권 가격', text: '금리가 오르면 이미 발행된 채권 값은 떨어져요. SVB가 무너진 이유가 바로 이거였어요.' }, { name: '업종 쏠림', text: '배당주 ETF에는 금융주가 들어 있어요. 은행 위기 때는 배당주도 흔들려요.' }],
    checkpoints: [
      { bar: 5, title: 'SVB 주가가 무너진 다음 날', hint: '어제 실리콘밸리은행 주가가 60% 가까이 빠졌어요. 위기가 다른 은행으로 번질까요?', bull: '은행 한 곳에서 멈추면, 금리 인상이 끝날 거라는 기대에 성장주가 오를 수 있어요.', bear: '다른 은행으로 번지면 시장 전체가 흔들려요. 장기채와 금이 피난처가 돼요.' },
      { bar: 6, title: '예금 보호 발표 다음 날 아침', hint: '일요일 밤 정부가 예금을 전액 보호하겠다고 했어요. 월요일 시장은 어떻게 반응할까요?', bull: '공포가 줄면 반등해요.', bear: '은행 불안이 남으면 금융주가 많은 배당주가 계속 흔들려요.' }] },

  { id: 'carry-2024', file: 'carry', title: '2024 엔 캐리 청산', boss: '엔화 와이번', bossSpecies: 'wyvern', iv: 0.22,
    cuts: [['2024-07-26', '주말 전'], ['2024-07-29', 'FOMC 주간'], ['2024-07-30', '반도체 약세'], ['2024-07-31', '일본 금리 인상 · 연준 동결'], ['2024-08-01', '경기 걱정'], ['2024-08-02', '고용 쇼크'], ['2024-08-05', '일본 증시 폭락'], ['2024-08-06', '반등'], ['2024-08-08', '실업수당 안도'], ['2024-08-09', '주말 전']],
    event: { kind: 'crisis', company: '엔 캐리 트레이드 청산', facts: [
      { at: 3, label: '일본은행', value: '기준금리 0.25%로 인상', good: false },
      { at: 3, label: '연준', value: '동결, 9월 인하 가능성 언급', good: true },
      { at: 4, label: '반도체(SOXX) 하루', calc: ['SOXX', 3, 4] },
      { at: 5, label: '7월 미국 고용', value: '+11.4만 명 · 실업률 4.3%', note: '예상보다 크게 부진', good: false },
      { at: 6, label: '닛케이225 (8/5)', value: '하루 −12.4%', good: false }] },
    briefing: '2024년 여름, 일본이 금리를 올리자 싼 엔화를 빌려 투자하던 돈이 한꺼번에 빠져나갔어요. 미국 고용까지 나쁘게 나오며 공포가 커졌어요.',
    lesson: '공포가 가장 클 때가 바닥 근처인 경우가 많아요. 이 구간에서는 일본 증시가 폭락한 8월 5일이 나스닥의 바닥이었어요.',
    concepts: [{ name: '캐리 트레이드', text: '금리가 낮은 나라의 돈을 빌려 다른 곳에 투자하는 거예요. 빌린 나라의 금리가 오르면 한꺼번에 되갚느라 시장이 흔들려요.' }, { name: '공포와 바닥', text: '모두가 팔 때가 가장 싼 때인 경우가 많아요. 다만 미리 알 수는 없어요.' }, { name: '채권의 방패', text: '경기 걱정이 커지면 금리가 내려갈 거라 보고 장기채가 올라요.' }],
    checkpoints: [
      { bar: 5, title: '고용보고서 발표일 아침', hint: '오늘 밤 7월 고용이 나와요. 어제 경기 걱정에 반도체가 7% 넘게 빠졌어요.', bull: '고용이 괜찮게 나오면 걱정이 줄고 반등해요.', bear: '고용이 나쁘면 경기 침체 걱정이 커져요. 장기채가 오르고 주식이 빠져요.' },
      { bar: 6, title: '월요일 아침, 아시아 증시 폭락', hint: '일본 증시가 하루에 12% 넘게 빠지고 있어요. 엔화를 빌려 투자하던 돈이 한꺼번에 빠져나가요.', bull: '이미 많이 빠졌다고 보면 반등을 노릴 때예요.', bear: '공포가 미국까지 번지면 하루 더 크게 빠져요. 장기채가 막아 줘요.' }] },

  { id: 'tariff-2025', file: 'tariff', title: '2025 관세 쇼크', boss: '관세 거인', bossSpecies: 'minotaur', iv: 0.35,
    cuts: [['2025-03-28', '주말 전'], ['2025-03-31', '분기 마지막 날'], ['2025-04-01', '발표 대기'], ['2025-04-02', '관세 발표일'], ['2025-04-03', '발표 다음 날'], ['2025-04-04', '중국 보복 관세'], ['2025-04-07', '변동성 폭발'], ['2025-04-08', '반등 실패'], ['2025-04-09', '90일 유예 발표'], ['2025-04-10', '되돌림'], ['2025-04-11', '주말 전']],
    event: { kind: 'crisis', company: '미국 상호 관세 발표', facts: [
      { at: 3, label: '상호 관세 발표', value: '4/2 장 마감 후, 대부분의 나라에 추가 관세', good: false },
      { at: 5, label: '이틀 동안 QQQ', calc: ['QQQ', 3, 5] },
      { at: 5, label: '중국', value: '미국산 제품에 34% 보복 관세', good: false },
      { at: 8, label: '관세 유예', value: '중국 외 국가 90일 유예', good: true },
      { at: 8, label: '그날 QQQ', calc: ['QQQ', 7, 8] },
      { at: 10, label: '이 구간 장기채(TLT)', calc: ['TLT', 3, 10] }] },
    briefing: '2025년 4월 2일, 미국이 대부분의 나라에 높은 관세를 발표했어요. 이틀 만에 나스닥이 10% 넘게 빠졌고, 일주일 뒤 유예 발표에 하루 만에 12% 올랐어요.',
    lesson: '정책 하나에 시장이 양쪽으로 크게 움직였어요. 폭락 중에 판 사람은 하루 만의 반등을 놓쳤고, 이번엔 장기채도 함께 빠졌어요.',
    concepts: [{ name: '정책 리스크', text: '정부 발표 하나로 시장이 며칠 만에 크게 오르내릴 수 있어요. 방향보다 크기에 대비해야 해요.' }, { name: '채권이 같이 빠질 때', text: '보통 주식이 빠지면 장기채가 오르지만, 이번엔 장기채도 함께 빠졌어요. 방패가 늘 통하는 건 아니에요.' }, { name: '금의 역할', text: '이 구간 끝에는 금이 사상 최고치 근처까지 올랐어요.' }],
    checkpoints: [
      { bar: 4, title: '관세 발표 다음 날 아침', hint: '어젯밤 예상보다 훨씬 높은 관세가 발표됐어요. 선물 시장이 크게 빠져 있어요.', bull: '나쁜 소식이 다 나왔다고 보면 싸게 사려는 사람이 들어올 수 있어요.', bear: '무역 전쟁으로 번지면 며칠 더 빠질 수 있어요. 금과 현금이 막아 줘요.' },
      { bar: 8, title: '폭락 일주일째', hint: '일주일 새 나스닥100이 12% 넘게 빠졌어요. 여기서 피할까요, 버틸까요?', bull: '정책이 바뀌면 하루에 크게 되돌릴 수 있어요.', bear: '협상 소식이 없으면 바닥이 더 낮을 수 있어요.' }] },

  { id: 'covid-2020', file: 'covid', title: '2020 코로나 폭락', boss: '공포의 해골', bossSpecies: 'skeleton', iv: 0.6,
    cuts: [['2020-02-19', '사상 최고치'], ['2020-02-24', '유럽 확산'], ['2020-02-27', '하락 가속'], ['2020-03-03', '긴급 금리 인하'], ['2020-03-06', '주말 전'], ['2020-03-09', '유가 폭락'], ['2020-03-12', '팬데믹 선언 다음 날'], ['2020-03-16', '제로 금리 다음 날'], ['2020-03-23', '무제한 양적완화'], ['2020-03-24', '반등']],
    event: { kind: 'crisis', company: '코로나19 팬데믹', facts: [
      { at: 2, label: '고점 대비 QQQ', calc: ['QQQ', 0, 2] },
      { at: 3, label: '연준', value: '긴급 0.5%p 금리 인하', good: true },
      { at: 6, label: 'WHO', value: '팬데믹 선언 (3/11)', good: false },
      { at: 7, label: '연준 (3/15 일요일)', value: '금리 0~0.25%로 인하', good: true },
      { at: 7, label: '고점 대비 QQQ', calc: ['QQQ', 0, 7] },
      { at: 8, label: '연준', value: '무제한 양적완화 발표', good: true },
      { at: 9, label: '이 구간 장기채(TLT)', calc: ['TLT', 0, 9] }] },
    briefing: '2020년 2월, 코로나가 전 세계로 번지며 한 달 만에 나스닥이 30% 가까이 빠졌어요. 이 판은 그 한 달을 버티는 판이에요.',
    lesson: '이런 폭락에서는 금도 함께 빠졌고, 끝까지 버텨 준 건 장기채였어요. 그리고 반등은 정책이 쏟아진 뒤에 왔어요.',
    concepts: [{ name: '진짜 폭락의 모습', text: '한 달 동안 하루 5~10%씩 오르내렸어요. 계획 없이 들어가면 버티기 어려운 장이에요.' }, { name: '금도 팔릴 때', text: '현금이 급해지면 사람들은 금까지 팔아요. 3월 중순에 금도 함께 빠졌어요.' }, { name: '정책과 바닥', text: '금리 인하와 양적완화가 쏟아진 뒤에야 바닥이 나왔어요.' }],
    checkpoints: [
      { bar: 3, title: '하락 일주일째', hint: '고점에서 일주일 만에 13% 빠졌어요. 여기가 바닥일까요?', bull: '각국이 돈을 풀면 반등할 수 있어요.', bear: '확산이 멈추지 않으면 더 빠져요. 장기채가 가장 든든한 방패예요.' },
      { bar: 7, title: '제로 금리 발표 다음 날 아침', hint: '어젯밤 연준이 금리를 0 가까이 내렸어요. 그런데 시장은 오히려 더 겁을 먹고 있어요.', bull: '정책이 쏟아지면 결국 반등해요.', bear: '오늘은 공포가 더 클 수 있어요. 금도 현금이 필요한 사람들에게 팔리고 있어요.' }] },

  { id: 'cpi-2022-06', file: 'cpi22jun', title: '2022 자이언트 스텝', boss: '물가 불개미', bossSpecies: 'fireant', iv: 0.32,
    cuts: [['2022-06-08', '물가 발표 이틀 전'], ['2022-06-09', '유럽 긴축 예고'], ['2022-06-10', '5월 물가 발표'], ['2022-06-13', '약세장 진입'], ['2022-06-14', 'FOMC 1일차'], ['2022-06-15', '자이언트 스텝'], ['2022-06-16', '다음 날 급락'], ['2022-06-17', '주말 전'], ['2022-06-24', '반등']],
    event: { kind: 'fomc', company: '미국 물가와 FOMC', facts: [
      { at: 2, label: '5월 소비자물가', value: '+8.6%', note: '41년 만에 가장 높음', good: false },
      { at: 5, label: '연준', value: '0.75%p 인상 → 1.50~1.75%', note: '1994년 이후 가장 큰 폭', good: false },
      { at: 6, label: '다음 날 QQQ', calc: ['QQQ', 5, 6] }] },
    briefing: '2022년 6월, 물가가 41년 만에 가장 높게 나오자 연준이 28년 만에 가장 큰 폭으로 금리를 올렸어요.',
    lesson: '금리 인상이 확정된 날은 오히려 올랐지만, 다음 날 경기 걱정에 더 크게 빠졌어요. 2022년엔 채권도 함께 약했어요.',
    concepts: [{ name: '자이언트 스텝', text: '보통 0.25%p씩 올리던 금리를 한 번에 0.75%p 올리는 걸 말해요.' }, { name: '주식과 채권이 같이 빠질 때', text: '물가 때문에 금리가 오르면 주식과 채권이 함께 약해져요. 2022년이 그랬어요.' }],
    checkpoints: [
      { bar: 2, title: '물가 발표일 아침', hint: '오늘 5월 물가가 나와요. 시장은 물가가 정점을 찍었기를 바라고 있어요.', bull: '물가가 꺾이면 안도하며 올라요.', bear: '또 높게 나오면 금리를 더 크게 올릴 거라는 걱정에 크게 빠져요.' },
      { bar: 5, title: '금리 결정일', hint: '이번 주 들어 0.75%p 인상 전망이 퍼졌어요. 이미 가격에 들어갔을까요?', bull: '다 알려진 결정이면 발표 날은 안도하며 오를 수 있어요.', bear: '경기 침체 걱정이 커지면 며칠 더 빠져요.' }] },

  { id: 'jackson-2022', file: 'jh22', title: '2022 잭슨홀 연설', boss: '잭슨홀 마법사', bossSpecies: 'lich', iv: 0.28,
    cuts: [['2022-08-19', '여름 랠리 끝자락'], ['2022-08-22', '관망'], ['2022-08-24', '연설 대기'], ['2022-08-25', '연설 전날'], ['2022-08-26', '파월 연설'], ['2022-08-29', '다음 주 월요일'], ['2022-08-31', '월말'], ['2022-09-02', '주말 전']],
    event: { kind: 'fomc', company: '파월 의장 잭슨홀 연설', facts: [
      { at: 4, label: '연설 (8/26)', value: '약 8분, "가계와 기업이 고통을 겪을 것"', good: false },
      { at: 4, label: '그날 QQQ', calc: ['QQQ', 3, 4] },
      { at: 7, label: '연설 뒤 일주일 QQQ', calc: ['QQQ', 3, 7] }] },
    briefing: '2022년 8월, 여름 내내 오르던 시장이 파월 의장의 짧은 연설 하나에 방향을 바꿨어요.',
    lesson: '중앙은행의 말 한마디가 몇 달 동안 쌓인 기대를 뒤집을 수 있어요. 연설 뒤 일주일 동안 나스닥은 계속 밀렸어요.',
    concepts: [{ name: '말이 곧 정책', text: '실제 금리를 바꾸지 않아도, 앞으로 어떻게 하겠다는 말만으로 시장이 움직여요.' }, { name: '기대의 되돌림', text: '좋은 쪽으로 기대가 많이 쌓였을수록 실망했을 때 크게 빠져요.' }],
    checkpoints: [
      { bar: 4, title: '연설 당일 아침', hint: '오늘 파월 의장이 잭슨홀에서 연설해요. 여름 내내 시장은 금리 인상이 곧 멈출 거라 기대하며 올랐어요.', bull: '부드러운 말이 나오면 랠리가 이어져요.', bear: '물가를 잡을 때까지 계속 올리겠다고 하면 크게 빠져요.' }] },

  { id: 'cpi-2022-09', file: 'cpi22sep', title: '2022 9월 물가 쇼크', boss: '불개미 여왕', bossSpecies: 'fireant', iv: 0.3,
    cuts: [['2022-09-07', '반등 시작'], ['2022-09-08', '반등 이틀째'], ['2022-09-09', '반등 사흘째'], ['2022-09-12', '반등 나흘째'], ['2022-09-13', '8월 물가 발표'], ['2022-09-14', '다음 날'], ['2022-09-15', '경기 걱정'], ['2022-09-16', '주말 전']],
    event: { kind: 'macro', company: '미국 8월 소비자물가', facts: [
      { at: 3, label: '나흘 동안 QQQ', calc: ['QQQ', 0, 3] },
      { at: 4, label: '8월 소비자물가', value: '+8.3% (예상 8.1%)', good: false },
      { at: 4, label: '그날 QQQ', calc: ['QQQ', 3, 4] }] },
    briefing: '2022년 9월, 시장은 물가가 꺾였다고 믿고 나흘 연속 올랐어요. 발표 하루에 그 기대가 무너졌어요.',
    lesson: '기대가 크게 쌓인 날은 예상과 조금만 달라도 크게 움직여요. 이날 나스닥100은 하루에 5% 넘게 빠졌어요.',
    concepts: [{ name: '예상과의 차이', text: '물가가 8.1%든 8.3%든 높기는 마찬가지지만, 시장은 예상과의 차이 0.2%p에 크게 반응했어요.' }, { name: '하루의 무게', text: '나흘 동안 번 걸 하루에 다 잃을 수 있어요. 발표 날에는 비중을 미리 생각해 둬야 해요.' }],
    checkpoints: [
      { bar: 4, title: '물가 발표일 아침', hint: '나흘 연속 올랐어요. 시장은 물가가 내려왔기를 기대하고 있어요.', bull: '물가가 예상보다 낮으면 랠리가 이어져요.', bear: '예상보다 높으면 크게 빠져요. 기대가 클수록 실망도 커요.' }] },

  { id: 'cpi-2022-11', file: 'cpi22nov', title: '2022 11월 물가 반전', boss: '반전 마법사', bossSpecies: 'lich', iv: 0.32,
    cuts: [['2022-11-03', '금리 인상 다음 날'], ['2022-11-04', '고용 발표'], ['2022-11-07', '선거 주간'], ['2022-11-08', '중간선거'], ['2022-11-09', '선거 다음 날'], ['2022-11-10', '10월 물가 발표'], ['2022-11-11', '다음 날'], ['2022-11-15', '랠리 이어짐']],
    event: { kind: 'macro', company: '미국 10월 소비자물가', facts: [
      { at: 5, label: '10월 소비자물가', value: '+7.7% (예상 7.9%)', good: true },
      { at: 5, label: '그날 QQQ', calc: ['QQQ', 4, 5] },
      { at: 5, label: '그날 3배 인버스(SQQQ)', calc: ['SQQQ', 4, 5] }] },
    briefing: '2022년 11월, 1년 내내 시장을 괴롭힌 물가가 처음으로 예상보다 낮게 나왔어요.',
    lesson: '반전은 예고 없이 하루에 와요. 이날 나스닥100이 7% 넘게 올랐고, 하락에 베팅한 사람은 크게 잃었어요.',
    concepts: [{ name: '숏 스퀴즈', text: '하락에 베팅한 사람이 많을 때 좋은 소식이 나오면, 손실을 막으려는 매수가 몰려 더 크게 올라요.' }, { name: '인버스의 위험', text: '3배 인버스는 반등 하루에 20% 넘게 잃을 수 있어요.' }],
    checkpoints: [
      { bar: 5, title: '물가 발표일 아침', hint: '1년 내내 물가에 맞아 온 시장이에요. 이번에도 높으면 바닥을 새로 쓸 수 있어요.', bull: '물가가 꺾이면 하루에 크게 튀어요. 인버스는 큰 손실이 나요.', bear: '또 높게 나오면 다시 빠져요.' }] },
];

/* ---------- build ---------- */
const pct = (a, b) => { const v = 100 * (b / a - 1); return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`; };
mkdirSync('data/tapes', { recursive: true });
const out = [];
for (const sc of S) {
  const rows = Object.fromEntries(readFileSync(`data/history/${sc.file}.txt`, 'utf8').trim().split('\n').map(l => { const [k, v] = l.split(':'); return [k, v.trim().split(/\s+/).map(Number)]; }));
  const dates = sc.cuts.map(c => c[0]);
  rows.QQQ.forEach((v, i) => { if (!Number.isFinite(v)) throw new Error(`${sc.id}: missing QQQ ${dates[i]}`); });
  const series = Object.fromEntries(Object.entries(rows).map(([k, arr]) => [k, arr.map((c, i) => ({ t: Date.parse(T(dates[i])), c }))]));
  Object.assign(series, derivSeries(series.QQQ, sc.iv));
  const facts = sc.event.facts.map(f => f.calc ? (() => { const [tk, a, b] = f.calc, v = pct(rows[tk][a], rows[tk][b]); return { at: f.at, label: f.label, value: v, good: !v.startsWith('−') }; })() : f);
  const tape = buildTape({
    id: sc.id, title: sc.title, boss: sc.boss, bossSpecies: sc.bossSpecies, market: 'US', daily: true, source: SOURCE,
    scale: { hpPerPct: 8, bossHpPerPct: 15 },
    event: { kind: sc.event.kind, company: sc.event.company, ticker: sc.id.toUpperCase(), logo: null, source: `${SOURCE} · 공개 발표 자료`, facts },
    briefing: sc.briefing, lesson: sc.lesson, concepts: sc.concepts,
    cuts: sc.cuts.map(([d, label]) => ({ t: T(d), label })),
    instruments: Object.fromEntries(Object.entries(INSTRUMENTS).map(([k, v]) => [k, { ...v, bars: k }])),
    skills: SKILLS(),
    checkpoints: sc.checkpoints.map(c => ({ allow: ['hold', 'equip', 'rebalance'], ...c })),
  }, key => series[key]);
  tape.history = true;
  calibrate(tape);
  writeFileSync(`data/tapes/${tape.id}.json`, JSON.stringify(tape, null, 1));
  out.push(`${tape.id} ${tape.bars.length - 1} turns · ${tape.scale.note} · QQQ ${pct(rows.QQQ[0], rows.QQQ.at(-1))}`);
}
console.log(out.join('\n'));
