// Consulta de productos en Open Food Facts (base de datos abierta y gratuita, sin registro).
// Cubre bien alimentos y bebidas; tiene pocos productos de limpieza y aseo.

const API = 'https://world.openfoodfacts.org/api/v2/product/';
const FIELDS = 'product_name,product_name_es,generic_name_es,brands,quantity,image_front_small_url,image_front_url';

// "COLUN" → "Colun"; respeta las marcas que ya vienen con mayúsculas y minúsculas.
const tidy = (s) => {
  const clean = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (clean !== clean.toUpperCase()) return clean;
  return clean.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
};

// Devuelve { status: 'found' | 'not-found' | 'offline' | 'timeout' | 'error', name, brand, size, imageUrl }
export async function lookupProduct(code, { timeout = 8000 } = {}) {
  if (navigator.onLine === false) return { status: 'offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API}${encodeURIComponent(code)}.json?fields=${FIELDS}`, { signal: controller.signal });
    if (res.status === 404) return { status: 'not-found' };
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    const p = data.product;
    if (data.status !== 1 || !p) return { status: 'not-found' };
    const name = tidy(p.product_name_es || p.product_name || p.generic_name_es);
    if (!name) return { status: 'not-found' };
    return {
      status: 'found',
      name,
      brand: tidy(String(p.brands ?? '').split(',')[0]),
      size: String(p.quantity ?? '').trim(),
      imageUrl: p.image_front_small_url || p.image_front_url || null,
    };
  } catch (err) {
    return { status: err?.name === 'AbortError' ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}
