// Copia en la nube con Firebase. Cada cuenta guarda sus datos en users/{uid}/{colección}/{id}
// y las reglas de Firestore impiden que una cuenta vea o modifique los datos de otra.
// El teléfono sigue siendo la fuente principal: aquí solo se copian los cambios y se reciben los de otros equipos.
import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from './vendor/firebase/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDocs, getDocsFromServer, onSnapshot, writeBatch, waitForPendingWrites,
  terminate, clearIndexedDbPersistence,
} from './vendor/firebase/firebase-firestore.js';

export const STORES = ['rooms', 'products', 'movements', 'extras'];
// Se escuchan en vivo. El historial (movements) solo se sube y se descarga al iniciar sesión,
// porque crece sin límite y leerlo entero en cada apertura gastaría la cuota gratuita.
const LIVE_STORES = ['rooms', 'products', 'extras'];
const BATCH_SIZE = 400;

let auth;
let fs;
let unsubscribers = [];
let statusListener = () => {};
let pending = false;

export function init(config, { onStatus } = {}) {
  const app = initializeApp(config);
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  auth.languageCode = 'es';
  fs = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (onStatus) statusListener = onStatus;
}

// Espera a que Firebase recupere la sesión guardada y devuelve el usuario (o null).
export async function ready() {
  await auth.authStateReady();
  return auth.currentUser;
}

export const currentUser = () => auth?.currentUser ?? null;
export const hasPendingWrites = () => pending;

const col = (store) => collection(fs, 'users', auth.currentUser.uid, store);
// Firestore no acepta campos undefined.
const clean = (value) => JSON.parse(JSON.stringify(value));

function trackPending() {
  pending = true;
  statusListener();
  waitForPendingWrites(fs).then(() => {
    pending = false;
    statusListener();
  }).catch(() => {});
}

// Copia en la nube las mismas operaciones aplicadas en el teléfono.
// Sin conexión, Firestore las guarda y las sube después, aunque se cierre la app.
export async function push(ops) {
  if (!auth?.currentUser || !ops.length) return;
  for (const store of new Set(ops.filter((op) => op.clear).map((op) => op.store))) {
    const keep = new Set(ops.filter((op) => op.store === store && op.put).map((op) => op.put.id));
    const snap = await getDocs(col(store));
    commit(snap.docs.filter((d) => !keep.has(d.id)).map((d) => ({ store, del: d.id })));
  }
  commit(ops.filter((op) => !op.clear));
}

function commit(ops) {
  if (!ops.length) return;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const batch = writeBatch(fs);
    for (const op of ops.slice(i, i + BATCH_SIZE)) {
      if ('del' in op) batch.delete(doc(col(op.store), op.del));
      else batch.set(doc(col(op.store), op.put.id), clean(op.put));
    }
    // No se espera la confirmación del servidor: sin conexión quedaría esperando.
    batch.commit().catch((err) => console.warn('No se pudo guardar en la nube', err));
  }
  trackPending();
}

// Descarga todo lo que hay en la cuenta (requiere conexión).
export async function fetchAll() {
  const data = {};
  for (const store of STORES) data[store] = (await getDocsFromServer(col(store))).docs.map((d) => d.data());
  return data;
}

// Escucha los cambios hechos desde otros equipos.
// onChange(store, { full }) llega una vez con la lista completa confirmada por el servidor;
// después llegan solo los cambios: onChange(store, { ops }).
export function listen(onChange, onError) {
  stopListening();
  for (const store of LIVE_STORES) {
    let synced = false;
    unsubscribers.push(onSnapshot(col(store), { includeMetadataChanges: true }, (snap) => {
      if (!synced) {
        if (snap.metadata.fromCache) return; // espera la versión del servidor
        synced = true;
        onChange(store, { full: snap.docs.map((d) => d.data()) });
        return;
      }
      const ops = [];
      for (const change of snap.docChanges()) {
        if (change.doc.metadata.hasPendingWrites) continue; // es un cambio propio que vuelve
        if (change.type === 'removed') ops.push({ store, del: change.doc.id });
        else ops.push({ store, put: change.doc.data() });
      }
      if (ops.length) onChange(store, { ops });
    }, onError));
  }
}

export function stopListening() {
  unsubscribers.forEach((unsubscribe) => unsubscribe());
  unsubscribers = [];
}

// Espera a que todo lo pendiente llegue al servidor; falla si no lo logra a tiempo.
export function flush(timeoutMs = 8000) {
  return Promise.race([
    waitForPendingWrites(fs),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
  ]);
}

export const signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

export async function logout() {
  stopListening();
  await signOut(auth);
  await terminate(fs);
  await clearIndexedDbPersistence(fs).catch(() => {});
}

export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Correo o contraseña incorrectos.';
    case 'auth/invalid-email':
      return 'El correo no es válido.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo. Usa "Entrar".';
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'La contraseña debe tener al menos 6 caracteres.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos e intenta de nuevo.';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet.';
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/invalid-api-key':
      return 'La configuración de Firebase no es válida.';
    case 'auth/operation-not-allowed':
      return 'El acceso con correo no está activado en Firebase (Authentication → Método de acceso).';
    default:
      return err?.message || 'No se pudo completar la operación.';
  }
}
