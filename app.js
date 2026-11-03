import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadArtwork } from './artwork.js';
import { buildLogo } from './logoGeometry.js';
import { buildTitle } from './titleGlass.js';
import { Starfield } from './starfield.js';
import { Constellation, ROLEPLAY, V1 } from './constellation.js';
import { SongPlayer } from './audio.js';

const CAM_Z = 10;
const LAYOUT = {
  logoSize: 2.9,
  logoY: 1.75,
  titleY: -0.65,
  subY: -3.1,
  fontSize: 1.2,
  lineGap: 1.35,
  tracking: 0.05,
  depthTitle: 0.24,
  depthLogo: 0.36,
  skew: 0,
};
const PHRASES = [
  'La historia de tu personaje afecta por completo en su comienzo en el servidor.',
  'Puedes premiar a otros jugadores por su calidad de rol regalándole puntos de rol.',
  'Tus decisiones e interacciones repercuten hasta con los NPC.',
  'Cuida de tu personaje ya que este podría enfermar de cualquier cosa.',
];

const canvas = document.getElementById('scene');
const subEl = document.getElementById('sub');
const replayBtn = document.getElementById('replay');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, CAM_Z);
const pmrem = new THREE.PMREMGenerator(renderer);
function radialCanvas() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#d9d9d9');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function skyCanvas() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#d8ccff');
  grad.addColorStop(0.5, '#5a5390');
  grad.addColorStop(1, '#1d1a3e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return c;
}

/* A studio made only of a soft sky and round soft lights: rectangular area
   lights reflect as hard-edged squares on the glossy letters and logo. */
function studioEnvironment() {
  const env = new THREE.Scene();
  const sky = new THREE.CanvasTexture(skyCanvas());
  sky.colorSpace = THREE.SRGBColorSpace;
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide })));
  const spot = new THREE.CanvasTexture(radialCanvas());
  for (const [x, y, z, r] of [[-14, 12, 10, 6], [16, 4, -6, 5], [2, 20, 4, 4]]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 9), map: spot }));
    light.position.set(x, y, z);
    env.add(light);
  }
  return env;
}
/* Mirror source for the glass: the marble blurred, so its bright flare blocks
   read as soft light instead of hard squares on the reflections. */
function softReflection(image) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  const g = c.getContext('2d');
  g.filter = 'blur(14px)';
  g.drawImage(image, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
scene.environment = pmrem.fromScene(studioEnvironment(), 0.04).texture;

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(-3, 4, 6);
const rimLight = new THREE.DirectionalLight(0x8fa6ff, 1.4);
rimLight.position.set(4, -1, -3);
scene.add(keyLight, rimLight);

/* A faint light from below-front: HOPE sits a little in front of PROJECT, so
   its shadow falls softly onto the lower edge of PROJECT. */
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const shadowLight = new THREE.DirectionalLight(0xffffff, 0.4);
shadowLight.castShadow = true;
shadowLight.position.set(0, LAYOUT.titleY - 7, 5.5);
shadowLight.target.position.set(0, LAYOUT.titleY, 0);
shadowLight.shadow.mapSize.set(2048, 2048);
shadowLight.shadow.bias = -0.0004;
shadowLight.shadow.normalBias = 0.015;
Object.assign(shadowLight.shadow.camera, { left: -4.5, right: 4.5, top: 3, bottom: -3, near: 1, far: 30 });
shadowLight.shadow.camera.updateProjectionMatrix();
scene.add(shadowLight, shadowLight.target);

const bgMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    cIn: { value: new THREE.Color('#1a1040') },
    cOut: { value: new THREE.Color('#06051a') },
    uRes: { value: new THREE.Vector2(1, 1) },
    uGlow: { value: new THREE.Vector2(0.5, 0.5) },
    uGlowR: { value: 0.26 },
    uGlowAmt: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 cIn;
    uniform vec3 cOut;
    uniform vec2 uRes;
    uniform vec2 uGlow;
    uniform float uGlowR;
    uniform float uGlowAmt;
    void main() {
      float r = length(vUv - vec2(0.5, 0.42));
      vec3 col = mix(cIn, cOut, smoothstep(0.0, 0.62, r));
      col += vec3(0.012, 0.005, 0.03) * smoothstep(0.3, 0.0, r) * (0.85 + 0.15 * sin(uTime * 0.3));
      vec2 d = (gl_FragCoord.xy / uRes - uGlow) * vec2(uRes.x / uRes.y, 1.0);
      col += exp(-dot(d, d) / (uGlowR * uGlowR)) * uGlowAmt * vec3(0.42, 0.2, 0.9);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  depthWrite: false,
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), bgMat);
bg.position.z = -45;
scene.add(bg);

