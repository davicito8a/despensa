// Envoltorio mínimo de IndexedDB. Todos los datos viven solo en este dispositivo.

const DB_NAME = 'despensa';
const DB_VERSION = 1;
export const STORES = ['rooms', 'products', 'movements', 'extras'];

let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) {
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === 'movements') store.createIndex('productId', 'productId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

const asPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function getAll(store) {
  const db = await openDB();
  return asPromise(db.transaction(store).objectStore(store).getAll());
}

export async function getAllByIndex(store, index, key) {
  const db = await openDB();
  return asPromise(db.transaction(store).objectStore(store).index(index).getAll(key));
}

// Quien quiera enterarse de cada cambio guardado (por ejemplo, la copia en la nube).
const writeListeners = new Set();
export const onWrite = (fn) => writeListeners.add(fn);

// Aplica varias operaciones en una sola transacción: o se guardan todas o ninguna.
// ops: [{ store, put: valor } | { store, del: id } | { store, clear: true }]
// silent: no avisa a los oyentes (se usa al aplicar cambios que vienen de la nube).
export async function write(ops, { silent = false } = {}) {
  if (!ops.length) return;
  await writeLocal(ops);
  if (!silent) writeListeners.forEach((fn) => fn(ops));
}

async function writeLocal(ops) {
  const db = await openDB();
  const tx = db.transaction([...new Set(ops.map((op) => op.store))], 'readwrite');
  for (const op of ops) {
    const store = tx.objectStore(op.store);
    if (op.clear) store.clear();
    else if ('del' in op) store.delete(op.del);
    else store.put(op.put);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
