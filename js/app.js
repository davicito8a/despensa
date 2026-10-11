import * as db from './db.js';
import {
  uid, needsRestock, suggestedQty, validateLevels, normalize, productLabel, matchesQuery, byName,
  barcodesOf, hasBarcode, addBarcode,
} from './logic.js';
import { RECOMMENDATIONS } from './recommendations.js';
import { createScanner, cameraErrorMessage } from './scanner.js';
import { lookupProduct } from './openfoodfacts.js';
import { parseVoice } from './voice.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const APP_VERSION = '1.4.0';
const DEFAULT_ROOMS = ['Cocina', 'Baño', 'Dormitorio', 'Lavandería', 'Bodega'];
const CART_KEY = 'despensa.cart';
const RECS_DRAFT_KEY = 'despensa.recsDraft';
const VOICE_ALIASES_KEY = 'despensa.voiceAliases';
const NO_ROOM = '';

const state = {
  rooms: [],
  products: [],
  extras: [],
  view: 'inicio',
  mode: 'descontar',
  query: { inicio: '', inventario: '' },
  roomFilter: 'all',
  cart: loadCart(), // { productId: cantidad } marcados en el carro durante la compra
};

// ---------- Utilidades ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const toInt = (v) => (String(v).trim() === '' ? NaN : Number(v));

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
  } catch {
    /* sin almacenamiento local: el carro solo dura la sesión */
  }
}

// Borrador de la configuración de productos habituales. Se escribe en cada cambio
// (localStorage es síncrono, así que sobrevive aunque el sistema cierre la app).
function loadRecsDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(RECS_DRAFT_KEY));
    return Array.isArray(draft?.items) && draft.items.length ? draft : null;
  } catch {
    return null;
  }
}

function saveRecsDraft(items) {
  try {
    localStorage.setItem(RECS_DRAFT_KEY, JSON.stringify({ items, savedAt: Date.now() }));
  } catch {
    /* sin almacenamiento local: el borrador no se puede guardar */
  }
}

function clearRecsDraft() {
  try {
    localStorage.removeItem(RECS_DRAFT_KEY);
  } catch {
    /* nada que borrar */
  }
}

const roomById = (id) => state.rooms.find((r) => r.id === id);
const roomName = (id) => roomById(id)?.name ?? 'Sin habitación';
const sortedRooms = () => [...state.rooms].sort((a, b) => a.order - b.order || byName(a, b));
const productById = (id) => state.products.find((p) => p.id === id);
const findByBarcode = (code) => state.products.find((p) => hasBarcode(p, code));
const shoppingItems = () => {
  const order = new Map(sortedRooms().map((r, i) => [r.id, i]));
  return state.products
    .filter(needsRestock)
    .sort((a, b) => (order.get(a.roomId) ?? 999) - (order.get(b.roomId) ?? 999) || byName(a, b));
};

const ICONS = {
  cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 19H7a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.4 11a4 4 0 0 1-1.9 8z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/></svg>',
  barcode: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>',
  flash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// ---------- Datos ----------

async function loadAll() {
  const [rooms, products, extras] = await Promise.all([
    db.getAll('rooms'), db.getAll('products'), db.getAll('extras'),
  ]);
  state.rooms = rooms;
  state.products = products;
  state.extras = extras.sort((a, b) => a.createdAt - b.createdAt);
}

async function seedRooms() {
  const rooms = DEFAULT_ROOMS.map((name, order) => ({ id: uid(), name, order }));
  await db.write(rooms.map((r) => ({ store: 'rooms', put: r })));
  state.rooms = rooms;
}

async function createRoom(name) {
  const clean = name.trim();
  if (!clean) return null;
  const existing = state.rooms.find((r) => normalize(r.name) === normalize(clean));
  if (existing) return existing;
  const room = { id: uid(), name: clean, order: Math.max(-1, ...state.rooms.map((r) => r.order)) + 1 };
  await db.write([{ store: 'rooms', put: room }]);
  state.rooms.push(room);
  return room;
}

function movement(product, type, before, after, batchId) {
  return {
    id: uid(),
    productId: product.id,
    productName: productLabel(product),
    type, // alta | consumo | reposicion | ajuste
    delta: after - before,
    before,
    after,
    at: Date.now(),
    batchId: batchId ?? null,
  };
}

function replaceProduct(updated) {
  const i = state.products.findIndex((p) => p.id === updated.id);
  if (i >= 0) state.products[i] = updated;
  else state.products.push(updated);
}

// Cambia el stock de varios productos en una sola transacción y devuelve los movimientos creados.
async function changeStock(changes, type) {
  const batchId = uid();
  const ops = [];
  const movements = [];
  const updated = [];
  for (const { id, delta } of changes) {
    const p = productById(id);
    if (!p) continue;
    const after = Math.max(0, p.stock + delta);
    if (after === p.stock) continue;
    const next = { ...p, stock: after, updatedAt: Date.now() };
    const mov = movement(p, type, p.stock, after, batchId);
    ops.push({ store: 'products', put: next }, { store: 'movements', put: mov });
    movements.push(mov);
    updated.push(next);
  }
  await db.write(ops);
  updated.forEach(replaceProduct);
  return movements;
}

async function undoMovements(movements) {
  const ops = [];
  const updated = [];
  for (const mov of movements) {
    const p = productById(mov.productId);
    if (p) {
      const next = { ...p, stock: Math.max(0, p.stock - mov.delta), updatedAt: Date.now() };
      ops.push({ store: 'products', put: next });
      updated.push(next);
    }
    ops.push({ store: 'movements', del: mov.id });
  }
  await db.write(ops);
  updated.forEach(replaceProduct);
  render();
}

// ---------- Interfaz general ----------

function render() {
  for (const tab of $$('.tab')) {
    const active = tab.dataset.view === state.view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-current', active ? 'page' : 'false');
  }
  const count = shoppingItems().length + state.extras.filter((e) => !e.done).length;
  const badge = $('#listBadge');
  badge.hidden = count === 0;
  badge.textContent = count;

  const view = $('#view');
  if (state.view === 'inicio') view.innerHTML = inicioHTML();
  else if (state.view === 'lista') view.innerHTML = listaHTML();
  else view.innerHTML = inventarioHTML();
  document.body.classList.toggle('has-footer', !!$('.footer-action', view));
}

function go(viewName) {
  if (state.view !== viewName) {
    state.view = viewName;
    window.scrollTo(0, 0);
  }
  render();
}

let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button type="button" data-undo>Deshacer</button>' : ''}`;
  el.hidden = false;
  if (undo) {
    $('[data-undo]', el).addEventListener('click', async () => {
      el.hidden = true;
      await undo();
    }, { once: true });
  }
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 6000 : 2500);
}

// Muestra un aviso cuando no haya otro con "Deshacer" a la vista, para no quitarle esa opción al usuario.
async function toastWhenFree(message) {
  const el = $('#toast');
  for (let waited = 0; !el.hidden && $('[data-undo]', el) && waited < 8000; waited += 300) {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  toast(message);
}

let sheetEls = null;
function openSheet(html, { wide = false, onClose = null } = {}) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const sheet = document.createElement('div');
  sheet.className = `sheet${wide ? ' wide' : ''}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<button type="button" class="sheet-close icon-btn" aria-label="Cerrar">${ICONS.close}</button>${html}`;
  backdrop.addEventListener('click', closeSheet);
  $('.sheet-close', sheet).addEventListener('click', closeSheet);
  document.body.append(backdrop, sheet);
  document.body.classList.add('sheet-open');
  sheetEls = { backdrop, sheet, onClose };
  return sheet;
}

function closeSheet() {
  if (!sheetEls) return;
  const { backdrop, sheet, onClose } = sheetEls;
  backdrop.remove();
  sheet.remove();
  sheetEls = null;
  document.body.classList.remove('sheet-open');
  onClose?.();
}

// Solo se muestra la foto real; sin foto, el nombre ocupa ese espacio.
function thumb(p) {
  return p.photo ? `<img class="thumb" src="${p.photo}" alt="">` : '';
}

function subtitle(p, withRoom = true) {
  return [p.brand, p.size, withRoom ? roomName(p.roomId) : null].filter(Boolean).join(' · ');
}

function productRow(p, { action, trailing = '', withRoom = true } = {}) {
  const low = needsRestock(p);
  return `
    <li class="row">
      <button type="button" class="row-main" data-action="${action}" data-id="${p.id}">
        ${thumb(p)}
        <span class="row-text">
          <span class="row-title">${esc(p.name)}</span>
          <span class="row-sub">${esc(subtitle(p, withRoom))}</span>
        </span>
        <span class="stock${low ? ' low' : ''}" title="Stock actual / máximo">${p.stock}<small>/${p.max}</small></span>
      </button>
      ${trailing}
    </li>`;
}

function stepperHTML(name, value, { min = 0, label = '' } = {}) {
  return `
    <div class="stepper" data-stepper="${name}">
      <button type="button" class="step" data-step="-1" aria-label="Restar">${ICONS.minus}</button>
      <input type="number" inputmode="numeric" pattern="[0-9]*" min="${min}" step="1" name="${name}" value="${esc(value)}" aria-label="${esc(label)}">
      <button type="button" class="step" data-step="1" aria-label="Sumar">${ICONS.plus}</button>
    </div>`;
}

// Conecta los botones − / + de todos los steppers dentro de root.
function wireSteppers(root, onChange) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    const input = $('input', btn.closest('.stepper'));
    const min = Number(input.min || 0);
    const current = Number.isFinite(toInt(input.value)) ? toInt(input.value) : 0;
    input.value = Math.max(min, current + Number(btn.dataset.step));
    onChange?.(input);
  });
  root.addEventListener('input', (e) => {
    if (e.target.closest('.stepper')) onChange?.(e.target);
  });
}

function emptyState(title, text, button = '') {
  return `<div class="empty"><p class="empty-title">${esc(title)}</p><p>${esc(text)}</p>${button}</div>`;
}

// ---------- Inicio: Descontar / Reponer ----------

