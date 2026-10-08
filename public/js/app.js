// Sillon — client minimaliste : un titre, un visualiseur, un index.
import { gsap } from 'gsap';
import { api } from './api.js';
import { Player } from './player.js';
import { createScene } from './scene.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (s) => (Number.isFinite(s) && s > 0 ? `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '00:00');
const pad = (n) => String(n).padStart(2, '0');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

let tracks = [];
const player = new Player();
const scene = createScene($('#scene'));

/* ---------- Bibliothèque ---------- */

async function refresh() {
  try {
    tracks = (await api.library()).tracks;
    player.sync(new Map(tracks.map((t) => [t.id, t])));
  } catch {
    toast('Serveur injoignable', true);
  }
  $('#count').textContent = tracks.length;
  renderList();
}

function renderList() {
  const cur = player.current?.id;
  $('#list').innerHTML = tracks.length
    ? tracks.map((t, i) => `<li class="row${t.id === cur ? ' is-current' : ''}"><button data-i="${i}">
        <span class="mono row__dim row__num">${pad(i + 1)}</span>
        <span class="row__title">${esc(t.title)}</span>
        <span class="row__dim row__artist">${esc(t.artist)}</span>
        <span class="mono row__dim row__genre">${esc(t.genre || '')}</span>
        <span class="mono row__dim row__dur">${fmt(t.duration)}</span>
      </button></li>`).join('')
    : '<li class="index__empty mono">Le serveur est vide. Glisse des fichiers audio ici, ou dépose-les dans le dossier music/.</li>';
}

$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  player.play(tracks, +b.dataset.i);
  toggleIndex(false);
});

/* ---------- Index ---------- */

function toggleIndex(open = !$('#index').classList.contains('is-open')) {
  $('#index').classList.toggle('is-open', open);
  $('#index').setAttribute('aria-hidden', !open);
  $('#indexBtn').setAttribute('aria-expanded', open);
  $('#indexBtn').firstChild.textContent = open ? 'Fermer ' : 'Index ';
  if (open && !reduce) gsap.from('.row', { yPercent: 60, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.04, delay: 0.3, clearProps: 'all' });
}
$('#indexBtn').addEventListener('click', () => toggleIndex());

/* ---------- Titre en cours ---------- */

function setTitle(text) {
  const h = $('#nTitle');
  const write = () => {
    // Un mot par ligne si le titre est long, sinon une seule ligne
    const words = text.split(' ');
    const lines = text.length > 14 ? words.reduce((acc, w) => {
      const last = acc[acc.length - 1];
      if (last && (last + ' ' + w).length <= 14) acc[acc.length - 1] = `${last} ${w}`; else acc.push(w);
      return acc;
    }, []) : [text];
    h.innerHTML = lines.map((l) => `<span class="line"><span>${esc(l)}</span></span>`).join('');
    if (!reduce) gsap.from(h.querySelectorAll('.line > span'), { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.07 });
  };
  if (reduce || !h.children.length) return write();
  gsap.to(h.querySelectorAll('.line > span'), { yPercent: -110, duration: 0.45, ease: 'power3.in', stagger: 0.03, onComplete: write });
}

player.addEventListener('track', ({ detail: t }) => {
  const i = tracks.findIndex((x) => x.id === t.id);
  $('#nMeta').textContent = [`${pad(i + 1)} / ${pad(tracks.length)}`, t.artist, t.genre].filter(Boolean).join(' — ');
  setTitle(t.title);
  $('#tDur').textContent = fmt(t.duration);
  const cover = $('#nCover');
  cover.hidden = !t.cover;
  if (t.cover) { cover.src = t.cover; if (!reduce) gsap.fromTo(cover, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 1, ease: 'expo.out' }); }
  visuals.start(t);
  document.title = `${t.title} — Sillon`;
  renderList();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
});

player.addEventListener('state', () => {
  $('#play').textContent = player.playing ? 'Pause' : 'Lecture';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused';
});
player.addEventListener('meta', () => {
  const d = player.audio.duration, t = player.current;
  $('#tDur').textContent = fmt(d);
  // La base apprend la durée exacte à la première écoute
  if (t && Number.isFinite(d) && Math.abs((t.duration || 0) - d) > 0.5) { t.duration = d; api.duration(t.id, d).then(renderList).catch(() => {}); }
});
player.addEventListener('time', () => {
  $('#tCur').textContent = fmt(player.audio.currentTime);
  $('#fill').style.transform = `scaleX(${player.progress})`;
  $('#progress').setAttribute('aria-valuenow', Math.round(player.progress * 100));
});
player.addEventListener('queue', () => {
  $('#shuffle').setAttribute('aria-pressed', player.shuffle);
  $('#repeat').setAttribute('aria-pressed', player.repeat !== 'off');
  $('#repeat').textContent = player.repeat === 'one' ? 'Boucle 1' : 'Boucle';
});
player.addEventListener('error', () => toast('Lecture impossible', true));

