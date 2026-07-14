'use strict';
/* ================================================================
   CYBER GARDEN DEFENSE — script.js
   Vanilla ES6, Canvas API, Web Audio API, LocalStorage.
   Sections:
     1.  Utilities
     2.  Data tables (UNIT_TYPES, ENEMY_TYPES, PROJECTILE_TYPES)
     3.  Procedural sprite drawing helpers
     4.  SoundManager
     5.  Particle
     6.  Tile / Grid
     7.  Unit
     8.  Enemy
     9.  Projectile
     10. WaveManager
     11. AnimationManager
     12. UIManager
     13. StarfieldBG (menu/background ambience)
     14. Game (main orchestrator + loop)
     15. Bootstrapping
   ================================================================ */

/* ================================================================
   1. UTILITIES
   ================================================================ */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);

/* Logical (world) resolution — all game-object math happens in this
   coordinate space; the canvas is scaled/letterboxed to fit any
   container size at render time (see Game.resize). */
const LOGICAL_COLS = 9;
const LOGICAL_ROWS = 5;
const CELL = 100;
const BASE_W = 46;                              // width of the "root node" wall strip
const LOGICAL_W = BASE_W + LOGICAL_COLS * CELL;  // 946
const LOGICAL_H = LOGICAL_ROWS * CELL;           // 500

const TOTAL_WAVES = 10;

/* ================================================================
   2. DATA TABLES
   ================================================================ */
const UNIT_TYPES = {
  generator: {
    id: 'generator', name: 'Energy Generator', cost: 50, hp: 80,
    color: '#2ee6ff', accent: '#0a3f4a',
    generateAmount: 25, generateInterval: 6,
    desc: 'Passively generates bonus energy every 6s.',
  },
  pulse: {
    id: 'pulse', name: 'Pulse Shooter', cost: 100, hp: 100,
    color: '#3b6bff', accent: '#0d1740',
    cooldown: 1.1, damage: 12, projectile: 'bolt', range: 999, speed: 620,
    desc: 'Fires rapid energy bolts at the nearest enemy in its lane.',
  },
  shield: {
    id: 'shield', name: 'Shield Node', cost: 75, hp: 320,
    color: '#a63bff', accent: '#2a0f40',
    desc: 'Very high HP. Blocks and delays enemies in its lane.',
  },
  laser: {
    id: 'laser', name: 'Laser Cannon', cost: 175, hp: 90,
    color: '#ff8a2e', accent: '#402008',
    cooldown: 2.6, damage: 70, projectile: 'laser', range: 999, speed: 1400,
    desc: 'Slow to charge, but devastating single-target damage.',
  },
  freeze: {
    id: 'freeze', name: 'Freeze Tower', cost: 125, hp: 90,
    color: '#8fdcff', accent: '#0a2c40',
    cooldown: 2.2, damage: 6, projectile: 'missile', range: 999, speed: 460,
    slowFactor: 0.45, slowDuration: 3,
    desc: 'Fires cryo missiles that slow enemies on impact.',
  },
};

const ENEMY_TYPES = {
  drone: {
    id: 'drone', name: 'Drone', hp: 60, speed: 30, damage: 4,
    attackInterval: 0.9, color: '#2ee6ff', score: 10, radius: 22,
  },
  tank: {
    id: 'tank', name: 'Tank Bot', hp: 280, speed: 14, damage: 8,
    attackInterval: 1.1, color: '#ff8a2e', score: 30, radius: 30,
  },
  speed: {
    id: 'speed', name: 'Speed Bot', hp: 40, speed: 62, damage: 3,
    attackInterval: 0.7, color: '#ff2ea6', score: 18, radius: 20,
  },
  flying: {
    id: 'flying', name: 'Flying AI', hp: 80, speed: 40, damage: 4,
    attackInterval: 0.9, color: '#a63bff', score: 24, radius: 24, flying: true,
  },
  boss: {
    id: 'boss', name: 'Boss Mech', hp: 1100, speed: 11, damage: 20,
    attackInterval: 1.3, color: '#ff2e4d', score: 200, radius: 42, boss: true,
  },
};

const PROJECTILE_TYPES = {
  bolt:   { color: '#3b6bff', glow: '#7fa8ff', size: 7,  trail: true  },
  laser:  { color: '#ff8a2e', glow: '#ffd9a3', size: 5,  trail: false, beam: true },
  missile:{ color: '#8fdcff', glow: '#e0f7ff', size: 8,  trail: true, frost: true },
};

/* ================================================================
   3. PROCEDURAL SPRITE DRAWING
   All visuals are drawn with canvas primitives — no image assets.
   `t` is elapsed seconds (for idle motion), `fx` carries transient
   animation state (attack flash, hit flash, death progress, etc).
   ================================================================ */
function glow(ctx, color, blur) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}
function clearGlow(ctx) { ctx.shadowBlur = 0; }