function inicioHTML() {
  const pending = shoppingItems().length;
  return `
    <header class="topbar"><h1>Inicio</h1></header>
    ${draftBannerHTML()}
    <div class="segmented" role="tablist" aria-label="Acción">
      <button type="button" role="tab" data-action="mode" data-mode="descontar" aria-selected="${state.mode === 'descontar'}">Descontar</button>
      <button type="button" role="tab" data-action="mode" data-mode="reponer" aria-selected="${state.mode === 'reponer'}">Reponer</button>
    </div>
    ${pending ? `<button type="button" class="banner" data-action="go" data-view="lista">${plural(pending, 'producto', 'productos')} en tu lista de compras →</button>` : ''}
    <div class="search-row">
      <input class="search" type="search" placeholder="Buscar producto…" value="${esc(state.query.inicio)}" data-search="inicio" autocomplete="off">
      <button type="button" class="scan-btn" data-action="voice" aria-label="${state.mode === 'descontar' ? 'Descontar' : 'Reponer'} dictando">${ICONS.mic}</button>
      <button type="button" class="scan-btn" data-action="scan-stock" aria-label="${state.mode === 'descontar' ? 'Descontar' : 'Reponer'} escaneando el código de barras">${ICONS.barcode}</button>
    </div>
    <div id="results">${inicioResultsHTML()}</div>`;
}

function inicioResultsHTML() {
  if (!state.products.length) {
    return emptyState(
      'Aún no tienes productos',
      'Agrega los productos que tienes en casa desde Inventario.',
      '<button type="button" class="primary" data-action="go" data-view="inventario">Ir a Inventario</button>',
    );
  }
  const found = state.products.filter((p) => matchesQuery(p, state.query.inicio)).sort(byName);
  if (!found.length) return emptyState('Sin resultados', 'Prueba con otro nombre o marca.');

  if (state.mode === 'descontar') {
    const rows = found.map((p) => productRow(p, {
      action: 'qty',
      trailing: `<button type="button" class="quick" data-action="quick" data-id="${p.id}" ${p.stock ? '' : 'disabled'} aria-label="Descontar 1 ${esc(p.name)}">−1</button>`,
    }));
    return `<p class="hint">Toca −1 para descontar una unidad, o el producto para elegir la cantidad.</p><ul class="list">${rows.join('')}</ul>`;
  }

  const quickPlus = (p) => `<button type="button" class="quick plus" data-action="quick" data-id="${p.id}" aria-label="Reponer 1 ${esc(p.name)}">+1</button>`;
  const inList = found.filter(needsRestock);
  const rest = found.filter((p) => !needsRestock(p));
  return `
    <p class="hint">Toca +1 para sumar una unidad, o el producto para registrar cuánto compraste.</p>
    ${inList.length ? `<h2 class="group">En tu lista <span>${inList.length}</span></h2><ul class="list">${inList.map((p) => productRow(p, { action: 'qty', trailing: quickPlus(p) })).join('')}</ul>` : ''}
    ${rest.length ? `<h2 class="group">Otros productos <span>${rest.length}</span></h2><ul class="list">${rest.map((p) => productRow(p, { action: 'qty', trailing: quickPlus(p) })).join('')}</ul>` : ''}`;
}

async function applyStock(id, delta) {
  const type = delta < 0 ? 'consumo' : 'reposicion';
  const movs = await changeStock([{ id, delta }], type);
  if (!movs.length) return;
  render();
  const mov = movs[0];
  const p = productById(id);
  const verb = delta < 0 ? 'Descontado' : 'Repuesto';
  let extra = '';
  if (delta < 0 && needsRestock(p) && mov.before > p.reorder) extra = ' · agregado a Mi lista';
  if (delta > 0 && !needsRestock(p) && mov.before <= p.reorder) extra = ' · quitado de Mi lista';
  toast(`${verb}: ${Math.abs(mov.delta)} ${p.name} (quedan ${p.stock})${extra}`, () => undoMovements(movs));
}

