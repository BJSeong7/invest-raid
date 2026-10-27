# 모험단 레이드 (invest-rpg)

실제 시장 이벤트가 보스가 되는 투자 교육 웹게임 엔진.
파티 비중 = 포트폴리오, 기술 = 실제 금융상품, 데미지 = 실제 등락률. 난수 없음.

```
npm install          # phaser, gsap, lightweight-charts (로컬 테스트용 사본)
npm test             # 엔진 자동 테스트 (node:test)
npm run tapes        # data/tapes/*.json 재생성 (예시 + 실제 종가 테이프)
npm run build        # dist/index.html (CDN 라이브러리, 배포용) + dist/local.html (로컬 테스트용)
npm run play         # Playwright 헤드리스 플레이스루 (한 판 끝까지 + 모바일 폭 점검)
npm run play:shots   # 위와 같되 shots/ 에 스크린샷 저장
```

## 구조

```
src/
  engine.js      순수 로직. 테이프 검증, 어댑터, 파티, 전투 상태기계, 판정, 등급/경험치, 코치 해설, what-if
  audio.js       WebAudio 합성 효과음·BGM (오디오 파일 없음)
  game.js        화면 흐름, Phaser 전투 씬(포즈+트윈), 차트(BattleChart), 체크포인트, 이벤트 자료, 도감·배지, 결과
  template.html  마크업 + CSS. 빌드 시 라이브러리·테이프·게임 코드가 삽입됨
scripts/
  make-tapes.mjs       예시 테이프 생성기 (이벤트 모양을 손으로 설계한 데이터)
  make-real-tapes.mjs  실제 일별 종가(stockanalysis.com)로 만든 실전 테이프 2개
  tape-from-bars.mjs   분봉/일봉 파일 → 테이프 변환기
  anime-import.py      AI 생성 시트 → 게임 스프라이트
  build.mjs            단일 HTML 빌드
art-src/         생성 원본 시트(크로마키 배경)
data/tapes/      테이프 JSON (레이드 1개 = 파일 1개)
test/
  engine.test.mjs 엔진 테스트
  play.mjs        헤드리스 플레이스루
```

핵심 원칙: **엔진은 데이터가 어디서 왔는지 모른다.** 리플레이든 라이브든 같은 테이프 형식으로 들어온다.
화면 층(Phaser)은 엔진이 돌려주는 턴 로그를 연출만 한다. 데미지는 절대 화면 층에서 계산하지 않는다.

## 테이프 형식

한 레이드 = 한 이벤트를 장중 구간(bar)으로 자른 것. 한 bar = 한 턴.

```jsonc
{
  "id": "fomc-2026-10-29",
  "title": "동결의 골렘 레이드", "boss": "동결의 골렘", "bossSpecies": "golem",   // golem | hydra | slime | bear
  "market": "US",                       // US | KR (표시용)
  "example": true,                      // 예시 데이터 표시. 실제 분봉이면 false
  "settled": true,                      // 라이브 테이프는 발표 전 false
  "briefing": "...", "lesson": "...",
  "concepts": [{ "name": "...", "text": "..." }],
  "instruments": { "QQQ": { "name": "나스닥100 ETF", "kind": "etf" } },   // kind: etf | lev | option | cash
  "skills": [
    { "id": "dealer_qqq", "role": "dealer", "instrument": "QQQ", "name": "질주 베기", "default": true, "lesson": "..." },
    { "id": "healer_put", "role": "healer", "instrument": "QQQ_P", "blend": { "QQQ_P": 0.25, "BIL": 0.75 }, "unlockLevel": 10 }
  ],
  "checkpoints": [{ "bar": 3, "title": "금리 결정 발표 1분 전", "hint": "...", "allow": ["hold", "equip", "rebalance"] }],
  "bars": [
    { "t": "2026-10-29T02:00:00+09:00", "label": "장중 대기", "prices": { "QQQ": 482.10, "TQQQ": 71.4, "...": 0 } }
  ]
}
```

- `prices`는 모든 instrument에 대해 모든 bar에 있어야 한다 (`validateTape`가 검사).
- `blend` 기술은 슬롯을 여러 상품에 나눈다. 옵션 기술은 슬롯의 20~25%만 옵션, 나머지는 현금이 기본.
- `unlockLevel`은 레벨 잠금. 화면의 '전 기술 해금' 토글(데모 모드)로 무시 가능.
- 체크포인트 `bar`는 "그 bar를 처리하기 **직전**에 멈춘다"는 뜻.

## 판정 규칙 (engine.js)

- 역할 슬롯 가치: 100에서 시작, 매 bar `slot *= 1 + ret × 배율 / 100`. 배율은 `HP_PER_PCT`(12), 옵션은 1.
  HP = min(100, slot), 100 초과분은 **실드**로 표시. 0이 되면 그 레이드에서 기절.
- 포트폴리오 수익률 = Σ 비중 × 기술 수익률. 보스 HP = `100 − 누적수익률 × BOSS_HP_PER_PCT`(40), 0~100 클램프.
  즉 +2.5%면 격파, 손실이면 보스는 무상.
- 등급: 기본 파티(default 기술, 25/40/20/15) 대비 초과수익으로 S/A/B/C/D/F. 경험치는 등급·수익·생존·격파로 계산.
- 컷인 분류: 포트폴리오 ±1% 이상이면 필살기/크리티컬, 한 역할 ±2% 이상이면 대피해/맹활약.
- `alternatives()`는 같은 시작 파티로 "모두 버티기 + 체크포인트별 단일 교체"를 전부 재실행해 최고/최악 선택을 찾는다.

