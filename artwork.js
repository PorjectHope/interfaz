import * as THREE from 'three';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${url}`));
    img.src = url;
  });
}

/* Transparent pixels in the source carry dark or grey RGB. Filling them from
   the nearest artwork pixel (multi-source BFS) means any surface that samples
   near the silhouette shows the marble colours instead of a dark fringe. */
export async function loadArtwork(url, res = 1024) {
  const img = await loadImage(url);
  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, res, res);
  const image = ctx.getImageData(0, 0, res, res);
  const px = image.data;
  const n = res * res;

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3] / 255;

  const known = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (alpha[i] >= 0.5) {
      known[i] = 1;
      queue[tail++] = i;
    }
  }
  const spread = (src, j) => {
    if (known[j]) return;
    known[j] = 1;
    px[j * 4] = px[src * 4];
    px[j * 4 + 1] = px[src * 4 + 1];
    px[j * 4 + 2] = px[src * 4 + 2];
    px[j * 4 + 3] = 255;
    queue[tail++] = j;
  };
  while (head < tail) {
    const i = queue[head++];
    const x = i % res;
    const y = (i - x) / res;
    if (x > 0) spread(i, i - 1);
    if (x < res - 1) spread(i, i + 1);
    if (y > 0) spread(i, i - res);
    if (y < res - 1) spread(i, i + res);
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return { texture, alpha, res };
}