function drawUnitSprite(ctx, typeId, cx, cy, t, fx = {}) {
  const type = UNIT_TYPES[typeId];
  const scale = fx.scale !== undefined ? fx.scale : 1;
  const hitFlash = fx.hitFlash || 0;
  const atkFlash = fx.atkFlash || 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  const baseColor = hitFlash > 0 ? `rgba(255,255,255,${hitFlash})` : type.color;

  switch (typeId) {
    case 'generator': {
      const spin = t * 1.4;
      glow(ctx, type.color, 14);
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = spin + (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * 24, y = Math.sin(a) * 24;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      clearGlow(ctx);
      const pulse = 8 + Math.sin(t * 4) * 3;
      ctx.fillStyle = baseColor;
      glow(ctx, type.color, 18);
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.fill();
      clearGlow(ctx);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'pulse': {
      glow(ctx, type.color, 12);
      ctx.fillStyle = type.accent;
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 2.5;
      roundRect(ctx, -20, -18, 40, 36, 8);
      ctx.fill(); ctx.stroke();
      const recoil = atkFlash * 6;
      ctx.fillStyle = baseColor;
      glow(ctx, type.color, 16 + atkFlash * 10);
      roundRect(ctx, 6 - recoil, -6, 22, 12, 4);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-4, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      clearGlow(ctx);
      break;
    }
    case 'shield': {
      glow(ctx, type.color, 14);
      ctx.fillStyle = type.accent;
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(22, -14);
      ctx.lineTo(22, 16);
      ctx.lineTo(0, 30);
      ctx.lineTo(-22, 16);
      ctx.lineTo(-22, -14);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      clearGlow(ctx);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -20); ctx.lineTo(0, 20);
      ctx.moveTo(-14, 0); ctx.lineTo(14, 0);
      ctx.stroke();
      const auraPulse = 0.15 + Math.sin(t * 2) * 0.08;
      ctx.strokeStyle = `rgba(166,59,255,${auraPulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'laser': {
      const charge = fx.charge || 0;
      glow(ctx, type.color, 10);
      ctx.fillStyle = type.accent;
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -26); ctx.lineTo(20, 0); ctx.lineTo(0, 26); ctx.lineTo(-20, 0);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      clearGlow(ctx);
      const coreColor = atkFlash > 0 ? '#ffffff' : type.color;
      glow(ctx, type.color, 10 + charge * 20 + atkFlash * 20);
      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.arc(0, 0, 6 + charge * 5, 0, Math.PI * 2);
      ctx.fill();
      clearGlow(ctx);
      break;
    }
    case 'freeze': {
      const bob = Math.sin(t * 2.2) * 2;
      glow(ctx, type.color, 16);
      ctx.fillStyle = type.accent;
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, -28 + bob);
      ctx.lineTo(16, -6 + bob);
      ctx.lineTo(10, 26 + bob);
      ctx.lineTo(-10, 26 + bob);
      ctx.lineTo(-16, -6 + bob);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      clearGlow(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 3; i++) {
        const ang = t * 1.5 + (i / 3) * Math.PI * 2;
        const rx = Math.cos(ang) * 20, ry = Math.sin(ang) * 8 - 4 + bob;
        ctx.beginPath(); ctx.arc(rx, ry, 2, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function drawEnemySprite(ctx, typeId, cx, cy, t, fx = {}) {
  const type = ENEMY_TYPES[typeId];
  const scale = (fx.scale !== undefined ? fx.scale : 1);
  const hitFlash = fx.hitFlash || 0;
  const lunge = fx.lunge || 0;
  const bob = type.flying ? Math.sin(t * 4 + cx * 0.05) * 6 : 0;
  ctx.save();
  ctx.translate(cx + lunge, cy + bob);
  ctx.scale(scale, scale);
  const baseColor = hitFlash > 0 ? `rgba(255,255,255,${hitFlash})` : type.color;

  switch (typeId) {
    case 'drone': {
      glow(ctx, type.color, 10);
      ctx.strokeStyle = type.color;
      ctx.lineWidth = 2;
      const spin = t * 8;
      for (let i = 0; i < 4; i++) {
        const a = spin + (i / 4) * Math.PI * 2;
        const rx = Math.cos(a) * 18, ry = Math.sin(a) * 18;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(rx, ry); ctx.stroke();
        ctx.beginPath(); ctx.arc(rx, ry, 3, 0, Math.PI * 2); ctx.stroke();
      }
      clearGlow(ctx);
      ctx.fillStyle = baseColor;
      glow(ctx, type.color, 12);
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      clearGlow(ctx);
      break;
    }
    case 'tank': {
      glow(ctx, type.color, 10);
      ctx.fillStyle = '#2a1608';
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2.5;
      roundRect(ctx, -26, -18, 52, 36, 6);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1a0e05';
      ctx.fillRect(-30, 14, 60, 8);
      ctx.fillRect(-30, -22, 60, 8);
      clearGlow(ctx);
      ctx.fillStyle = baseColor;
      ctx.fillRect(-4, -6, 22, 10);
      break;
    }
    case 'speed': {
      glow(ctx, type.color, 12);
      ctx.fillStyle = '#2a0a1c';
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(20, 0); ctx.lineTo(-16, -14); ctx.lineTo(-8, 0); ctx.lineTo(-16, 14);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      clearGlow(ctx);
      ctx.strokeStyle = `rgba(255,46,166,0.5)`;
      ctx.lineWidth = 2;
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-8 - i * 10, -6); ctx.lineTo(-8 - i * 10, 6);
        ctx.stroke();
      }
      break;
    }
    case 'flying': {
      glow(ctx, type.color, 14);
      ctx.fillStyle = '#1a0a2a';
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2.5;
      const wingFlap = Math.sin(t * 10) * 8;
      ctx.beginPath();
      ctx.moveTo(0, -20); ctx.lineTo(24, wingFlap); ctx.lineTo(0, 20); ctx.lineTo(-24, wingFlap);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      clearGlow(ctx);
      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'boss': {
      glow(ctx, type.color, 18);
      ctx.fillStyle = '#280808';
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const x = Math.cos(a) * 40, y = Math.sin(a) * 40;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      clearGlow(ctx);
      const corePulse = 10 + Math.sin(t * 5) * 4;
      glow(ctx, type.color, 20);
      ctx.fillStyle = baseColor;
      ctx.beginPath(); ctx.arc(0, 0, corePulse, 0, Math.PI * 2); ctx.fill();
      clearGlow(ctx);
      break;
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================================================================
   4. SOUND MANAGER — placeholder SFX synthesized with Web Audio API
   ================================================================ */
class SoundManager {
  constructor() {
    this.ctx = null;
    this.sfxVolume = 0.7;
    this.musicVolume = 0.4;
    this._ambientNodes = null;
  }

  /* Must be called after a user gesture (browser autoplay policy). */
  unlock() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
  }

  _env(gainNode, startTime, attack, decay, peak) {
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(peak, startTime + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);
  }

  _tone({ freq = 440, endFreq = null, duration = 0.2, type = 'sine', vol = 0.3, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
    this._env(gain, t0, Math.min(0.02, duration * 0.2), duration, vol * this.sfxVolume);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  _noiseBurst({ duration = 0.25, vol = 0.3, filterFreq = 1200, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol * this.sfxVolume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t0);
  }

  shoot(kind = 'bolt') {
    if (kind === 'laser') this._tone({ freq: 1400, endFreq: 500, duration: 0.22, type: 'sawtooth', vol: 0.25 });
    else if (kind === 'missile') this._tone({ freq: 500, endFreq: 260, duration: 0.28, type: 'triangle', vol: 0.25 });
    else this._tone({ freq: 900, endFreq: 1300, duration: 0.09, type: 'square', vol: 0.18 });
  }
  place() { this._tone({ freq: 300, endFreq: 700, duration: 0.18, type: 'sine', vol: 0.3 }); }
  enemyDeath() {
    this._noiseBurst({ duration: 0.22, vol: 0.28, filterFreq: 900 });
    this._tone({ freq: 260, endFreq: 60, duration: 0.24, type: 'sawtooth', vol: 0.2, delay: 0.02 });
  }
  buttonClick() { this._tone({ freq: 700, endFreq: 900, duration: 0.07, type: 'square', vol: 0.2 }); }
  hit() { this._tone({ freq: 200, endFreq: 120, duration: 0.08, type: 'square', vol: 0.15 }); }
  baseHit() { this._noiseBurst({ duration: 0.3, vol: 0.35, filterFreq: 500 }); }
  victory() {
    [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, duration: 0.3, type: 'triangle', vol: 0.25, delay: i * 0.14 }));
  }
  defeat() {
    [400, 320, 240, 160].forEach((f, i) => this._tone({ freq: f, duration: 0.35, type: 'sawtooth', vol: 0.22, delay: i * 0.16 }));
  }
  waveStart() { this._tone({ freq: 220, endFreq: 440, duration: 0.4, type: 'sine', vol: 0.2 }); }
}

/* ================================================================
   5. PARTICLE
   ================================================================ */
class Particle {
  constructor(x, y, opts = {}) {
    this.x = x; this.y = y;
    this.vx = opts.vx ?? rand(-60, 60);
    this.vy = opts.vy ?? rand(-60, 60);
    this.life = 0;
    this.maxLife = opts.maxLife ?? rand(0.3, 0.7);
    this.size = opts.size ?? rand(2, 5);
    this.color = opts.color ?? '#2ee6ff';
    this.gravity = opts.gravity ?? 0;
    this.shrink = opts.shrink ?? true;
    this.fadeText = opts.text ?? null;
    this.dead = false;
  }
  update(dt) {
    this.life += dt;
    if (this.life >= this.maxLife) { this.dead = true; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    this.vx *= (1 - Math.min(1, dt * 1.5));
  }
  draw(ctx) {
    const p = 1 - this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = clamp(p, 0, 1);
    glow(ctx, this.color, 8);
    ctx.fillStyle = this.color;
    const s = this.shrink ? this.size * p : this.size;
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0.5, s), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class DamageNumber {
  constructor(x, y, text, color = '#ffffff') {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 0; this.maxLife = 0.8;
    this.vy = -40;
    this.dead = false;
  }
  update(dt) {
    this.life += dt;
    if (this.life >= this.maxLife) { this.dead = true; return; }
    this.y += this.vy * dt;
    this.vy += 40 * dt;
  }
  draw(ctx) {
    const p = 1 - this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = clamp(p, 0, 1);
    ctx.font = 'bold 15px "Orbitron", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.color;
    glow(ctx, this.color, 6);
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

/* ================================================================
   6. TILE / GRID
   ================================================================ */
class Tile {
  constructor(row, col, x, y, w, h) {
    this.row = row; this.col = col;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.cx = x + w / 2; this.cy = y + h / 2;
    this.unit = null;
  }
}

class Grid {
  constructor(rows, cols, cellSize, originX) {
    this.rows = rows; this.cols = cols; this.cell = cellSize; this.originX = originX;
    this.tiles = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push(new Tile(r, c, originX + c * cellSize, r * cellSize, cellSize, cellSize));
      }
      this.tiles.push(row);
    }
  }
  getTileAt(x, y) {
    const col = Math.floor((x - this.originX) / this.cell);
    const row = Math.floor(y / this.cell);
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return null;
    return this.tiles[row][col];
  }
  rowTiles(row) { return this.tiles[row]; }
  /* Nearest living unit "ahead" (smaller x) of a given x within a row. */
  nearestBlockerAhead(row, x) {
    let best = null; let bestX = -Infinity;
    for (const tile of this.tiles[row]) {
      if (tile.unit && tile.unit.hp > 0 && tile.cx < x && tile.cx > bestX) {
        bestX = tile.cx; best = tile.unit;
      }
    }
    return best;
  }
  /* Nearest living unit in a row that a projectile fired from x could hit. */
  forEachUnit(cb) {
    for (const row of this.tiles) for (const tile of row) if (tile.unit) cb(tile.unit, tile);
  }
}

/* ================================================================
   7. UNIT
   ================================================================ */
class Unit {
  constructor(typeId, tile, game) {
    this.typeId = typeId;
    this.type = UNIT_TYPES[typeId];
    this.tile = tile;
    this.game = game;
    this.hp = this.type.hp;
    this.maxHp = this.type.hp;
    this.cooldownTimer = rand(0, 0.3);
    this.genTimer = 0;
    this.placeAnim = 0;         // 0 -> 1 grow-in
    this.atkFlash = 0;          // attack flash decay
    this.hitFlash = 0;          // damage flash decay
    this.charge = 0;            // laser charge visual
    this.dying = false;
    this.deathTimer = 0;
    this.removed = false;
    this.ringPulse = 1;         // placement ring expand
  }

  takeDamage(amount) {
    if (this.dying) return;
    this.hp -= amount;
    this.hitFlash = 1;
    this.game.anim.addDamageNumber(this.tile.cx, this.tile.y + 10, `-${Math.round(amount)}`, '#ff2e4d');
    if (this.hp <= 0) this.startDeath();
  }

  startDeath() {
    this.dying = true;
    this.deathTimer = 0;
    this.game.spawnBurst(this.tile.cx, this.tile.cy, this.type.color, 16);
  }

  update(dt) {
    if (this.dying) {
      this.deathTimer += dt;
      if (this.deathTimer > 0.4) {
        this.removed = true;
        if (this.tile.unit === this) this.tile.unit = null;
      }
      return;
    }
    this.placeAnim = clamp(this.placeAnim + dt / 0.28, 0, 1);
    this.ringPulse = clamp(this.ringPulse - dt * 2, 0, 1);
    this.atkFlash = clamp(this.atkFlash - dt * 4, 0, 1);
    this.hitFlash = clamp(this.hitFlash - dt * 6, 0, 1);

    if (this.typeId === 'generator') {
      this.genTimer += dt;
      this.charge = clamp(this.genTimer / this.type.generateInterval, 0, 1);
      if (this.genTimer >= this.type.generateInterval) {
        this.genTimer = 0;
        this.game.addEnergy(this.type.generateAmount);
        this.atkFlash = 1;
        this.game.anim.addDamageNumber(this.tile.cx, this.tile.y + 4, `+${this.type.generateAmount}`, '#ffb84d');
        this.game.spawnBurst(this.tile.cx, this.tile.cy, this.type.color, 8);
      }
      return;
    }

    if (!this.type.projectile) return; // shield: no attack

    this.cooldownTimer += dt;
    this.charge = clamp(this.cooldownTimer / this.type.cooldown, 0, 1);
    if (this.cooldownTimer >= this.type.cooldown) {
      const target = this.game.findTargetInRow(this.tile.row, this.tile.cx);
      if (target) {
        this.cooldownTimer = 0;
        this.atkFlash = 1;
        this.game.spawnProjectile(this.type.projectile, this.tile.row, this.tile.cx + 26, this.tile.cy, this.type.damage, this);
        this.game.sound.shoot(this.type.projectile);
      }
    }
  }

  draw(ctx, t) {
    const scale = this.dying
      ? clamp(1 - this.deathTimer / 0.4, 0, 1)
      : (this.placeAnim < 1 ? lerp(0.2, 1, this.placeAnim) : 1);
    drawUnitSprite(ctx, this.typeId, this.tile.cx, this.tile.cy, t, {
      scale, hitFlash: this.hitFlash, atkFlash: this.atkFlash, charge: this.charge,
    });

    /* placement ring */
    if (this.ringPulse > 0 && this.placeAnim < 1) {
      ctx.save();
      ctx.globalAlpha = this.ringPulse;
      ctx.strokeStyle = this.type.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.tile.cx, this.tile.cy, 40 * (1.4 - this.ringPulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* health bar (only if damaged) */
    if (!this.dying && this.hp < this.maxHp) {
      const w = 40, h = 5;
      const x = this.tile.cx - w / 2, y = this.tile.cy - 38;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x, y, w, h);
      const pct = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = pct > 0.4 ? '#39ff9a' : '#ff2e4d';
      ctx.fillRect(x, y, w * pct, h);
    }
  }
}

/* ================================================================
   8. ENEMY
   ================================================================ */
class Enemy {
  constructor(typeId, row, x, game, waveMultiplier) {
    this.typeId = typeId;
    this.type = ENEMY_TYPES[typeId];
    this.row = row;
    this.x = x;
    this.y = row * CELL + CELL / 2;
    this.game = game;
    this.hp = Math.round(this.type.hp * waveMultiplier.hp);
    this.maxHp = this.hp;
    this.speed = this.type.speed * waveMultiplier.speed;
    this.baseSpeed = this.speed;
    this.state = 'walk';
    this.attackTimer = 0;
    this.hitFlash = 0;
    this.lunge = 0;
    this.slowTimer = 0;
    this.dying = false;
    this.deathTimer = 0;
    this.removed = false;
    this.breached = false;
    this.scoreValue = this.type.score;
  }

  applySlow(factor, duration) {
    this.slowTimer = Math.max(this.slowTimer, duration);
    this.slowFactor = factor;
  }

  takeDamage(amount) {
    if (this.dying) return;
    this.hp -= amount;
    this.hitFlash = 1;
    this.game.anim.addDamageNumber(this.x, this.y - 20, `-${Math.round(amount)}`, '#ffe45c');
    if (this.hp <= 0) this.startDeath();
  }

  startDeath() {
    this.dying = true;
    this.deathTimer = 0;
    this.game.sound.enemyDeath();
    this.game.spawnBurst(this.x, this.y, this.type.color, this.type.boss ? 36 : 14);
    this.game.addScore(this.scoreValue);
    this.game.waveManager.onEnemyKilled();
  }

  update(dt, grid) {
    this.hitFlash = clamp(this.hitFlash - dt * 6, 0, 1);
    this.lunge = clamp(this.lunge - dt * 5, 0, 1);
    if (this.dying) {
      this.deathTimer += dt;
      if (this.deathTimer > 0.35) this.removed = true;
      return;
    }
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.speed = this.baseSpeed * (this.slowFactor ?? 1);
      if (this.slowTimer <= 0) this.speed = this.baseSpeed;
    }

    const blocker = grid.nearestBlockerAhead(this.row, this.x);
    const contactGap = 30;
    if (blocker && (this.x - (blocker.tile.x + blocker.tile.w)) <= contactGap) {
      this.state = 'attack';
      this.attackTimer += dt;
      if (this.attackTimer >= this.type.attackInterval) {
        this.attackTimer = 0;
        this.lunge = 1;
        blocker.takeDamage(this.type.damage * 3);
        this.game.sound.hit();
        this.game.spawnBurst(blocker.tile.cx, blocker.tile.cy, '#ff2e4d', 4);
      }
    } else {
      this.state = 'walk';
      this.x -= this.speed * dt;
      if (this.x <= BASE_W) {
        this.breached = true;
        this.dying = true; // remove without death FX/score
        this.deathTimer = 0.34; // skip lingering shrink anim
        this.game.onBaseBreached(this);
      }
    }
  }

  draw(ctx, t) {
    const scale = this.dying ? clamp(1 - this.deathTimer / 0.35, 0, 1) : 1;
    if (this.breached) return;
    drawEnemySprite(ctx, this.typeId, this.x, this.y, t, {
      scale, hitFlash: this.hitFlash, lunge: this.state === 'attack' ? this.lunge * -8 : 0,
    });
    /* health bar */
    if (!this.dying && this.hp < this.maxHp) {
      const w = this.type.boss ? 60 : 34, h = 5;
      const x = this.x - w / 2, y = this.y - this.type.radius - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y, w, h);
      const pct = clamp(this.hp / this.maxHp, 0, 1);
      ctx.fillStyle = pct > 0.4 ? '#39ff9a' : '#ff2e4d';
      ctx.fillRect(x, y, w * pct, h);
    }
    if (this.slowTimer > 0) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#8fdcff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.type.radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ================================================================
   9. PROJECTILE
   ================================================================ */
class Projectile {
  constructor(typeId, row, x, y, damage, source, game) {
    this.typeId = typeId;
    this.type = PROJECTILE_TYPES[typeId];
    this.row = row; this.x = x; this.y = y;
    this.damage = damage;
    this.source = source;
    this.game = game;
    this.speed = source.type.speed || 600;
    this.dead = false;
    this.trailTimer = 0;
  }
  update(dt, enemies) {
    this.x += this.speed * dt;
    this.trailTimer += dt;
    if (this.type.trail && this.trailTimer > 0.02) {
      this.trailTimer = 0;
      this.game.particles.push(new Particle(this.x - 8, this.y, {
        vx: -30, vy: rand(-5, 5), maxLife: 0.2, size: 3, color: this.type.color, gravity: 0,
      }));
    }
    for (const enemy of enemies) {
      if (enemy.row !== this.row || enemy.dying || enemy.removed) continue;
      if (Math.abs(enemy.x - this.x) <= (enemy.type.radius * 0.7 + this.type.size)) {
        enemy.takeDamage(this.damage);
        if (this.type.frost) enemy.applySlow(this.game.getUnitByProjectileSource(this).type.slowFactor, this.game.getUnitByProjectileSource(this).type.slowDuration);
        this.game.spawnBurst(this.x, this.y, this.type.glow, 8);
        this.dead = true;
        return;
      }
    }
    if (this.x > LOGICAL_W + 40) this.dead = true;
  }
  draw(ctx) {
    ctx.save();
    glow(ctx, this.type.glow, 12);
    ctx.fillStyle = this.type.color;
    if (this.typeId === 'laser') {
      ctx.fillRect(this.x - 14, this.y - 2, 28, 4);
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.type.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ================================================================
   10. WAVE MANAGER
   ================================================================ */
class WaveManager {
  constructor(game) {
    this.game = game;
    this.waveNum = 0;
    this.entries = [];
    this.spawnIndex = 0;
    this.waveTimer = 0;
    this.enemiesAliveCount = 0;
    this.enemiesKilled = 0;
    this.totalEnemies = 0;
    this.state = 'idle';        // idle -> spawning -> clearing -> intermission
    this.intermissionTimer = 0;
    this.intermissionLength = 5;
    this.finished = false;
  }

  startWave(num) {
    this.waveNum = num;
    this.entries = this.generateWave(num);
    this.totalEnemies = this.entries.length;
    this.spawnIndex = 0;
    this.waveTimer = 0;
    this.enemiesKilled = 0;
    this.state = 'spawning';
    this.game.sound.waveStart();
    this.game.anim.announceWave(num);
    this.game.ui.setWave(num);
  }

  generateWave(waveNum) {
    const pool = ['drone'];
    if (waveNum >= 3) pool.push('speed');
    if (waveNum >= 4) pool.push('tank');
    if (waveNum >= 5) pool.push('flying');
    const isBossWave = waveNum % 5 === 0;
    // Fewer enemies and more breathing room early on; ramps up gradually.
    const count = Math.min(4 + Math.floor(waveNum * 1.5), 22);
    const spawnInterval = Math.max(0.9, 2.6 - waveNum * 0.11);

    const entries = [];
    let t = 3.5; // grace period before the first enemy appears, so the player can place a unit first
    for (let i = 0; i < count; i++) {
      entries.push({ type: pick(pool), time: t });
      t += spawnInterval * rand(0.85, 1.3);
    }
    if (isBossWave) {
      entries.push({ type: 'boss', time: t + 2.5 });
    }
    return entries;
  }

  onEnemyKilled() { this.enemiesKilled++; }

  update(dt) {
    if (this.state === 'spawning') {
      this.waveTimer += dt;
      while (this.spawnIndex < this.entries.length && this.entries[this.spawnIndex].time <= this.waveTimer) {
        const entry = this.entries[this.spawnIndex];
        this.game.spawnEnemy(entry.type, this.waveNum);
        this.spawnIndex++;
      }
      if (this.spawnIndex >= this.entries.length) this.state = 'clearing';
    } else if (this.state === 'clearing') {
      if (this.game.enemies.length === 0) {
        if (this.waveNum >= TOTAL_WAVES) {
          this.finished = true;
          this.game.triggerVictory();
        } else {
          this.state = 'intermission';
          this.intermissionTimer = 0;
        }
      }
    } else if (this.state === 'intermission') {
      this.intermissionTimer += dt;
      if (this.intermissionTimer >= this.intermissionLength) {
        this.startWave(this.waveNum + 1);
      }
    }
  }

  getProgress() {
    if (this.totalEnemies === 0) return 0;
    return clamp(this.enemiesKilled / this.totalEnemies, 0, 1);
  }
}

/* ================================================================
   11. ANIMATION MANAGER — shake, flash, floating text, wave banner
   ================================================================ */
class AnimationManager {
  constructor(game) {
    this.game = game;
    this.damageNumbers = [];
    this.shakeAmount = 0;
    this.flashAlpha = 0;
    this.waveBanner = null; // {text, life}
    this.viewport = document.getElementById('game-viewport');
    this.flashEl = document.getElementById('screen-flash');
    this.settingsShakeEnabled = true;
  }

  addDamageNumber(x, y, text, color) {
    this.damageNumbers.push(new DamageNumber(x, y, text, color));
  }

  shake(intensity = 1) {
    if (!this.settingsShakeEnabled) return;
    this.viewport.classList.remove('shake');
    void this.viewport.offsetWidth; // restart animation
    this.viewport.classList.add('shake');
  }

  flash() {
    this.flashEl.classList.remove('flash-active');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('flash-active');
  }

  announceWave(num) {
    this.waveBanner = { text: `WAVE ${num}`, life: 0, maxLife: 1.8 };
  }

  update(dt) {
    this.damageNumbers.forEach(d => d.update(dt));
    this.damageNumbers = this.damageNumbers.filter(d => !d.dead);
    if (this.waveBanner) {
      this.waveBanner.life += dt;
      if (this.waveBanner.life >= this.waveBanner.maxLife) this.waveBanner = null;
    }
  }

  draw(ctx) {
    this.damageNumbers.forEach(d => d.draw(ctx));
    if (this.waveBanner) {
      const p = this.waveBanner.life / this.waveBanner.maxLife;
      const alpha = p < 0.15 ? p / 0.15 : (p > 0.7 ? (1 - p) / 0.3 : 1);
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.textAlign = 'center';
      ctx.font = 'bold 42px "Orbitron", sans-serif';
      ctx.fillStyle = '#2ee6ff';
      glow(ctx, '#2ee6ff', 20);
      ctx.fillText(this.waveBanner.text, LOGICAL_W / 2, LOGICAL_H / 2);
      ctx.restore();
    }
  }
}

/* ================================================================
   12. UI MANAGER
   ================================================================ */
class UIManager {
  constructor(game) {
    this.game = game;
    this.els = {
      screens: document.querySelectorAll('.screen'),
      overlays: document.querySelectorAll('.overlay'),
      energy: document.getElementById('hud-energy'),
      wave: document.getElementById('hud-wave'),
      lives: document.getElementById('hud-lives'),
      score: document.getElementById('hud-score'),
      waveFill: document.getElementById('wave-progress-fill'),
      unitTray: document.getElementById('unit-tray'),
      menuHighscore: document.getElementById('menu-highscore'),
      goWave: document.getElementById('go-wave'),
      goScore: document.getElementById('go-score'),
      goHighscore: document.getElementById('go-highscore'),
      vicScore: document.getElementById('vic-score'),
      vicHighscore: document.getElementById('vic-highscore'),
      tooltip: document.getElementById('tooltip'),
      howtoUnits: document.getElementById('howto-units-list'),
      howtoEnemies: document.getElementById('howto-enemies-list'),
      viewport: document.getElementById('game-viewport'),
    };
    this.unitCards = {};
  }

  showScreen(id) {
    this.els.screens.forEach(s => s.classList.toggle('active', s.id === id));
  }
  showOverlay(id) {
    this.els.overlays.forEach(o => o.classList.toggle('active', o.id === id));
  }
  hideOverlays() {
    this.els.overlays.forEach(o => o.classList.remove('active'));
  }

  setEnergy(val) { this.els.energy.textContent = Math.floor(val); }
  setScore(val) { this.els.score.textContent = Math.floor(val); }
  setWave(num) { this.els.wave.textContent = num; }
  setWaveProgress(pct) { this.els.waveFill.style.width = `${Math.floor(pct * 100)}%`; }

  buildLives(max) {
    this.els.lives.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const el = document.createElement('span');
      el.className = 'life-icon';
      this.els.lives.appendChild(el);
    }
  }
  setLives(current, max) {
    const icons = this.els.lives.querySelectorAll('.life-icon');
    icons.forEach((icon, i) => icon.classList.toggle('lost', i >= current));
  }

  buildUnitTray(game) {
    this.els.unitTray.innerHTML = '';
    this.unitCards = {};
    Object.values(UNIT_TYPES).forEach(type => {
      const card = document.createElement('div');
      card.className = 'unit-card';
      card.dataset.type = type.id;

      const canvas = document.createElement('canvas');
      canvas.width = 88; canvas.height = 88;
      const ctx = canvas.getContext('2d');
      drawUnitSprite(ctx, type.id, 44, 44, 0, {});

      const name = document.createElement('div');
      name.className = 'unit-name';
      name.textContent = type.name;

      const cost = document.createElement('div');
      cost.className = 'unit-cost';
      cost.textContent = `⚡ ${type.cost}`;

      card.appendChild(canvas);
      card.appendChild(name);
      card.appendChild(cost);
      this.els.unitTray.appendChild(card);
      this.unitCards[type.id] = card;

      card.addEventListener('click', () => game.onUnitCardClick(type.id));
      card.addEventListener('mouseenter', (e) => this.showTooltip(type, e));
      card.addEventListener('mousemove', (e) => this.moveTooltip(e));
      card.addEventListener('mouseleave', () => this.hideTooltip());
    });
  }

  refreshAffordability(energy) {
    Object.values(UNIT_TYPES).forEach(type => {
      const card = this.unitCards[type.id];
      if (!card) return;
      card.classList.toggle('disabled', energy < type.cost);
    });
  }

  setSelectedCard(typeId) {
    Object.entries(this.unitCards).forEach(([id, card]) => {
      card.classList.toggle('selected', id === typeId);
    });
  }

  showTooltip(type, e) {
    const t = this.els.tooltip;
    let stats = `<div class="stat-line"><span>HP</span><span>${type.hp}</span></div>`;
    if (type.damage) stats += `<div class="stat-line"><span>DMG</span><span>${type.damage}</span></div>`;
    if (type.cooldown) stats += `<div class="stat-line"><span>RATE</span><span>${type.cooldown}s</span></div>`;
    if (type.generateAmount) stats += `<div class="stat-line"><span>ENERGY</span><span>+${type.generateAmount}/${type.generateInterval}s</span></div>`;
    t.innerHTML = `<h4>${type.name} — ⚡${type.cost}</h4><p>${type.desc}</p>${stats}`;
    t.classList.add('visible');
    this.moveTooltip(e);
  }
  moveTooltip(e) {
    const t = this.els.tooltip;
    t.style.left = `${e.clientX + 14}px`;
    t.style.top = `${e.clientY + 14}px`;
  }
  hideTooltip() { this.els.tooltip.classList.remove('visible'); }

  populateHowTo() {
    this.els.howtoUnits.innerHTML = Object.values(UNIT_TYPES).map(t =>
      `<li><strong>${t.name}</strong> — ⚡${t.cost} — ${t.desc}</li>`).join('');
    this.els.howtoEnemies.innerHTML = Object.values(ENEMY_TYPES).map(t =>
      `<li><strong>${t.name}</strong> — HP ${t.hp}, DMG ${t.damage}${t.boss ? ' — BOSS' : ''}</li>`).join('');
  }

  setPlacingMode(active, valid = true) {
    this.els.viewport.classList.toggle('placing', active);
    this.els.viewport.classList.toggle('invalid-placement', active && !valid);
  }
}

/* ================================================================
   13. STARFIELD BACKGROUND (ambient, runs behind every screen)
   ================================================================ */
class StarfieldBG {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = [];
    this.lastTime = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }
  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    const count = Math.floor((window.innerWidth * window.innerHeight) / 9000);
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random() * this.canvas.width,
      y: Math.random() * this.canvas.height,
      z: rand(0.2, 1),
      r: rand(0.5, 1.8),
      hue: pick(['#2ee6ff', '#a63bff', '#ff8a2e', '#3b6bff']),
      twinkle: Math.random() * Math.PI * 2,
    }));
  }
  loop(now) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.stars) {
      s.y += s.z * 12 * dt;
      s.twinkle += dt * 2;
      if (s.y > this.canvas.height) { s.y = -4; s.x = Math.random() * this.canvas.width; }
      const alpha = 0.4 + Math.sin(s.twinkle) * 0.3;
      ctx.globalAlpha = clamp(alpha, 0.1, 0.8) * s.z;
      ctx.fillStyle = s.hue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * s.z + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(this.loop);
  }
}

/* ================================================================
   14. GAME — main orchestrator
   ================================================================ */
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.fxCanvas = document.getElementById('fx-canvas');
    this.fxCtx = this.fxCanvas.getContext('2d');
    this.viewport = document.getElementById('game-viewport');

    this.sound = new SoundManager();
    this.ui = new UIManager(this);
    this.anim = new AnimationManager(this);

    this.grid = new Grid(LOGICAL_ROWS, LOGICAL_COLS, CELL, BASE_W);
    this.waveManager = new WaveManager(this);

    this.enemies = [];
    this.projectiles = [];
    this.particles = [];

    this.energy = 200;
    this.score = 0;
    this.lives = 5;
    this.maxLives = 5;

    this.state = 'menu'; // menu | playing | paused | gameover | victory
    this.selectedUnitType = null;
    this.hoverTile = null;

    this.lastTime = performance.now();
    this.energyRegenTimer = 0;
    this.t = 0; // elapsed sim time, for idle sprite animation

    this.scale = 1; this.offsetX = 0; this.offsetY = 0;

    this._bindUI();
    this._resizeCanvases();
    window.addEventListener('resize', () => this._resizeCanvases());

    this.ui.buildUnitTray(this);
    this.ui.populateHowTo();
    this.ui.buildLives(this.maxLives);
    this._loadHighScore();

    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  /* ---------------- persistence ---------------- */
  _loadHighScore() {
    this.highScore = Number(localStorage.getItem('cgd_highscore') || 0);
    this.ui.els.menuHighscore.textContent = this.highScore;
  }
  _saveHighScoreIfNeeded() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('cgd_highscore', String(this.highScore));
    }
  }

  /* ---------------- canvas sizing ---------------- */
  _resizeCanvases() {
    const rect = this.viewport.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const dpr = window.devicePixelRatio || 1;
    this.scale = Math.min(w / LOGICAL_W, h / LOGICAL_H);
    this.offsetX = (w - LOGICAL_W * this.scale) / 2;
    this.offsetY = (h - LOGICAL_H * this.scale) / 2;

    [this.canvas, this.fxCanvas].forEach(c => {
      c.width = w * dpr; c.height = h * dpr;
      c.style.width = `${w}px`; c.style.height = `${h}px`;
    });
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, this.offsetX * dpr, this.offsetY * dpr);
    this.fxCtx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, this.offsetX * dpr, this.offsetY * dpr);
  }

  _toLogicalCoords(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    const cssX = clientX - rect.left, cssY = clientY - rect.top;
    return { x: (cssX - this.offsetX) / this.scale, y: (cssY - this.offsetY) / this.scale };
  }

  /* ---------------- UI bindings ---------------- */
  _bindUI() {
    const click = (id, fn) => document.getElementById(id).addEventListener('click', () => { this._clickSound(); fn(); });

    click('btn-start', () => this.startNewGame());
    click('btn-howto', () => this.ui.showScreen('screen-howto'));
    click('btn-settings', () => this.ui.showScreen('screen-settings'));
    document.querySelectorAll('.btn-back').forEach(btn =>
      btn.addEventListener('click', () => { this._clickSound(); this.ui.showScreen('screen-menu'); }));

    click('btn-pause', () => this.pause());
    click('btn-resume', () => this.resume());
    click('btn-restart', () => this.startNewGame());
    click('btn-quit', () => this.quitToMenu());
    click('btn-retry', () => this.startNewGame());
    click('btn-gameover-menu', () => this.quitToMenu());
    click('btn-victory-again', () => this.startNewGame());
    click('btn-victory-menu', () => this.quitToMenu());

    document.getElementById('sfx-volume').addEventListener('input', (e) => {
      this.sound.sfxVolume = e.target.value / 100;
    });
    document.getElementById('music-volume').addEventListener('input', (e) => {
      this.sound.musicVolume = e.target.value / 100;
    });
    document.getElementById('screen-shake-toggle').addEventListener('change', (e) => {
      this.anim.settingsShakeEnabled = e.target.checked;
    });

    this.viewport.addEventListener('click', (e) => this._onCanvasClick(e));
    this.viewport.addEventListener('mousemove', (e) => this._onCanvasHover(e));
    this.viewport.addEventListener('mouseleave', () => { this.hoverTile = null; });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.state === 'playing') this.pause();
      else if (e.key === 'Escape' && this.state === 'paused') this.resume();
    });
  }

  _clickSound() { this.sound.unlock(); this.sound.buttonClick(); }

  onUnitCardClick(typeId) {
    this.sound.unlock();
    if (this.state !== 'playing') return;
    const type = UNIT_TYPES[typeId];
    if (this.energy < type.cost) { this.sound.buttonClick(); return; }
    this.selectedUnitType = (this.selectedUnitType === typeId) ? null : typeId;
    this.ui.setSelectedCard(this.selectedUnitType);
  }

  _onCanvasClick(e) {
    if (this.state !== 'playing' || !this.selectedUnitType) return;
    const { x, y } = this._toLogicalCoords(e.clientX, e.clientY);
    const tile = this.grid.getTileAt(x, y);
    if (!tile || tile.unit) return;
    const type = UNIT_TYPES[this.selectedUnitType];
    if (this.energy < type.cost) return;
    this.energy -= type.cost;
    const unit = new Unit(this.selectedUnitType, tile, this);
    tile.unit = unit;
    this.sound.place();
    this.spawnBurst(tile.cx, tile.cy, type.color, 10);
    this.selectedUnitType = null;
    this.ui.setSelectedCard(null);
  }

  _onCanvasHover(e) {
    if (this.state !== 'playing') { this.hoverTile = null; return; }
    const { x, y } = this._toLogicalCoords(e.clientX, e.clientY);
    this.hoverTile = this.grid.getTileAt(x, y);
    if (this.selectedUnitType) {
      const type = UNIT_TYPES[this.selectedUnitType];
      const valid = this.hoverTile && !this.hoverTile.unit && this.energy >= type.cost;
      this.ui.setPlacingMode(true, valid);
    } else {
      this.ui.setPlacingMode(false);
    }
  }

  /* ---------------- game flow ---------------- */
  startNewGame() {
    this.sound.unlock();
    this.grid = new Grid(LOGICAL_ROWS, LOGICAL_COLS, CELL, BASE_W);
    this.enemies = []; this.projectiles = []; this.particles = [];
    this.energy = 200; this.score = 0; this.lives = this.maxLives;
    this.selectedUnitType = null;
    this.ui.setSelectedCard(null);
    this.ui.buildLives(this.maxLives);
    this.ui.setLives(this.lives, this.maxLives);
    this.ui.setScore(0);
    this.ui.setEnergy(this.energy);
    this.ui.hideOverlays();
    this.ui.showScreen('screen-game');
    this.state = 'playing';
    this.waveManager = new WaveManager(this);
    this.waveManager.startWave(1);
    this._resizeCanvases();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showOverlay('overlay-pause');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hideOverlays();
  }
  quitToMenu() {
    this.state = 'menu';
    this.ui.hideOverlays();
    this.ui.showScreen('screen-menu');
    this.ui.els.menuHighscore.textContent = this.highScore;
  }

  triggerVictory() {
    this.state = 'victory';
    this._saveHighScoreIfNeeded();
    this.sound.victory();
    this.ui.els.vicScore.textContent = Math.floor(this.score);
    this.ui.els.vicHighscore.textContent = this.highScore;
    this.ui.showOverlay('overlay-victory');
  }

  triggerGameOver() {
    this.state = 'gameover';
    this._saveHighScoreIfNeeded();
    this.sound.defeat();
    this.ui.els.goWave.textContent = this.waveManager.waveNum;
    this.ui.els.goScore.textContent = Math.floor(this.score);
    this.ui.els.goHighscore.textContent = this.highScore;
    this.ui.showOverlay('overlay-gameover');
  }

  onBaseBreached(enemy) {
    this.lives--;
    this.ui.setLives(this.lives, this.maxLives);
    this.sound.baseHit();
    this.anim.shake();
    this.anim.flash();
    if (this.lives <= 0) this.triggerGameOver();
  }

  addEnergy(amount) { this.energy += amount; }
  addScore(amount) { this.score += amount; }

  /* ---------------- entity factories ---------------- */
  spawnEnemy(typeId, waveNum) {
    const row = randInt(0, LOGICAL_ROWS - 1);
    const waveMultiplier = {
      hp: 1 + (waveNum - 1) * 0.09,
      speed: 1 + (waveNum - 1) * 0.03,
    };
    const enemy = new Enemy(typeId, row, LOGICAL_W + rand(0, 60), this, waveMultiplier);
    this.enemies.push(enemy);
  }

  spawnProjectile(typeId, row, x, y, damage, sourceUnit) {
    const proj = new Projectile(typeId, row, x, y, damage, sourceUnit, this);
    this.projectiles.push(proj);
  }

  spawnBurst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      this.particles.push(new Particle(x, y, {
        vx: rand(-90, 90), vy: rand(-90, 90), color, maxLife: rand(0.25, 0.6), size: rand(2, 5), gravity: 40,
      }));
    }
  }

  findTargetInRow(row, fromX) {
    let best = null; let bestDist = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.row !== row || enemy.dying || enemy.removed || enemy.x <= fromX) continue;
      const d = enemy.x - fromX;
      if (d < bestDist) { bestDist = d; best = enemy; }
    }
    return best;
  }

  getUnitByProjectileSource(projectile) { return projectile.source; }

  /* ---------------- main loop ---------------- */
  loop(now) {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.state === 'playing') {
      this.t += dt;
      this.update(dt);
    } else {
      // keep idle animation time moving very slowly for menu-adjacent screens (not strictly needed)
    }
    this.render();
    requestAnimationFrame(this.loop);
  }

  update(dt) {
    /* passive energy regen */
    this.energyRegenTimer += dt;
    if (this.energyRegenTimer >= 1) {
      this.energyRegenTimer = 0;
      this.addEnergy(3);
    }

    this.waveManager.update(dt);

    this.grid.forEachUnit(u => u.update(dt));

    this.enemies.forEach(e => e.update(dt, this.grid));
    this.enemies = this.enemies.filter(e => !e.removed);

    this.projectiles.forEach(p => p.update(dt, this.enemies));
    this.projectiles = this.projectiles.filter(p => !p.dead);

    this.particles.forEach(p => p.update(dt));
    this.particles = this.particles.filter(p => !p.dead);

    this.anim.update(dt);

    // cleanup dead units left in tiles
    this.grid.forEachUnit(u => { if (u.removed && u.tile.unit === u) u.tile.unit = null; });

    // HUD sync
    this.ui.setEnergy(this.energy);
    this.ui.setScore(this.score);
    this.ui.refreshAffordability(this.energy);
    this.ui.setWaveProgress(this.waveManager.getProgress());
  }

  /* ---------------- rendering ---------------- */
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    if (this.state === 'menu' || this.state === 'howto' || this.state === 'settings') return;

    this._drawGridBackground(ctx);
    this._drawBaseWall(ctx);

    if (this.hoverTile && this.selectedUnitType) this._drawHoverHighlight(ctx);

    this.grid.forEachUnit(u => u.draw(ctx, this.t));
    this.enemies.forEach(e => e.draw(ctx, this.t));
    this.projectiles.forEach(p => p.draw(ctx));

    const fx = this.fxCtx;
    fx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    this.particles.forEach(p => p.draw(fx));
    this.anim.draw(fx);
  }

  _drawGridBackground(ctx) {
    for (let r = 0; r < LOGICAL_ROWS; r++) {
      for (let c = 0; c < LOGICAL_COLS; c++) {
        const tile = this.grid.tiles[r][c];
        const alt = (r + c) % 2 === 0;
        ctx.fillStyle = alt ? 'rgba(20,30,48,0.55)' : 'rgba(14,20,34,0.55)';
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
      }
    }
    ctx.strokeStyle = 'rgba(46,230,255,0.08)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= LOGICAL_COLS; c++) {
      const x = BASE_W + c * CELL;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, LOGICAL_H); ctx.stroke();
    }
    for (let r = 0; r <= LOGICAL_ROWS; r++) {
      const y = r * CELL;
      ctx.beginPath(); ctx.moveTo(BASE_W, y); ctx.lineTo(LOGICAL_W, y); ctx.stroke();
    }
  }

  _drawBaseWall(ctx) {
    const grad = ctx.createLinearGradient(0, 0, BASE_W, 0);
    grad.addColorStop(0, 'rgba(166,59,255,0.5)');
    grad.addColorStop(1, 'rgba(46,230,255,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, BASE_W, LOGICAL_H);
    ctx.strokeStyle = '#2ee6ff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(BASE_W, 0); ctx.lineTo(BASE_W, LOGICAL_H); ctx.stroke();
    const pulse = 0.4 + Math.sin(this.t * 3) * 0.2;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.shadowColor = '#2ee6ff'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#2ee6ff';
    for (let r = 0; r < LOGICAL_ROWS; r++) {
      ctx.beginPath();
      ctx.arc(BASE_W / 2, r * CELL + CELL / 2, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawHoverHighlight(ctx) {
    const t = this.hoverTile;
    const type = UNIT_TYPES[this.selectedUnitType];
    const valid = !t.unit && this.energy >= type.cost;
    ctx.save();
    ctx.strokeStyle = valid ? '#39ff9a' : '#ff2e4d';
    ctx.fillStyle = valid ? 'rgba(57,255,154,0.12)' : 'rgba(255,46,77,0.12)';
    ctx.lineWidth = 2;
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.strokeRect(t.x + 1, t.y + 1, t.w - 2, t.h - 2);
    ctx.restore();
  }
}

/* ================================================================
   15. BOOTSTRAP
   ================================================================ */
window.addEventListener('DOMContentLoaded', () => {
  new StarfieldBG(document.getElementById('bg-canvas'));
  window.__game = new Game();
});
