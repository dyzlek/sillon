// Gère la bibliothèque en ligne de commande.
//   npm run db                         → liste les sons
//   npm run db -- set 2 artist="Panchiko" genre="Indie" year=2016
//   npm run db -- set 2 visual=spectre,anneau visual_every=16
// On désigne un son par son numéro dans la liste ou par son id.
import { q, update, EDITABLE, MODES } from '../server/db.js';

const [cmd = 'list', who, ...pairs] = process.argv.slice(2);
const rows = q.all.all();
const pick = (k) => rows[Number(k) - 1] || rows.find((r) => r.id === k);
const mmss = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');

if (cmd === 'list') {
  rows.forEach((r, i) => console.log(
    `${String(i + 1).padStart(2)}  ${r.id}  ${r.artist} — ${r.title}`.padEnd(64),
    `${(r.genre || '').padEnd(10)} ${mmss(r.duration).padStart(5)}  ${String(r.plays).padStart(3)} écoute(s)  vues : ${r.visual} / ${r.visual_every}s${r.cover ? '  ▣' : ''}`,
  ));
  if (!rows.length) console.log('Base vide : dépose des sons dans music/ ou lance « npm run import -- <dossier> ».');
} else if (cmd === 'set') {
  const r = pick(who);
  if (!r) { console.error(`Son introuvable : ${who}`); process.exit(1); }
  const fields = {};
  for (const p of pairs) {
    const [k, ...v] = p.split('=');
    if (!EDITABLE.includes(k)) { console.error(`Champ inconnu : ${k} (possibles : ${EDITABLE.join(', ')})`); process.exit(1); }
    const val = v.join('=');
    fields[k] = ['year', 'visual_every', 'position'].includes(k) ? Number(val) : val || null;
  }
  const t = update(r.id, fields);
  console.log(`✓ ${t.artist} — ${t.title} · ${t.genre || ''} ${t.year || ''} · vues : ${t.visual} / ${t.visual_every}s`);
} else {
  console.log(`Commandes : list, set <n°|id> champ=valeur…\nChamps : ${EDITABLE.join(', ')}\nVues : ${MODES.join(', ')}`);
}
