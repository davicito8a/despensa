// Interpreta frases dictadas ("se acabaron dos leches y un arroz") sin internet ni IA.
// Solo propone cambios: la pantalla de confirmación decide qué se aplica.
import { normalize } from './logic.js';

const VERBS = {
  descontar: [
    'se termino', 'se terminaron', 'se acabo', 'se acabaron', 'se nos termino', 'se nos terminaron',
    'se nos acabo', 'se nos acabaron', 'se uso', 'se usaron', 'se gasto', 'se gastaron', 'se vencio',
    'se vencieron', 'termine', 'terminamos', 'acabe', 'acabamos', 'use', 'usamos', 'ocupe', 'ocupamos',
    'gaste', 'gastamos', 'consumi', 'consumimos', 'saque', 'sacamos', 'bote', 'botamos', 'descuenta',
    'descontar', 'descontame', 'resta', 'restar', 'quita', 'quitar',
  ],
  reponer: [
    'compre', 'compramos', 'compro', 'compraron', 'traje', 'trajimos', 'trajeron', 'llego', 'llegaron',
    'agregue', 'agregamos', 'agrega', 'agregar', 'suma', 'sumar', 'sume', 'sumamos', 'repon', 'reponer',
    'repuse', 'repusimos',
  ],
};

const VERB_LIST = Object.entries(VERBS)
  .flatMap(([mode, verbs]) => verbs.map((v) => ({ mode, v })))
  .sort((a, b) => b.v.length - a.v.length);
const VERB_RE = new RegExp(`(?:^| )(${VERB_LIST.map((x) => x.v).join('|')})(?= |$)`, 'g');
const VERB_MODE = Object.fromEntries(VERB_LIST.map((x) => [x.v, x.mode]));

const NUMBERS = {
  un: 1, una: 1, uno: 1, otro: 1, otra: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
};

// Palabras que no ayudan a identificar el producto.
const STOP = new Set([
  'el', 'la', 'los', 'las', 'lo', 'unos', 'unas', 'otros', 'otras', 'de', 'del', 'al', 'a', 'mi', 'mis',
  'su', 'sus', 'me', 'nos', 'se', 'que', 'y', 'e', 'ya', 'hoy', 'ayer', 'recien', 'tambien', 'ademas',
  'mas', 'solo', 'con', 'para', 'por', 'en', 'todo', 'toda', 'todos', 'todas', '_y_',
]);

// Envases y medidas: "dos paquetes de arroz" se refiere al arroz.
const UNITS = new Set([
  'paquete', 'caja', 'cajita', 'botella', 'bolsa', 'lata', 'tarro', 'frasco', 'sobre', 'rollo',
  'unidad', 'litro', 'kilo', 'kg', 'gramo', 'bandeja', 'pack', 'envase', 'malla', 'saco', 'barra',
  'tubo', 'pote', 'bidon', 'sachet', 'paquetito', 'botellita', 'tarrito',
]);

// Plural → singular, suficiente para nombres de productos: leches → leche, arroces → arroz, panes → pan.
export function singular(w) {
  if (w.length <= 3 || !w.endsWith('s') || /(?:us|is)$/.test(w)) return w;
  if (w.endsWith('ces')) return `${w.slice(0, -3)}z`;
  if (w.endsWith('iones')) return `${w.slice(0, -5)}ion`;
  if (w.endsWith('es') && /[lnrdjy]$/.test(w.slice(0, -2))) return w.slice(0, -2);
  return w.slice(0, -1);
}

