// Sillon — serveur : garde la musique, la sert en streaming. La bibliothèque vit dans SQLite (server/db.js).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ROOT, MUSIC, AUDIO, IMAGES, q, update } from './db.js';

const PUBLIC = path.join(ROOT, 'public');
const VENDOR = { '/vendor/gsap/': path.join(ROOT, 'node_modules', 'gsap') };
const PORT = Number(process.env.PORT) || 4173;
const MAX_UPLOAD = 300 * 1024 * 1024;
// En ligne, définir SILLON_TOKEN : l'envoi de fichiers et les modifications exigent alors cette clé.
const TOKEN = process.env.SILLON_TOKEN || '';
const allowed = (req) => !TOKEN || crypto.timingSafeEqual(
  crypto.createHash('sha256').update(req.headers.authorization || '').digest(),
  crypto.createHash('sha256').update(`Bearer ${TOKEN}`).digest(),
);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', ...IMAGES };

/* ---------------- Synchronisation dossier → base ---------------- */

export const idOf = (file) => crypto.createHash('sha1').update(file).digest('hex').slice(0, 10);

// « Artiste - Titre.mp3 » → { artist, title } ; sinon tout le nom devient le titre.
function fromFilename(file) {
  const base = path.parse(file).name.replace(/_+/g, ' ').trim();
  const [a, ...t] = base.split(' - ');
  return t.length ? { artist: a.trim(), title: t.join(' - ').trim() } : { artist: 'Artiste inconnu', title: base };
}

// Pochette : une image du même nom que le son, à côté de lui.
function coverFor(file, names) {
  const base = path.parse(file).name.toLowerCase();
  return names.find((n) => IMAGES[path.extname(n).toLowerCase()] && path.parse(n).name.toLowerCase() === base) || null;
}

export async function scan() {
  await fsp.mkdir(MUSIC, { recursive: true });
  const names = await fsp.readdir(MUSIC);
  const audio = names.filter((f) => AUDIO[path.extname(f).toLowerCase()]);
  for (const file of audio) {
    const { size } = await fsp.stat(path.join(MUSIC, file));
    const cover = coverFor(file, names);
    const row = q.byFile.get(file);
    if (row) q.touch.run(size, cover, row.id);
    else {
      const { artist, title } = fromFilename(file);
      q.insert.run(idOf(file), file, title, artist, cover, size, Date.now());
    }
  }
  // Fichier disparu = titre retiré de la base
  for (const { id, file } of q.files.all()) if (!audio.includes(file)) q.remove.run(id);
  console.log(`♪ ${audio.length} son(s) dans music/`);
}

const publicTrack = (t) => ({
  id: t.id, title: t.title, artist: t.artist, album: t.album, genre: t.genre, year: t.year,
  duration: t.duration, plays: t.plays, size: t.size, type: AUDIO[path.extname(t.file).toLowerCase()],
  cover: t.cover ? `/api/cover/${t.id}` : null,
  visual: t.visual.split(','), visualEvery: t.visual_every,
});


/* ---------------- HTTP ---------------- */

const json = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
async function body(req, limit = 1e5) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('Trop gros'), { status: 413 }); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function sendFile(req, res, file, type) {
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (!range) {
    res.writeHead(200, { ...head, 'Content-Length': size });
    return fs.createReadStream(file).pipe(res);
  }
  const start = range[1] ? +range[1] : size - +range[2];
  const end = Math.min(range[1] && range[2] ? +range[2] : size - 1, size - 1);
  if (start >= size || start > end || start < 0) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  fs.createReadStream(file, { start, end }).pipe(res);
}

async function upload(req, res) {
  if (!allowed(req)) return json(res, 401, { error: 'Clé requise' });
  const name = path.basename(decodeURIComponent(req.headers['x-filename'] || '')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
  const ext = path.extname(name).toLowerCase();
  if (!name || !(AUDIO[ext] || IMAGES[ext])) return json(res, 415, { error: 'Format non pris en charge' });
  if (Number(req.headers['content-length']) > MAX_UPLOAD) return json(res, 413, { error: 'Fichier trop lourd (300 Mo max)' });
  const target = path.join(MUSIC, name);
  if (AUDIO[ext] && fs.existsSync(target)) return json(res, 409, { error: 'Déjà sur le serveur' });
  const tmp = `${target}.part`;
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
  await scan();
  const row = AUDIO[ext] ? q.byFile.get(name) : null;
  json(res, 201, row ? publicTrack(q.get.get(row.id)) : { ok: true });
}

function serveStatic(req, res, pathname) {
  let base = PUBLIC, rel = pathname;
  for (const [prefix, dir] of Object.entries(VENDOR)) if (pathname.startsWith(prefix)) { base = dir; rel = pathname.slice(prefix.length - 1); }
  let file = path.normalize(path.join(base, decodeURIComponent(rel)));
  if (!file.startsWith(base)) return json(res, 403, { error: 'Interdit' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const track = (id) => q.get.get(id);

const routes = [
  ['GET', /^\/api\/library$/, (req, res) => json(res, 200, { tracks: q.all.all().map(publicTrack) })],
  ['GET', /^\/api\/stream\/(\w+)$/, (req, res, [id]) => {
    const t = track(id);
    t ? sendFile(req, res, path.join(MUSIC, t.file), AUDIO[path.extname(t.file).toLowerCase()]) : json(res, 404, { error: 'Son introuvable' });
  }],
  ['GET', /^\/api\/cover\/(\w+)$/, (req, res, [id]) => {
    const t = track(id);
    const file = t?.cover && path.join(MUSIC, t.cover);
    file && fs.existsSync(file) ? sendFile(req, res, file, IMAGES[path.extname(file).toLowerCase()]) : json(res, 404, { error: 'Pas de pochette' });
  }],
  // Le navigateur connaît la durée exacte : il la confie à la base.
  ['POST', /^\/api\/tracks\/(\w+)\/duration$/, async (req, res, [id]) => {
    const { duration } = await body(req);
    if (!track(id) || !(duration > 0)) return json(res, 400, { error: 'Durée invalide' });
    q.duration.run(duration, id, duration);
    json(res, 200, publicTrack(track(id)));
  }],
  ['POST', /^\/api\/tracks\/(\w+)\/play$/, (req, res, [id]) => {
    if (!track(id)) return json(res, 404, { error: 'Son introuvable' });
    q.play.run(id, Date.now());
    json(res, 200, { plays: track(id).plays });
  }],
  ['PATCH', /^\/api\/tracks\/(\w+)$/, async (req, res, [id]) => {
    if (!allowed(req)) return json(res, 401, { error: 'Clé requise' });
    if (!track(id)) return json(res, 404, { error: 'Son introuvable' });
    json(res, 200, publicTrack(update(id, await body(req))));
  }],
  ['POST', /^\/api\/upload$/, upload],
];

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname.startsWith('/api/')) {
      for (const [method, re, fn] of routes) {
        const m = re.exec(pathname);
        if (m && method === req.method) return await fn(req, res, m.slice(1));
      }
      return json(res, 404, { error: 'Route inconnue' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Méthode non autorisée' });
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.status || (e instanceof SyntaxError ? 400 : 500), { error: e.message });
  }
});

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  await scan();
  let rescanTimer;
  fs.watch(MUSIC, () => { clearTimeout(rescanTimer); rescanTimer = setTimeout(() => scan().catch(console.error), 400); });
  server.listen(PORT, () => console.log(`Sillon → http://localhost:${PORT}`));
}
