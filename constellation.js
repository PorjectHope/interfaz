import * as THREE from 'three';

/* Constellations that always sit in the background as faint stars. When an
   event runs, the stars light up in a few steps, a thin line traces the
   strokes, and everything goes back to how it was at the start. */
const STEPS = 3;
const BASE = 0.2;
const PEAK = 0.42;
const STAGGER = 0.5;
const LIGHT_TIME = 1.0;
const LIGHT_JITTER = 0.3;
const MAX_AT = LIGHT_JITTER + LIGHT_TIME;
const TRACE_TIME = 0.9;
const HOLD = 2.0;
const FADE = 1.4;
const VIEW_TAN = Math.tan(THREE.MathUtils.degToRad(19));

/* Node positions copied from the reference drawings, one list of polylines per letter. */
export const ROLEPLAY = [
  [
    [[78, 125], [127, 125], [141, 166], [112, 187], [150, 230]],
    [[78, 125], [86, 190], [90, 243]],
  ],
  [
    [[188, 120], [207, 92], [237, 125], [241, 228], [217, 250], [190, 228], [188, 120]],
  ],
  [
    [[262, 110], [264, 181], [265, 240], [307, 244]],
  ],
  [
    [[310, 110], [322, 170], [337, 240], [390, 220]],
    [[310, 110], [350, 90]],
    [[322, 170], [348, 157]],
  ],
  [
    [[412, 75], [465, 103], [461, 148], [415, 153], [412, 75]],
    [[415, 153], [416, 227]],
  ],
  [
    [[493, 70], [498, 143], [499, 203], [549, 220]],
  ],
  [
    [[577, 72], [614, 66], [637, 148], [651, 209]],
    [[569, 218], [571, 151], [604, 156], [637, 148]],
    [[577, 72], [572, 151]],
  ],
  [
    [[665, 112], [706, 152], [738, 90]],
    [[706, 152], [660, 234]],
  ],
];

/* The version of the server: a V and a 1. */
export const V1 = [
  [
    [[75, 105], [97, 205], [142, 105]],
  ],
  [
    [[193, 130], [226, 85], [226, 222]],
    [[187, 223], [226, 222], [262, 228]],
  ],
];

/* Each star switches on and off in abrupt steps, at its own rate and phase. */
const STAR_VERT = /* glsl */ `
  attribute float aLit;
  attribute float aPhase;
  attribute float aRate;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vLit;
  varying float vBlink;
  void main() {
    vLit = aLit;
    vBlink = step(0.4, fract(uTime * aRate + aPhase));
    gl_PointSize = (3.0 + 2.5 * aLit) * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FRAG = /* glsl */ `
  varying float vLit;
  varying float vBlink;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 4.5);
    float tw = mix(0.25, 1.0, vBlink);
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0), 0.8 * core * vLit * tw);
  }