function openQtySheet(p) {
  const descontar = state.mode === 'descontar';
  if (descontar && p.stock === 0) {
    toast(`No queda stock de ${p.name}.`);
    return;
  }
  const initial = descontar ? 1 : (needsRestock(p) ? suggestedQty(p) : 1);
  const sheet = openSheet(`
    <h2>${descontar ? 'Descontar' : 'Reponer'}</h2>
    <div class="sheet-product">${thumb(p)}<div><strong>${esc(productLabel(p))}</strong><div class="muted">Stock actual: ${p.stock} · máximo ${p.max}</div></div></div>
    <form id="qtyForm">
      <label class="field-label">${descontar ? '¿Cuántas unidades se usaron?' : '¿Cuántas unidades compraste?'}</label>
      ${stepperHTML('qty', initial, { min: 1, label: 'Cantidad' })}
      ${descontar ? `<button type="button" class="link" data-action="all">Se terminó todo (${p.stock})</button>` : (needsRestock(p) ? `<p class="muted small">Sugerido: ${suggestedQty(p)} para llegar al máximo.</p>` : '')}
      <p class="preview" id="qtyPreview"></p>
      <p class="error" id="qtyError" role="alert"></p>
      <button type="submit" class="primary block">${descontar ? 'Descontar' : 'Reponer'}</button>
    </form>`);
  const form = $('#qtyForm', sheet);
  const input = form.elements.qty;
  if (descontar) input.max = p.stock;

  const update = () => {
    const qty = toInt(input.value);
    const valid = Number.isInteger(qty) && qty >= 1 && (!descontar || qty <= p.stock);
    $('#qtyError', sheet).textContent = valid ? '' : (descontar && qty > p.stock ? `Solo hay ${p.stock}.` : 'Ingresa una cantidad válida.');
    $('button[type=submit]', form).disabled = !valid;
    if (!valid) { $('#qtyPreview', sheet).textContent = ''; return; }
    const after = p.stock + (descontar ? -qty : qty);
    const onList = after <= p.reorder;
    $('#qtyPreview', sheet).innerHTML = `Quedarán <strong>${after}</strong>${onList ? ' · <span class="tag low">en Mi lista</span>' : ''}`;
  };
  wireSteppers(form, update);
  $('[data-action=all]', form)?.addEventListener('click', () => { input.value = p.stock; update(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const qty = toInt(input.value);
    closeSheet();
    await applyStock(p.id, descontar ? -qty : qty);
  });
  update();
}

// ---------- Voz: dictar lo que se usó o se compró ----------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Recuerda qué producto eligió el usuario para cada frase ("leche" → Leche entera).
function loadVoiceAliases() {
  try {
    return JSON.parse(localStorage.getItem(VOICE_ALIASES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveVoiceAliases(aliases) {
  try {
    localStorage.setItem(VOICE_ALIASES_KEY, JSON.stringify(aliases));
  } catch {
    /* sin almacenamiento local: la próxima vez volverá a preguntar */
  }
}

// La base es el dictado del teclado (funciona en cualquier iPhone); "Escuchar" se ofrece si el navegador lo permite.
function openVoiceSheet(text = '') {
  const descontar = state.mode === 'descontar';
  let recognition = null;
  const sheet = openSheet(`
    <h2>Dictar</h2>
    <p class="muted">Toca el micrófono del teclado y di lo que ${descontar ? 'se usó o se terminó' : 'compraste'}. Puedes nombrar varios productos.</p>
    <form id="voiceForm">
      <textarea class="voice-text" name="text" rows="3" autocomplete="off" autocapitalize="sentences"
        placeholder="${descontar ? 'Ej.: se acabaron dos leches y un arroz' : 'Ej.: compré tres leches y dos paquetes de arroz'}">${esc(text)}</textarea>
      ${SpeechRecognition ? `<button type="button" class="secondary block" data-voice="listen">${ICONS.mic} Escuchar</button>` : ''}
      <p class="muted small" id="voiceStatus"></p>
      <p class="error" id="voiceError" role="alert"></p>
      <button type="submit" class="primary block">Revisar</button>
    </form>`, { onClose: () => recognition?.abort() });
  const form = $('#voiceForm', sheet);
  const area = form.elements.text;
  const status = $('#voiceStatus', sheet);
  const error = $('#voiceError', sheet);
  area.focus();

  $('[data-voice=listen]', sheet)?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (recognition) { recognition.stop(); return; }
    const base = area.value.trim();
    recognition = new SpeechRecognition();
    recognition.lang = 'es-CL';
    recognition.interimResults = true;
    recognition.onresult = (ev) => {
      const said = [...ev.results].map((r) => r[0].transcript).join(' ').trim();
      area.value = [base, said].filter(Boolean).join(', ');
    };
    recognition.onerror = (ev) => {
      error.textContent = ev.error === 'no-speech'
        ? 'No escuché nada. Intenta de nuevo.'
        : 'No se pudo usar el micrófono aquí. Usa el micrófono del teclado.';
    };
    recognition.onend = () => {
      recognition = null;
      btn.innerHTML = `${ICONS.mic} Escuchar`;
      status.textContent = '';
    };
    error.textContent = '';
    try {
      recognition.start();
      btn.textContent = 'Detener';
      status.textContent = 'Escuchando…';
    } catch {
      recognition = null;
      error.textContent = 'No se pudo usar el micrófono aquí. Usa el micrófono del teclado.';
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const said = area.value.trim();
    if (!said) { error.textContent = 'Dicta o escribe qué productos.'; return; }
    const items = parseVoice(said, state.products, { defaultMode: state.mode, aliases: loadVoiceAliases() });
    if (!items.length) { error.textContent = 'No reconocí productos en la frase. Nómbralos como están en tu inventario.'; return; }
    recognition?.abort();
    openVoiceReview(said, items);
  });
}

// Recorre las filas en orden y calcula el efecto real de cada una (con tope en el stock disponible).
function voicePlan(rows) {
  const running = new Map();
  return rows.map((row) => {
    const p = productById(row.productId);
    if (!p || !Number.isInteger(row.qty) || row.qty < 1) return { row, p: null };
    const before = running.get(p.id) ?? p.stock;
    const qty = row.mode === 'descontar' ? Math.min(row.qty, before) : row.qty;
    const after = before + (row.mode === 'descontar' ? -qty : qty);
    running.set(p.id, after);
    return { row, p, before, after, qty };
  });
}

function openVoiceReview(text, items) {
  const rows = items.map((it) => ({ ...it, auto: it.productId }));
  const options = (row) => {
    const cands = row.candidates.map(productById).filter(Boolean);
    const others = state.products.filter((p) => !row.candidates.includes(p.id)).sort(byName);
    const opt = (p) => `<option value="${p.id}"${p.id === row.productId ? ' selected' : ''}>${esc(productLabel(p))}</option>`;
    return `
      <option value=""${row.productId ? '' : ' selected'}>${cands.length ? '¿Cuál de estos?' : 'Elegir producto…'}</option>
      ${cands.length ? `<optgroup label="Parecidos">${cands.map(opt).join('')}</optgroup>` : ''}
      ${others.length ? `<optgroup label="${cands.length ? 'Otros productos' : 'Todos los productos'}">${others.map(opt).join('')}</optgroup>` : ''}
      <option value="skip">Ignorar</option>`;
  };
  const modeBtn = (row, mode, label) =>
    `<button type="button" data-voice-mode="${mode}" aria-selected="${row.mode === mode}">${label}</button>`;

  const sheet = openSheet(`
    <h2>Revisa antes de confirmar</h2>
    <p class="voice-said">“${esc(text)}”</p>
    <ul class="voice-list">
      ${rows.map((row, i) => `
        <li class="voice-row" data-i="${i}">
          <p class="voice-heard">Escuché: “${esc(row.heard)}”</p>
          <select class="voice-select" aria-label="Producto">${options(row)}</select>
          <div class="voice-controls">
            <div class="segmented" role="group" aria-label="Acción">${modeBtn(row, 'descontar', 'Descontar')}${modeBtn(row, 'reponer', 'Reponer')}</div>
            ${stepperHTML(`qty${i}`, row.qty, { min: 1, label: 'Cantidad' })}
          </div>
          <p class="voice-note"></p>
        </li>`).join('')}
    </ul>
    <button type="button" class="primary block" data-voice="confirm">Confirmar</button>
    <button type="button" class="link" data-voice="again">Volver a dictar</button>`, { wide: true });

  const refresh = () => {
    let ready = 0;
    let invalid = false;
    voicePlan(rows).forEach(({ row, p, before, after, qty }, i) => {
      const el = $(`.voice-row[data-i="${i}"]`, sheet);
      const note = $('.voice-note', el);
      let warn = false;
      if (row.productId === 'skip') {
        note.textContent = 'No se aplicará.';
      } else if (!row.productId) {
        warn = true;
        note.textContent = row.candidates.length
          ? 'Hay varios productos parecidos. Elige cuál.'
          : 'No lo encontré en tu inventario. Elige el producto o ignóralo.';
      } else if (!p) {
        warn = invalid = true;
        note.textContent = 'Ingresa una cantidad válida.';
      } else if (row.mode === 'descontar' && before === 0) {
        warn = true;
        note.textContent = `No queda stock de ${p.name}; se omitirá.`;
      } else {
        ready++;
        warn = row.mode === 'descontar' && qty < row.qty;
        note.innerHTML = `${warn ? `Solo hay ${before}; se descontará${qty === 1 ? '' : 'n'} ${qty}. ` : ''}Stock ${before} → <strong>${after}</strong>${after <= p.reorder ? ' · <span class="tag low">en Mi lista</span>' : ''}`;
      }
      el.classList.toggle('warn', warn);
      el.classList.toggle('skip', row.productId === 'skip');
    });
    const btn = $('[data-voice=confirm]', sheet);
    btn.disabled = invalid || ready === 0;
    btn.textContent = ready > 1 ? `Confirmar ${ready} cambios` : 'Confirmar';
  };

  sheet.addEventListener('change', (e) => {
    if (!e.target.matches('.voice-select')) return;
    rows[e.target.closest('.voice-row').dataset.i].productId = e.target.value || null;
    refresh();
  });
  wireSteppers(sheet, (input) => {
    rows[input.closest('.voice-row').dataset.i].qty = toInt(input.value);
    refresh();
  });
  sheet.addEventListener('click', async (e) => {
    const modeEl = e.target.closest('[data-voice-mode]');
    if (modeEl) {
      rows[modeEl.closest('.voice-row').dataset.i].mode = modeEl.dataset.voiceMode;
      for (const b of $$('[data-voice-mode]', modeEl.parentElement)) b.setAttribute('aria-selected', b === modeEl);
      refresh();
      return;
    }
    const action = e.target.closest('[data-voice]')?.dataset.voice;
    if (action === 'again') openVoiceSheet(text);
    if (action === 'confirm') await applyVoice(rows);
  });
  refresh();
}

async function applyVoice(rows) {
  const plan = voicePlan(rows).filter((x) => x.p && x.qty > 0);
  const aliases = loadVoiceAliases();
  for (const { row } of plan) {
    if (!row.sure || row.productId !== row.auto) aliases[row.key] = row.productId;
  }
  saveVoiceAliases(aliases);

  const totals = (mode) => {
    const sums = new Map();
    for (const { row, p, qty } of plan) if (row.mode === mode) sums.set(p.id, (sums.get(p.id) ?? 0) + qty);
    return [...sums].map(([id, qty]) => ({ id, delta: mode === 'descontar' ? -qty : qty }));
  };
  const wasListed = new Map(state.products.map((p) => [p.id, needsRestock(p)]));
  closeSheet();
  // Primero lo comprado y después lo usado: así los topes calculados en la revisión siguen valiendo.
  const added = await changeStock(totals('reponer'), 'reposicion');
  const used = await changeStock(totals('descontar'), 'consumo');
  const movs = [...added, ...used];
  render();
  if (!movs.length) { toast('No hubo cambios.'); return; }

  const describe = (list) => (list.length > 3
    ? plural(list.length, 'producto', 'productos')
    : list.map((m) => `${Math.abs(m.delta)} ${productById(m.productId)?.name ?? m.productName}`).join(', '));
  const parts = [];
  if (used.length) parts.push(`Descontado: ${describe(used)}`);
  if (added.length) parts.push(`Repuesto: ${describe(added)}`);
  const ids = [...new Set(movs.map((m) => m.productId))];
  const joined = ids.filter((id) => !wasListed.get(id) && needsRestock(productById(id))).length;
  const left = ids.filter((id) => wasListed.get(id) && !needsRestock(productById(id))).length;
  if (joined) parts.push(`${plural(joined, 'agregado', 'agregados')} a Mi lista`);
  if (left) parts.push(`${plural(left, 'quitado', 'quitados')} de Mi lista`);
  toast(parts.join(' · '), () => undoMovements(movs));
}

// ---------- Mi lista ----------

function listaHTML() {
  const items = shoppingItems();
  // El carro solo conserva productos que siguen en la lista.
  const ids = new Set(items.map((p) => p.id));
  for (const id of Object.keys(state.cart)) if (!ids.has(id)) delete state.cart[id];
  saveCart();

  const inCart = Object.keys(state.cart).length;
  const hasAnything = items.length || state.extras.length;
  const rows = items.map((p) => {
    const checked = p.id in state.cart;
    return `
      <li class="row list-row${checked ? ' checked' : ''}">
        <button type="button" class="check" data-action="toggle-cart" data-id="${p.id}" aria-pressed="${checked}" aria-label="Marcar ${esc(p.name)} en el carro">${ICONS.check}</button>
        <button type="button" class="row-text plain" data-action="toggle-cart" data-id="${p.id}">
          <span class="row-title">${esc(p.name)}</span>
          <span class="row-sub">${esc(subtitle(p))}</span>
          <span class="row-sub">Tienes ${p.stock} · sugerido <strong>${suggestedQty(p)}</strong></span>
        </button>
        ${checked
          ? `<div class="stepper compact" data-cart="${p.id}">
               <button type="button" class="step" data-cart-step="-1" data-id="${p.id}" aria-label="Restar">${ICONS.minus}</button>
               <output>${state.cart[p.id]}</output>
               <button type="button" class="step" data-cart-step="1" data-id="${p.id}" aria-label="Sumar">${ICONS.plus}</button>
             </div>`
          : `<span class="suggest">${suggestedQty(p)}</span>`}
      </li>`;
  });
  const extras = state.extras.map((x) => `
    <li class="row list-row${x.done ? ' checked' : ''}">
      <button type="button" class="check" data-action="toggle-extra" data-id="${x.id}" aria-pressed="${x.done}" aria-label="Marcar ${esc(x.text)}">${ICONS.check}</button>
      <span class="row-text"><span class="row-title">${esc(x.text)}</span></span>
      <button type="button" class="icon-btn" data-action="delete-extra" data-id="${x.id}" aria-label="Quitar ${esc(x.text)}">${ICONS.close}</button>
    </li>`);

  return `
    <header class="topbar">
      <h1>Mi lista</h1>
      ${hasAnything ? `<button type="button" class="icon-btn" data-action="share-list" aria-label="Compartir lista">${ICONS.share}</button>` : ''}
    </header>
    ${items.length
      ? `<p class="hint">Marca lo que vas echando al carro y ajusta la cantidad real. Al terminar, registra la compra.</p><ul class="list">${rows.join('')}</ul>`
      : emptyState('Todo en orden', state.products.length ? 'Ningún producto está en su nivel de reposición.' : 'Cuando agregues productos al inventario, los que se estén acabando aparecerán aquí.')}
    <h2 class="group">Otros <span>no son parte del inventario</span></h2>
    ${extras.length ? `<ul class="list">${extras.join('')}</ul>` : ''}
    <form class="inline-form" data-form="add-extra">
      <input name="text" placeholder="Ej: velas de cumpleaños" autocomplete="off" maxlength="80" aria-label="Agregar otro producto">
      <button type="submit" class="secondary">Agregar</button>
    </form>
    ${state.extras.some((x) => x.done) ? '<button type="button" class="link" data-action="clear-extras">Quitar los marcados</button>' : ''}
    ${inCart ? `<div class="footer-action"><button type="button" class="primary block" data-action="checkout">Registrar compra (${plural(inCart, 'producto', 'productos')})</button></div>` : ''}`;
}

async function checkout() {
  const entries = Object.entries(state.cart).filter(([, qty]) => qty > 0);
  if (!entries.length) return;
  const movs = await changeStock(entries.map(([id, qty]) => ({ id, delta: qty })), 'reposicion');
  state.cart = {};
  saveCart();
  render();
  const still = movs.filter((m) => needsRestock(productById(m.productId))).length;
  toast(
    `Compra registrada: ${plural(movs.length, 'producto', 'productos')}${still ? ` · ${still} sigue${still === 1 ? '' : 'n'} en la lista` : ''}`,
    () => undoMovements(movs),
  );
}

async function shareList() {
  const items = shoppingItems();
  const pending = state.extras.filter((x) => !x.done);
  const date = new Date().toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  const lines = [`Lista de compras (${date})`];
  for (const p of items) lines.push(`• ${productLabel(p)}: ${suggestedQty(p)}`);
  if (pending.length) {
    lines.push('', 'Otros:');
    for (const x of pending) lines.push(`• ${x.text}`);
  }
  const text = lines.join('\n');
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Lista copiada al portapapeles.');
  } catch (err) {
    if (err?.name !== 'AbortError') toast('No se pudo compartir la lista.');
  }
}

// ---------- Inventario ----------

function inventarioHTML() {
  const chips = [{ id: 'all', name: 'Todas' }, ...sortedRooms()];
  if (state.products.some((p) => !roomById(p.roomId))) chips.push({ id: NO_ROOM, name: 'Sin habitación' });
  return `
    <header class="topbar">
      <h1>Inventario</h1>
      <div class="topbar-actions">
        ${cloudButtonHTML()}
        <button type="button" class="icon-btn" data-action="settings" aria-label="Ajustes">${ICONS.gear}</button>
        <button type="button" class="primary small" data-action="add">${ICONS.plus}<span>Agregar</span></button>
      </div>
    </header>
    ${draftBannerHTML()}
    ${cloudNudgeHTML()}
    <input class="search" type="search" placeholder="Buscar en el inventario…" value="${esc(state.query.inventario)}" data-search="inventario" autocomplete="off">
    <div class="chips" role="tablist" aria-label="Habitación">
      ${chips.map((c) => `<button type="button" class="chip" data-action="room-filter" data-room="${c.id}" aria-selected="${state.roomFilter === c.id}">${esc(c.name)}</button>`).join('')}
    </div>
    <div id="results">${inventarioResultsHTML()}</div>`;
}

function inventarioResultsHTML() {
  if (!state.products.length) {
    return emptyState(
      'Tu inventario está vacío',
      'Agrega productos a mano o elígelos desde la lista de productos habituales.',
      '<button type="button" class="primary" data-action="add">Agregar productos</button>',
    );
  }
  const groups = [...sortedRooms(), { id: NO_ROOM, name: 'Sin habitación' }]
    .filter((r) => state.roomFilter === 'all' || state.roomFilter === r.id)
    .map((room) => {
      const products = state.products
        .filter((p) => (roomById(p.roomId) ? p.roomId : NO_ROOM) === room.id && matchesQuery(p, state.query.inventario))
        .sort(byName);
      return { room, products };
    })
    .filter((g) => g.products.length);
  if (!groups.length) return emptyState('Sin resultados', 'No hay productos que coincidan.');
  return groups.map(({ room, products }) => `
    <h2 class="group">${esc(room.name)} <span>${products.length}</span></h2>
    <ul class="list">${products.map((p) => productRow(p, { action: 'edit', withRoom: false })).join('')}</ul>`).join('');
}

function openAddSheet() {
  const soon = (title, text) => `
    <button type="button" class="option" disabled>
      <span class="option-title">${title} <span class="tag">Próximamente</span></span>
      <span class="option-text">${text}</span>
    </button>`;
  const draft = loadRecsDraft();
  const sheet = openSheet(`
    <h2>Agregar productos</h2>
    <div class="options">
      ${draft ? `
      <button type="button" class="option highlight" data-action="resume-draft">
        <span class="option-title">Continuar configuración pendiente</span>
        <span class="option-text">${plural(draft.items.length, 'producto', 'productos')} sin terminar de los productos habituales.</span>
      </button>` : ''}
      <button type="button" class="option" data-action="add-manual">
        <span class="option-title">Ingreso manual</span>
        <span class="option-text">Escribe los datos del producto.</span>
      </button>
      <button type="button" class="option" data-action="add-recs">
        <span class="option-title">Productos habituales</span>
        <span class="option-text">Elige varios de una lista de productos comunes del hogar.</span>
      </button>
      <button type="button" class="option" data-action="add-scan">
        <span class="option-title">Escanear código de barras</span>
        <span class="option-text">Busca nombre, marca, tamaño y foto automáticamente.</span>
      </button>
      ${soon('Fotografía del producto', 'Reconoce el producto desde una foto.')}
      ${soon('Escanear boleta', 'Agrega varios productos desde una boleta.')}
    </div>`);
  sheet.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'add-manual') openProductSheet(null);
    if (action === 'add-recs') openRecommendations();
    if (action === 'add-scan') scanToAdd();
    if (action === 'resume-draft') openSetupSheet(loadRecsDraft().items);
  });
}

