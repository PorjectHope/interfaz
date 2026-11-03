import * as THREE from 'three';

const COUNT = 2600;
const CAM_Z = 10;
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(19));
const REPEL_RADIUS = 0.17;
const REPEL_STRENGTH = 0.075;
const SHOCK_SPEED = 0.6;
const SHOCK_WIDTH = 0.12;
const SHOCK_AMP = 0.09;
const SHOCK_LIFE = 4;

const PALETTE = [
  [new THREE.Color(0xeef2ff), 0.55],
  [new THREE.Color(0xa0b2ff), 0.18],
  [new THREE.Color(0x7988ff), 0.12],
  [new THREE.Color(0xc083ff), 0.1],
  [new THREE.Color(0x9747ff), 0.05],
];

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aBand;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uLow;
  uniform float uHigh;
  varying vec3 vColor;
  varying float vTw;
  varying float vBright;
  varying float vBand;
  varying float vLevel;
  void main() {
    vColor = color;
    vTw = 0.6 + 0.4 * sin(uTime * 1.4 + aPhase);
    vBand = step(0.5, aBand);
    vLevel = aBand > 1.5 ? uHigh : (aBand > 0.5 ? uLow : 0.0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float raw = aSize * uPixelRatio * (9.0 / -mv.z);
    vBright = clamp(raw / 3.6, 0.3, 1.0);
    gl_PointSize = max(raw * 1.5, 3.6 * uPixelRatio) * (1.0 + 0.5 * vLevel);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTw;
  varying float vBright;
  varying float vBand;
  varying float vLevel;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 4.5);
    float flash = vBand > 0.5 ? mix(0.25, 1.4, vLevel) : 1.0;
    gl_FragColor = vec4(vColor, min(1.0, core * vTw * vBright * uOpacity * flash));
  }
`;

function pickColor() {
  let r = Math.random();
  for (const [c, w] of PALETTE) {
    if (r < w) return c;
    r -= w;
  }
  return PALETTE[0][0];
}

/* Soft streak: fades in from the tail, tapers at the head and falls off
   smoothly across its width, so it has no hard square edges. */
function makeStreakTexture() {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = ((y + 0.5) / h) * 2 - 1;
    const across = Math.exp(-v * v * 4.5);
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const along = Math.pow(u, 1.6) * (1 - THREE.MathUtils.smoothstep(u, 0.85, 1));
      const i = (y * w + x) * 4;
      img.data[i] = 205;
      img.data[i + 1] = 218;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * along * across);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

export class Starfield {
  constructor(scene) {
    this.scene = scene;
    this.nx = new Float32Array(COUNT);
    this.ny = new Float32Array(COUNT);
    this.depth = new Float32Array(COUNT);
    this.ox = new Float32Array(COUNT);
    this.oy = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
    const phases = new Float32Array(COUNT);
    const bands = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);

    for (let i = 0; i < COUNT; i++) {
      this.nx[i] = (Math.random() * 2 - 1) * 1.15;
      this.ny[i] = (Math.random() * 2 - 1) * 1.15;
      this.depth[i] = 1.5 + Math.pow(Math.random(), 1.3) * 34;
      const c = pickColor();
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      const roll = Math.random();
      sizes[i] = roll > 0.975
        ? 2.6 + Math.random() * 1.8
        : roll > 0.84
          ? 1.1 + Math.random() * 0.9
          : 0.35 + Math.random() * 0.5;
      phases[i] = Math.random() * Math.PI * 2;
      /* Big stars answer the bass, small ones answer the treble; the rest stay still. */
      bands[i] = roll > 0.84 ? 1 : Math.random() < 0.35 ? 2 : 0;
    }

    this.positions = new Float32Array(COUNT * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geometry.setAttribute('aBand', new THREE.BufferAttribute(bands, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uLow: { value: 0 },
        uHigh: { value: 0 },
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.shocks = [];
    this.meteors = [];
    this.streakTex = makeStreakTexture();
  }

  shock(nx, ny, t) {
    this.shocks.push({ nx, ny, t0: t });
  }

  /* Levels from the song, each between 0 and 1: low drives the big stars, high the small ones. */
  setBands(low, high) {
    this.material.uniforms.uLow.value = low;
    this.material.uniforms.uHigh.value = high;
  }

  shootingStar(aspect, t) {
    const dep = 12;
    const h = TAN_HALF_FOV * dep;
    const w = h * aspect;
    const angle = -0.22 - Math.random() * 0.36;
    const len = 2.6 + Math.random() * 1.4;
    const mat = new THREE.SpriteMaterial({
      map: this.streakTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0,
      rotation: angle,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(len, len * 0.09, 1);
    const z = CAM_Z - dep;
    const sx = -w - 1.8 - Math.random() * 1.5;
    const sy = h * (0.3 + Math.random() * 0.65);
    const dist = w * 2.5 + 6;
    sprite.position.set(sx, sy, z);
    this.scene.add(sprite);
    this.meteors.push({
      sprite,
      mat,
      sx,
      sy,
      z,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      t0: t,
      dur: 1.9,
    });
  }

  update(t, aspect, mx, my) {
    const pos = this.positions;
    const mxs = mx * aspect;

    for (let s = this.shocks.length - 1; s >= 0; s--) {
      if (t - this.shocks[s].t0 > SHOCK_LIFE) this.shocks.splice(s, 1);
    }

    for (let i = 0; i < COUNT; i++) {
      const bx = this.nx[i] * aspect;
      const by = this.ny[i];
      let tx = 0;
      let ty = 0;

      let dx = bx - mxs;
      let dy = by - my;
      let d = Math.hypot(dx, dy);
      if (d < REPEL_RADIUS && d > 1e-4) {
        const f = 1 - d / REPEL_RADIUS;
        const m = REPEL_STRENGTH * f * f;
        tx += (dx / d) * m;
        ty += (dy / d) * m;
      }

      for (const sh of this.shocks) {
        dx = bx - sh.nx * aspect;
        dy = by - sh.ny;
        d = Math.hypot(dx, dy);
        if (d < 1e-4) continue;
        const age = t - sh.t0;
        const ad = Math.abs(d - age * SHOCK_SPEED);
        if (ad < SHOCK_WIDTH) {
          const m = SHOCK_AMP * (1 - ad / SHOCK_WIDTH) * Math.exp(-age * 1.5);
          tx += (dx / d) * m;
          ty += (dy / d) * m;
        }
      }

      this.ox[i] += (tx - this.ox[i]) * 0.12;
      this.oy[i] += (ty - this.oy[i]) * 0.12;
      const h = TAN_HALF_FOV * this.depth[i];
      pos[i * 3] = (bx + this.ox[i]) * h;
      pos[i * 3 + 1] = (by + this.oy[i]) * h;
      pos[i * 3 + 2] = CAM_Z - this.depth[i];
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.material.uniforms.uTime.value = t;

    for (let m = this.meteors.length - 1; m >= 0; m--) {
      const mt = this.meteors[m];
      const p = (t - mt.t0) / mt.dur;
      if (p >= 1) {
        this.scene.remove(mt.sprite);
        mt.mat.dispose();
        this.meteors.splice(m, 1);
        continue;
      }
      mt.sprite.position.set(mt.sx + mt.dx * p, mt.sy + mt.dy * p, mt.z);
      mt.mat.opacity = Math.pow(Math.sin(p * Math.PI), 0.8) * 0.6;
    }
  }
}
