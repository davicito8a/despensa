# Despensa

Inventario del hogar con lista de compras automática. Es una app web instalable (PWA):
funciona en iPhone y Android, sin tiendas de apps y sin costo.

Los datos se guardan en el teléfono (IndexedDB) y, si el usuario crea una cuenta, también en la nube (Firebase).

## Copia en la nube (opcional)

- Inventario → botón de nube (o Ajustes → Copia en la nube): crear cuenta o entrar con correo y contraseña.
- Al entrar, lo que hay en el teléfono se sube a la cuenta; en un teléfono vacío se descarga lo de la cuenta.
- Cada cuenta es un inventario independiente (`users/{uid}/...`); las reglas de Firestore impiden ver o
  modificar los datos de otra cuenta. El dueño del proyecto Firebase sí puede verlos desde la consola.
- Sin conexión la app funciona igual y los cambios se suben después. El historial se sube y se descarga solo
  al iniciar sesión, para no gastar la cuota gratuita.
- Cerrar sesión borra los datos del teléfono (siguen en la cuenta) y no se permite si hay cambios sin subir.
- Configuración del proyecto: [js/firebase-config.js](js/firebase-config.js). Reglas de Firestore:

  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /users/{uid}/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
  ```

## Qué hace

- **Inicio**: descontar (−1 rápido o cantidad exacta) y reponer (+1 o cantidad comprada). Cada acción se puede deshacer.
- **Dictar** (botón de micrófono en Inicio): se dice o escribe una frase como *"se acabaron dos leches y un arroz"* o
  *"compré tres leches y dos paquetes de arroz"*. [js/voice.js](js/voice.js) la interpreta en el teléfono, sin internet,
  y la app muestra una revisión antes de aplicar nada: si hay varios productos parecidos pregunta cuál (y lo recuerda),
  no crea productos nuevos y no descuenta más de lo que hay. La base es el dictado del teclado; el botón *Escuchar*
  aparece solo si el navegador permite reconocer voz.
- **Mi lista**: se arma sola con los productos cuyo stock actual ≤ nivel de reposición. En el supermercado marcas
  lo que echas al carro, ajustas la cantidad real y tocas *Registrar compra*. También admite artículos sueltos
  que no son parte del inventario, y se puede compartir como texto.
- **Inventario**: productos por habitación, búsqueda, edición de ficha y cantidades, historial por producto.
  Para agregar: ingreso manual, lista de productos habituales o escaneo de código de barras. La foto del producto
  y la boleta aparecen como "Próximamente".
- **Código de barras**:
  - *Agregar → Escanear código*: busca nombre, marca, tamaño y foto en [Open Food Facts](https://world.openfoodfacts.org)
    (base de datos abierta; cubre bien alimentos, poco aseo y limpieza). Si no lo encuentra, se completa a mano.
  - *Inicio → botón de escáner*: cada código escaneado descuenta o suma 1 unidad, según el modo elegido.
    Un código desconocido se puede asignar a un producto existente; desde ese momento la app lo reconoce.
  - Un producto puede tener varios códigos, separados por coma.
  - Lectura con el lector nativo del navegador (Android) o con [ZXing](https://github.com/zxing-js/library)
    (iPhone; licencia Apache 2.0, en `js/vendor/`). Funciona sin internet; solo la búsqueda en Open Food Facts lo necesita.
- **Ajustes** (engranaje en Inventario): habitaciones, historial completo, exportar e importar respaldo.

## Publicarla gratis en GitHub Pages

1. Crea una cuenta en <https://github.com> (si no tienes) y un repositorio nuevo, por ejemplo `despensa`.
   Puede ser público; el código no contiene tus datos.
2. Sube **todo el contenido de esta carpeta** al repositorio (en la web: *Add file → Upload files*, arrastra
   los archivos y carpetas, y *Commit changes*).
3. En el repositorio: *Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save*.
4. Después de uno o dos minutos la app queda en `https://TU-USUARIO.github.io/despensa/`.

## Instalarla en el teléfono

- **iPhone**: abre la dirección en **Safari** → botón Compartir → *Agregar a pantalla de inicio*.
- **Android**: abre la dirección en Chrome → menú ⋮ → *Instalar app* (o *Agregar a pantalla principal*).

Úsala siempre desde el ícono instalado. En iPhone, los datos de una página abierta solo en Safari pueden borrarse
tras varios días sin uso; instalada en la pantalla de inicio queda protegida. De todas formas,
**exporta un respaldo de vez en cuando** (Inventario → engranaje → Exportar) y guárdalo en iCloud Drive o Google Drive.

Funciona sin conexión después de la primera apertura.

## Probarla en el computador

Hace falta un servidor local (abrir `index.html` con doble clic no basta para el modo sin conexión):

```
python -m http.server 8000
```

y abrir <http://localhost:8000>.

## Publicar cambios

Al modificar archivos, sube el número de versión de `CACHE` en [sw.js](sw.js) (por ejemplo `despensa-v2`).
Así los teléfonos descargan la versión nueva: aparece la segunda vez que abres la app tras publicar.

## Estructura

| Archivo | Contenido |
|---|---|
| `index.html` | Página y barra de navegación |
| `css/styles.css` | Estilos (modo claro y oscuro automáticos) |
| `js/app.js` | Pantallas e interacción |
| `js/logic.js` | Reglas: reposición, cantidad sugerida, validaciones |
| `js/db.js` | Almacenamiento local (IndexedDB) |
| `js/recommendations.js` | Lista de productos habituales |
| `js/scanner.js` | Cámara y lectura de códigos de barras |
| `js/openfoodfacts.js` | Búsqueda de productos en Open Food Facts |
| `js/cloud.js`, `js/firebase-config.js` | Copia en la nube con Firebase |
| `js/vendor/` | Librerías ZXing y Firebase, con sus licencias |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y modo sin conexión |
