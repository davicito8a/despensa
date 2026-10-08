import * as db from './db.js';
import {
  uid, needsRestock, suggestedQty, validateLevels, normalize, productLabel, matchesQuery, byName,
} from './logic.js';
import { RECOMMENDATIONS } from './recommendations.js';

const APP_VERSION = '1.0.0';
const DEFAULT_ROOMS = ['Cocina', 'Baño', 'Dormitorio', 'Lavandería', 'Bodega'];
const CART_KEY = 'despensa.cart';
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

const roomById = (id) => state.rooms.find((r) => r.id === id);
const roomName = (id) => roomById(id)?.name ?? 'Sin habitación';
const sortedRooms = () => [...state.rooms].sort((a, b) => a.order - b.order || byName(a, b));
const productById = (id) => state.products.find((p) => p.id === id);
const shoppingItems = () => {
  const order = new Map(sortedRooms().map((r, i) => [r.id, i]));
  return state.products
    .filter(needsRestock)
    .sort((a, b) => (order.get(a.roomId) ?? 999) - (order.get(b.roomId) ?? 999) || byName(a, b));
};

const ICONS = {
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

let sheetEls = null;
function openSheet(html, { wide = false } = {}) {
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
  sheetEls = { backdrop, sheet };
  return sheet;
}

function closeSheet() {
  if (!sheetEls) return;
  sheetEls.backdrop.remove();
  sheetEls.sheet.remove();
  sheetEls = null;
  document.body.classList.remove('sheet-open');
}

function thumb(p) {
  if (p.photo) return `<img class="thumb" src="${p.photo}" alt="">`;
  return `<span class="thumb initial" aria-hidden="true">${esc(p.name.charAt(0).toUpperCase())}</span>`;
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
      <input type="number" inputmode="numeric" pattern="[0-9]*" min="${min}" step="1" name="${name}" value="${value}" aria-label="${esc(label)}">
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
    <div class="segmented" role="tablist" aria-label="Acción">
      <button type="button" role="tab" data-action="mode" data-mode="descontar" aria-selected="${state.mode === 'descontar'}">Descontar</button>
      <button type="button" role="tab" data-action="mode" data-mode="reponer" aria-selected="${state.mode === 'reponer'}">Reponer</button>
    </div>
    ${pending ? `<button type="button" class="banner" data-action="go" data-view="lista">${plural(pending, 'producto', 'productos')} en tu lista de compras →</button>` : ''}
    <input class="search" type="search" placeholder="Buscar producto…" value="${esc(state.query.inicio)}" data-search="inicio" autocomplete="off">
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
        <button type="button" class="icon-btn" data-action="settings" aria-label="Ajustes">${ICONS.gear}</button>
        <button type="button" class="primary small" data-action="add">${ICONS.plus}<span>Agregar</span></button>
      </div>
    </header>
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
  const sheet = openSheet(`
    <h2>Agregar productos</h2>
    <div class="options">
      <button type="button" class="option" data-action="add-manual">
        <span class="option-title">Ingreso manual</span>
        <span class="option-text">Escribe los datos del producto.</span>
      </button>
      <button type="button" class="option" data-action="add-recs">
        <span class="option-title">Productos habituales</span>
        <span class="option-text">Elige varios de una lista de productos comunes del hogar.</span>
      </button>
      ${soon('Escanear código de barras', 'Busca el producto automáticamente.')}
      ${soon('Fotografía del producto', 'Reconoce el producto desde una foto.')}
      ${soon('Escanear boleta', 'Agrega varios productos desde una boleta.')}
    </div>`);
  sheet.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'add-manual') openProductSheet(null);
    if (action === 'add-recs') openRecommendations();
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

function openProductSheet(product) {
  const isNew = !product;
  const defaultRoom = state.roomFilter !== 'all' && roomById(state.roomFilter) ? state.roomFilter : sortedRooms()[0]?.id;
  const d = product ?? {
    name: '', brand: '', size: '', roomId: defaultRoom ?? NO_ROOM, barcode: '', photo: null, stock: 1, max: 4, reorder: 1,
  };
  let photo = d.photo ?? null;

  const sheet = openSheet(`
    <h2>${isNew ? 'Nuevo producto' : 'Editar producto'}</h2>
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
        <label>Código de barras<input name="barcode" value="${esc(d.barcode)}" inputmode="numeric" maxlength="20" autocomplete="off" placeholder="Opcional"></label>
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
    const error = !data.name ? 'El nombre es obligatorio.' : validateLevels(data);
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
}

function openRecommendations() {
  const existing = new Set(state.products.map((p) => normalize(p.name)));
  const rooms = [...new Set(RECOMMENDATIONS.map((r) => r.room))];
  const sheet = openSheet(`
    <h2>Productos habituales</h2>
    <p class="muted">Marca los que normalmente tienes en casa. En el siguiente paso ajustas cantidades.</p>
    <form id="recsForm">
      ${rooms.map((room) => `
        <h3 class="group">${esc(room)}</h3>
        <div class="check-grid">
          ${RECOMMENDATIONS.map((r, i) => (r.room !== room ? '' : `
            <label class="check-item${existing.has(normalize(r.name)) ? ' disabled' : ''}">
              <input type="checkbox" name="rec" value="${i}" ${existing.has(normalize(r.name)) ? 'disabled' : ''}>
              <span>${esc(r.name)}${existing.has(normalize(r.name)) ? ' <small>(ya está)</small>' : ''}</span>
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

async function openRecommendationSetup(picked) {
  // Asegura que existan las habitaciones sugeridas antes de mostrar los selectores.
  const roomIds = {};
  for (const name of new Set(picked.map((r) => r.room))) roomIds[name] = (await createRoom(name)).id;

  const sheet = openSheet(`
    <h2>Configura ${plural(picked.length, 'producto', 'productos')}</h2>
    <p class="muted">Ajusta el stock actual a lo que tienes hoy. Marca y tamaño son opcionales.</p>
    <form id="setupForm" novalidate>
      ${picked.map((r, i) => `
        <fieldset class="setup-card" data-index="${i}">
          <label>Nombre *<input name="name" value="${esc(r.name)}" maxlength="60" autocomplete="off"></label>
          <div class="two">
            <label>Marca<input name="brand" maxlength="40" autocomplete="off"></label>
            <label>Tamaño<input name="size" value="${esc(r.size ?? '')}" maxlength="30" autocomplete="off"></label>
          </div>
          <label>Habitación<select name="roomId" data-room-select>${roomOptions(roomIds[r.room])}</select></label>
          <div class="three">
            <div class="field"><span>Stock actual</span>${stepperHTML('stock', r.max, { label: 'Stock actual' })}</div>
            <div class="field"><span>Máximo</span>${stepperHTML('max', r.max, { min: 1, label: 'Stock máximo' })}</div>
            <div class="field"><span>Reposición</span>${stepperHTML('reorder', r.reorder, { label: 'Nivel de reposición' })}</div>
          </div>
          <p class="error" role="alert"></p>
        </fieldset>`).join('')}
      <div class="sheet-footer"><button type="submit" class="primary block">Agregar ${plural(picked.length, 'producto', 'productos')}</button></div>
    </form>`, { wide: true });
  const form = $('#setupForm', sheet);
  wireSteppers(form);
  $$('select[data-room-select]', form).forEach(wireRoomSelect);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = Date.now();
    const products = [];
    let firstError = null;
    for (const card of $$('.setup-card', form)) {
      const get = (name) => $(`[name=${name}]`, card).value;
      const data = {
        name: get('name').trim(),
        brand: get('brand').trim(),
        size: get('size').trim(),
        roomId: get('roomId') === '__new' ? NO_ROOM : get('roomId'),
        barcode: '',
        photo: null,
        stock: toInt(get('stock')),
        max: toInt(get('max')),
        reorder: toInt(get('reorder')),
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
    closeSheet();
    state.view = 'inventario';
    render();
    toast(`${plural(products.length, 'producto agregado', 'productos agregados')} al inventario.`);
  });
}

// ---------- Ajustes, historial y respaldo ----------

function openSettings() {
  const counts = new Map();
  for (const p of state.products) counts.set(p.roomId, (counts.get(p.roomId) ?? 0) + 1);
  const sheet = openSheet(`
    <h2>Ajustes</h2>
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
      <p class="muted">Tus datos se guardan solo en este teléfono. Exporta un respaldo de vez en cuando (por ejemplo a iCloud Drive o Google Drive).</p>
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
      case 'settings': openSettings(); break;
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
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
