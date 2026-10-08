// Importe un dossier : copie les sons dans music/, associe les pochettes, enregistre tout dans la base.
// npm run import -- "C:\chemin\vers\dossier"
// Une image est associée au son dont le nom la contient (505.jpg → « 505 - Arctic Monkeys.mp3 »).
// Une fiche « <son>.json » à côté du son (title, artist, album, genre, year, visual…) est appliquée à la base.
import fs from 'node:fs';
import path from 'node:path';
import { MUSIC, AUDIO, IMAGES, q, update } from '../server/db.js';
import { scan, idOf } from '../server/server.js';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('Usage : npm run import -- <dossier>');
  process.exit(1);
}

const norm = (s) => path.parse(s).name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const names = fs.readdirSync(src);
const sounds = names.filter((n) => AUDIO[path.extname(n).toLowerCase()]);
const images = names.filter((n) => IMAGES[path.extname(n).toLowerCase()]);
fs.mkdirSync(MUSIC, { recursive: true });

const plan = [];
for (const s of sounds) {
  const key = norm(s);
  const img = images.find((i) => norm(i) === key) || images.find((i) => norm(i) && key.includes(norm(i)));
  fs.copyFileSync(path.join(src, s), path.join(MUSIC, s));
  if (img) fs.copyFileSync(path.join(src, img), path.join(MUSIC, path.parse(s).name + path.extname(img).toLowerCase()));
  plan.push({ s, img });
}

await scan();

for (const { s, img } of plan) {
  const id = idOf(s);
  const side = path.join(src, `${path.parse(s).name}.json`);
  if (fs.existsSync(side)) update(id, JSON.parse(fs.readFileSync(side, 'utf8')));
  const t = q.get.get(id);
  console.log(`✓ ${id}  ${t.artist} — ${t.title}${img ? `  (pochette : ${img})` : ''}`);
}