const layout = new THREE.Group();
const logoRig = new THREE.Group();
logoRig.position.y = LAYOUT.logoY;
const titleRig = new THREE.Group();
titleRig.position.y = LAYOUT.titleY;
const skew = new THREE.Group();
skew.matrixAutoUpdate = false;
skew.matrix.set(1, LAYOUT.skew, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
titleRig.add(skew);
layout.add(logoRig, titleRig);
scene.add(layout);

const stars = new Starfield(scene);

const composerTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const clock = new THREE.Clock();
const logoBase = { y: LAYOUT.logoY, spin: 0 };
const mouse = { x: 0, y: 0 };
const mouseSm = { x: 0, y: 0 };
let title = null;
let introDone = false;
let introTl = null;
let shootTimer = null;
let constellations = [];
let constellationIndex = 0;
let constellationTimer = null;
const song = new SongPlayer('./welcome-project-hope.mp3');

function layoutScene() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const k = THREE.MathUtils.clamp(camera.aspect / 1.6, 0.52, 1);
  layout.scale.setScalar(k);
  for (const c of constellations) c.place(camera.aspect);
  layout.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(0, LAYOUT.subY, 0).applyMatrix4(layout.matrixWorld).project(camera);
  subEl.style.top = `${((1 - p.y) / 2) * h}px`;
}

function buildPhrases() {
  subEl.innerHTML = '';
  PHRASES.forEach((text, i) => {
    const span = document.createElement('span');
    span.className = i === 0 ? 'phrase show' : 'phrase';
    span.textContent = text;
    subEl.appendChild(span);
  });
}

let phraseIndex = 0;
setInterval(() => {
  if (!introDone) return;
  const spans = subEl.querySelectorAll('.phrase');
  spans[phraseIndex].classList.remove('show');
  phraseIndex = (phraseIndex + 1) % spans.length;
  spans[phraseIndex].classList.add('show');
}, 6500);

function scheduleShootingStar() {
  clearTimeout(shootTimer);
  shootTimer = setTimeout(() => {
    stars.shootingStar(camera.aspect, clock.getElapsedTime());
    scheduleShootingStar();
  }, 15000 + Math.random() * 15000);
}

/* Lights the next constellation in turn, unless one is already running. */
function startNextConstellation() {
  if (!constellations.length || constellations.some((c) => c.active)) return;
  constellations[constellationIndex].start(clock.getElapsedTime());
  constellationIndex = (constellationIndex + 1) % constellations.length;
}

/* Now and then one constellation lights up; they take turns, never together. */
function scheduleConstellation() {
  clearTimeout(constellationTimer);
  constellationTimer = setTimeout(() => {
    startNextConstellation();
    scheduleConstellation();
  }, 40000 + Math.random() * 35000);
}

