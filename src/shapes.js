import * as THREE from 'three';

function containsPoint(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(poly) {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/* Turns independent closed contours into THREE.Shapes. Nesting depth decides
   the role: even depth = solid, odd depth = hole of its innermost container.
   This avoids depending on winding direction, which varies per source. */
export function shapesFromPaths(paths) {
  const subs = paths.filter((p) => p.curves.length > 0);
  const polys = subs.map((p) => p.getPoints(8));
  const areas = polys.map(polygonArea);
  const depth = new Array(subs.length).fill(0);
  const parent = new Array(subs.length).fill(-1);

  for (let i = 0; i < subs.length; i++) {
    const probe = polys[i][0];
    for (let j = 0; j < subs.length; j++) {
      if (j === i) continue;
      if (containsPoint(polys[j], probe.x, probe.y)) {
        depth[i]++;
        if (parent[i] < 0 || areas[j] < areas[parent[i]]) parent[i] = j;
      }
    }
  }

  const solids = new Map();
  const shapes = [];
  subs.forEach((p, i) => {
    if (depth[i] % 2 === 0) {
      const shape = new THREE.Shape();
      shape.curves = p.curves;
      solids.set(i, shape);
      shapes.push(shape);
    }
  });
  subs.forEach((p, i) => {
    if (depth[i] % 2 === 1 && solids.has(parent[i])) {
      const hole = new THREE.Path();
      hole.curves = p.curves;
      solids.get(parent[i]).holes.push(hole);
    }
  });
  return shapes;
}