function roomOptions(selectedId) {
  return [
    ...sortedRooms().map((r) => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${esc(r.name)}</option>`),
    `<option value="${NO_ROOM}" ${!roomById(selectedId) ? 'selected' : ''}>Sin habitación</option>`,
    '<option value="__new">+ Nueva habitación…</option>',
  ].join('');
}

// Permite crear una habitación desde cualquier <select> de habitaciones.
function wireRoomSelect(select) {
  let previous = select.value;
  select.addEventListener('change', async () => {
    if (select.value !== '__new') { previous = select.value; return; }
    const name = prompt('Nombre de la nueva habitación:');
    const room = name ? await createRoom(name) : null;
    if (!room) { select.value = previous; return; }
    for (const other of $$('select[data-room-select]')) {
      const keep = other === select ? room.id : other.value;
      other.innerHTML = roomOptions(keep);
    }
    previous = room.id;
    select.dispatchEvent(new Event('change', { bubbles: true })); // avisa al borrador del nuevo valor
  });
}

async function resizeImage(file, maxSize = 480) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MOVEMENT_LABEL = { alta: 'Agregado', consumo: 'Descontado', reposicion: 'Repuesto', ajuste: 'Ajuste manual' };

function movementLine(m, withName) {
  const when = new Date(m.at).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const sign = m.delta > 0 ? `+${m.delta}` : `${m.delta}`;
  return `
    <li class="mov">
      <span class="mov-main">${withName ? `<strong>${esc(m.productName)}</strong> · ` : ''}${MOVEMENT_LABEL[m.type] ?? m.type}</span>
      <span class="mov-delta ${m.delta < 0 ? 'neg' : 'pos'}">${sign}</span>
      <span class="mov-meta">${when} · ${m.before} → ${m.after}</span>
    </li>`;
}

function openProductSheet(product, prefill = {}) {
  const isNew = !product;
  const defaultRoom = state.roomFilter !== 'all' && roomById(state.roomFilter) ? state.roomFilter : sortedRooms()[0]?.id;
  const d = product ?? {
    name: '', brand: '', size: '', roomId: defaultRoom ?? NO_ROOM, barcode: '', photo: null, stock: 1, max: 4, reorder: 1, ...prefill,
  };
  let photo = d.photo ?? null;

  const sheet = openSheet(`
    <h2>${isNew ? 'Nuevo producto' : 'Editar producto'}</h2>
    <p class="lookup" id="lookupStatus" role="status" hidden></p>
    <form id="productForm" novalidate>
      <div class="photo-field">
        <div class="photo-preview" id="photoPreview"></div>
        <div class="photo-actions">
          <label class="secondary small file-btn"><span id="photoLabel"></span><input type="file" accept="image/*" id="photoInput" hidden></label>
          <button type="button" class="link" id="removePhoto">Quitar foto</button>
        </div>
      </div>
      <fieldset>
        <legend>Ficha</legend>
        <label>Nombre *<input name="name" value="${esc(d.name)}" required maxlength="60" autocomplete="off" placeholder="Ej: Leche"></label>
        <div class="two">
          <label>Marca<input name="brand" value="${esc(d.brand)}" maxlength="40" autocomplete="off" placeholder="Ej: Colun"></label>
          <label>Tamaño<input name="size" value="${esc(d.size)}" maxlength="30" autocomplete="off" placeholder="Ej: 1 L"></label>
        </div>
        <label>Habitación<select name="roomId" data-room-select>${roomOptions(d.roomId)}</select></label>
        <label>Código de barras<input name="barcode" value="${esc(d.barcode)}" maxlength="120" autocomplete="off" placeholder="Opcional"></label>
        <p class="muted small field-note">Si el producto tiene varios códigos (por ejemplo, dos marcas), sepáralos con coma.</p>
      </fieldset>
      <fieldset>
        <legend>Cantidades</legend>
        <div class="num-row"><span>Stock actual</span>${stepperHTML('stock', d.stock, { label: 'Stock actual' })}</div>
        <div class="num-row"><span>Stock máximo</span>${stepperHTML('max', d.max, { min: 1, label: 'Stock máximo' })}</div>
        <div class="num-row"><span>Nivel de reposición</span>${stepperHTML('reorder', d.reorder, { label: 'Nivel de reposición' })}</div>
        <p class="preview" id="levelHint"></p>
      </fieldset>
      <p class="error" id="formError" role="alert"></p>
      <button type="submit" class="primary block">Guardar</button>
      ${isNew ? '' : '<button type="button" class="danger block" id="deleteProduct">Eliminar producto</button>'}
    </form>
    ${isNew ? '' : '<section class="history"><h3>Últimos movimientos</h3><ul id="productHistory" class="movs"><li class="muted">Cargando…</li></ul></section>'}`);

  const form = $('#productForm', sheet);
  const showPhoto = () => {
    $('#photoPreview', sheet).innerHTML = photo
      ? `<img src="${photo}" alt="Foto del producto">`
      : '<span class="muted small">Sin foto</span>';
    $('#photoLabel', sheet).textContent = photo ? 'Cambiar foto' : 'Agregar foto';
    $('#removePhoto', sheet).hidden = !photo;
  };
  showPhoto();
  $('#photoInput', sheet).addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      photo = await resizeImage(file);
      showPhoto();
    } catch {
      toast('No se pudo leer la imagen.');
    }
  });
  $('#removePhoto', sheet).addEventListener('click', () => { photo = null; showPhoto(); });
  wireRoomSelect(form.elements.roomId);

  const readLevels = () => ({
    stock: toInt(form.elements.stock.value),
    max: toInt(form.elements.max.value),
    reorder: toInt(form.elements.reorder.value),
  });
  const updateHint = () => {
    const levels = readLevels();
    const error = validateLevels(levels);
    const hint = $('#levelHint', sheet);
    if (error) { hint.innerHTML = `<span class="error-text">${esc(error)}</span>`; return; }
    hint.innerHTML = needsRestock(levels)
      ? `<span class="tag low">En Mi lista</span> Sugerido comprar ${suggestedQty(levels)}.`
      : `Entrará a Mi lista cuando queden ${levels.reorder} o menos.`;
  };
  wireSteppers(form, updateHint);
  updateHint();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const data = {
      name: f.name.value.trim(),
      brand: f.brand.value.trim(),
      size: f.size.value.trim(),
      roomId: f.roomId.value === '__new' ? NO_ROOM : f.roomId.value,
      barcode: f.barcode.value.trim(),
      photo,
      ...readLevels(),
    };
    const taken = barcodesOf(data)
      .map((code) => [code, state.products.find((p) => p.id !== product?.id && hasBarcode(p, code))])
      .find(([, owner]) => owner);
    const error = !data.name ? 'El nombre es obligatorio.'
      : taken ? `El código ${taken[0]} ya pertenece a "${productLabel(taken[1])}".`
        : validateLevels(data);
    if (error) { $('#formError', sheet).textContent = error; return; }
    const duplicate = state.products.find((p) => p.id !== product?.id && normalize(productLabel(p)) === normalize(productLabel(data)));
    if (duplicate && !confirm(`Ya existe "${productLabel(duplicate)}" en el inventario. ¿Guardar de todas formas?`)) return;

    const now = Date.now();
    const saved = isNew
      ? { id: uid(), ...data, createdAt: now, updatedAt: now }
      : { ...product, ...data, updatedAt: now };
    const ops = [{ store: 'products', put: saved }];
    if (isNew) ops.push({ store: 'movements', put: movement(saved, 'alta', 0, saved.stock) });
    else if (saved.stock !== product.stock) ops.push({ store: 'movements', put: movement(saved, 'ajuste', product.stock, saved.stock) });
    await db.write(ops);
    replaceProduct(saved);
    closeSheet();
    render();
    toast(isNew ? `${saved.name} agregado al inventario.` : 'Cambios guardados.');
    // Si se escribió un código nuevo, completa con Open Food Facts lo que falte (al escanear ya se consultó).
    const previous = { barcode: product?.barcode ?? prefill.barcode ?? '' };
    const newCode = barcodesOf(saved).find((code) => !hasBarcode(previous, code));
    if (newCode) enrichFromBarcode(saved.id, newCode);
  });

  if (!isNew) {
    $('#deleteProduct', sheet).addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${productLabel(product)}" del inventario? También saldrá de Mi lista.`)) return;
      await db.write([{ store: 'products', del: product.id }]);
      state.products = state.products.filter((p) => p.id !== product.id);
      delete state.cart[product.id];
      saveCart();
      closeSheet();
      render();
      toast(`${product.name} eliminado.`, async () => {
        await db.write([{ store: 'products', put: product }]);
        replaceProduct(product);
        render();
      });
    });
    db.getAllByIndex('movements', 'productId', product.id).then((movs) => {
      const list = $('#productHistory', sheet);
      if (!list) return;
      movs.sort((a, b) => b.at - a.at);
      list.innerHTML = movs.length
        ? movs.slice(0, 15).map((m) => movementLine(m, false)).join('')
        : '<li class="muted">Sin movimientos.</li>';
    });
  }

  // Permite a quien abrió la hoja completarla después (por ejemplo, con datos de Open Food Facts).
  return {
    isOpen: () => sheetEls?.sheet === sheet,
    status(text, kind = '') {
      const el = $('#lookupStatus', sheet);
      el.hidden = !text;
      el.textContent = text;
      el.className = `lookup ${kind}`;
    },
    fillIfEmpty(fields) {
      for (const [name, value] of Object.entries(fields)) {
        if (value && !form.elements[name].value.trim()) form.elements[name].value = value;
      }
    },
    setPhotoIfEmpty(dataUrl) {
      if (photo) return;
      photo = dataUrl;
      showPhoto();
    },
  };
}