function playIntro() {
  if (!title) return;
  introDone = false;
  replayBtn.classList.remove('show');
  if (introTl) introTl.kill();
  gsap.killTweensOf([logoBase, logoRig.scale, camera.position, bloom, stars.material.uniforms.uOpacity]);

  logoBase.y = LAYOUT.logoY - 0.7;
  logoBase.spin = -Math.PI * 3;
  logoRig.scale.setScalar(0.2);
  camera.position.z = 13.5;
  stars.material.uniforms.uOpacity.value = 0;
  gsap.set(subEl, { opacity: 0 });
  renderer.shadowMap.autoUpdate = true;
  title.letters.forEach(({ group, base }) => {
    group.position.set(base.x, base.y, base.z - 2.4);
    group.rotation.x = 1.2;
    group.scale.setScalar(0.001);
  });

  introTl = gsap.timeline({
    onComplete: () => {
      introDone = true;
      /* The letters stop moving once the intro ends, so the shadow map can stop being redrawn every frame. */
      renderer.shadowMap.autoUpdate = false;
      layoutScene();
      replayBtn.classList.add('show');
      scheduleShootingStar();
      scheduleConstellation();
    },
  });

  introTl
    .to(stars.material.uniforms.uOpacity, { value: 1, duration: 2.4, ease: 'power2.out' }, 0)
    .to(camera.position, { z: CAM_Z, duration: 3.2, ease: 'power3.out' }, 0)
    .to(logoRig.scale, { x: 1, y: 1, z: 1, duration: 2.4, ease: 'back.out(1.2)' }, 0.2)
    .to(logoBase, { spin: 0, duration: 3.2, ease: 'power3.out' }, 0.2)
    .to(logoBase, { y: LAYOUT.logoY, duration: 2.4, ease: 'power3.inOut' }, 0.2)
    .to(bloom, { strength: 0.95, duration: 0.7, ease: 'power2.out' }, 2.7)
    .to(bloom, { strength: 0.55, duration: 1.6, ease: 'power2.inOut' }, 3.4);

  title.letters.forEach(({ group, base }, k) => {
    const at = 3.0 + k * 0.055;
    introTl
      .to(group.position, { x: base.x, y: base.y, z: base.z, duration: 1.1, ease: 'power3.out' }, at)
      .to(group.rotation, { x: 0, duration: 1.1, ease: 'power3.out' }, at)
      .to(group.scale, { x: 1, y: 1, z: 1, duration: 0.9, ease: 'back.out(1.6)' }, at);
  });

  introTl.to(subEl, { opacity: 1, duration: 1.2, ease: 'power2.out' }, 4.8);
}

window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
});
document.documentElement.addEventListener('mouseleave', () => {
  mouse.x = 0;
  mouse.y = 0;
});
window.addEventListener('pointerdown', (e) => {
  if (!introDone) return;
  const nx = (e.clientX / window.innerWidth) * 2 - 1;
  const ny = -((e.clientY / window.innerHeight) * 2 - 1);
  stars.shock(nx, ny, clock.getElapsedTime());
  gsap.fromTo(
    logoRig.scale,
    { x: 1.035, y: 1.035, z: 1.035 },
    { x: 1, y: 1, z: 1, duration: 1.1, ease: 'elastic.out(1, 0.35)', overwrite: true },
  );
});
replayBtn.addEventListener('click', playIntro);

const soundBtn = document.getElementById('sound-btn');
const soundPanel = document.getElementById('sound-panel');
const volumeInput = document.getElementById('volume');
const volumeValue = document.getElementById('volume-value');
function showVolume(percent) {
  volumeInput.value = percent;
  volumeValue.textContent = `${percent}%`;
}
showVolume(Math.round(song.volume * 100));
soundBtn.addEventListener('click', () => {
  const open = soundPanel.classList.toggle('open');
  soundBtn.setAttribute('aria-expanded', String(open));
});
volumeInput.addEventListener('input', () => {
  showVolume(Number(volumeInput.value));
  song.setVolume(Number(volumeInput.value) / 100);
});
/* The controls sit on top of the scene: pressing them must not trigger a star shock. */
document.getElementById('sound').addEventListener('pointerdown', (e) => e.stopPropagation());
window.addEventListener('resize', layoutScene);

