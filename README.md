# Despensa

Inventario del hogar con lista de compras automática. Es una app web instalable (PWA):
funciona en iPhone y Android, sin tiendas de apps y sin costo.

Los datos se guardan **solo en el teléfono** (IndexedDB). No hay servidor ni cuentas.

## Qué hace (versión 1)

- **Inicio**: descontar (−1 rápido o cantidad exacta) y reponer (+1 o cantidad comprada). Cada acción se puede deshacer.
- **Mi lista**: se arma sola con los productos cuyo stock actual ≤ nivel de reposición. En el supermercado marcas
  lo que echas al carro, ajustas la cantidad real y tocas *Registrar compra*. También admite artículos sueltos
  que no son parte del inventario, y se puede compartir como texto.
- **Inventario**: productos por habitación, búsqueda, edición de ficha y cantidades, historial por producto.
  Para agregar: ingreso manual o lista de productos habituales. El escaneo de código de barras, la foto y la boleta
  aparecen como "Próximamente".
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
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y modo sin conexión |