/* ---------- Commandes ---------- */

const start = () => (player.current ? player.toggle() : tracks.length && player.play(tracks));
$('#play').addEventListener('click', start);
$('#next').addEventListener('click', () => player.next());
$('#prev').addEventListener('click', () => player.prev());
$('#shuffle').addEventListener('click', () => player.toggleShuffle());
$('#repeat').addEventListener('click', () => player.cycleRepeat());

const progress = $('#progress');
const ratio = (e) => { const r = progress.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
let seeking = false;
progress.addEventListener('pointerdown', (e) => { seeking = true; progress.setPointerCapture(e.pointerId); player.seek(ratio(e)); });
progress.addEventListener('pointermove', (e) => {
  $('#hover').style.transform = `scaleX(${ratio(e)})`;
  if (seeking) player.seek(ratio(e));
});
progress.addEventListener('pointerup', () => { seeking = false; });
progress.addEventListener('pointerleave', () => { $('#hover').style.transform = 'scaleX(0)'; });

/* ---------- Vues automatiques ----------
   Chaque son a dans la base sa suite de vues (visual) et leur durée (visual_every).
   On passe à la suivante quand le temps est écoulé, ou plus tôt sur une grosse montée de basses. */
const visuals = {
  list: ['sphere'], i: 0, every: 24, since: 0, avg: 0,
  start(t) {
    this.list = t.visual?.length ? t.visual : ['sphere'];
    this.every = t.visualEvery ?? 24;
    this.i = 0; this.since = performance.now(); this.avg = 0;
    scene.setMode(this.list[0]);
  },
  tick(now, L) {
    if (!player.playing || this.list.length < 2 || !this.every) return;
    this.avg += (L.bass - this.avg) * 0.02;
    const elapsed = (now - this.since) / 1000;
    const drop = elapsed > this.every * 0.5 && L.bass > 0.55 && L.bass > this.avg * 1.5;
    if (elapsed > this.every || drop) {
      this.i = (this.i + 1) % this.list.length;
      this.since = now;
      scene.setMode(this.list[this.i]);
    }
  },
};

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => player.resume());
  ms.setActionHandler('pause', () => player.pause());
  ms.setActionHandler('previoustrack', () => player.prev());
  ms.setActionHandler('nexttrack', () => player.next());
}

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' && !e.target.closest('button')) { e.preventDefault(); start(); }
  else if (k === 'ArrowRight') e.shiftKey ? player.next() : player.nudge(5);
  else if (k === 'ArrowLeft') e.shiftKey ? player.prev() : player.nudge(-5);
  else if (k.toLowerCase() === 'i') toggleIndex();
  else if (k === 'Escape') toggleIndex(false);
});

/* ---------- Envoi au serveur ---------- */

const drop = $('#drop');
let depth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; drop.classList.add('is-on'); } });
addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; drop.classList.remove('is-on'); } });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  drop.classList.remove('is-on');
  for (const f of e.dataTransfer.files) {
    const t = toast(`${f.name} — 0 %`, false, true);
    try {
      const send = () => api.upload(f, (p) => { t.textContent = `${f.name} — ${Math.round(p * 100)} %`; }, uploadKey());
      await send().catch(async (err) => {
        // Serveur protégé : on demande la clé une fois, puis on la retient
        if (err.status !== 401) throw err;
        const k = prompt('Clé du serveur pour envoyer des sons');
        if (!k) throw err;
        try { localStorage.setItem('sillon:key', k); } catch { /* stockage indisponible */ }
        return send();
      });
      t.textContent = `${f.name} — sur le serveur`;
    } catch (err) {
      t.textContent = `${f.name} — ${err.message}`;
      t.classList.add('is-error');
    }
    setTimeout(() => t.remove(), 3500);
  }
  await refresh();
});

function uploadKey() {
  try { return localStorage.getItem('sillon:key') || ''; } catch { return ''; }
}

function toast(text, error = false, keep = false) {
  const el = document.createElement('p');
  el.className = `toast${error ? ' is-error' : ''}`;
  el.textContent = text;
  $('#toasts').append(el);
  if (!keep) setTimeout(() => el.remove(), 3500);
  return el;
}

/* ---------- Boucle ---------- */

function loop(time) {
  const L = player.sample();
  visuals.tick(time, L);
  scene.frame(time, player.playing ? player.freq : null, L);
  requestAnimationFrame(loop);
}

await refresh();
requestAnimationFrame(loop);
if (!reduce) {
  gsap.from('.top > *, .deck', { opacity: 0, y: (i) => (i < 2 ? -20 : 20), duration: 1.2, ease: 'expo.out', stagger: 0.08 });
  gsap.from('#nTitle .line > span', { yPercent: 110, duration: 1.4, ease: 'expo.out', delay: 0.2 });
}
setInterval(() => !document.hidden && refresh(), 15000);