const clean = (s) => normalize(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (s) => clean(s).split(' ').filter((w) => w && !STOP.has(w)).map(singular);

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// 2 = igual, 1 = parecida (prefijo o una letra distinta, típico del dictado), 0 = distinta.
function wordMatch(q, w) {
  if (q === w) return 2;
  if (q.length >= 4 && w.length >= 4 && (w.startsWith(q) || q.startsWith(w))) return 1;
  if (q.length >= 5 && w.length >= 5 && editDistance(q, w) <= 1) return 1;
  return 0;
}

// Puntaje de un producto para las palabras dichas; 0 si alguna palabra no calza con nada.
function score(qWords, p) {
  const nameW = wordsOf(p.name);
  const extraW = wordsOf(`${p.brand ?? ''} ${p.size ?? ''}`);
  let total = 0;
  for (const q of qWords) {
    const inName = Math.max(0, ...nameW.map((w) => wordMatch(q, w)));
    const inExtra = Math.max(0, ...extraW.map((w) => wordMatch(q, w)));
    if (!inName && !inExtra) return { total: 0, exact: false };
    total += inName ? inName + 1 : inExtra;
  }
  const exact = nameW.length === qWords.length && nameW.every((w) => qWords.includes(w));
  return { total: total + (exact ? 1 : 0), exact };
}

function parseSegment(segment, mode) {
  let found = null;
  const text = segment.replace(VERB_RE, (_, verb) => {
    found ??= VERB_MODE[verb];
    return ' ';
  });
  const tokens = text.split(' ').filter(Boolean);
  let qty = null;
  const words = [];
  const units = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) { qty ??= Number(t); continue; }
    if (t === 'media' && tokens[i + 1] === 'docena') { qty = 6; i++; continue; }
    if (t === 'docena' || t === 'docenas') { qty = (qty ?? 1) * 12; continue; }
    if (t === 'par' || t === 'pares') { qty = (qty ?? 1) * 2; continue; }
    if (t in NUMBERS) { qty ??= NUMBERS[t]; continue; }
    if (STOP.has(t)) continue;
    const w = singular(t);
    if (UNITS.has(w)) units.push(w);
    else words.push(w);
  }
  return { mode: found ?? mode, qty: qty ?? 1, words: words.length ? words : units };
}

/**
 * Convierte la frase en una lista de propuestas:
 * { heard, key, qty, mode, candidates: [ids ordenados], productId (null si hay que elegir), sure }.
 * aliases recuerda elecciones anteriores: { "leche": productId }.
 */
export function parseVoice(text, products, { defaultMode = 'descontar', aliases = {} } = {}) {
  // Los nombres que llevan "y" (por ejemplo "sal y pimienta") se protegen antes de separar por "y".
  const namesWithY = products.map((p) => clean(p.name)).filter((name) => name.includes(' y '));
  const pieces = normalize(text).split(/[,;.!?¿¡]+/).flatMap((piece) => {
    let c = ` ${clean(piece)} `;
    for (const name of namesWithY) c = c.split(` ${name} `).join(` ${name.replace(/ y /g, ' _y_ ')} `);
    return c.split(/ (?:y|e|mas|ademas|tambien) /);
  });
  // Las mismas partes con el texto tal como se dictó, para mostrarlas en la revisión.
  const originals = text.split(/[,;.!?¿¡]+/)
    .flatMap((piece) => ` ${piece.replace(/\s+/g, ' ').trim()} `.split(/ (?:y|e|m[aá]s|adem[aá]s|tambi[eé]n) /i));
  const shown = (i, seg) => (originals.length === pieces.length ? originals[i].trim() : seg.replace(/_y_/g, 'y'));

  const items = [];
  let mode = defaultMode;
  for (const [i, piece] of pieces.entries()) {
    const seg = piece.trim();
    if (!seg) continue;
    // Cada parte hereda la acción de la anterior: "se acabaron dos leches y un arroz".
    const parsed = parseSegment(seg, mode);
    mode = parsed.mode;
    if (!parsed.words.length) continue;

    const key = parsed.words.join(' ');
    const scored = products
      .map((p) => ({ p, ...score(parsed.words, p) }))
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name, 'es'));
    let candidates = scored.map((x) => x.p.id);
    let productId = null;
    let sure = false;

    if (scored.length === 1) {
      productId = candidates[0];
      sure = true;
    } else if (scored.length > 1) {
      const exact = scored.filter((x) => x.exact);
      if (exact.length === 1) productId = exact[0].p.id;
    } else {
      // Nada calza con todas las palabras: sugiere los que calzan con alguna.
      candidates = products
        .filter((p) => parsed.words.some((q) => q.length >= 4 && wordsOf(p.name).some((w) => wordMatch(q, w))))
        .map((p) => p.id);
    }

    const remembered = aliases[key];
    if (remembered && products.some((p) => p.id === remembered)) {
      productId = remembered;
      sure = true;
      candidates = [remembered, ...candidates.filter((id) => id !== remembered)];
    }

    items.push({ heard: shown(i, seg), key, qty: parsed.qty, mode: parsed.mode, candidates, productId, sure });
  }
  return items;
}
