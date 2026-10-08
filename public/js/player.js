// Moteur de lecture : file d'attente, aléatoire, répétition, analyseur de fréquences, fondus.
import { api } from './api.js';

const FADE = 0.16;

export class Player extends EventTarget {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.list = [];      // ordre d'origine
    this.queue = [];     // ordre de lecture
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // off | all | one
    this.counted = false;
    this.levels = { bass: 0, mid: 0, high: 0, energy: 0 };

    const a = this.audio;
    a.addEventListener('timeupdate', () => {
      this.emit('time');
      if (!this.counted && a.currentTime > Math.min(10, (a.duration || 20) * 0.5)) {
        this.counted = true;
        api.played(this.current.id).then((r) => this.emit('counted', r)).catch(() => {});
      }
    });
    a.addEventListener('play', () => this.emit('state'));
    a.addEventListener('pause', () => this.emit('state'));
    a.addEventListener('loadedmetadata', () => this.emit('meta'));
    a.addEventListener('ended', () => (this.repeat === 'one' ? this.restart() : this.next(true)));
    a.addEventListener('error', () => this.emit('error'));
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused; }
  get progress() { return this.audio.duration ? this.audio.currentTime / this.audio.duration : 0; }

  // Le graphe Web Audio ne peut naître qu'après un geste de l'utilisateur.
  graph() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const src = this.ctx.createMediaElementSource(this.audio);
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.82;
    src.connect(this.gain).connect(this.analyser).connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  // Appelé à chaque image par les visuels.
  sample() {
    const L = this.levels;
    if (!this.analyser || !this.playing) {
      L.bass *= 0.92; L.mid *= 0.92; L.high *= 0.92; L.energy *= 0.92;
      this.freq?.fill(0);
      return L;
    }
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq, band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += f[i]; return s / (b - a) / 255; };
    L.bass = band(1, 8); L.mid = band(8, 60); L.high = band(60, 200);
    L.energy = L.bass * 0.5 + L.mid * 0.35 + L.high * 0.15;
    return L;
  }

  setList(tracks, start = 0) {
    this.list = tracks.slice();
    const first = this.list[start];
    this.queue = this.shuffle ? [first, ...shuffled(this.list.filter((t) => t !== first))] : this.list.slice();
    this.index = this.queue.indexOf(first);
  }

  play(tracks, start = 0) {
    this.graph();
    this.setList(tracks, start);
    this.load();
  }

  load(autoplay = true) {
    const t = this.current;
    if (!t) return;
    this.counted = false;
    this.audio.src = api.streamURL(t.id);
    this.emit('track', t);
    if (autoplay) this.resume();
  }

  async resume() {
    if (!this.current) return;
    this.graph();
    await this.ctx?.resume();
    if (this.gain) {
      const g = this.gain.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now); g.setValueAtTime(0, now); g.linearRampToValueAtTime(1, now + FADE);
    }
    try { await this.audio.play(); } catch (e) { if (e.name !== 'AbortError') this.emit('error', e); }
  }

  pause() {
    if (!this.gain) return this.audio.pause();
    const g = this.gain.gain, now = this.ctx.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + FADE);
    clearTimeout(this.fadeTimer);
    this.fadeTimer = setTimeout(() => this.audio.pause(), FADE * 1000);
  }

  toggle() { this.playing ? this.pause() : this.resume(); }
  restart() { this.audio.currentTime = 0; this.resume(); }

  next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) this.index++;
    else if (this.repeat === 'all' || !auto) this.index = 0;
    else { this.emit('state'); return; }
    this.load();
  }

  prev() {
    if (this.audio.currentTime > 3) return this.restart();
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    this.load();
  }

  jump(i) { this.index = i; this.load(); }
  seek(ratio) { if (this.audio.duration) this.audio.currentTime = Math.max(0, Math.min(1, ratio)) * this.audio.duration; }
  nudge(sec) { if (this.audio.duration) this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + sec)); }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const cur = this.current;
    if (cur) {
      this.queue = this.shuffle ? [cur, ...shuffled(this.list.filter((t) => t !== cur))] : this.list.slice();
      this.index = this.queue.indexOf(cur);
    }
    this.emit('queue');
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.emit('queue');
  }

  playNext(track) {
    if (!this.current) return this.play([track]);
    this.queue.splice(this.index + 1, 0, track);
    this.emit('queue');
  }

  // Après un changement de bibliothèque : on remplace les objets, on retire les titres supprimés.
  sync(byId) {
    const cur = this.current;
    this.list = this.list.map((t) => byId.get(t.id)).filter(Boolean);
    this.queue = this.queue.map((t) => byId.get(t.id)).filter(Boolean);
    if (cur) this.index = this.queue.findIndex((t) => t.id === cur.id);
    this.emit('queue');
  }
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
