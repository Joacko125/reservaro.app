# reservaro.app
Aplicación web para reserva de turnos de canchas de futbol. Nuestra misión es liberar de la carga de llevar la agenda de turnos a todos los dueños de canchas de futbol que las alquilen a usuarios finales, ofreciendoles una solucion atractiva, estética y que les facilite el posicionamiento.

## Cómo se trabaja

- **Desarrollo:** se abre `front/` con Live Server (VS Code → Go Live). Tailwind corre desde su CDN, así que no hay nada que compilar: cambiás una clase y se ve al toque.
- **Datos:** `front/assets/js/modo.js` elige de dónde salen. `'demo'` usa `store-demo.js` (todo en el navegador). `'api'` usa `store-api.js`, que habla con la API de Django. Para probar sin tocar el archivo, agregá `?modo=api` a la dirección. La lista de rutas de la API está al principio de `store-api.js`.
- **Librerías:** Alpine y Lucide están en `front/assets/vendor/`, con la versión fija en el nombre del archivo. No se bajan de ningún CDN.

## Build de producción

```bash
bash build/construir.sh
```

Arma la carpeta `dist/`, que es la que se sube al servidor. `front/` no se toca.

- La primera vez baja el ejecutable oficial de Tailwind (la CLI standalone, sin Node ni npm) a `build/.bin/`.
- Compila solo las clases que se usan, en `dist/assets/css/tailwind.css` (unos 40 KB), y cambia el CDN de Tailwind por ese CSS en todos los HTML.
- Si queda algún CDN de Tailwind o algún `<style type="text/tailwindcss">` en `dist/`, frena con error. Ese tipo de `<style>` solo funciona con el CDN, así que los estilos propios van en `front/assets/css/estilos.css`.
- Los colores y las fuentes salen de `front/assets/js/config.js`, el mismo archivo que usa el CDN. El color del club es una variable de CSS (`--club`): el mismo CSS sirve para todos los complejos.
- En Windows se corre desde la terminal **Git Bash** de VS Code. En el servidor, con bash.
- `dist/` y `build/.bin/` no se suben a Git (`.gitignore`).