`;

const LINE_VERT = /* glsl */ `
  attribute float aPos;
  attribute float aReveal;
  varying float vPos;
  varying float vReveal;
  void main() {
    vPos = aPos;
    vReveal = aReveal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vPos;
  varying float vReveal;
  void main() {
    if (vPos > vReveal) discard;
    gl_FragColor = vec4(vec3(0.75, 0.85, 1.0), 0.055 * uOpacity);
  }
`;

export class Constellation {
  /* anchor: where the word sits, as fractions of the visible half-width and
     half-height at its depth (x: -1 left edge, 1 right edge). */
  constructor(letters, { height = 0.9, spread = 1, anchor = { x: 0, y: 0 }, pixelRatio = 1, depth = -9, camZ = 10 }) {
    this.group = new THREE.Group();
    this.anchor = anchor;
    this.depth = depth;
    this.camZ = camZ;
    this.active = false;
    this.t0 = 0;
    this.letterCount = letters.length;

    const points = letters.flatMap((letter) => letter.flat());
    const minX = Math.min(...points.map((p) => p[0]));
    const maxX = Math.max(...points.map((p) => p[0]));
    const minY = Math.min(...points.map((p) => p[1]));
    const maxY = Math.max(...points.map((p) => p[1]));
    const s = height / (maxY - minY);
    const cx = (minX + maxX) / 2;
    const toWorld = ([px, py]) => [(px - cx) * s * spread, (maxY - py) * s - height / 2];

    const stars = [];
    const segs = [];
    letters.forEach((letter, li) => {
      const starIndex = new Map();
      const strokes = letter.map((stroke) =>
        stroke.map((p) => {
          const key = p.join(',');
          if (!starIndex.has(key)) {
            starIndex.set(key, stars.length);
            const [x, y] = toWorld(p);
            stars.push({ x, y, letter: li });
          }
          return toWorld(p);
        }),
      );
      const cums = strokes.map((pts) => {
        const c = [0];
        for (let k = 1; k < pts.length; k++) {
          c.push(c[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        }
        return c;
      });
      const perimeter = cums.reduce((sum, c) => sum + c[c.length - 1], 0);
      let offset = 0;
      strokes.forEach((pts, si) => {
        const c = cums[si];
        for (let k = 0; k < pts.length - 1; k++) {
          segs.push({
            a: pts[k],
            b: pts[k + 1],
            pa: (offset + c[k]) / perimeter,
            pb: (offset + c[k + 1]) / perimeter,
            letter: li,
          });
        }
        offset += c[c.length - 1];
      });
    });

    const S = stars.length;
    const starPos = new Float32Array(S * 3);
    this.starLetter = new Uint8Array(S);
    this.starDelay = new Float32Array(S);
    this.starLevel = new Float32Array(S);
    this.litArr = new Float32Array(S).fill(BASE);
    stars.forEach((st, i) => {
      starPos[i * 3] = st.x;
      starPos[i * 3 + 1] = st.y;
      this.starLetter[i] = st.letter;
    });
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.litAttr = new THREE.BufferAttribute(this.litArr, 1);
    starGeo.setAttribute('aLit', this.litAttr);
    const phase = new Float32Array(S);
    const rate = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      phase[i] = Math.random();
      rate[i] = 0.5 + Math.random() * 0.9;
    }
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    starGeo.setAttribute('aRate', new THREE.BufferAttribute(rate, 1));

    const V = segs.length * 2;
    const linePos = new Float32Array(V * 3);
    const linePosT = new Float32Array(V);
    this.vertLetter = new Uint8Array(V);
    this.reveal = new Float32Array(V);
    segs.forEach((sg, i) => {
      for (let j = 0; j < 2; j++) {
        const v = i * 2 + j;
        const p = j === 0 ? sg.a : sg.b;
        linePos[v * 3] = p[0];
        linePos[v * 3 + 1] = p[1];
        linePosT[v] = j === 0 ? sg.pa : sg.pb;
        this.vertLetter[v] = sg.letter;
      }
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('aPos', new THREE.BufferAttribute(linePosT, 1));
    this.revealAttr = new THREE.BufferAttribute(this.reveal, 1);
    lineGeo.setAttribute('aReveal', this.revealAttr);

    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const starPoints = new THREE.Points(starGeo, this.starMat);
    const lines = new THREE.LineSegments(lineGeo, this.lineMat);
    starPoints.frustumCulled = false;
    lines.frustumCulled = false;
    this.group.add(starPoints, lines);
  }

  /* Places the word for the current screen shape; the scale keeps it modest on narrow screens. */
  place(aspect) {
    const halfH = (this.camZ - this.depth) * VIEW_TAN;
    this.group.position.set(this.anchor.x * halfH * aspect, this.anchor.y * halfH, this.depth);
    this.group.scale.setScalar(THREE.MathUtils.clamp(aspect / 1.6, 0.6, 1));
  }

  start(t) {
    this.t0 = t;
    this.active = true;
    for (let i = 0; i < this.starDelay.length; i++) {
      this.starDelay[i] = this.starLetter[i] * STAGGER + Math.random() * LIGHT_JITTER;
    }
    this.starLevel.fill(0);
    this.reveal.fill(0);
  }

  update(t) {
    this.starMat.uniforms.uTime.value = t;
    let fade = 0;
    if (this.active) {
      const e = t - this.t0;
      const end = (this.letterCount - 1) * STAGGER + MAX_AT + TRACE_TIME + HOLD;
      fade = e <= end ? 1 : Math.max(0, 1 - (e - end) / FADE);
      if (e > end + FADE) this.active = false;

      for (let i = 0; i < this.starLevel.length; i++) {
        const x = THREE.MathUtils.clamp((e - this.starDelay[i]) / LIGHT_TIME, 0, 1);
        this.starLevel[i] = Math.ceil(x * STEPS) / STEPS;
      }
      for (let v = 0; v < this.reveal.length; v++) {
        const r = THREE.MathUtils.clamp((e - this.vertLetter[v] * STAGGER - MAX_AT) / TRACE_TIME, 0, 1);
        this.reveal[v] = r * r * (3 - 2 * r);
      }
      this.revealAttr.needsUpdate = true;
    }
    for (let i = 0; i < this.litArr.length; i++) {
      this.litArr[i] = BASE + PEAK * this.starLevel[i] * fade;
    }
    this.litAttr.needsUpdate = true;
    this.lineMat.uniforms.uOpacity.value = fade;
  }
}
