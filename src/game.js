// Game layer: screens, Phaser battle scene, cut-ins, checkpoint modal, chart, result.
// The build concatenates engine.js + art.js + audio.js + this file into one inline module, so these imports
// exist for editors/tests only and are stripped at build time.
import { ROLES, ROLE_META, ReplayAdapter, defaultParty, validateParty, createBattle, step, intervene, nextCheckpoint, settle, coachText, contribution, applyExp, expNext, alternatives } from './engine.js';
import { CHARACTERS, BOSSES, svgUri, rasterize, hurtSvg } from './art.js';
import { unlock, setMuted, isMuted, sfx, startBgm, stopBgm } from './audio.js';

const TAPES = window.__TAPES__ || [];
const adapter = new ReplayAdapter(TAPES);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtPct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const fmtTime = iso => iso.slice(11, 16);
const fmtDate = iso => `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const charOf = role => CHARACTERS[ROLE_META[role].species];
const ROLE_COLOR = { tank: 'var(--tank)', dealer: 'var(--dealer)', healer: 'var(--healer)', support: 'var(--support)' };
const ROLE_HEX = { tank: 0x8EA0B8, dealer: 0x6E9BFF, healer: 0xF2C14E, support: 0x6FD39A };
const UNLOCKS = { 5: '폭주 돌진 (레버리지 ETF)', 10: '도토리 보험 (풋옵션)' };

/* ------------------------------------------------------------------ */
/* Profile (per-viewer convenience only; wrapped in try/catch)         */
/* ------------------------------------------------------------------ */
const PROFILE_KEY = 'invest-rpg.profile.v1';
let profile = loadProfile();
function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY)); if (p && p.level) return { plays: {}, ...p }; } catch {}
  return { level: 1, exp: 0, unlockAll: false, plays: {} };
}
function saveProfile() { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {} }
function effectiveLevel() { return profile.unlockAll ? 99 : profile.level; }
function renderProfile() {
  $('#pLv').textContent = 'Lv.' + profile.level;
  $('#pExp').style.width = (100 * profile.exp / expNext(profile.level)) + '%';
  $('#pExpTxt').textContent = `${profile.exp} / ${expNext(profile.level)}`;
  $('#unlockBtn').setAttribute('aria-pressed', String(!!profile.unlockAll));
  $('#unlockBtn').textContent = profile.unlockAll ? '전 기술 해금 중' : '전 기술 해금';
}

/* ------------------------------------------------------------------ */
/* Screens                                                             */
/* ------------------------------------------------------------------ */
const SCREENS = ['select', 'brief', 'party', 'battle', 'result'];
function showScreen(name) {
  SCREENS.forEach(s => { $('#screen-' + s).hidden = s !== name; });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg;
  gsap.killTweensOf(t);
  gsap.fromTo(t, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: .25, onComplete: () => gsap.to(t, { opacity: 0, y: 10, duration: .3, delay: ms / 1000 }) });
}

/* ---------- 1. raid select ---------- */
let currentTape = null, party = null;
function renderSelect() {
  $('#partyPreview').innerHTML = ROLES.map(r => `<img src="${svgUri(charOf(r).svg)}" alt="${charOf(r).name}">`).join('');
  $('#raids').innerHTML = '';
  TAPES.forEach(t => {
    const best = profile.plays[t.id]?.best;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'raid';
    b.innerHTML = `<img src="${svgUri(BOSSES[t.bossSpecies].svg)}" alt="">
      <div class="meta"><h3>${t.title}</h3>
      <div class="row" style="gap:6px"><span class="chip ${t.market === 'US' ? 'us' : 'kr'}">${t.market === 'US' ? '미국' : '국내'} · ${fmtDate(t.bars[0].t)}</span>${t.example ? '<span class="chip example">예시 데이터</span>' : ''}</div>
      <span class="small muted">${t.bars.length - 1}구간 · 체크포인트 ${t.checkpoints.length}회${best ? ` · <span class="best">최고 ${best}</span>` : ''}</span></div>`;
    b.addEventListener('click', () => { unlock(); sfx.select(); openBrief(t.id); });
    $('#raids').appendChild(b);
  });
}

/* ---------- 2. briefing ---------- */
async function openBrief(id) {
  currentTape = await adapter.load(id);
  const t = currentTape;
  $('#bArt').src = svgUri(BOSSES[t.bossSpecies].svg);
  $('#bArt').alt = t.boss;
  $('#bTag').textContent = `${t.market === 'US' ? '미국' : '국내'} 레이드${t.example ? ' · 예시 데이터' : ''}`;
  $('#bDate').textContent = `${fmtDate(t.bars[0].t)} ${fmtTime(t.bars[0].t)} ~ ${fmtTime(t.bars.at(-1).t)} (한국시간)`;
  $('#bTitle').textContent = `${t.boss} 출현!`;
  $('#bBrief').innerHTML = `<b>[시스템]</b> ${t.briefing}`;
  // labels after the first checkpoint describe what happened; keep them hidden until the raid reaches them
  const reveal = Math.min(...t.checkpoints.map(c => c.bar), t.bars.length - 1);
  $('#bTimeline').innerHTML = t.bars.map((b, i) => `<span class="${t.checkpoints.some(c => c.bar === i) ? 'cp' : ''}">${fmtTime(b.t)} ${i <= reveal ? b.label : '???'}</span>`).join('');
  $('#bConcepts').innerHTML = (t.concepts || []).map(c => `<span class="chip" style="color:var(--gold)">${c.name}</span>`).join('');
  showScreen('brief');
  gsap.fromTo('#bArt', { scale: .6, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: .6, ease: 'back.out(1.6)' });
  if (!reduceMotion) gsap.fromTo('.boss-stage', { x: -6 }, { x: 6, duration: .06, repeat: 5, yoyo: true, clearProps: 'x', delay: .35 });
  sfx.roar();
}

/* ---------- 3. party setup ---------- */
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
    card.innerHTML = `<img src="${svgUri(c.svg)}" alt="${c.name}">
      <h3>${c.name} <small>${m.name} · ${m.asset}</small></h3>
      <div class="weight"><label for="w-${role}"><span>비중</span><output id="o-${role}">${party.weights[role]}%</output></label>
      <input type="range" id="w-${role}" min="0" max="100" step="5" value="${party.weights[role]}" aria-label="${c.name} 비중"></div>
      <div class="skills" id="sk-${role}"></div>`;
    $('#roles').appendChild(card);
    card.querySelector('input').addEventListener('input', e => { party.weights[role] = +e.target.value; $('#o-' + role).value = party.weights[role] + '%'; renderSum(); });
    renderSkillList(card.querySelector('#sk-' + role), role, lvl);
  });
  renderSum();
}
function renderSkillList(box, role, lvl) {
  box.innerHTML = '';
  currentTape.skills.filter(s => s.role === role).forEach(s => {
    const locked = s.unlockLevel && lvl < s.unlockLevel;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'skill';
    b.setAttribute('aria-pressed', String(party.skills[role] === s.id));
    const ins = currentTape.instruments[s.instrument];
    b.innerHTML = `<span><span class="n">${s.name}</span><span class="i">${ins.name}${s.blend ? ' 25% + 현금 75%' : ''}</span></span>${locked ? `<span class="lock">Lv.${s.unlockLevel} 해금</span>` : ''}`;
    b.addEventListener('click', () => {
      if (locked) { sfx.back(); toast(`Lv.${s.unlockLevel}에 해금돼요. 상단 '전 기술 해금'으로 미리 써볼 수 있어요.`, 2600); return; }
      sfx.select(); party.skills[role] = s.id;
      box.querySelectorAll('.skill').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
    });
    box.appendChild(b);
  });
}
function renderSum() {
  const sum = ROLES.reduce((a, r) => a + party.weights[r], 0);
  const el = $('#sumTxt'); el.textContent = `${sum} / 100`; el.classList.toggle('bad', sum !== 100);
  $('#alloc').innerHTML = ROLES.map(r => `<i style="width:${party.weights[r]}%;background:${ROLE_COLOR[r]}" title="${charOf(r).name} ${party.weights[r]}%"></i>`).join('');
  $('#startBattle').disabled = sum !== 100;
}

/* ------------------------------------------------------------------ */
/* Phaser battle scene                                                 */
/* ------------------------------------------------------------------ */
const W = 960, H = 540;
const FORMATION = { tank: { x: 335, y: 405, s: .36 }, dealer: { x: 220, y: 350, s: .33 }, support: { x: 145, y: 445, s: .34 }, healer: { x: 250, y: 490, s: .36 } };
const BOSS_POS = { x: 715, y: 455 };

class BattleScene extends Phaser.Scene {
  constructor() { super('battle'); this.sprites = {}; this.idle = []; }
  create() {
    this.drawBackground();
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 8); g.generateTexture('spark', 16, 16); g.destroy();
    this.flashRect = this.add.rectangle(W / 2, H / 2, W, H, 0xffffff, 0).setDepth(50);
    this.ready = true;
  }
  drawBackground() {
    const g = this.add.graphics().setDepth(0);
    g.fillGradientStyle(0x151A2E, 0x151A2E, 0x2B2140, 0x2B2140, 1); g.fillRect(0, 0, W, H * .72);
    g.fillStyle(0xFFF3C4, .9); g.fillCircle(790, 86, 34); g.fillStyle(0x151A2E, 1); g.fillCircle(804, 76, 28);
    // Yeouido-ish skyline, deterministic
    const bld = [[0, 300, 70], [60, 250, 90], [140, 330, 60], [195, 210, 110], [300, 280, 80], [375, 170, 70], [440, 240, 120], [555, 300, 60], [610, 200, 90], [695, 260, 70], [760, 150, 100], [855, 290, 60], [905, 230, 80]];
    bld.forEach(([x, top, w], i) => {
      g.fillStyle(0x0E1220, 1); g.fillRect(x, top, w, H * .72 - top);
      g.fillStyle(0xF4C542, .35);
      for (let yy = top + 12; yy < H * .72 - 10; yy += 18) for (let xx = x + 8; xx < x + w - 8; xx += 14) if ((xx * 7 + yy * 13 + i) % 5 < 2) g.fillRect(xx, yy, 5, 8);
    });
    g.fillStyle(0x1B2233, 1); g.fillRect(0, H * .72, W, H * .28);
    g.lineStyle(1, 0x2C3650, 1);
    for (let i = 0; i <= 12; i++) { const x = i * (W / 12); g.lineBetween(x, H * .72, (x - W / 2) * 2.2 + W / 2, H); }
    for (let i = 0; i < 6; i++) { const y = H * .72 + i * i * 6; g.lineBetween(0, y, W, y); }
    g.fillStyle(0x0D1018, .35); g.fillEllipse(BOSS_POS.x, BOSS_POS.y + 6, 300, 44);
  }
  async loadArt(tape) {
    const add = async (key, svg, w, h) => { if (this.textures.exists(key)) this.textures.remove(key); this.textures.addImage(key, await rasterize(svg, w, h)); };
    await Promise.all([...ROLES.map(r => add('c_' + r, charOf(r).svg, 400, 440)), ...ROLES.map(r => add('h_' + r, hurtSvg(ROLE_META[r].species), 400, 440)), add('boss', BOSSES[tape.bossSpecies].svg, 480, 480)]);
  }
  async setup(tape) {
    // tear down the previous raid BEFORE swapping textures (a live sprite must never point at a removed texture)
    this.idle.forEach(t => t.stop()); this.idle = [];
    this.tweens.killAll();
    Object.values(this.sprites).forEach(s => s.destroy()); this.sprites = {};
    this.emitter?.destroy(); this.emitter = null;
    await this.loadArt(tape);
    ROLES.forEach(role => {
      const f = FORMATION[role];
      const s = this.add.image(f.x, f.y, 'c_' + role).setOrigin(.5, 1).setScale(f.s).setDepth(10 + f.y / 100);
      s.home = { x: f.x, y: f.y, s: f.s }; this.sprites[role] = s;
      this.idle.push(this.tweens.add({ targets: s, y: f.y - 5, duration: 900 + ROLES.indexOf(role) * 120, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    });
    const b = this.add.image(BOSS_POS.x, BOSS_POS.y, 'boss').setOrigin(.5, 1).setScale(.72).setDepth(9);
    b.home = { x: BOSS_POS.x, y: BOSS_POS.y, s: .72 }; this.sprites.boss = b;
    this.idle.push(this.tweens.add({ targets: b, scaleY: .74, scaleX: .71, duration: 1400, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    this.emitter = this.add.particles(0, 0, 'spark', { speed: { min: 90, max: 320 }, angle: { min: 0, max: 360 }, scale: { start: .8, end: 0 }, lifespan: { min: 300, max: 650 }, gravityY: 300, emitting: false }).setDepth(40);
    gsapLike(this, b, { alpha: { from: 0, to: 1 }, y: { from: BOSS_POS.y - 40, to: BOSS_POS.y } }, 500);
  }
  tw(cfg) { return new Promise(res => this.tweens.add({ ...cfg, onComplete: () => { cfg.onComplete?.(); res(); } })); }
  number(x, y, text, color, size = 28) {
    const t = this.add.text(x, y, text, { fontFamily: 'Jua, sans-serif', fontSize: size + 'px', color, stroke: '#14161c', strokeThickness: 6 }).setOrigin(.5).setDepth(60);
    this.tweens.add({ targets: t, y: y - 60, alpha: { from: 1, to: 0 }, scale: { from: .6, to: 1.1 }, duration: 900, ease: 'cubic.out', onComplete: () => t.destroy() });
  }
  flash(color, alpha, dur) {
    this.flashRect.setFillStyle(color, alpha);
    this.tweens.add({ targets: this.flashRect, fillAlpha: 0, duration: dur });
  }
  shake(dur, intensity) { if (!reduceMotion) this.cameras.main.shake(dur, intensity); }
  slash(x, y, color) {
    const g = this.add.graphics().setDepth(45); g.lineStyle(6, color, 1);
    for (let i = 0; i < 3; i++) g.lineBetween(x - 60 + i * 14, y - 50 + i * 10, x + 40 + i * 14, y + 40 + i * 10);
    this.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }
  /** Plays one engine turn. speed >= 1 shortens every duration. */
  async playTurn(turn, speed = 1, hooks = {}) {
    const d = ms => Math.max(30, ms / speed);
    const boss = this.sprites.boss, ret = turn.boss.portfolioRet;
    const mag = Math.min(1, Math.abs(ret) / 1.5);
    if (ret < 0) {
      // boss attack: lunge, impact on party
      sfx.roar();
      await this.tw({ targets: boss, x: boss.home.x - 70 - 60 * mag, scaleX: .78, duration: d(170), ease: 'power2.in' });
      this.shake(d(280), .004 + .018 * mag); this.flash(0xff4d4d, .18 + .25 * mag, d(300)); (mag > .5 ? sfx.bigHit : sfx.hit)();
      ROLES.forEach((role, i) => {
        const r = turn.roles[role], s = this.sprites[role];
        if (r.ret < 0) {
          const loss = Math.round(r.hpBefore - r.hpAfter);
          this.time.delayedCall(d(40 * i), () => {
            s.setTint(0xff6b6b);
            this.tweens.add({ targets: s, x: s.home.x - 18, duration: d(60), yoyo: true, repeat: 2, onComplete: () => { s.clearTint(); s.x = s.home.x; } });
            this.number(s.x, s.y - 150 * s.scale * 3, '-' + Math.max(1, loss), '#ff6b6b', 24 + 20 * Math.min(1, loss / 40));
            this.emitter.explode(6 + Math.round(10 * mag), s.x, s.y - 60);
          });
        } else if (r.ret > 0) this.time.delayedCall(d(120), () => this.number(s.x, s.y - 130, '+' + Math.max(1, Math.round(r.hpAfter - r.hpBefore + (r.shield || 0) * 0)), '#4fd18b', 20));
      });
      hooks.onImpact?.();
      await this.tw({ targets: boss, x: boss.home.x, scaleX: boss.home.s, duration: d(320), ease: 'back.out(1.5)' });
    } else {
      // party attack: each gaining role dashes in; boss takes the portfolio gain
      const attackers = ROLES.filter(r => turn.roles[r].ret > 0);
      for (let i = 0; i < attackers.length; i++) {
        const role = attackers[i], s = this.sprites[role];
        if (s.dead) continue;
        const r = turn.roles[role];
        const str = Math.min(1, r.ret / 1.2);
        await this.tw({ targets: s, x: boss.home.x - 150, y: boss.home.y - 10, duration: d(150), ease: 'power2.in' });
        sfx.slash(); this.slash(boss.home.x - 40, boss.home.y - 140, ROLE_HEX[role]);
        this.emitter.explode(8 + Math.round(14 * str), boss.home.x - 30, boss.home.y - 140);
        boss.setTint(0xffffff); this.tweens.add({ targets: boss, x: boss.home.x + 16, duration: d(50), yoyo: true, repeat: 1, onComplete: () => { boss.clearTint(); boss.x = boss.home.x; } });
        this.number(boss.home.x, boss.home.y - 260, '+' + fmtPct(r.ret * r.weight / 100).replace('+', '').replace('%', ''), '#F4C542', 22 + 22 * str);
        if (i === 0) hooks.onImpact?.();
        this.tw({ targets: s, x: s.home.x, y: s.home.y, duration: d(220), ease: 'power2.out' });
        await sleep(d(110));
      }
      ROLES.filter(r => turn.roles[r].ret < 0).forEach(role => { const s = this.sprites[role]; s.setTint(0xffa0a0); this.time.delayedCall(d(200), () => s.clearTint()); this.number(s.x, s.y - 120, '-' + Math.max(1, Math.round(turn.roles[role].hpBefore - turn.roles[role].hpAfter)), '#ff9b9b', 18); });
      if (attackers.length === 0) hooks.onImpact?.();
      if (ret >= 1) { this.shake(d(200), .006); this.flash(0xF4C542, .25, d(300)); sfx.crit(); }
      await sleep(d(260));
    }
    // shields and faints
    ROLES.forEach(role => {
      const r = turn.roles[role], s = this.sprites[role];
      if (r.shield > 0 && r.hpAfter >= 100 && r.ret > 0) { const ring = this.add.circle(s.x, s.y - 70, 60).setStrokeStyle(4, 0xF4C542, .9).setDepth(30); this.tweens.add({ targets: ring, scale: 1.6, alpha: 0, duration: d(500), onComplete: () => ring.destroy() }); sfx.shield(); }
      if (r.fainted && !s.dead) { s.dead = true; s.setTexture('h_' + role); sfx.faint(); this.tweens.add({ targets: s, angle: 90, alpha: .45, y: s.home.y + 30, duration: d(450), ease: 'bounce.out' }); }
      else if (!s.dead && r.hpBefore - r.hpAfter >= 8) { s.setTexture('h_' + role); this.time.delayedCall(d(900), () => { if (!s.dead) s.setTexture('c_' + role); }); }
    });
    await sleep(d(200));
  }
  async bossDefeated(speed = 1) {
    const b = this.sprites.boss; sfx.win(); this.shake(400 / speed, .01); this.flash(0xffffff, .8, 600 / speed);
    for (let i = 0; i < 6; i++) { this.emitter.explode(24, b.home.x - 100 + Math.random() * 200, b.home.y - 300 + Math.random() * 260); await sleep(90 / speed); }
    await this.tw({ targets: b, angle: 12, alpha: 0, scale: .2, y: b.home.y + 60, duration: 700 / speed, ease: 'back.in(2)' });
  }
  async partyWiped(speed = 1) { sfx.lose(); this.flash(0x000000, .7, 900 / speed); await sleep(900 / speed); }
}
function gsapLike(scene, target, props, dur) { Object.entries(props).forEach(([k, v]) => { target[k] = v.from; }); scene.tweens.add({ targets: target, ...Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.to])), duration: dur, ease: 'back.out(1.4)' }); }

let game = null, scene = null;
async function ensureGame() {
  if (game) return scene;
  try { await document.fonts.load('20px Jua'); } catch {}
  game = new Phaser.Game({ type: Phaser.AUTO, parent: 'arena', width: W, height: H, backgroundColor: '#0D1018', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene: [BattleScene], render: { antialias: true, pixelArt: false } });
  scene = game.scene.getScene('battle');
  while (!scene?.ready) { await sleep(30); scene = game.scene.getScene('battle'); }
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
  const sub = `${fmtTime(turn.t)} ${turn.label} · 파티 ${fmtPct(turn.boss.portfolioRet)}`;
  const bossArt = svgUri(BOSSES[currentTape.bossSpecies].svg), roleArt = svgUri(charOf(cut.role).svg), hurtArt = svgUri(hurtSvg(ROLE_META[cut.role].species));
  if (cut.kind === 'critical_hit') return { text: cut.text, sub, bg: '#4A1522', artL: hurtArt, artR: bossArt, hit: true };
  if (cut.kind === 'role_crushed') return { text: cut.text, sub, bg: '#3A1A2E', artL: hurtArt, artR: bossArt, hit: true };
  if (cut.kind === 'critical_deal') return { text: cut.text, sub, bg: '#0F3A2E', artL: roleArt, artR: null };
  return { text: cut.text, sub, bg: '#1F3A14', artL: roleArt, artR: null };
}

/* ------------------------------------------------------------------ */
/* Battle flow                                                         */
/* ------------------------------------------------------------------ */
let battle = null, speed = 1, userPaused = false, aborted = false, chart = null, series = null, resumeWaiters = [];
const speedFactor = () => reduceMotion ? Math.max(4, speed) : speed;

$$('.seg [data-speed]').forEach(b => b.addEventListener('click', () => { speed = +b.dataset.speed; $$('.seg [data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); sfx.select(); }));
$('#pauseBtn').addEventListener('click', () => { userPaused = !userPaused; $('#pauseBtn').textContent = userPaused ? '계속' : '일시정지'; if (!userPaused) { resumeWaiters.splice(0).forEach(r => r()); } sfx.select(); });
let abortArmed = 0;
$('#abortBtn').addEventListener('click', () => {
  if (Date.now() - abortArmed < 3000) { aborted = true; userPaused = false; resumeWaiters.splice(0).forEach(r => r()); $('#abortBtn').textContent = '레이드 포기'; stopBgm(); showScreen('select'); return; }
  abortArmed = Date.now(); $('#abortBtn').textContent = '정말 포기? (한 번 더)'; setTimeout(() => { $('#abortBtn').textContent = '레이드 포기'; }, 3000);
});
const waitResume = () => userPaused ? new Promise(r => resumeWaiters.push(r)) : Promise.resolve();

function hpClass(v) { return v > 50 ? '' : v > 20 ? 'mid' : 'low'; }
function renderPartyHud(turn) {
  const s = battle;
  $('#partyhud').innerHTML = ROLES.map(role => {
    const sk = s.party._bySkill[s.party.skills[role]], hp = s.partyHp[role], sh = s.shield[role];
    const r = turn?.roles[role]?.ret;
    return `<div class="phud ${hp <= 0 ? 'dead' : ''}" id="phud-${role}" style="--rc:${ROLE_COLOR[role]}">
      <div class="t"><b>${charOf(role).name} ${r === undefined ? '' : `<span class="delta ${r >= 0 ? 'up' : 'down'}">${fmtPct(r)}</span>`}</b><small>${sk.name} · ${s.party.weights[role]}%</small></div>
      <div class="hp"><i class="${hpClass(hp)}" style="width:${hp}%"></i><em style="width:${Math.min(100, sh)}%"></em></div>
      <div class="num"><span>HP <b class="tabular">${Math.round(hp)}</b>${sh > 0 ? ` <span style="color:var(--gold)">+${Math.round(sh)}</span>` : ''}</span><span class="tabular">${currentTape.instruments[sk.instrument].name}</span></div></div>`;
  }).join('');
}
function renderBossHud() {
  $('#hBossName').textContent = currentTape.boss;
  $('#hBossHp').style.width = battle.bossHp + '%'; $('#hBossHpTxt').textContent = Math.round(battle.bossHp);
}
function renderTurnLine(turn) {
  if (!turn) { $('#hLabel').textContent = `${fmtTime(currentTape.bars[0].t)} ${currentTape.bars[0].label}`; $('#hTime').textContent = ''; $('#hRet').textContent = '—'; $('#hRet').className = 'ret tabular'; $('#hCum').textContent = '0.00%'; $('#hCum').className = 'ret tabular'; return; }
  $('#hLabel').textContent = turn.label; $('#hTime').textContent = fmtTime(turn.t) + ' KST';
  const r = turn.boss.portfolioRet; $('#hRet').textContent = fmtPct(r); $('#hRet').className = 'ret tabular ' + (r >= 0 ? 'up' : 'down');
  const c = battle.equity - 100; $('#hCum').textContent = fmtPct(c); $('#hCum').className = 'ret tabular ' + (c >= 0 ? 'up' : 'down');
}

function makeChart(container, withBoss) {
  const c = LightweightCharts.createChart(container, {
    autoSize: true, layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#A6AEBE', fontFamily: 'Gowun Dodum, sans-serif', fontSize: 11 },
    grid: { vertLines: { color: '#232A38' }, horzLines: { color: '#232A38' } }, rightPriceScale: { borderColor: '#343D4F' }, leftPriceScale: { visible: withBoss, borderColor: '#343D4F' },
    timeScale: { borderColor: '#343D4F', timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true }, crosshair: { mode: 0 }, handleScroll: false, handleScale: false,
  });
  const pct = { type: 'custom', formatter: v => fmtPct(v), minMove: .01 };
  const eq = c.addLineSeries({ color: '#F4C542', lineWidth: 3, priceScaleId: 'right', lastValueVisible: true, priceLineVisible: false, priceFormat: pct });
  const bm = c.addLineSeries({ color: '#7C8597', lineWidth: 2, lineStyle: 2, priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false, priceFormat: pct });
  const bo = withBoss ? c.addAreaSeries({ priceScaleId: 'left', lineColor: '#FF6B6B', topColor: 'rgba(255,107,107,.22)', bottomColor: 'rgba(255,107,107,0)', lineWidth: 1, lastValueVisible: false, priceLineVisible: false,
    priceFormat: { type: 'custom', formatter: v => 'HP ' + Math.round(v), minMove: 1 }, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }) : null;
  if (bo) c.priceScale('left').applyOptions({ scaleMargins: { top: .05, bottom: 0 } });
  c.priceScale('right').applyOptions({ scaleMargins: { top: .15, bottom: .15 } });
  return { c, eq, bm, bo };
}
const ts = iso => Math.floor(Date.parse(iso) / 1000) + 9 * 3600;   // shift so the axis prints KST clock times
function feedChart(S, s) {
  const pts = [{ bar: 0, t: s.tape.bars[0].t, equity: 100, benchmark: 100, bossHp: 100 }, ...s.history];
  S.eq.setData(pts.map(p => ({ time: ts(p.t), value: p.equity - 100 })));
  S.bm.setData(pts.map(p => ({ time: ts(p.t), value: p.benchmark - 100 })));
  S.bo?.setData(pts.map(p => ({ time: ts(p.t), value: p.bossHp })));
  const marks = (s.actions || []).filter(a => a.type !== 'hold').map(a => ({ time: ts(s.tape.bars[a.at].t), position: 'aboveBar', color: '#F4C542', shape: 'arrowDown', text: a.type === 'equip' ? '교체' : '비중' }));
  S.eq.setMarkers(marks);
  S.c.timeScale().fitContent();
}

async function startBattle() {
  const errs = validateParty(party, currentTape); if (errs.length) { toast(errs[0]); return; }
  unlock(); sfx.select();
  battle = createBattle(currentTape, party); aborted = false; userPaused = false; $('#pauseBtn').textContent = '일시정지';
  showScreen('battle');
  const sc = await ensureGame(); game.scale.refresh();
  await sc.setup(currentTape);
  renderBossHud(); renderPartyHud(); renderTurnLine(null);
  chart?.c.remove(); chart = makeChart($('#chart'), true); feedChart(chart, battle);
  $('#chartNote').textContent = `${currentTape.bars.length - 1}구간 · 30분~1시간 단위${currentTape.example ? ' · 예시 데이터' : ''}`;
  startBgm(.3);
  await cutIn({ text: `${currentTape.boss} 출현!`, sub: `${fmtDate(currentTape.bars[0].t)} · ${currentTape.bars.length - 1}구간 레이드`, bg: '#2A1A3A', artL: null, artR: svgUri(BOSSES[currentTape.bossSpecies].svg) }, Math.max(1, speedFactor() / 2));
  await sleep(300 / speedFactor());
  await raidLoop();
}
async function raidLoop() {
  while (!battle.done && !aborted) {
    await waitResume(); if (aborted) return;
    const turn = step(battle);
    if (!turn) { if (battle.paused) { await showCheckpoint(battle.paused); continue; } break; }
    const sp = speedFactor();
    await scene.playTurn(turn, sp, { onImpact: () => { renderPartyHud(turn); renderBossHud(); renderTurnLine(turn); } });
    feedChart(chart, battle);
    const cut = cutForTurn(turn);
    if (cut && speed < 4) await cutIn(cut, sp);
    if (battle.bossHp <= 0 && !battle._bossShown) { battle._bossShown = true; startBgm(.8); }
  }
  if (aborted) return;
  stopBgm();
  const r = battle.result;
  if (r.bossDown) await scene.bossDefeated(speedFactor()); else if (r.alive === 0) await scene.partyWiped(speedFactor()); else await sleep(400);
  showResult();
}

/* ---------- checkpoint modal ---------- */
function showCheckpoint(cp) {
  return new Promise(resolve => {
    sfx.pause();
    const m = $('#cp'); m.hidden = false;
    $('#cpTitle span:last-child').textContent = `${fmtTime(currentTape.bars[cp.bar].t)} ${cp.title}`;
    const cum = battle.equity - 100, next = currentTape.bars[cp.bar];
    $('#cpHint').innerHTML = `<b>[시스템]</b> ${cp.hint}<br><span class="muted">지금까지 파티 <b style="color:${cum >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(cum)}</b> · 다음 구간 <b>${fmtTime(next.t)} ${next.label}</b> · 체크포인트마다 한 가지 행동만 할 수 있어요.</span>`;
    const tabs = $$('#cp .tabs [data-tab]');
    const setTab = name => { tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name))); $('#cpHold').hidden = name !== 'hold'; $('#cpEquip').hidden = name !== 'equip'; $('#cpRebal').hidden = name !== 'rebalance'; };
    tabs.forEach(t => { t.onclick = () => { sfx.select(); setTab(t.dataset.tab); }; });
    setTab('hold');
    const done = (action, msg) => { try { intervene(battle, action); } catch (e) { toast(e.message); return; } m.hidden = true; if (msg) toast(msg); renderPartyHud(); resolve(); };
    $('#cpHoldBtn').onclick = () => { sfx.select(); done({ type: 'hold' }, '버틴다!'); };
    // equip
    const lvl = effectiveLevel();
    $('#cpEquip').innerHTML = '';
    ROLES.forEach(role => {
      const cur = battle.party._bySkill[battle.party.skills[role]];
      const box = document.createElement('div'); box.className = 'cp-role'; box.style.setProperty('--rc', ROLE_COLOR[role]);
      box.innerHTML = `<img src="${svgUri(charOf(role).svg)}" alt=""><div><div class="hdr"><b>${charOf(role).name}</b><span>지금: ${cur.name} · ${battle.party.weights[role]}%</span></div><div class="opts"></div></div>`;
      const opts = box.querySelector('.opts');
      currentTape.skills.filter(s => s.role === role && s.id !== cur.id).forEach(s => {
        const locked = s.unlockLevel && lvl < s.unlockLevel;
        const b = document.createElement('button'); b.type = 'button'; b.className = 'skill'; b.disabled = !!locked;
        b.innerHTML = `<span class="n">${s.name}</span><span class="i">${currentTape.instruments[s.instrument].name}${locked ? ` · Lv.${s.unlockLevel}` : ''}</span>`;
        b.onclick = () => { sfx.select(); done({ type: 'equip', role, skill: s.id, level: lvl }, `${charOf(role).name}: ${s.name} 장착!`); };
        opts.appendChild(b);
      });
      if (!opts.children.length) opts.innerHTML = '<span class="small muted">바꿀 기술이 없어요</span>';
      $('#cpEquip').appendChild(box);
    });
    // rebalance
    const w = { ...battle.party.weights };
    const renderSl = () => {
      $('#cpSliders').innerHTML = ROLES.map(role => `<div class="weight" style="--rc:${ROLE_COLOR[role]}"><label for="cw-${role}"><span>${charOf(role).name}</span><output>${w[role]}%</output></label><input type="range" id="cw-${role}" min="0" max="100" step="5" value="${w[role]}" aria-label="${charOf(role).name} 비중"></div>`).join('');
      ROLES.forEach(role => $('#cw-' + role).addEventListener('input', e => { w[role] = +e.target.value; e.target.previousElementSibling.querySelector('output').value = w[role] + '%'; const sum = ROLES.reduce((a, r) => a + w[r], 0); $('#cpSum').textContent = `${sum} / 100`; $('#cpSum').classList.toggle('bad', sum !== 100); $('#cpRebalBtn').disabled = sum !== 100; }));
      $('#cpSum').textContent = '100 / 100'; $('#cpSum').classList.remove('bad'); $('#cpRebalBtn').disabled = false;
    };
    renderSl();
    $('#cpRebalBtn').onclick = () => { sfx.select(); done({ type: 'rebalance', weights: w }, '비중 조정!'); };
    $('#cpHoldBtn').focus();
  });
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */
let rChart = null;
async function showResult() {
  const s = battle, r = s.result;
  showScreen('result');
  // persist play & exp
  const before = { ...profile };
  const after = applyExp(profile, r.exp);
  const play = profile.plays[currentTape.id] || { count: 0 };
  const order = ['F', 'D', 'C', 'B', 'A', 'S'];
  play.count++; if (!play.best || order.indexOf(r.grade) > order.indexOf(play.best)) play.best = r.grade;
  profile = { ...after, plays: { ...profile.plays, [currentTape.id]: play } }; saveProfile();

  const stamp = $('#rStamp'); stamp.textContent = r.grade; stamp.className = 'stamp ' + r.grade;
  $('#rVerdict').textContent = r.bossDown ? `${currentTape.boss} 격파!` : r.alive === 0 ? '파티 전멸…' : r.returnPct >= 0 ? '레이드 생존 · 보스는 버텼다' : '보스에게 밀렸다';
  $('#rRet').textContent = fmtPct(r.returnPct); $('#rRet').style.color = r.returnPct >= 0 ? 'var(--green)' : 'var(--red)';
  $('#rAlpha').textContent = fmtPct(r.alpha); $('#rAlpha').style.color = r.alpha >= 0 ? 'var(--green)' : 'var(--red)';
  $('#rBoss').textContent = r.bossDown ? '격파' : `HP ${Math.round(s.bossHp)} 남음`;
  $('#rAlive').textContent = `${r.alive} / 4`;
  const cs = ROLES.map(role => ({ role, c: contribution(s, role) })); const mx = Math.max(.2, ...cs.map(x => Math.abs(x.c)));
  $('#rContribs').innerHTML = cs.map(({ role, c }) => `<div class="contrib" style="--rc:${ROLE_COLOR[role]}"><span>${charOf(role).name}</span><div class="bar"><i style="${c >= 0 ? 'left:50%' : 'right:50%'};width:${50 * Math.abs(c) / mx}%"></i></div><span class="v tabular" style="color:${c >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(c)}</span></div>`).join('');
  const acts = (s.actions || []);
  $('#rDecisions').innerHTML = acts.length ? acts.map(a => {
    const bar = currentTape.bars[a.at]; const after = s.log.filter(t => t.bar >= a.at).reduce((x, t) => x + t.boss.portfolioRet, 0);
    const what = a.type === 'hold' ? '버티기' : a.type === 'equip' ? `${charOf(ROLES.find(r => s.party._bySkill[a.to]?.role === r) || 'dealer').name} → ${s.party._bySkill[a.to].name}` : '비중 조정 ' + ROLES.map(r => a.to[r]).join('/');
    return `<div><span class="t">${fmtTime(bar.t)}</span><span>${what}</span><span class="muted">· 이후 파티 ${fmtPct(after)}</span></div>`;
  }).join('') : '<span class="muted">체크포인트 없음</span>';
  // what-if: best / worst single-action strategies from the same starting party
  const alts = alternatives(currentTape, { weights: { ...party.weights }, skills: { ...party.skills }, _bySkill: party._bySkill });
  const best = alts[0], worst = alts.at(-1), lvl = effectiveLevel();
  const row = (k, cls, a, v) => `<div><span class="k ${cls}">${k}</span><span>${a}</span><span class="v" style="color:${v >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(v)}</span></div>`;
  const lockNote = a => a.detail.unlockLevel > lvl ? `<span class="lock">Lv.${a.detail.unlockLevel}</span>` : '';
  $('#rWhatIf').innerHTML = [
    row('내 선택', 'me', acts.some(a => a.type !== 'hold') ? '위 체크포인트 선택대로' : '모두 버티기', r.returnPct),
    row('최고', 'best', best.label + lockNote(best), best.returnPct),
    row('최악', 'worst', worst.label + lockNote(worst), worst.returnPct),
  ].join('');
  $('#rConcepts').innerHTML = (currentTape.concepts || []).map((c, i) => `<details${i === 0 ? ' open' : ''}><summary>${c.name}</summary><p>${c.text}</p></details>`).join('');
  rChart?.c.remove(); rChart = makeChart($('#rChart'), false); feedChart(rChart, s);
  $('#coachAv').src = svgUri(CHARACTERS.squirrel.svg);
  // animations
  sfx.stamp();
  gsap.fromTo(stamp, { scale: 3, opacity: 0, rotate: -30 }, { scale: 1, opacity: 1, rotate: -12, duration: .45, ease: 'back.out(1.2)' });
  if (!reduceMotion) gsap.fromTo('.stamp-wrap', { x: -8 }, { x: 8, duration: .05, repeat: 5, yoyo: true, clearProps: 'x', delay: .35 });
  // coach typing
  const bubble = $('#coachBubble'); bubble.innerHTML = '';
  const lines = coachText(s);
  (async () => { for (const line of lines) { const p = document.createElement('p'); p.className = 'typing'; bubble.appendChild(p); for (const ch of line) { p.textContent += ch; if (!reduceMotion) await sleep(14); } p.classList.remove('typing'); await sleep(200); } })();
  // exp
  const expEl = $('#rExp'); const o = { v: 0 }; gsap.to(o, { v: r.exp, duration: 1, onUpdate: () => { expEl.textContent = '+' + Math.round(o.v); } });
  const bar = $('#rExpBar'); bar.style.width = (100 * before.exp / expNext(before.level)) + '%';
  $('#rExpTxt').textContent = `Lv.${before.level} ${before.exp} / ${expNext(before.level)}`;
  await sleep(500);
  if (after.levelUps.length) {
    await animBar(bar, 100, 600);
    for (const L of after.levelUps) { sfx.level(); toast(`레벨 업! Lv.${L}${UNLOCKS[L] ? ' · ' + UNLOCKS[L] + ' 해금' : ''}`, 2600); bar.style.transition = 'none'; bar.style.width = '0%'; await sleep(50); bar.style.transition = ''; if (L !== after.levelUps.at(-1)) await animBar(bar, 100, 500); await sleep(300); }
    await animBar(bar, 100 * after.exp / expNext(after.level), 600);
  } else await animBar(bar, 100 * after.exp / expNext(after.level), 900);
  $('#rExpTxt').textContent = `Lv.${after.level} ${after.exp} / ${expNext(after.level)}`;
  renderProfile();
}
function animBar(el, pct, ms) { return new Promise(res => { el.style.transition = `width ${ms}ms cubic-bezier(.2,.8,.2,1)`; requestAnimationFrame(() => { el.style.width = pct + '%'; setTimeout(res, ms); }); }); }

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
$('#toParty').addEventListener('click', () => { sfx.select(); openParty(); });
$('#backToSelect').addEventListener('click', () => { sfx.back(); showScreen('select'); });
$('#backToBrief').addEventListener('click', () => { sfx.back(); showScreen('brief'); });
$('#presetBtn').addEventListener('click', () => { sfx.select(); party = Object.assign(defaultParty(currentTape), { _tapeId: currentTape.id }); renderPartyScreen(); });
$('#startBattle').addEventListener('click', startBattle);
$('#retryBtn').addEventListener('click', () => { sfx.select(); openParty(); });
$('#otherBtn').addEventListener('click', () => { sfx.select(); renderSelect(); showScreen('select'); });
$('#etfBtn').addEventListener('click', () => { sfx.select(); $('#etfAlloc').innerHTML = ROLES.map(r => `<i style="width:${battle.party.weights[r]}%;background:${ROLE_COLOR[r]}"></i>`).join(''); $('#etfModal').hidden = false; });
$('#etfClose').addEventListener('click', () => { sfx.back(); $('#etfModal').hidden = true; });
$('#muteBtn').addEventListener('click', () => { unlock(); const m = !isMuted(); setMuted(m); $('#muteBtn').textContent = m ? '소리 꺼짐' : '소리 켜짐'; $('#muteBtn').setAttribute('aria-pressed', String(m)); });
$('#unlockBtn').addEventListener('click', () => { profile.unlockAll = !profile.unlockAll; saveProfile(); renderProfile(); sfx.select(); toast(profile.unlockAll ? '데모 모드: 모든 기술을 쓸 수 있어요' : '레벨 제한을 다시 켰어요'); if (!$('#screen-party').hidden) renderPartyScreen(); });
document.addEventListener('keydown', e => { if (e.key === ' ' && !$('#screen-battle').hidden && $('#cp').hidden && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); $('#pauseBtn').click(); } });

renderProfile(); renderSelect(); showScreen('select');

// test/automation hooks (not used by the UI)
window.__rpg = { TAPES, previewCut: kind => cutIn(kind === 'deal' ? { text: '크리티컬!', sub: '05:00 기자회견 시작 · 파티 +1.24%', bg: '#0F3A2E', artL: svgUri(CHARACTERS.cheetah.svg), artR: null } : { text: '필살기!', sub: '05:00 매파 발언 · 파티 -1.20%', bg: '#4A1522', artL: svgUri(hurtSvg('cheetah')), artR: svgUri(BOSSES.golem.svg), hit: true }, 1), get battle() { return battle; }, get profile() { return profile; }, openBrief, openParty, startBattle, setSpeed: v => { speed = v; }, setParty: p => { party = Object.assign(p, { _tapeId: currentTape.id }); } };
