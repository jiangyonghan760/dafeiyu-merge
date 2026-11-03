/* 合成大肥鱼 · Merge the Whale
 * 物理：Matter.js | 渲染/合成/音效：自研
 * 素材：dsh-meme 插件「大肥鱼」图库（个人娱乐）
 */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 配置 */
  const W = 480;
  const H = 730;
  const FLOOR_TOP = H - 8;
  const DROP_Y = 76;
  const DANGER_Y = 128;
  const DROP_COOLDOWN = 330;
  const TAU = Math.PI * 2;

  const LEVELS = [
    { name: '小懵鱼', color: '#8ed2ff', r: 18, quote: '？' },
    { name: '偷看鱼', color: '#7cc4f7', r: 24, quote: '盯——' },
    { name: '害羞鱼', color: '#9db6ff', r: 31, quote: '…别看我' },
    { name: '比心鱼', color: '#a99bff', r: 39, quote: '给你比个心' },
    { name: '干饭鱼', color: '#c39bf5', r: 48, quote: '先干饭！' },
    { name: '得意鱼', color: '#e79be6', r: 58, quote: '嘿嘿嘿' },
    { name: '躺平鱼', color: '#ff9dc4', r: 70, quote: '摆了' },
    { name: '睡觉鱼', color: '#ff9aa9', r: 82, quote: '呼…呼…' },
    { name: '震惊鱼', color: '#ffa878', r: 96, quote: '啊？？' },
    { name: '点赞鱼', color: '#ffc65c', r: 107, quote: '这条鱼值得' },
    { name: '飘了鱼', color: '#ff7fa8', r: 121, quote: '我已经飘了' },
  ];
  const MAX_LEVEL = LEVELS.length;
  const MERGE_SCORE = [0, 2, 4, 7, 11, 16, 22, 30, 40, 52, 66, 82];
  const SPAWN_WEIGHTS = [0.34, 0.26, 0.2, 0.12, 0.08];

  const imgSrc = (i) => `assets/fish-${String(i).padStart(2, '0')}.webp`;

  /* ---------------------------------------------------------------- DOM */
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const boardWrap = $('boardWrap');
  const scoreEl = $('score');
  const bestEl = $('best');
  const comboEl = $('combo');
  const toastEl = $('toast');
  const hintEl = $('hint');
  const overlay = $('overlay');
  const book = $('book');
  const bookGrid = $('bookGrid');
  const nextImg = $('nextImg');
  const nextName = $('nextName');
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const HINT_TEXT = isTouch ? '拖动瞄准 · 松手投放' : '移动鼠标 · 点击投放';
  hintEl.textContent = HINT_TEXT;

  /* ------------------------------------------------------------ 小工具 */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;

  function hex2rgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgba(hex, a) {
    const c = hex2rgb(hex);
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }
  function mixHex(h1, h2, t) {
    const a = hex2rgb(h1), b = hex2rgb(h2);
    const c = a.map((v, i) => Math.round(lerp(v, b[i], t)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('dafeiyu.' + k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('dafeiyu.' + k, JSON.stringify(v)); } catch (e) {}
    },
  };

  /* -------------------------------------------------------------- 音效 */
  let actx = null;
  let muted = store.get('mute', false);

  function initAudio() {
    if (muted) return;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function tone(freq, dur, type, vol, delay, slideTo) {
    if (muted || !actx) return;
    const t0 = actx.currentTime + (delay || 0);
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  const sfx = {
    drop() {
      initAudio();
      tone(540, 0.09, 'sine', 0.05, 0, 250);
    },
    merge(level) {
      const f = 240 * Math.pow(2, level / 12);
      tone(f, 0.17, 'triangle', 0.08);
      tone(f * 1.5, 0.13, 'sine', 0.045, 0.015);
    },
    big() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.06));
    },
    over() {
      tone(320, 0.7, 'sawtooth', 0.05, 0, 70);
      tone(160, 0.7, 'sine', 0.05, 0.05, 50);
    },
  };

  /* ------------------------------------------------------------- Matter */
  const { Engine, Bodies, Body, Composite, Events } = Matter;

  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.2;
  engine.positionIterations = 10;
  engine.velocityIterations = 8;

  function addWalls() {
    const opt = { isStatic: true, friction: 0.35, restitution: 0.04, render: { visible: false } };
    Composite.add(engine.world, [
      Bodies.rectangle(W / 2, FLOOR_TOP + 40, W + 240, 80, opt),
      Bodies.rectangle(-40, H / 2, 80, H + 400, opt),
      Bodies.rectangle(W + 40, H / 2, 80, H + 400, opt),
    ]);
  }
  addWalls();

  const fishBodies = [];

  function makeFish(level, x, y) {
    const r = LEVELS[level - 1].r;
    const body = Bodies.circle(x, y, r, {
      label: 'fish',
      restitution: 0.06,
      friction: 0.32,
      frictionStatic: 0.6,
      frictionAir: 0.0018,
      density: 0.0011,
      slop: 0.02,
      sleepThreshold: 50,
    });
    body.pl = {
      level,
      merged: false,
      dead: false,
      born: performance.now(),
      spawn: 1,
    };
    Composite.add(engine.world, body);
    fishBodies.push(body);
    return body;
  }

  function removeFish(body) {
    if (!body || body.pl.dead) return;
    body.pl.dead = true;
    Composite.remove(engine.world, body);
    const i = fishBodies.indexOf(body);
    if (i >= 0) fishBodies.splice(i, 1);
  }

  /* --------------------------------------------------------------- 状态 */
  const state = {
    phase: 'ready', // ready | playing | over
    score: 0,
    best: store.get('best', 0),
    current: 1,
    next: 1,
    seen: new Set(store.get('seen', [1])),
    lastDrop: 0,
    danger: 0,
    aimX: W / 2,
    pointerDown: false,
    combo: 1,
    lastMergeAt: 0,
    shake: 0,
  };

  const fx = { rings: [], parts: [], texts: [] };
  const bubbles = Array.from({ length: 26 }, () => ({
    x: rand(10, W - 10),
    y: rand(0, H),
    r: rand(1.4, 5.2),
    v: rand(8, 26),
    a: rand(0.05, 0.22),
  }));

  /* --------------------------------------------------------------- 输入 */
  function toLocal(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  function aimTo(x) {
    const r = LEVELS[state.current - 1].r;
    state.aimX = clamp(x, r + 4, W - r - 4);
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = toLocal(e);
    aimTo(p.x);
  });
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    initAudio();
    const p = toLocal(e);
    aimTo(p.x);
    state.pointerDown = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!state.pointerDown) return;
    state.pointerDown = false;
    const p = toLocal(e);
    aimTo(p.x);
    drop();
  });
  canvas.addEventListener('pointercancel', () => { state.pointerDown = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { aimTo(state.aimX - 22); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { aimTo(state.aimX + 22); e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'ArrowDown') { drop(); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') restart();
    else if (e.key === 'm' || e.key === 'M') toggleSound();
  });

  /* --------------------------------------------------------- 投放与合成 */
  function randomSpawn() {
    let roll = Math.random();
    for (let i = 0; i < SPAWN_WEIGHTS.length; i++) {
      roll -= SPAWN_WEIGHTS[i];
      if (roll <= 0) return i + 1;
    }
    return 1;
  }

  function drop() {
    if (state.phase !== 'playing') return;
    const now = performance.now();
    if (now - state.lastDrop < DROP_COOLDOWN) return;
    state.lastDrop = now;

    const level = state.current;
    const r = LEVELS[level - 1].r;
    const x = clamp(state.aimX, r + 4, W - r - 4);
    const body = makeFish(level, x, DROP_Y);
    Body.setVelocity(body, { x: rand(-0.2, 0.2), y: 1.4 });
    body.pl.spawn = 0.86;

    sfx.drop();
    hintEl.classList.add('hide');

    state.current = state.next;
    state.next = randomSpawn();
    aimTo(state.aimX);
    updateNextUI();
  }

  const mergeQueue = [];

  Events.on(engine, 'collisionStart', (ev) => {
    const pairs = ev.pairs;
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i].bodyA;
      const b = pairs[i].bodyB;
      if (!a.pl || !b.pl || a.pl.dead || b.pl.dead) continue;
      if (a.pl.level !== b.pl.level || a.pl.merged || b.pl.merged) continue;
      a.pl.merged = true;
      b.pl.merged = true;
      mergeQueue.push([a, b]);
    }
  });

  function processMerges(now) {
    while (mergeQueue.length) {
      const pair = mergeQueue.pop();
      const a = pair[0], b = pair[1];
      if (a.pl.dead || b.pl.dead) continue;

      const level = a.pl.level;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      removeFish(a);
      removeFish(b);

      const isMax = level >= MAX_LEVEL;
      const nextLevel = isMax ? 0 : level + 1;
      const gainLevel = isMax ? MAX_LEVEL : nextLevel;

      if (now - state.lastMergeAt < 750) state.combo = Math.min(state.combo + 1, 9);
      else state.combo = 1;
      state.lastMergeAt = now;

      const mult = 1 + (state.combo - 1) * 0.2;
      let gain = Math.round(MERGE_SCORE[gainLevel] * mult);
      if (isMax) gain = Math.round(260 * mult);

      state.score += gain;
      updateScore();

      const color = LEVELS[gainLevel - 1].color;
      addRing(x, y, isMax ? 150 : LEVELS[gainLevel - 1].r * 1.5, color);
      burst(x, y, color, isMax ? 26 : 10 + Math.round(gainLevel * 1.4));
      addText(x, y - LEVELS[gainLevel - 1].r * 0.4, '+' + gain, isMax ? '#ffd166' : '#ffffff', isMax ? 30 : 20);

      if (isMax) {
        sfx.big();
        state.shake = 14;
        toast('🐳 双鱼飞升！+' + gain);
      } else {
        sfx.merge(gainLevel);
        state.shake = Math.max(state.shake, 2 + gainLevel * 0.5);
        const nr = LEVELS[nextLevel - 1].r;
        const body = makeFish(nextLevel, clamp(x, nr + 2, W - nr - 2), y);
        body.pl.spawn = 1.24;
        if (gainLevel > 1 && !state.seen.has(gainLevel)) {
          state.seen.add(gainLevel);
          store.set('seen', Array.from(state.seen));
          toast('🎉 解锁：' + LEVELS[gainLevel - 1].name);
          renderBook();
        }
      }

      if (state.combo >= 2) showCombo(state.combo);
    }
  }

  /* ---------------------------------------------------------------- 特效 */
  function addRing(x, y, r, color) {
    fx.rings.push({ x, y, r0: r * 0.35, r1: r, life: 1, color });
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const ang = rand(0, TAU);
      const sp = rand(0.08, 0.34);
      fx.parts.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 0.06,
        r: rand(1.5, 4.2),
        life: 1,
        color: Math.random() < 0.4 ? '#ffffff' : color,
      });
    }
  }
  function addText(x, y, text, color, size) {
    fx.texts.push({ x, y, text, color, size, life: 1 });
  }

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  let comboTimer = 0;
  function showCombo(n) {
    comboEl.textContent = '连击 ×' + n;
    comboEl.classList.remove('show');
    void comboEl.offsetWidth;
    comboEl.classList.add('show');
    clearTimeout(comboTimer);
    comboTimer = setTimeout(() => comboEl.classList.remove('show'), 820);
  }

  /* ---------------------------------------------------------------- 计分 */
  function updateScore() {
    scoreEl.textContent = state.score;
    scoreEl.classList.remove('bump');
    void scoreEl.offsetWidth;
    scoreEl.classList.add('bump');
    if (state.score > state.best) {
      state.best = state.score;
      store.set('best', state.best);
      bestEl.textContent = state.best;
    }
  }

  function updateNextUI() {
    nextImg.src = imgSrc(state.next);
    nextName.textContent = LEVELS[state.next - 1].name;
  }

  /* -------------------------------------------------------------- 游戏流 */
  function resetWorld() {
    for (let i = fishBodies.length - 1; i >= 0; i--) {
      Composite.remove(engine.world, fishBodies[i]);
    }
    fishBodies.length = 0;
    mergeQueue.length = 0;
    fx.rings.length = 0;
    fx.parts.length = 0;
    fx.texts.length = 0;
  }

  function startGame() {
    resetWorld();
    state.phase = 'playing';
    state.score = 0;
    state.combo = 1;
    state.danger = 0;
    state.lastDrop = 0;
    state.lastMergeAt = 0;
    state.shake = 0;
    state.aimX = W / 2;
    state.current = 1 + Math.floor(Math.random() * 3);
    state.next = randomSpawn();
    scoreEl.textContent = '0';
    bestEl.textContent = state.best;
    updateNextUI();
    overlay.classList.add('hidden');
    hintEl.classList.remove('hide');
    hintEl.textContent = HINT_TEXT;
  }

  function restart() {
    book.classList.add('hidden');
    startGame();
  }

  function gameOver() {
    if (state.phase !== 'playing') return;
    state.phase = 'over';
    state.pointerDown = false;
    sfx.over();
    const reached = Math.max.apply(null, Array.from(state.seen));
    $('overScore').textContent = state.score;
    $('overBest').textContent = state.best;
    $('overFish').src = imgSrc(reached);
    $('overTitle').textContent = state.score >= state.best && state.score > 0 ? '新纪录！' : '鱼塘满了';
    $('overDesc').textContent =
      state.score >= 200 ? '这缸肥鱼，已经养出感情了。' : '肥鱼们挤不下啦，再来一缸？';
    setTimeout(() => overlay.classList.remove('hidden'), 420);
  }

  function toggleSound() {
    muted = !muted;
    store.set('mute', muted);
    $('btnSound').textContent = muted ? '🔇' : '🔊';
    $('btnSound').classList.toggle('off', muted);
    if (!muted) initAudio();
  }

  /* -------------------------------------------------------------- 图鉴 */
  function renderBook() {
    bookGrid.innerHTML = '';
    LEVELS.forEach((lv, i) => {
      const n = i + 1;
      const el = document.createElement('div');
      el.className = 'book-item' + (state.seen.has(n) ? '' : ' locked');
      el.innerHTML =
        '<img src="' + imgSrc(n) + '" alt="' + lv.name + '">' +
        '<b>' + (state.seen.has(n) ? lv.name : '???') + '</b>' +
        '<i>Lv.' + n + '</i>';
      bookGrid.appendChild(el);
    });
  }

  /* -------------------------------------------------------------- 布局 */
  let dpr = 1;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    const app = $('app');
    const col = document.querySelector('.col');
    const topbar = document.querySelector('.topbar');
    const foot = document.querySelector('.foot');
    const availH = Math.max(240, app.clientHeight - topbar.offsetHeight - foot.offsetHeight - 18);
    const availW = Math.max(240, Math.min(app.clientWidth - 20, 560));
    const w = Math.min(availW, (availH * W) / H);
    const h = (w * H) / W;

    col.style.width = Math.floor(w) + 'px';
    canvas.style.width = Math.floor(w) + 'px';
    canvas.style.height = Math.floor(h) + 'px';
  }
  window.addEventListener('resize', layout);
  if (window.ResizeObserver) {
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(layout);
    }).observe(boardWrap);
  }

  /* -------------------------------------------------------------- 渲染 */
  function drawBackground(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d2747');
    g.addColorStop(0.45, '#0a1f3a');
    g.addColorStop(1, '#061426');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const lg = ctx.createRadialGradient(W / 2, H + 60, 40, W / 2, H + 60, H * 0.85);
    lg.addColorStop(0, 'rgba(96, 196, 255, 0.20)');
    lg.addColorStop(1, 'rgba(96, 196, 255, 0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const x = ((i * 173 + t * 0.012 * (i + 1)) % (W + 240)) - 120;
      const grad = ctx.createLinearGradient(x, -80, x + 90, H * 0.92);
      grad.addColorStop(0, 'rgba(150, 220, 255, 0.09)');
      grad.addColorStop(1, 'rgba(150, 220, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, -80);
      ctx.lineTo(x + 70, -80);
      ctx.lineTo(x + 190, H * 0.92);
      ctx.lineTo(x + 40, H * 0.92);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fillStyle = 'rgba(180, 230, 255, ' + b.a + ')';
      ctx.fill();
      ctx.strokeStyle = 'rgba(220, 245, 255, ' + b.a * 0.9 + ')';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    ctx.restore();

    const fg = ctx.createLinearGradient(0, FLOOR_TOP - 26, 0, FLOOR_TOP + 10);
    fg.addColorStop(0, 'rgba(120, 210, 255, 0)');
    fg.addColorStop(1, 'rgba(120, 210, 255, 0.22)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, FLOOR_TOP - 26, W, 40);
    ctx.fillStyle = 'rgba(170, 230, 255, 0.35)';
    ctx.fillRect(0, FLOOR_TOP - 1, W, 1.4);
  }

  function drawDangerLine(t) {
    const pulse = state.danger > 0 ? 0.45 + 0.35 * Math.sin(t * 0.012) : 0.26;
    const col = state.danger > 0 ? 'rgba(255, 120, 120, ' + pulse + ')' : 'rgba(255, 200, 120, ' + pulse + ')';
    ctx.save();
    ctx.setLineDash([9, 9]);
    ctx.lineDashOffset = -t * 0.02;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(14, DANGER_Y);
    ctx.lineTo(W - 14, DANGER_Y);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = '600 10px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillStyle = state.danger > 0 ? 'rgba(255,150,150,.75)' : 'rgba(255,205,150,.5)';
    ctx.textAlign = 'right';
    ctx.fillText(state.danger > 0 ? '危险！' : '危险线', W - 16, DANGER_Y - 6);
    ctx.restore();
  }

  function drawAim(t) {
    if (state.phase !== 'playing') return;
    const r = LEVELS[state.current - 1].r;
    const x = clamp(state.aimX, r + 4, W - r - 4);

    ctx.save();
    ctx.setLineDash([5, 12]);
    ctx.lineDashOffset = -t * 0.03;
    ctx.strokeStyle = 'rgba(190, 230, 255, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, DROP_Y + r * 0.6);
    ctx.lineTo(x, FLOOR_TOP - 6);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(190, 230, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, FLOOR_TOP - 5, r * 0.9, r * 0.28, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.62;
    drawFishAt(x, DROP_Y, state.current, 1, true);
    ctx.restore();
  }

  function drawFishAt(x, y, level, scale, ghost) {
    const L = LEVELS[level - 1];
    const r = L.r * scale;

    const glow = ctx.createRadialGradient(x, y, r * 0.55, x, y, r * 1.45);
    glow.addColorStop(0, rgba(L.color, ghost ? 0.3 : 0.52));
    glow.addColorStop(1, rgba(L.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.45, 0, TAU);
    ctx.fill();

    const g = ctx.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.08, x, y, r * 1.06);
    g.addColorStop(0, mixHex(L.color, '#ffffff', 0.78));
    g.addColorStop(0.52, mixHex(L.color, '#ffffff', 0.22));
    g.addColorStop(1, mixHex(L.color, '#1a2b4a', 0.28));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = Math.max(1.5, r * 0.055);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(x - r * 0.34, y - r * 0.46, r * 0.34, r * 0.2, -0.55, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.fill();

    const img = images[level - 1];
    if (img && img.complete) {
      const s = r * 2.16;
      ctx.drawImage(img, x - s / 2, y - s / 2 - r * 0.02, s, s);
    }
  }

  function drawFish(body, t) {
    const pl = body.pl;
    const born = (performance.now() - pl.born) / 190;
    const k = clamp(born, 0, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    const scale = lerp(pl.spawn, 1, ease);
    const wobble = body.isSleeping ? 0 : Math.sin(t * 0.002 + body.id) * 0.006;
    drawFishAt(body.position.x, body.position.y, pl.level, scale + wobble, false);
  }

  function drawFX() {
    ctx.save();
    for (const ring of fx.rings) {
      const p = 1 - ring.life;
      const r = lerp(ring.r0, ring.r1, p);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, r, 0, TAU);
      ctx.strokeStyle = rgba(ring.color, ring.life * 0.85);
      ctx.lineWidth = 2 + 5 * ring.life;
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    for (const p of fx.parts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, TAU);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    for (const tx of fx.texts) {
      const a = clamp(tx.life * 1.4, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '900 ' + tx.size + 'px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(4, 16, 30, ' + a * 0.55 + ')';
      ctx.strokeText(tx.text, tx.x, tx.y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, tx.x, tx.y);
    }
    ctx.restore();
  }

  function render(t) {
    const shake = state.shake;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawBackground(t);
    drawDangerLine(t);

    ctx.save();
    ctx.strokeStyle = 'rgba(150, 210, 255, 0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.restore();

    ctx.save();
    if (shake > 0.2) ctx.translate(rand(-shake, shake), rand(-shake, shake));

    const sorted = fishBodies.slice().sort((a, b) => a.pl.level - b.pl.level || a.id - b.id);
    for (const b of sorted) drawFish(b, t);

    drawAim(t);
    drawFX();
    ctx.restore();

    ctx.save();
    ctx.font = '700 11px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200, 235, 255, 0.35)';
    ctx.textAlign = 'left';
    ctx.fillText('TANK 01 · ' + fishBodies.length + ' FISH', 16, 22);
    ctx.restore();
  }

  /* -------------------------------------------------------------- 主循环 */
  let lastT = performance.now();
  let acc = 0;

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      lastT = performance.now();
      acc = 0;
    }
  });

  function frame(t) {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min(now - lastT, 50);
    lastT = now;

    if (state.phase !== 'over') {
      acc += dt;
      let steps = 0;
      while (acc >= 16.6667 && steps < 4) {
        Engine.update(engine, 16.6667);
        acc -= 16.6667;
        steps++;
      }
      if (steps === 4) acc = 0;
    }

    processMerges(now);
    updateFX(dt);
    updateDanger(dt, now);

    for (const b of bubbles) {
      b.y -= b.v * dt * 0.001;
      b.x += Math.sin((t + b.y) * 0.004) * 0.06;
      if (b.y < -8) { b.y = H + 8; b.x = rand(10, W - 10); }
    }

    state.shake *= Math.pow(0.86, dt / 16.67);
    render(t);
  }

  function updateFX(dt) {    const k = dt / 16.667;
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      fx.rings[i].life -= 0.045 * k;
      if (fx.rings[i].life <= 0) fx.rings.splice(i, 1);
    }
    for (let i = fx.parts.length - 1; i >= 0; i--) {
      const p = fx.parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.0006 * dt;
      p.vx *= 0.995;
      p.life -= 0.028 * k;
      if (p.life <= 0) fx.parts.splice(i, 1);
    }
    for (let i = fx.texts.length - 1; i >= 0; i--) {
      const tx = fx.texts[i];
      tx.y -= 0.05 * dt;
      tx.life -= 0.014 * k;
      if (tx.life <= 0) fx.texts.splice(i, 1);
    }
  }

  function updateDanger(dt, now) {
    if (state.phase !== 'playing') return;
    let danger = false;
    for (const b of fishBodies) {
      const top = b.position.y - b.circleRadius;
      const calm = b.isSleeping || b.speed < 0.9;
      if (top < DANGER_Y && calm && now - b.pl.born > 600) { danger = true; break; }
    }
    if (danger) {
      state.danger += dt;
      if (state.danger > 1200) gameOver();
    } else {
      state.danger = Math.max(0, state.danger - dt * 2);
    }
  }

  /* -------------------------------------------------------------- 启动 */
  const images = [];
  function loadImages() {
    return Promise.all(
      LEVELS.map(function (_, i) {
        return new Promise(function (resolve) {
          const img = new Image();
          img.onload = function () { resolve(img); };
          img.onerror = function () { resolve(img); };
          img.src = imgSrc(i + 1);
          images[i] = img;
        });
      })
    );
  }

  function bindUI() {
    $('btnAgain').addEventListener('click', restart);
    $('btnRestart').addEventListener('click', restart);
    $('btnSound').addEventListener('click', toggleSound);
    $('btnBook').addEventListener('click', function () { renderBook(); book.classList.remove('hidden'); });
    $('btnBookClose').addEventListener('click', function () { book.classList.add('hidden'); });
    book.addEventListener('click', function (e) { if (e.target === book) book.classList.add('hidden'); });
    $('btnShare').addEventListener('click', function () {
      const top = Math.max.apply(null, Array.from(state.seen));
      const text = '我在「合成大肥鱼」养出 ' + state.score + ' 分，最高到 ' + LEVELS[top - 1].name + '！你也来养一缸 🐳 ' + location.href;
      function fallback() { toast('复制失败，手动截图吧～'); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast('战绩已复制，去贴给朋友吧'); }, fallback);
      } else { fallback(); }
    });
    $('btnSound').textContent = muted ? '🔇' : '🔊';
    $('btnSound').classList.toggle('off', muted);
  }

  async function boot() {
    layout();
    bindUI();
    bestEl.textContent = state.best;
    await loadImages();
    renderBook();
    state.current = 1 + Math.floor(Math.random() * 3);
    state.next = randomSpawn();
    updateNextUI();
    state.phase = 'playing';
    requestAnimationFrame(function () {
      lastT = performance.now();
      frame(performance.now());
    });
  }

  /* -------------------------------------------------------------- 调试钩子 */
  function dropAt(x) {
    aimTo(x);
    drop();
  }
  window.__dfy = {
    get state() { return state; },
    get fish() { return fishBodies.length; },
    get bodies() { return fishBodies; },
    LEVELS: LEVELS,
    drop: drop,
    dropAt: dropAt,
    restart: restart,
    clear: resetWorld,
    over: gameOver,
    spawn: function (level, x, y) {
      return makeFish(level, x == null ? W / 2 : x, y == null ? 300 : y);
    },
    tick: function (n) {
      for (let i = 0; i < (n || 1); i++) {
        Engine.update(engine, 16.6667);
        const now = performance.now();
        processMerges(now);
        updateFX(16.6667);
        updateDanger(16.6667, now);
      }
      render(performance.now());
    },
    auto: function (n, gap) {
      let i = 0;
      const id = setInterval(function () {
        dropAt(rand(W * 0.25, W * 0.75));
        if (++i >= n) clearInterval(id);
      }, gap || 420);
      return id;
    },
  };

  boot();
})();
