import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { shapesFromPaths } from './shapes.js';

/* Stops of the CSS gradient supplied for the wordmark. */
const GRADIENT_STOPS = ['#3D0A82', '#6114C2', '#8632F2', '#A65CFF', '#7988FF', '#5B66FF', '#4448CB', '#2D2F92'];
const CSS_ANGLE = 142;

function glyphPaths(commands) {
  const paths = [];
  let cur = null;
  for (const c of commands) {
    if (c.type === 'M') {
      cur = new THREE.Path();
      cur.moveTo(c.x, -c.y);
      paths.push(cur);
    } else if (!cur) {
      continue;
    } else if (c.type === 'L') {
      cur.lineTo(c.x, -c.y);
    } else if (c.type === 'C') {
      cur.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    } else if (c.type === 'Q') {
      cur.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    }
  }
  return paths;
}

function glyphGeometry(commands, fontSize, depth) {
  const shapes = shapesFromPaths(glyphPaths(commands));
  if (!shapes.length) return null;
  const raw = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.35,
    bevelSize: fontSize * 0.028,
    bevelOffset: 0,
    bevelSegments: 5,
    curveSegments: 12,
  });
  return toCreasedNormals(raw, Math.PI / 5);
}

/* CSS linear-gradient(142deg, ...) rendered on a canvas that has the same
   aspect as the text block, so the gradient matches the CSS geometry. */
function cssGradientTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const a = THREE.MathUtils.degToRad(CSS_ANGLE);
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const g = ctx.createLinearGradient(
    w / 2 - (dx * len) / 2,
    h / 2 - (dy * len) / 2,
    w / 2 + (dx * len) / 2,
    h / 2 + (dy * len) / 2,
  );
  GRADIENT_STOPS.forEach((hex, i) => g.addColorStop(i / (GRADIENT_STOPS.length - 1), hex));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* Crystal that also mirrors: transmission keeps the glass, while the
   reflection environment (the graded marble) and the thin-film iridescence
   add the mirror-like colour sheen. */
function glassMaterial(gradient, env) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    emissiveMap: gradient,
    emissive: 0xffffff,
    emissiveIntensity: 0.45,
    transmission: 1,
    thickness: 1.1,
    ior: 1.45,
    roughness: 0.02,
    metalness: 0.05,
    specularIntensity: 1,
    envMap: env,
    envMapIntensity: 2.0,
    iridescence: 0.35,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [200, 500],
    clearcoat: 1,
    clearcoatRoughness: 0.02,
  });
}