// ---------- Código de barras ----------

const LOOKUP_MESSAGES = {
  'not-found': 'No encontramos este código en Open Food Facts. Completa los datos a mano; desde ahora la app lo reconocerá.',
  offline: 'Sin conexión: completa los datos a mano.',
  timeout: 'Open Food Facts no respondió a tiempo. Completa los datos a mano.',
  error: 'No se pudo consultar Open Food Facts. Completa los datos a mano.',
};

// Hoja con la cámara. onCode(código, ui) se llama por cada código leído o escrito a mano.
function openScannerSheet({ title, hint, onCode }) {
  let scanner = null;
  const sheet = openSheet(`
    <h2>${esc(title)}</h2>
    ${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
    <div class="scanner">
      <video muted playsinline></video>
      <div class="scanner-frame" aria-hidden="true"></div>
      <button type="button" class="scanner-torch" hidden aria-label="Linterna" aria-pressed="false">${ICONS.flash}</button>
    </div>
    <p class="scan-status" id="scanStatus" role="status">Abriendo la cámara…</p>
    <div id="scanResult" aria-live="polite"></div>
    <form class="inline-form" id="manualCode">
      <input name="code" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="O escribe el número del código" aria-label="Número del código de barras">
      <button type="submit" class="secondary">Usar</button>
    </form>`, { onClose: () => scanner?.stop() });

  const ui = {
    sheet,
    status: (text) => { $('#scanStatus', sheet).textContent = text; },
    result: (html) => { $('#scanResult', sheet).innerHTML = html; },
  };
  let last = { code: '', seen: 0 };
  const handle = (raw, { manual = false } = {}) => {
    const code = String(raw).trim();
    if (!code) return;
    const now = Date.now();
    // Mientras el mismo código siga frente a la cámara no se vuelve a contar;
    // cuenta de nuevo solo si dejó de verse un momento (por ejemplo, el siguiente envase igual).
    if (!manual && code === last.code && now - last.seen < 1200) {
      last.seen = now;
      return;
    }
    last = { code, seen: now };
    navigator.vibrate?.(60);
    onCode(code, ui);
  };

  scanner = createScanner($('video', sheet), handle);
  scanner.start()
    .then((torch) => {
      if (sheetEls?.sheet !== sheet) return;
      ui.status('Apunta al código de barras y mantenlo dentro del recuadro.');
      const torchBtn = $('.scanner-torch', sheet);
      if (!torch) return;
      torchBtn.hidden = false;
      torchBtn.addEventListener('click', () => {
        const on = torchBtn.getAttribute('aria-pressed') !== 'true';
        torchBtn.setAttribute('aria-pressed', String(on));
        torch(on).catch(() => {});
      });
    })
    .catch((err) => {
      if (sheetEls?.sheet !== sheet) return;
      $('.scanner', sheet).classList.add('off');
      ui.status(cameraErrorMessage(err));
    });

  $('#manualCode', sheet).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.code;
    handle(input.value, { manual: true });
    input.value = '';
  });
  return ui;
}

function scanToAdd() {
  openScannerSheet({
    title: 'Escanear código',
    hint: 'Apunta la cámara al código de barras del producto nuevo.',
    onCode: (code) => {
      closeSheet();
      addByBarcode(code);
    },
  });
}

async function fetchPhoto(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await resizeImage(await res.blob()) : null;
  } catch {
    return null;
  }
}

async function addByBarcode(code) {
  const existing = findByBarcode(code);
  if (existing) {
    openProductSheet(existing);
    toast(`${existing.name} ya está en tu inventario.`);
    return;
  }
  const editor = openProductSheet(null, { barcode: code });
  editor.status('Buscando el producto en Open Food Facts…');
  const info = await lookupProduct(code);
  if (!editor.isOpen()) return;
  if (info.status !== 'found') {
    editor.status(LOOKUP_MESSAGES[info.status], 'warn');
    return;
  }
  editor.fillIfEmpty({ name: info.name, brand: info.brand, size: info.size });
  editor.status('Datos sugeridos por Open Food Facts. Revísalos y completa las cantidades.', 'ok');
  if (info.imageUrl) {
    const photo = await fetchPhoto(info.imageUrl);
    if (photo && editor.isOpen()) editor.setPhotoIfEmpty(photo);
  }
}

