#!/usr/bin/env bash
# Build de producción de Reservaro: copia front/ a dist/ con Tailwind ya compilado.
#
# Cómo se usa (desde la carpeta reservaro.app):
#   bash build/construir.sh
# En Windows anda en la terminal "Git Bash" de VS Code (viene con Git).
# En el servidor (Linux) anda igual. Lo que hay que subir es la carpeta dist/.
#
# Qué hace:
#   1. Baja una sola vez el ejecutable oficial de Tailwind (la "CLI standalone": no hace falta Node ni npm).
#   2. Copia front/ a dist/.
#   3. Compila el CSS con las clases que se usan de verdad (minificado) en dist/assets/css/tailwind.css.
#   4. En los HTML de dist/ cambia el CDN de Tailwind por ese CSS.
# front/ no se toca: se sigue trabajando con Live Server igual que siempre.
set -euo pipefail

VERSION_TAILWIND="3.4.17"   # misma versión 3 que el CDN
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$RAIZ/build"
DIST="$RAIZ/dist"

# --- 1. El ejecutable de Tailwind según el sistema ---
case "$(uname -s)" in
  Linux*)               ARCHIVO="tailwindcss-linux-x64" ;;
  Darwin*)              ARCHIVO="tailwindcss-macos-$( [ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64 )" ;;
  MINGW*|MSYS*|CYGWIN*) ARCHIVO="tailwindcss-windows-x64.exe" ;;
  *) echo "No conozco este sistema: $(uname -s)"; exit 1 ;;
esac
TAILWIND="${TAILWIND:-$BUILD/.bin/$VERSION_TAILWIND-$ARCHIVO}"   # se puede cambiar con la variable TAILWIND
if [ ! -x "$TAILWIND" ] && ! command -v "${TAILWIND%% *}" >/dev/null 2>&1; then
  echo "Bajando Tailwind $VERSION_TAILWIND ($ARCHIVO)..."
  mkdir -p "$BUILD/.bin"
  curl -fL --progress-bar -o "$TAILWIND" \
    "https://github.com/tailwindlabs/tailwindcss/releases/download/v$VERSION_TAILWIND/$ARCHIVO"
  chmod +x "$TAILWIND"
fi

# --- 2. Copia limpia ---
echo "Copiando front/ a dist/..."
rm -rf "$DIST"
cp -r "$RAIZ/front" "$DIST"

# --- 3. CSS compilado ---
echo "Compilando Tailwind..."
$TAILWIND -c "$BUILD/tailwind.config.js" -i "$BUILD/entrada.css" -o "$DIST/assets/css/tailwind.css" --minify

# --- 4. HTML: CDN → CSS compilado ---
CDN='<script src="https://cdn.tailwindcss.com"></script>'
CSS='<link rel="stylesheet" href="/assets/css/tailwind.css">'
CANTIDAD=0
while IFS= read -r -d '' html; do
  if grep -qF "$CDN" "$html"; then
    sed -i.bak "s#$CDN#$CSS#" "$html" && rm -f "$html.bak"
    CANTIDAD=$((CANTIDAD + 1))
  fi
done < <(find "$DIST" -name '*.html' -print0)

# Control: no tiene que quedar ningún CDN de Tailwind ni ningún <style type="text/tailwindcss">
if grep -rqE 'cdn\.tailwindcss\.com|text/tailwindcss' "$DIST" --include='*.html'; then
  echo "ERROR: quedó Tailwind del CDN en algún HTML de dist/:"
  grep -rlE 'cdn\.tailwindcss\.com|text/tailwindcss' "$DIST" --include='*.html'
  exit 1
fi

TAMANIO=$(wc -c < "$DIST/assets/css/tailwind.css")
echo "Listo: dist/ armado. $CANTIDAD páginas pasaron al CSS compilado ($((TAMANIO / 1024)) KB)."