## 데이터 어댑터

```js
import { ReplayAdapter, LiveAdapter } from './src/engine.js';
const replay = new ReplayAdapter(tapesFromJson);                 // 번들된 JSON
const live = new LiveAdapter('https://api.example/raids', url => fetch(url).then(r => r.json()));
// 두 어댑터 모두 list() -> [{id,title,boss,date,market,settled}], load(id) -> tape
```

### 실제 분봉으로 테이프 만들기

```
node scripts/tape-from-bars.mjs spec.json > data/tapes/<id>.json
```

`spec.json`에 컷 시각(`cuts`)과 심볼별 분봉 파일 경로(`instruments.*.bars`, JSON `[{t,c}]` 또는 CSV)를 적으면,
각 컷 시각 **이전의 마지막 종가**를 샘플링해 테이프를 만든다(미래 참조 없음). 옵션 계약도 같은 방식으로 한 심볼로 넣는다.
결과는 `validateTape`를 통과해야 저장된다. 자세한 형식은 스크립트 상단 주석 참고.

라이브 서버가 할 일: 이번 주 이벤트 일정 → 보스 생성(LLM, 사람 검수) → 발표 전엔 `settled:false` 테이프, 발표 후 실제 분봉으로 bars 채움.
실제 데이터 후보: 미국 ETF·옵션 분봉(Alpaca 등 시세 API), 국내 ETF 분봉(사내 시세). 사용 조건은 서비스 노출 전 확인.

## AI 코치

현재 `coachText()`는 규칙 기반(결정적)이다. LLM으로 바꿀 때는 같은 입력(파티 구성, 턴 로그, 체크포인트 선택, 개념 카드)을
프롬프트로 넘기고 출력 형식만 맞추면 된다. 가드레일: 개념 설명만, 특정 상품 매수·매도 판단과 수익 전망 금지.

## 아트 파이프라인 (AI 생성 치비 아트)

캐릭터 4종·보스 5종·배경·이펙트는 이 프로젝트를 위해 생성한 **오리지널 디자인**이다 (Figma AI 이미지 생성, Gemini 모델, 총 12장).
생성 원본 시트는 `art-src/`에, 게임용 스프라이트는 `dist/assets/anime/`에 있다.

```
python3 scripts/anime-import.py      # art-src/sheet_*.png -> dist/assets/anime/*  (크로마키 → 포즈 분리 → 공통 기준선 크롭 → 초상화)
```

- 한 시트 = 한 캐릭터의 3포즈(idle / attack / hurt). 같은 시트의 포즈는 같은 높이·발 위치로 잘라서 Phaser에서 텍스처만 바꿔도 발이 땅에 붙어 있다.
- 전투 연출은 스프라이트 시트 애니메이션이 아니라 **정지 포즈 + 트윈**(바운스·돌진·넉백·스쿼시) + VFX 스프라이트(`fx_*.png`)로 만든다. 포켓몬류 연출 방식.
- 새 보스를 추가하려면: 같은 프롬프트 규칙(3포즈, 왼쪽 보기, #00FF00 배경)으로 시트를 만들어 `art-src/sheet_boss_<이름>.png`로 두고 `anime-import.py`의 `SHEETS`, `game.js`의 `UNIT_OF_BOSS`/`BOSS_STYLE`/`BOSS_MOVES`에 한 줄씩 추가한다.
- 기업 로고(`dist/assets/logos/`)는 Brandfetch에서 받은 각 사 등록상표로, 해당 기업의 실적·이벤트를 설명하는 자리에만 쓴다.

## 이벤트 자료 (테이프 `event`)

```jsonc
"event": { "kind": "earnings|fomc|macro", "company": "Meta Platforms", "logo": "assets/logos/meta.png",
  "logos": [{ "src": "...", "name": "Meta" }], "source": "출처",
  "facts": [ { "at": 0, "label": "시장 예상 매출", "value": "$63.2B" },                     // at = 이 사실이 공개되는 bar 인덱스
             { "at": 6, "label": "매출", "value": "$64.6B (+26%)", "note": "예상 상회", "good": true } ] }
```

브리핑에는 첫 체크포인트 이전(`at <= 첫 cp bar`) 사실만, 체크포인트에는 `at <= cp.bar`, 전투 중엔 턴이 지날 때 새로 공개되는 사실이 "속보"로 뜬다. 발표 전 스포일러가 나가지 않도록 `at`을 정확히 적는다.

## 라이선스·고지

- 캐릭터·보스·배경·이펙트: 이 프로젝트를 위해 AI로 생성한 오리지널 디자인 (`dist/assets/anime/CREDITS.txt`). 유명 캐릭터·실존 인물을 본뜨지 않는다.
- 기업 로고: 각 사의 등록상표(Brandfetch 경유). 교육 목적의 사실 설명에만 쓰고, 상표권은 각 회사에 있다 (`dist/assets/logos/CREDITS.txt`).
- 효과음: 이 저장소에서 코드로 합성한 오리지널.
- 차트: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache 2.0). 화면의 TradingView 로고 표기는 라이선스 조건이므로 지우지 말 것.
- Phaser(MIT), GSAP(표준 라이선스, 무료 사용 범위 확인).
- 예시 테이프의 가격은 실제 시세가 아니다. 특정 상품의 투자권유가 아니다.