// Completa con Open Food Facts solo los datos que le faltan a un producto existente.
// Nunca reemplaza lo que el usuario escribió; si no hay internet o no se encuentra, no hace nada.
async function enrichFromBarcode(id, code) {
  const missing = (p) => ({ brand: !p.brand, size: !p.size, photo: !p.photo });
  const before = productById(id);
  if (!before || !Object.values(missing(before)).some(Boolean)) return;
  const info = await lookupProduct(code);
  if (info.status !== 'found') return;
  const photo = missing(before).photo && info.imageUrl ? await fetchPhoto(info.imageUrl) : null;

  const current = productById(id); // puede haber cambiado mientras se consultaba
  if (!current) return;
  const gaps = missing(current);
  const patch = {};
  if (gaps.brand && info.brand) patch.brand = info.brand;
  if (gaps.size && info.size) patch.size = info.size;
  if (gaps.photo && photo) patch.photo = photo;
  if (!Object.keys(patch).length) return;

  const updated = { ...current, ...patch, updatedAt: Date.now() };
  await db.write([{ store: 'products', put: updated }]);
  replaceProduct(updated);
  render();
  const names = { brand: 'marca', size: 'tamaño', photo: 'foto' };
  const list = Object.keys(patch).map((k) => names[k]);
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} y ${list.at(-1)}` : list[0];
  toastWhenFree(`${updated.name}: se agregó ${joined} desde Open Food Facts.`);
}

// Escaneo continuo desde Inicio: cada código descuenta o suma 1 unidad.
function scanStock() {
  const descontar = state.mode === 'descontar';
  const delta = descontar ? -1 : 1;
  let paused = false;
  let pendingCode = '';
  let lastMovs = null;
  const ui = openScannerSheet({
    title: descontar ? 'Descontar escaneando' : 'Reponer escaneando',
    hint: descontar ? 'Cada código que escanees descuenta 1 unidad.' : 'Cada código que escanees suma 1 unidad.',
    onCode: async (code) => {
      if (paused) return;
      const p = findByBarcode(code);
      if (!p) {
        paused = true;
        pendingCode = code;
        ui.result(`
          <div class="scan-card warn">
            <p>El código <strong>${esc(code)}</strong> no está en tu inventario.</p>
            <div class="scan-actions">
              <button type="button" class="primary small" data-scan="assign">Es un producto que ya tengo</button>
              <button type="button" class="secondary small" data-scan="create">Crear producto nuevo</button>
              <button type="button" class="link" data-scan="continue">Seguir escaneando</button>
            </div>
          </div>`);
        return;
      }
      if (descontar && p.stock === 0) {
        ui.result(`<div class="scan-card warn"><p>No queda stock de <strong>${esc(p.name)}</strong>.</p></div>`);
        return;
      }
      const movs = await changeStock([{ id: p.id, delta }], descontar ? 'consumo' : 'reposicion');
      lastMovs = movs;
      render();
      const now = productById(p.id);
      ui.result(`
        <div class="scan-card ok">
          <p><strong>${esc(productLabel(now))}</strong> ${delta < 0 ? '−1' : '+1'} · quedan ${now.stock}${needsRestock(now) ? ' · <span class="tag low">en Mi lista</span>' : ''}</p>
          <button type="button" class="link" data-scan="undo">Deshacer</button>
        </div>`);
    },
  });

  ui.sheet.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-scan]')?.dataset.scan;
    if (action === 'undo' && lastMovs) {
      await undoMovements(lastMovs);
      lastMovs = null;
      ui.result('<div class="scan-card"><p>Deshecho.</p></div>');
    } else if (action === 'continue') {
      paused = false;
      ui.result('');
    } else if (action === 'create') {
      closeSheet();
      addByBarcode(pendingCode);
    } else if (action === 'assign') {
      closeSheet();
      openAssignSheet(pendingCode, delta);
    }
  });
}

// Asocia un código desconocido a un producto existente (por ejemplo, los creados desde productos habituales).
function openAssignSheet(code, delta = 0) {
  const sheet = openSheet(`
    <h2>¿Qué producto es?</h2>
    <p class="muted">Elige el producto con el código <strong>${esc(code)}</strong>. Desde ahora la app lo reconocerá al escanear.</p>
    <input class="search" type="search" placeholder="Buscar producto…" autocomplete="off" id="assignSearch">
    <ul class="list" id="assignList"></ul>`);
  const list = $('#assignList', sheet);
  const draw = () => {
    const found = state.products.filter((p) => matchesQuery(p, $('#assignSearch', sheet).value)).sort(byName);
    list.innerHTML = found.length
      ? found.map((p) => productRow(p, { action: 'assign' })).join('')
      : '<li class="row empty-row">Sin resultados.</li>';
  };
  draw();
  $('#assignSearch', sheet).addEventListener('input', draw);
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action=assign]');
    if (!btn) return;
    const p = productById(btn.dataset.id);
    const updated = { ...p, barcode: addBarcode(p.barcode, code), updatedAt: Date.now() };
    await db.write([{ store: 'products', put: updated }]);
    replaceProduct(updated);
    closeSheet();
    enrichFromBarcode(updated.id, code);
    if (delta && !(delta < 0 && updated.stock === 0)) {
      await applyStock(updated.id, delta);
    } else {
      render();
      toast(`Código asignado a ${updated.name}.`);
    }
  });
}

function openRecommendations() {
  const existing = new Set(state.products.map((p) => normalize(p.name)));
  const pending = new Set((loadRecsDraft()?.items ?? []).map((x) => normalize(x.name)));
  const status = (r) => (existing.has(normalize(r.name)) ? 'ya está' : pending.has(normalize(r.name)) ? 'pendiente' : '');
  const rooms = [...new Set(RECOMMENDATIONS.map((r) => r.room))];
  const sheet = openSheet(`
    <h2>Productos habituales</h2>
    <p class="muted">Marca los que normalmente tienes en casa. En el siguiente paso ajustas cantidades.</p>
    <form id="recsForm">
      ${rooms.map((room) => `
        <h3 class="group">${esc(room)}</h3>
        <div class="check-grid">
          ${RECOMMENDATIONS.map((r, i) => (r.room !== room ? '' : `
            <label class="check-item${status(r) ? ' disabled' : ''}">
              <input type="checkbox" name="rec" value="${i}" ${status(r) ? 'disabled' : ''}>
              <span>${esc(r.name)}${status(r) ? ` <small>(${status(r)})</small>` : ''}</span>
            </label>`)).join('')}
        </div>`).join('')}
      <div class="sheet-footer"><button type="submit" class="primary block" disabled>Continuar</button></div>
    </form>`, { wide: true });
  const form = $('#recsForm', sheet);
  const submit = $('button[type=submit]', form);
  form.addEventListener('change', () => {
    const n = $$('input[name=rec]:checked', form).length;
    submit.disabled = n === 0;
    submit.textContent = n ? `Continuar (${n})` : 'Continuar';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const picked = $$('input[name=rec]:checked', form).map((el) => RECOMMENDATIONS[Number(el.value)]);
    openRecommendationSetup(picked);
  });
}

// Convierte las recomendaciones elegidas en ítems del borrador y los suma a lo pendiente.
async function openRecommendationSetup(picked) {
  const roomIds = {};
  for (const name of new Set(picked.map((r) => r.room))) roomIds[name] = (await createRoom(name)).id;
  const items = loadRecsDraft()?.items ?? [];
  const pending = new Set(items.map((x) => normalize(x.name)));
  for (const r of picked) {
    if (pending.has(normalize(r.name))) continue;
    items.push({
      name: r.name, brand: '', size: r.size ?? '', roomId: roomIds[r.room], stock: r.max, max: r.max, reorder: r.reorder,
    });
  }
  saveRecsDraft(items);
  openSetupSheet(items);
}

function setupCardHTML(item) {
  return `
    <fieldset class="setup-card">
      <div class="setup-card-head">
        <label>Nombre *<input name="name" value="${esc(item.name)}" maxlength="60" autocomplete="off"></label>
        <button type="button" class="link danger-text" data-remove-card>Quitar</button>
      </div>
      <div class="two">
        <label>Marca<input name="brand" value="${esc(item.brand)}" maxlength="40" autocomplete="off"></label>
        <label>Tamaño<input name="size" value="${esc(item.size)}" maxlength="30" autocomplete="off"></label>
      </div>
      <label>Habitación<select name="roomId" data-room-select>${roomOptions(item.roomId)}</select></label>
      <div class="three">
        <div class="field"><span>Stock actual</span>${stepperHTML('stock', item.stock, { label: 'Stock actual' })}</div>
        <div class="field"><span>Máximo</span>${stepperHTML('max', item.max, { min: 1, label: 'Stock máximo' })}</div>
        <div class="field"><span>Reposición</span>${stepperHTML('reorder', item.reorder, { label: 'Nivel de reposición' })}</div>
      </div>
      <p class="error" role="alert"></p>
    </fieldset>`;
}

// Hoja de configuración: cada cambio se guarda en el borrador, así nada se pierde si la app se cierra.
function openSetupSheet(items) {
  const title = (n) => `Configura ${plural(n, 'producto', 'productos')}`;
  const button = (n) => `Agregar ${plural(n, 'producto', 'productos')}`;
  const sheet = openSheet(`
    <h2 id="setupTitle">${title(items.length)}</h2>
    <p class="muted">Ajusta el stock actual a lo que tienes hoy. Marca y tamaño son opcionales.
      Tu avance se guarda solo: si la app se cierra, puedes continuar después.</p>
    <form id="setupForm" novalidate>
      <div id="setupCards">${items.map(setupCardHTML).join('')}</div>
      <div class="sheet-footer"><button type="submit" class="primary block">${button(items.length)}</button></div>
    </form>`, {
    wide: true,
    onClose: () => {
      const draft = loadRecsDraft();
      if (draft) {
        render();
        toast(`Avance guardado: ${plural(draft.items.length, 'producto pendiente', 'productos pendientes')}.`);
      }
    },
  });
  const form = $('#setupForm', sheet);
  const cards = () => $$('.setup-card', form);
  const readCard = (card) => {
    const get = (name) => $(`[name=${name}]`, card).value;
    return {
      name: get('name').trim(),
      brand: get('brand').trim(),
      size: get('size').trim(),
      roomId: get('roomId') === '__new' ? NO_ROOM : get('roomId'),
      stock: get('stock'),
      max: get('max'),
      reorder: get('reorder'),
    };
  };
  const persist = () => {
    const n = cards().length;
    $('#setupTitle', sheet).textContent = title(n);
    $('button[type=submit]', form).textContent = button(n);
    saveRecsDraft(cards().map(readCard));
  };

  wireSteppers(form, persist);
  form.addEventListener('input', persist);
  form.addEventListener('change', persist);
  $$('select[data-room-select]', form).forEach(wireRoomSelect);
  form.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-card]');
    if (!remove) return;
    remove.closest('.setup-card').remove();
    if (cards().length) {
      persist();
    } else {
      clearRecsDraft();
      closeSheet();
      render();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = Date.now();
    const products = [];
    let firstError = null;
    for (const card of cards()) {
      const raw = readCard(card);
      const data = {
        ...raw, barcode: '', photo: null, stock: toInt(raw.stock), max: toInt(raw.max), reorder: toInt(raw.reorder),
      };
      const error = !data.name ? 'El nombre es obligatorio.' : validateLevels(data);
      $('.error', card).textContent = error ?? '';
      if (error) { firstError ??= card; continue; }
      products.push({ id: uid(), ...data, createdAt: now, updatedAt: now });
    }
    if (firstError) { firstError.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    await db.write(products.flatMap((p) => [
      { store: 'products', put: p },
      { store: 'movements', put: movement(p, 'alta', 0, p.stock) },
    ]));
    products.forEach(replaceProduct);
    clearRecsDraft();
    closeSheet();
    state.view = 'inventario';
    render();
    toast(`${plural(products.length, 'producto agregado', 'productos agregados')} al inventario.`);
  });
}

function draftBannerHTML() {
  const draft = loadRecsDraft();
  if (!draft) return '';
  return `
    <div class="banner draft">
      <span>Tienes ${plural(draft.items.length, 'producto', 'productos')} sin terminar de configurar.</span>
      <span class="banner-actions">
        <button type="button" class="link" data-action="discard-draft">Descartar</button>
        <button type="button" class="primary small" data-action="resume-draft">Continuar</button>
      </span>
    </div>`;
}

// ---------- Ajustes, historial y respaldo ----------

function openSettings() {
  const counts = new Map();
  for (const p of state.products) counts.set(p.roomId, (counts.get(p.roomId) ?? 0) + 1);
  const sheet = openSheet(`
    <h2>Ajustes</h2>
    <section class="settings-section">
      <h3>Copia en la nube</h3>
      <p class="cloud-status" data-cloud-indicator data-state="${cloudStatus().kind}"><span class="dot"></span><span data-cloud-text>${esc(cloudStatus().text)}</span></p>
      ${FIREBASE_CONFIG ? `<button type="button" class="secondary block" data-action="account">${cloudState.user ? 'Administrar cuenta' : 'Activar copia en la nube'}</button>` : ''}
    </section>
    <section class="settings-section">
      <h3>Habitaciones</h3>
      <ul class="list">
        ${sortedRooms().map((r) => `
          <li class="row room-row">
            <span class="row-text"><span class="row-title">${esc(r.name)}</span><span class="row-sub">${plural(counts.get(r.id) ?? 0, 'producto', 'productos')}</span></span>
            <button type="button" class="link" data-action="rename-room" data-id="${r.id}">Renombrar</button>
            <button type="button" class="link danger-text" data-action="delete-room" data-id="${r.id}">Eliminar</button>
          </li>`).join('')}
      </ul>
      <form class="inline-form" id="addRoomForm">
        <input name="name" placeholder="Nueva habitación" maxlength="30" autocomplete="off" aria-label="Nueva habitación">
        <button type="submit" class="secondary">Agregar</button>
      </form>
    </section>
    <section class="settings-section">
      <h3>Historial</h3>
      <button type="button" class="secondary block" data-action="history">Ver todos los movimientos</button>
    </section>
    <section class="settings-section">
      <h3>Respaldo</h3>
      <p class="muted">${cloudState.user
        ? 'Tus datos ya se guardan en tu cuenta. El respaldo es una copia adicional en un archivo.'
        : 'Tus datos se guardan solo en este teléfono. Exporta un respaldo de vez en cuando (por ejemplo a iCloud Drive o Google Drive).'}</p>
      <div class="two">
        <button type="button" class="secondary" data-action="export">Exportar</button>
        <label class="secondary file-btn">Importar<input type="file" accept="application/json,.json" id="importInput" hidden></label>
      </div>
    </section>
    <p class="muted small center">Despensa ${APP_VERSION} · <span id="persistInfo"></span></p>`);

  navigator.storage?.persisted?.().then((ok) => {
    const info = $('#persistInfo', sheet);
    if (info) info.textContent = ok ? 'almacenamiento protegido' : 'instálala en la pantalla de inicio para proteger tus datos';
  });

  $('#addRoomForm', sheet).addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.elements.name;
    if (!input.value.trim()) return;
    await createRoom(input.value);
    render();
    openSettings();
  });

  sheet.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const room = roomById(btn.dataset.id);
    switch (btn.dataset.action) {
      case 'rename-room': {
        const name = prompt('Nuevo nombre:', room.name)?.trim();
        if (!name || name === room.name) return;
        const updated = { ...room, name };
        await db.write([{ store: 'rooms', put: updated }]);
        Object.assign(room, updated);
        render();
        openSettings();
        break;
      }
      case 'delete-room': {
        const affected = state.products.filter((p) => p.roomId === room.id);
        const message = affected.length
          ? `¿Eliminar "${room.name}"? Sus ${plural(affected.length, 'producto quedará', 'productos quedarán')} sin habitación.`
          : `¿Eliminar "${room.name}"?`;
        if (!confirm(message)) return;
        const moved = affected.map((p) => ({ ...p, roomId: NO_ROOM, updatedAt: Date.now() }));
        await db.write([{ store: 'rooms', del: room.id }, ...moved.map((p) => ({ store: 'products', put: p }))]);
        state.rooms = state.rooms.filter((r) => r.id !== room.id);
        moved.forEach(replaceProduct);
        if (state.roomFilter === room.id) state.roomFilter = 'all';
        render();
        openSettings();
        break;
      }
      case 'history':
        openHistory();
        break;
      case 'account':
        openAccountSheet();
        break;
      case 'export':
        exportBackup();
        break;
      default:
    }
  });

  $('#importInput', sheet).addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importBackup(file);
    e.target.value = '';
  });
}

async function openHistory() {
  const sheet = openSheet('<h2>Historial</h2><ul class="movs" id="allHistory"><li class="muted">Cargando…</li></ul>');
  const movs = (await db.getAll('movements')).sort((a, b) => b.at - a.at);
  $('#allHistory', sheet).innerHTML = movs.length
    ? movs.slice(0, 300).map((m) => movementLine(m, true)).join('')
    : '<li class="muted">Aún no hay movimientos.</li>';
}

async function exportBackup() {
  const data = { app: 'despensa', version: 1, exportedAt: new Date().toISOString() };
  for (const store of db.STORES) data[store] = await db.getAll(store);
  const name = `despensa-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Respaldo Despensa' });
      return;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('El archivo no es un respaldo válido.');
    return;
  }
  if (data?.app !== 'despensa' || !db.STORES.every((s) => Array.isArray(data[s]))) {
    toast('El archivo no es un respaldo de Despensa.');
    return;
  }
  if (!confirm(`Esto reemplazará todos tus datos actuales por el respaldo (${plural(data.products.length, 'producto', 'productos')}). ¿Continuar?`)) return;
  await db.write(db.STORES.flatMap((store) => [
    { store, clear: true },
    ...data[store].map((value) => ({ store, put: value })),
  ]));
  await loadAll();
  state.cart = {};
  saveCart();
  closeSheet();
  render();
  toast('Respaldo importado.');
}