const glowCenter = new THREE.Vector3();
const drawSize = new THREE.Vector2();
function updateGlow() {
  renderer.getDrawingBufferSize(drawSize);
  bgMat.uniforms.uRes.value.copy(drawSize);
  glowCenter.set(0, LAYOUT.titleY + 0.42, 0).applyMatrix4(layout.matrixWorld).project(camera);
  bgMat.uniforms.uGlow.value.set(glowCenter.x * 0.5 + 0.5, glowCenter.y * 0.5 + 0.5);
}

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  mouseSm.x += (mouse.x - mouseSm.x) * 0.06;
  mouseSm.y += (mouse.y - mouseSm.y) * 0.06;
  bgMat.uniforms.uTime.value = t;
  stars.update(t, camera.aspect, mouseSm.x, mouseSm.y);
  const bands = song.update();
  stars.setBands(bands.low, bands.high);
  for (const c of constellations) c.update(t);
  keyLight.position.set(-3 + mouseSm.x * 3 + Math.sin(t * 0.25) * 1.2, 4 + mouseSm.y * 2.5, 6);
  if (title) {
    logoRig.position.y = logoBase.y + Math.sin(t * 0.9) * 0.03;
    logoRig.rotation.y = logoBase.spin + mouseSm.x * 0.3 + Math.sin(t * 0.45) * 0.08;
    logoRig.rotation.x = -mouseSm.y * 0.14 + Math.sin(t * 0.37) * 0.03;
  }
  updateGlow();
  composer.render();
}

async function loadFont(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fuente no encontrada (${res.status})`);
  return window.opentype.parse(await res.arrayBuffer());
}

async function boot() {
  if (!window.opentype) throw new Error('opentype.js no se cargó desde el CDN');
  const artwork = await loadArtwork('./Logo-sin-destellos.png');
  const marble = await new THREE.TextureLoader().loadAsync('./textura-hope-igualada.jpg');
  marble.colorSpace = THREE.SRGBColorSpace;
  marble.anisotropy = 8;
  marble.wrapS = marble.wrapT = THREE.MirroredRepeatWrapping;
  marble.needsUpdate = true;
  const glassEnv = pmrem.fromEquirectangular(softReflection(marble.image)).texture;
  const font = await loadFont('./aerospace.regular.otf');
  logoRig.add(buildLogo(artwork, { size: LAYOUT.logoSize, depth: LAYOUT.depthLogo, wallTexture: marble }));
  title = buildTitle(font, { marble, glassEnv }, [
    { text: 'PROJECT', kind: 'glass', bend: 8.0, dy: 0.15 },
    { text: 'HOPE', kind: 'marble', z: 0.6, dy: -0.1 },
  ], {
    fontSize: LAYOUT.fontSize,
    lineGap: LAYOUT.lineGap,
    depth: LAYOUT.depthTitle,
    tracking: LAYOUT.tracking,
  });
  skew.add(title.group);
  const pixelRatio = renderer.getPixelRatio();
  constellations = [
    new Constellation(ROLEPLAY, { height: 1.8, spread: 1.1, anchor: { x: -0.58, y: 0.42 }, pixelRatio }),
    new Constellation(V1, { height: 1.2, anchor: { x: 0.56, y: 0.2 }, pixelRatio }),
  ];
  constellations.forEach((c) => scene.add(c.group));
  buildPhrases();
  layoutScene();
  await renderer.compileAsync(scene, camera);
  loadingEl.classList.add('hide');
  // Modo sala (?sala): solo el fondo lila, sin estrellas, logo, título, frases ni música (se usa como pantalla de la sala)
  if (new URLSearchParams(location.search).has('sala')) {
    document.body.classList.add('sala');
    stars.material.uniforms.uOpacity.value = 0;
    constellations.forEach((c) => { c.group.visible = false; });
    logoRig.visible = false;
    title.group.visible = false;
    camera.position.z = CAM_Z;
    return;
  }
  song.start();
  playIntro();
}

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = `Error: ${err.message}`;
});

animate();
