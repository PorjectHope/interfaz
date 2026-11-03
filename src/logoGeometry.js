import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { shapesFromPaths } from './shapes.js';

/* Marching squares on an alpha field. Every crossing lives on a grid edge and
   is shared by exactly two cells, so chaining segments by edge key yields
   closed loops in pixel space. */
function traceContours(alpha, w, h, threshold) {
  const gw = w + 2;
  const gh = h + 2;
  const v = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) v[(y + 1) * gw + x + 1] = alpha[y * w + x];
  }

  const ins = (a) => a >= threshold;
  const along = (a, b) => (b === a ? 0.5 : (threshold - a) / (b - a));
  const hKey = (i, j) => (j * gw + i) * 2;
  const vKey = (i, j) => (j * gw + i) * 2 + 1;

  const segA = [];
  const segB = [];
  const adj = new Map();
  const link = (k, s) => {
    const list = adj.get(k);
    if (list) list.push(s);
    else adj.set(k, [s]);
  };
  const addSeg = (p, q) => {
    const s = segA.length;
    segA.push(p);
    segB.push(q);
    link(p, s);
    link(q, s);
  };

  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const a = v[j * gw + i];
      const b = v[j * gw + i + 1];
      const c = v[(j + 1) * gw + i + 1];
      const d = v[(j + 1) * gw + i];
      const ia = ins(a);
      const ib = ins(b);
      const ic = ins(c);
      const id = ins(d);
      const edges = [];
      if (ia !== ib) edges.push(hKey(i, j));
      if (ib !== ic) edges.push(vKey(i + 1, j));
      if (id !== ic) edges.push(hKey(i, j + 1));
      if (ia !== id) edges.push(vKey(i, j));
      if (edges.length === 2) {
        addSeg(edges[0], edges[1]);
      } else if (edges.length === 4) {
        const [top, right, bottom, left] = edges;
        const separateAB = ia === ins((a + b + c + d) * 0.25);
        if (separateAB) {
          addSeg(top, right);
          addSeg(bottom, left);
        } else {
          addSeg(top, left);
          addSeg(right, bottom);
        }
      }
    }
  }

  const pos = (k) => {
    const idx = k >> 1;
    const i = idx % gw;
    const j = (idx - i) / gw;
    if ((k & 1) === 0) {
      return [i - 1 + along(v[j * gw + i], v[j * gw + i + 1]), j - 1];
    }
    return [i - 1, j - 1 + along(v[j * gw + i], v[(j + 1) * gw + i])];
  };

  const used = new Uint8Array(segA.length);
  const loops = [];
  for (let s = 0; s < segA.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segA[s];
    let key = segB[s];
    const pts = [pos(start)];
    let guard = 0;
    while (key !== start && guard++ < 4000000) {
      pts.push(pos(key));
      const list = adj.get(key);
      let next = -1;
      for (let q = 0; q < list.length; q++) {
        if (!used[list[q]]) {
          next = list[q];
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      key = segA[next] === key ? segB[next] : segA[next];
    }
    loops.push(pts);
  }
  return loops;
}

function rdp(points, eps) {
  const n = points.length;
  if (n < 3) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = ((px - ax) * dx + (py - ay) * dy) / len2;
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function simplifyClosed(pts, eps) {
  const n = pts.length;
  if (n < 8) return pts;
  let far = 1;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp(pts.slice(far).concat([pts[0]]), eps);
  return a.concat(b.slice(1, -1));
}

function polygonArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/* The logo as a real extruded solid. UVs come from the canvas-space position
   so the artwork maps exactly on faces and walls alike. */
export function buildLogo({ texture, alpha, res }, { size, depth, wallTexture }) {
  const toWorld = ([x, y]) => [((x + 0.5) / res) * size - size / 2, size / 2 - ((y + 0.5) / res) * size];
  const paths = traceContours(alpha, res, res, 0.5)
    .map((pts) => simplifyClosed(pts, 0.9))
    .filter((pts) => pts.length > 2 && polygonArea(pts) > 60)
    .map((pts) => {
      const path = new THREE.Path();
      const [x0, y0] = toWorld(pts[0]);
      path.moveTo(x0, y0);
      for (let i = 1; i < pts.length; i++) {
        const [x, y] = toWorld(pts[i]);
        path.lineTo(x, y);
      }
      return path;
    });

  const raw = new THREE.ExtrudeGeometry(shapesFromPaths(paths), {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.3,
    bevelSize: size * 0.012,
    bevelOffset: 0,
    bevelSegments: 4,
    curveSegments: 1,
  });
  const groups = raw.groups.map((g) => ({ ...g }));
  const geo = toCreasedNormals(raw, Math.PI / 5);
  geo.clearGroups();
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);

  /* Group 0 is the front and back faces (the artwork), group 1 the walls and
     bevels, which carry the graded marble so the thickness shows the texture. */
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / size + 0.5;
    uv[i * 2 + 1] = p.getY(i) / size + 0.5;
  }
  const wallScale = size * 1.05;
  for (const g of geo.groups) {
    if (g.materialIndex !== 1) continue;
    for (let i = g.start; i < g.start + g.count; i++) {
      uv[i * 2] = p.getX(i) / wallScale + 0.5;
      uv[i * 2 + 1] = p.getY(i) / wallScale + 0.5;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);

  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: 0xffffff,
    emissiveIntensity: 0.22,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  const wallMaterial = new THREE.MeshPhysicalMaterial({
    map: wallTexture,
    emissiveMap: wallTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.22,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  return new THREE.Mesh(geo, [faceMaterial, wallMaterial]);
}