// ---------- Copia en la nube ----------
// El teléfono sigue siendo la fuente principal. Con una cuenta activa, cada cambio se copia a Firebase
// y los cambios hechos desde otro teléfono con la misma cuenta llegan aquí.

const CLOUD_UID_KEY = 'despensa.cloudUid';
const CLOUD_NUDGE_KEY = 'despensa.cloudNudgeUntil';
const cloudState = { loaded: false, error: '', user: null };
let cloud = null;
let earlyOps = []; // cambios hechos mientras la nube aún se estaba cargando

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento local */
  }
}

db.onWrite((ops) => {
  if (cloud && cloudState.user) cloud.push(ops);
  else if (FIREBASE_CONFIG && readKey(CLOUD_UID_KEY)) earlyOps.push(...ops);
});

function cloudStatus() {
  if (!FIREBASE_CONFIG) return { kind: 'off', text: 'La copia en la nube aún no está configurada.' };
  if (cloudState.error) return { kind: 'error', text: cloudState.error };
  if (!cloudState.user) return { kind: 'off', text: 'Desactivada: tus datos están solo en este teléfono.' };
  if (!navigator.onLine) return { kind: 'pending', text: 'Sin conexión: los cambios se subirán cuando vuelva internet.' };
  if (cloud.hasPendingWrites()) return { kind: 'pending', text: 'Subiendo cambios…' };
  return { kind: 'ok', text: 'Todo está guardado en tu cuenta.' };
}

// Actualiza los indicadores sin redibujar la pantalla (no interrumpe lo que se esté escribiendo).
function updateCloudIndicators() {
  const status = cloudStatus();
  for (const el of $$('[data-cloud-indicator]')) el.dataset.state = status.kind;
  for (const el of $$('[data-cloud-text]')) el.textContent = status.text;
}

function cloudButtonHTML() {
  if (!FIREBASE_CONFIG) return '';
  return `<button type="button" class="icon-btn cloud-btn" data-action="account" data-cloud-indicator data-state="${cloudStatus().kind}" aria-label="Copia en la nube">${ICONS.cloud}</button>`;
}

function cloudNudgeHTML() {
  if (!FIREBASE_CONFIG || !cloudState.loaded || cloudState.user || !state.products.length) return '';
  if (Number(readKey(CLOUD_NUDGE_KEY) ?? 0) > Date.now()) return '';
  return `
    <div class="banner draft cloud-nudge">
      <span>Activa la copia en la nube para no perder tu inventario si cambias de teléfono.</span>
      <span class="banner-actions">
        <button type="button" class="link" data-action="snooze-cloud">Ahora no</button>
        <button type="button" class="primary small" data-action="account">Activar</button>
      </span>
    </div>`;
}

async function initCloud() {
  if (!FIREBASE_CONFIG) return;
  try {
    cloud = await import('./cloud.js');
    cloud.init(FIREBASE_CONFIG, { onStatus: updateCloudIndicators });
    const user = await cloud.ready();
    cloudState.loaded = true;
    if (!user) {
      earlyOps = [];
    } else if (readKey(CLOUD_UID_KEY) === user.uid) {
      cloudState.user = user;
      const ops = earlyOps;
      earlyOps = [];
      await cloud.push(ops);
      startListening();
    } else {
      await linkAccount(user); // sesión abierta pero sin terminar de vincular (por ejemplo, se cortó internet)
    }
  } catch (err) {
    console.warn(err);
    cloudState.error = 'No se pudo conectar con la nube. Tus datos siguen guardados en el teléfono.';
  }
  render();
}

function startListening() {
  cloud.listen(applyRemote, (err) => {
    console.warn(err);
    cloudState.error = 'Se perdió la conexión con la nube. Cierra y vuelve a abrir la app.';
    updateCloudIndicators();
  });
}

// Compara dos objetos sin importar el orden de sus campos.
const stable = (value) => JSON.stringify(value, (_, v) => (
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v
));

async function applyRemote(store, { full, ops }) {
  const local = state[store];
  let changes = ops;
  if (full) {
    if (!full.length && local.length) {
      // La nube está vacía pero el teléfono no: nunca se borra lo local; se vuelve a subir.
      cloud.push(local.map((value) => ({ store, put: value })));
      return;
    }
    const remoteIds = new Set(full.map((x) => x.id));
    changes = [
      ...local.filter((x) => !remoteIds.has(x.id)).map((x) => ({ store, del: x.id })),
      ...full.map((x) => ({ store, put: x })),
    ];
  }
  changes = changes.filter((op) => {
    const current = local.find((x) => x.id === ('del' in op ? op.del : op.put.id));
    return 'del' in op ? !!current : !current || stable(current) !== stable(op.put);
  });
  if (!changes.length) return;
  await db.write(changes, { silent: true });
  for (const op of changes) {
    if ('del' in op) {
      state[store] = state[store].filter((x) => x.id !== op.del);
    } else {
      const i = state[store].findIndex((x) => x.id === op.put.id);
      if (i >= 0) state[store][i] = op.put;
      else state[store].push(op.put);
    }
  }
  if (store === 'extras') state.extras.sort((a, b) => a.createdAt - b.createdAt);
  if (store === 'rooms' && state.roomFilter !== 'all' && state.roomFilter !== NO_ROOM && !roomById(state.roomFilter)) {
    state.roomFilter = 'all';
  }
  render();
}

