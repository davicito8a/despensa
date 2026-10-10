// Reglas de negocio puras: no tocan la base de datos ni la interfaz.

export const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

// Regla central: el producto va a la lista si stock actual <= nivel de reposición.
export const needsRestock = (p) => p.stock <= p.reorder;

// El stock máximo solo sirve para sugerir cuánto comprar.
export const suggestedQty = (p) => Math.max(p.max - p.stock, 1);

export function validateLevels({ stock, max, reorder }) {
  const fields = [
    [stock, 'El stock actual'],
    [max, 'El stock máximo'],
    [reorder, 'El nivel de reposición'],
  ];
  for (const [value, name] of fields) {
    if (!Number.isInteger(value) || value < 0) return `${name} debe ser un número entero, 0 o mayor.`;
  }
  if (max < 1) return 'El stock máximo debe ser al menos 1.';
  if (reorder >= max) return 'El nivel de reposición debe ser menor que el stock máximo.';
  return null;
}

export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

export const productLabel = (p) => [p.name, p.brand, p.size].filter(Boolean).join(' ');

export const matchesQuery = (p, query) => {
  const q = normalize(query);
  if (!q) return true;
  const text = normalize(`${p.name} ${p.brand} ${p.size} ${p.barcode}`);
  return q.split(' ').every((word) => text.includes(word));
};

// Un producto puede tener varios códigos (por ejemplo, la misma leche de dos marcas), separados por coma.
export const barcodesOf = (p) => String(p?.barcode ?? '').split(/[\s,;]+/).filter(Boolean);

// Clave para comparar códigos: en los numéricos se ignoran los ceros iniciales (UPC-A = EAN-13 con un 0 delante).
export const barcodeKey = (code) => {
  const clean = String(code ?? '').trim().toUpperCase();
  return /^\d+$/.test(clean) ? clean.replace(/^0+/, '') : clean;
};

export const hasBarcode = (p, code) => {
  const key = barcodeKey(code);
  return !!key && barcodesOf(p).some((c) => barcodeKey(c) === key);
};

export const addBarcode = (current, code) => {
  const codes = barcodesOf({ barcode: current });
  if (!codes.some((c) => barcodeKey(c) === barcodeKey(code))) codes.push(code);
  return codes.join(', ');
};

export const byName =(a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
