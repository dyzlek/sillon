// Visualiseur 3D : un nuage de particules qui passe d'une forme à l'autre,
// déformé en direct par le spectre de fréquences.
import * as THREE from 'three';
import { gsap } from 'gsap';

export const MODES = ['sphere', 'spectre', 'anneau']; // mêmes noms que la colonne « visual » de la base
const COLS = 120, ROWS = 70, N = COLS * ROWS;

const vertex = /* glsl */ `
uniform float uTime, uBass, uMid, uHigh, uSize;
uniform vec3 uMix;           // poids des trois formes
uniform sampler2D uFreq;     // spectre (512 × 1)
uniform sampler2D uHist;     // historique du spectre (128 × 64) pour le paysage
attribute vec3 aSphere, aPlane, aRing;
attribute float aRand;
varying float vAccent, vAlpha;

float f(float x) { return texture2D(uFreq, vec2(pow(clamp(x, 0.0, 1.0), 1.8) * 0.6, 0.5)).r; }

void main() {
  // Sphère : chaque latitude écoute une bande de fréquences
  vec3 n = normalize(aSphere);
  float lon = atan(n.z, n.x) / 6.2831853 + 0.5;
  float band = f(abs(n.y) * 0.75 + 0.25 * abs(fract(lon * 3.0 + uTime * 0.05) * 2.0 - 1.0));
  float wob = sin(n.x * 4.0 + uTime * 0.7) * sin(n.z * 3.0 - uTime * 0.5) * 0.05;
  vec3 sphere = n * (1.25 + band * 0.42 + uBass * 0.15 + wob);

  // Spectre : un paysage qui défile, chaque rangée est une image passée
  float h = texture2D(uHist, vec2(pow(aPlane.x * 0.5 + 0.5, 1.6) * 0.55, aPlane.z * 0.5 + 0.5)).r;
  vec3 plane = vec3(aPlane.x * 2.6, h * h * 1.35 - 0.55, aPlane.z * 1.8 - 0.2);

  // Anneau : chaque angle écoute une fréquence, en miroir
  float a = aRing.x, ang = abs(a / 3.14159265);
  float r = 1.15 + f(ang) * 0.9 + aRing.y * 0.08;
  vec3 ring = vec3(cos(a) * r, sin(a) * r, aRing.z * (0.1 + uMid * 0.4));

  vec3 p = sphere * uMix.x + plane * uMix.y + ring * uMix.z;
  p += (aRand - 0.5) * 0.012 * (1.0 + uHigh * 6.0);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float energy = band * uMix.x + h * uMix.y + f(ang) * uMix.z;
  gl_PointSize = uSize * (0.6 + energy * 1.4) * (1.0 / -mv.z);
  vAccent = step(0.93, aRand) + step(0.55, energy) * step(0.6, aRand);
  vAlpha = 0.5 + energy * 0.5;
}`;

const fragment = /* glsl */ `
uniform vec3 uColor, uAccent;
varying float vAccent, vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(mix(uColor, uAccent, clamp(vAccent, 0.0, 1.0)), vAlpha);
}`;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(0, 0.35, 5.2);

  // Trois formes pour les mêmes particules
  const sphere = new Float32Array(N * 3), plane = new Float32Array(N * 3), ring = new Float32Array(N * 3), rand = new Float32Array(N);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = golden * i;
    sphere.set([Math.cos(t) * r, y, Math.sin(t) * r], i * 3);
    const cx = i % COLS, cz = Math.floor(i / COLS);
    plane.set([(cx / (COLS - 1)) * 2 - 1, 0, (cz / (ROWS - 1)) * 2 - 1], i * 3);
    ring.set([(i / N) * Math.PI * 2 - Math.PI, Math.random() * 2 - 1, Math.random() * 2 - 1], i * 3);
    rand[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(sphere, 3));
  geo.setAttribute('aSphere', new THREE.BufferAttribute(sphere, 3));
  geo.setAttribute('aPlane', new THREE.BufferAttribute(plane, 3));
  geo.setAttribute('aRing', new THREE.BufferAttribute(ring, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));

  const freqData = new Uint8Array(512);
  const freqTex = new THREE.DataTexture(freqData, 512, 1, THREE.RedFormat, THREE.UnsignedByteType);
  freqTex.magFilter = freqTex.minFilter = THREE.LinearFilter;
  const HW = 128, HH = 64, hist = new Uint8Array(HW * HH);
  const histTex = new THREE.DataTexture(hist, HW, HH, THREE.RedFormat, THREE.UnsignedByteType);
  histTex.magFilter = histTex.minFilter = THREE.LinearFilter;

  const u = {
    uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uSize: { value: 9 },
    uMix: { value: new THREE.Vector3(1, 0, 0) }, uFreq: { value: freqTex }, uHist: { value: histTex },
    uColor: { value: new THREE.Color() }, uAccent: { value: new THREE.Color() },
  };
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: u, vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);

  function refreshColors() {
    const s = getComputedStyle(document.documentElement);
    u.uColor.value.set(s.getPropertyValue('--fg').trim());
    u.uAccent.value.set(s.getPropertyValue('--accent').trim());
  }
  refreshColors();

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Sur un écran étroit on recule pour tout garder dans le cadre
    camera.position.z = w < h ? 6.2 + (h / w) * 1.6 : 5.2;
    camera.updateProjectionMatrix();
    u.uSize.value = 15 * renderer.getPixelRatio();
  }
  resize();
  addEventListener('resize', resize);

  const mouse = { x: 0, y: 0 };
  addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

  let mode = 0, histTick = 0;
  function setMode(name) {
    const i = MODES.indexOf(name);
    if (i < 0 || i === mode) return;
    mode = i;
    const target = [0, 0, 0]; target[mode] = 1;
    gsap.to(u.uMix.value, { x: target[0], y: target[1], z: target[2], duration: 1.6, ease: 'expo.inOut' });
  }

  function frame(time, freq, L) {
    u.uTime.value = time / 1000;
    for (const k of ['Bass', 'Mid', 'High']) u[`u${k}`].value += (L[k.toLowerCase()] - u[`u${k}`].value) * 0.25;
    if (freq) freqData.set(freq.subarray(0, 512));
    else freqData.fill(0);
    freqTex.needsUpdate = true;

    // Historique : on décale d'une rangée et on écrit le spectre actuel en tête
    if (++histTick % 2 === 0) {
      hist.copyWithin(HW, 0, HW * (HH - 1));
      for (let x = 0; x < HW; x++) hist[x] = freqData[Math.floor((x / HW) * 512)];
      histTex.needsUpdate = true;
    }

    const t = time / 1000;
    points.rotation.y = t * 0.08 * u.uMix.value.x + t * 0.03 * u.uMix.value.z;
    points.rotation.x = 0.28 * u.uMix.value.y;
    camera.position.x += (mouse.x * 0.8 - camera.position.x) * 0.04;
    camera.position.y += (0.35 - mouse.y * 0.6 - camera.position.y) * 0.04;
    camera.lookAt(0, 0.1, 0);
    renderer.render(scene, camera);
  }

  return { frame, setMode };
}