// Une los datos del teléfono con los de la cuenta la primera vez que se entra.
async function linkAccount(user) {
  const remote = await cloud.fetchAll();
  const localMovements = await db.getAll('movements');
  const pristine = !state.products.length && !state.extras.length;
  const remoteHasData = db.STORES.some((store) => remote[store].length);
  const ops = [];
  let upload = [];

  if (pristine && remoteHasData) {
    // Teléfono nuevo: se usa lo que hay en la cuenta.
    for (const store of db.STORES) ops.push({ store, clear: true });
  } else {
    // Se suben los datos del teléfono. Las habitaciones con el mismo nombre se unen para no duplicarlas.
    const twins = new Map();
    for (const room of state.rooms) {
      const twin = remote.rooms.find((r) => normalize(r.name) === normalize(room.name));
      if (twin) twins.set(room.id, twin.id);
    }
    const remap = (p) => (twins.has(p.roomId) ? { ...p, roomId: twins.get(p.roomId) } : p);
    upload = [
      ...state.rooms.filter((r) => !twins.has(r.id)).map((r) => ({ store: 'rooms', put: r })),
      ...state.products.map((p) => ({ store: 'products', put: remap(p) })),
      ...state.extras.map((x) => ({ store: 'extras', put: x })),
      ...localMovements.map((m) => ({ store: 'movements', put: m })),
    ];
    ops.push(...[...twins.keys()].map((id) => ({ store: 'rooms', del: id })));
  }
  for (const store of db.STORES) for (const value of remote[store]) ops.push({ store, put: value });
  ops.push(...upload);

  await db.write(ops, { silent: true });
  cloudState.user = user;
  cloudState.error = '';
  writeKey(CLOUD_UID_KEY, user.uid);
  earlyOps = [];
  await cloud.push(upload);
  await loadAll();
  if (!state.rooms.length) await seedRooms();
  startListening();
  render();
}

function cloudErrorMessage(err) {
  if (err?.code === 'permission-denied') return 'Firebase rechazó el acceso: revisa las reglas de Firestore.';
  if (err?.code === 'unavailable') return 'Sin conexión a internet.';
  return cloud?.authErrorMessage(err) ?? 'No se pudo conectar con la nube.';
}

function openAccountSheet() {
  if (!FIREBASE_CONFIG) {
    openSheet('<h2>Copia en la nube</h2><p class="muted">La copia en la nube aún no está configurada.</p>');
    return;
  }
  const user = cloudState.user;
  const status = cloudStatus();
  const sheet = openSheet(user ? `
    <h2>Copia en la nube</h2>
    <p>Conectado como <strong>${esc(user.email)}</strong></p>
    <p class="cloud-status" data-cloud-indicator data-state="${status.kind}"><span class="dot"></span><span data-cloud-text>${esc(status.text)}</span></p>
    <p class="muted small">Cada cambio se guarda en tu cuenta. Si cambias de teléfono, instala la app y entra con este correo para recuperar tu inventario.</p>
    <button type="button" class="secondary block" data-action="logout">Cerrar sesión</button>
    <p class="muted small">Al cerrar sesión se borran los datos de este teléfono; siguen guardados en tu cuenta.</p>` : `
    <h2>Copia en la nube</h2>
    <p class="muted">Guarda tu inventario en tu cuenta para no perderlo si cambias o pierdes el teléfono. Cada cuenta tiene su propio inventario.</p>
    ${cloudState.error ? `<p class="error">${esc(cloudState.error)}</p>` : ''}
    <form id="authForm" novalidate>
      <label>Correo<input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" required></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
      <p class="error" id="authError" role="alert"></p>
      <div class="two">
        <button type="submit" class="primary" data-mode="signin">Entrar</button>
        <button type="submit" class="secondary" data-mode="signup">Crear cuenta</button>
      </div>
      <button type="button" class="link" data-action="reset-password">Olvidé mi contraseña</button>
    </form>
    <p class="muted small">Al entrar, los productos que ya tienes en este teléfono se suben a tu cuenta.</p>`);

  sheet.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') await logoutCloud();
    if (action === 'reset-password') {
      const email = $('#authForm', sheet).elements.email.value.trim();
      const error = $('#authError', sheet);
      if (!email) { error.textContent = 'Escribe tu correo y vuelve a tocar "Olvidé mi contraseña".'; return; }
      try {
        await cloud.resetPassword(email);
        error.textContent = '';
        toast('Te enviamos un correo para crear una nueva contraseña.');
      } catch (err) {
        error.textContent = cloudErrorMessage(err);
      }
    }
  });

  $('#authForm', sheet)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const mode = e.submitter?.dataset.mode ?? 'signin';
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    const error = $('#authError', sheet);
    if (!email || !password) { error.textContent = 'Escribe tu correo y contraseña.'; return; }
    if (!cloud) { error.textContent = 'No se pudo cargar la nube. Revisa tu conexión y vuelve a abrir la app.'; return; }
    const buttons = $$('button', form);
    buttons.forEach((b) => { b.disabled = true; });
    error.textContent = '';
    e.submitter.textContent = 'Conectando…';
    try {
      const cred = mode === 'signup' ? await cloud.signUp(email, password) : await cloud.signIn(email, password);
      await linkAccount(cred.user);
      closeSheet();
      toast(mode === 'signup' ? 'Cuenta creada: tu inventario ya está en la nube.' : 'Listo: tu inventario está sincronizado.');
    } catch (err) {
      console.warn(err);
      error.textContent = cloudErrorMessage(err);
      buttons.forEach((b) => { b.disabled = false; });
      $('[data-mode=signin]', form).textContent = 'Entrar';
      $('[data-mode=signup]', form).textContent = 'Crear cuenta';
    }
  });
}

async function logoutCloud() {
  if (!confirm('Se borrarán los datos de este teléfono; seguirán guardados en tu cuenta. ¿Cerrar sesión?')) return;
  try {
    await cloud.flush();
  } catch {
    toast('Hay cambios que aún no se suben a la nube. Conéctate a internet e intenta de nuevo.');
    return;
  }
  await cloud.logout();
  writeKey(CLOUD_UID_KEY, null);
  writeKey(CART_KEY, null);
  writeKey(RECS_DRAFT_KEY, null);
  await db.write(db.STORES.map((store) => ({ store, clear: true })), { silent: true });
  location.reload();
}

// ---------- Eventos de las vistas ----------

function bindEvents() {
  $('.tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) go(tab.dataset.view);
  });

  const view = $('#view');
  view.addEventListener('input', (e) => {
    const key = e.target.dataset.search;
    if (!key) return;
    state.query[key] = e.target.value;
    $('#results').innerHTML = key === 'inicio' ? inicioResultsHTML() : inventarioResultsHTML();
  });

  view.addEventListener('submit', async (e) => {
    if (e.target.dataset.form !== 'add-extra') return;
    e.preventDefault();
    const text = e.target.elements.text.value.trim();
    if (!text) return;
    const extra = { id: uid(), text, done: false, createdAt: Date.now() };
    await db.write([{ store: 'extras', put: extra }]);
    state.extras.push(extra);
    render();
    $('[data-form=add-extra] input')?.focus();
  });

  view.addEventListener('click', async (e) => {
    const cartStep = e.target.closest('[data-cart-step]');
    if (cartStep) {
      const id = cartStep.dataset.id;
      state.cart[id] = Math.max(1, (state.cart[id] ?? 1) + Number(cartStep.dataset.cartStep));
      saveCart();
      render();
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { id } = btn.dataset;
    switch (btn.dataset.action) {
      case 'go': go(btn.dataset.view); break;
      case 'mode':
        state.mode = btn.dataset.mode;
        render();
        break;
      case 'quick': await applyStock(id, state.mode === 'descontar' ? -1 : 1); break;
      case 'qty': openQtySheet(productById(id)); break;
      case 'edit': openProductSheet(productById(id)); break;
      case 'add': openAddSheet(); break;
      case 'scan-stock': scanStock(); break;
      case 'voice': openVoiceSheet(); break;
      case 'resume-draft': openSetupSheet(loadRecsDraft()?.items ?? []); break;
      case 'discard-draft':
        if (!confirm('¿Descartar los productos que no terminaste de configurar?')) return;
        clearRecsDraft();
        render();
        break;
      case 'settings': openSettings(); break;
      case 'account': openAccountSheet(); break;
      case 'snooze-cloud':
        writeKey(CLOUD_NUDGE_KEY, String(Date.now() + 7 * 24 * 3600 * 1000));
        render();
        break;
      case 'room-filter':
        state.roomFilter = btn.dataset.room;
        render();
        break;
      case 'toggle-cart':
        if (id in state.cart) delete state.cart[id];
        else state.cart[id] = suggestedQty(productById(id));
        saveCart();
        render();
        break;
      case 'checkout': await checkout(); break;
      case 'share-list': await shareList(); break;
      case 'toggle-extra': {
        const extra = state.extras.find((x) => x.id === id);
        extra.done = !extra.done;
        await db.write([{ store: 'extras', put: extra }]);
        render();
        break;
      }
      case 'delete-extra':
        await db.write([{ store: 'extras', del: id }]);
        state.extras = state.extras.filter((x) => x.id !== id);
        render();
        break;
      case 'clear-extras': {
        const done = state.extras.filter((x) => x.done);
        await db.write(done.map((x) => ({ store: 'extras', del: x.id })));
        state.extras = state.extras.filter((x) => !x.done);
        render();
        break;
      }
      default:
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

// ---------- Arranque ----------

async function init() {
  try {
    await loadAll();
    if (!state.rooms.length) await seedRooms();
  } catch (err) {
    $('#view').innerHTML = emptyState('No se pudo abrir la base de datos', String(err?.message ?? err));
    return;
  }
  bindEvents();
  render();
  navigator.storage?.persist?.().catch(() => {});
  window.addEventListener('online', updateCloudIndicators);
  window.addEventListener('offline', updateCloudIndicators);
  initCloud();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