function marbleMaterial(map) {
  return new THREE.MeshPhysicalMaterial({
    map,
    emissiveMap: map,
    emissive: 0xffffff,
    emissiveIntensity: 0.22,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
}

function blockUV(geo, box) {
  const p = geo.attributes.position;
  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - box.min.x) / w;
    uv[i * 2 + 1] = (p.getY(i) - box.min.y) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const frac = (v) => v - Math.floor(v);

/* Maps the marble so each letter shows its own turned, shifted region of the
   texture instead of repeating the same picture. */
function artUV(geo, center, scale, turn, ox, oy) {
  const p = geo.attributes.position;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const dx = (p.getX(i) - center.x) / scale;
    const dy = (p.getY(i) - center.y) / scale;
    uv[i * 2] = c * dx - s * dy + 0.5 + ox;
    uv[i * 2 + 1] = s * dx + c * dy + 0.5 + oy;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/* One level of midpoint subdivision for non-indexed triangles, so the large
   flat caps of a glyph have enough vertices to follow a curved surface. */
function subdivide(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const p = geo.attributes.position;
  const uvA = geo.attributes.uv;
  const nA = geo.attributes.normal;
  const n = p.count;
  const pos = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const nor = new Float32Array(n * 4 * 3);
  let po = 0;
  let uo = 0;
  let no = 0;
  const get = (i) => ({
    P: [p.getX(i), p.getY(i), p.getZ(i)],
    U: [uvA.getX(i), uvA.getY(i)],
    N: [nA.getX(i), nA.getY(i), nA.getZ(i)],
  });
  const mid = (a, b) => ({
    P: a.P.map((v, k) => (v + b.P[k]) / 2),
    U: a.U.map((v, k) => (v + b.U[k]) / 2),
    N: a.N.map((v, k) => (v + b.N[k]) / 2),
  });
  const push = (v) => {
    pos[po++] = v.P[0];
    pos[po++] = v.P[1];
    pos[po++] = v.P[2];
    uv[uo++] = v.U[0];
    uv[uo++] = v.U[1];
    nor[no++] = v.N[0];
    nor[no++] = v.N[1];
    nor[no++] = v.N[2];
  };
  for (let t = 0; t < n; t += 3) {
    const A = get(t);
    const B = get(t + 1);
    const C = get(t + 2);
    const AB = mid(A, B);
    const BC = mid(B, C);
    const CA = mid(C, A);
    [A, AB, CA, AB, B, BC, CA, BC, C, AB, BC, CA].forEach(push);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/* Wraps a flat word onto a ball: x runs along the equator and y along the
   meridians, so letters keep their shape on the surface and the ends fall
   back away from the viewer. Extrusion depth runs along the ball's normal. */
function bendOntoBall(geo, radius, centerY) {
  const p = geo.attributes.position;
  const nA = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const th = x / radius;
    const ph = (y - centerY) / radius;
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    const st = Math.sin(th);
    const ct = Math.cos(th);
    const nb = [cp * st, sp, cp * ct];
    p.setXYZ(
      i,
      radius * cp * st + z * nb[0],
      radius * sp + z * nb[1],
      radius * (cp * ct - 1) + z * nb[2],
    );
    const tx = [cp * ct, 0, -cp * st];
    const ty = [-sp * st, cp, -sp * ct];
    const a = nA.getX(i);
    const b = nA.getY(i);
    const c = nA.getZ(i);
    const nx = a * tx[0] + b * ty[0] + c * nb[0];
    const ny = a * tx[1] + b * ty[1] + c * nb[1];
    const nz = a * tx[2] + b * ty[2] + c * nb[2];
    const len = Math.hypot(nx, ny, nz) || 1;
    nA.setXYZ(i, nx / len, ny / len, nz / len);
  }
  p.needsUpdate = true;
  nA.needsUpdate = true;
}

/* Lines are { text, kind, bend?, z? }: 'glass' gets the brand gradient as a
   crystal tint, 'marble' gets the graded texture on each letter. A glass line
   with `bend` is wrapped onto a ball of that radius. Each letter is pivoted at
   its own centre so the reveal can scale and rotate it in place. */
export function buildTitle(font, { marble, glassEnv }, lines, { fontSize, lineGap, depth, tracking }) {
  const group = new THREE.Group();
  const blocks = lines.map(() => new THREE.Box3());
  const pieces = [];

  lines.forEach((line, li) => {
    const y = -li * lineGap + (line.dy || 0);
    const total = font.getAdvanceWidth(line.text, fontSize) + tracking * (line.text.length - 1);
    for (let i = 0; i < line.text.length; i++) {
      const ch = line.text[i];
      if (ch === ' ') continue;
      const x = font.getAdvanceWidth(line.text.slice(0, i), fontSize) + tracking * i - total / 2;
      const geo = glyphGeometry(font.getPath(ch, 0, 0, fontSize).commands, fontSize, depth);
      if (!geo) continue;
      geo.translate(x, y, -depth / 2 + (line.z || 0));
      geo.computeBoundingBox();
      blocks[li].union(geo.boundingBox);
      pieces.push({ geo, li });
    }
  });

  const materials = lines.map((line, li) => {
    if (line.kind === 'glass') {
      const s = blocks[li].getSize(new THREE.Vector3());
      const k = 1024 / Math.max(s.x, s.y);
      return glassMaterial(cssGradientTexture(Math.round(s.x * k), Math.round(s.y * k)), glassEnv);
    }
    return marbleMaterial(marble);
  });

  const letters = [];
  let marbleIndex = 0;
  for (const { geo, li } of pieces) {
    const line = lines[li];
    const box = blocks[li];
    let g = geo;
    if (line.kind === 'glass') {
      blockUV(g, box);
      if (line.bend) {
        g = subdivide(g);
        bendOntoBall(g, line.bend, box.getCenter(new THREE.Vector3()).y);
      }
    } else {
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const size = bb.getSize(new THREE.Vector3());
      const k = marbleIndex++;
      const turn = k * 2.4;
      const ox = (frac(k * 0.618) - 0.5) * 0.36;
      const oy = (frac(k * 0.414) - 0.5) * 0.36;
      artUV(g, bb.getCenter(new THREE.Vector3()), Math.max(size.x, size.y) * 3.2, turn, ox, oy);
    }
    g.computeBoundingBox();
    const base = g.boundingBox.getCenter(new THREE.Vector3());
    g.translate(-base.x, -base.y, -base.z);

    const holder = new THREE.Group();
    holder.position.copy(base);
    const mesh = new THREE.Mesh(g, materials[li]);
    mesh.castShadow = line.kind === 'marble';
    mesh.receiveShadow = line.kind === 'glass';
    holder.add(mesh);
    group.add(holder);
    letters.push({ group: holder, base });
  }

  return { group, letters };
}
