#!/usr/bin/env bash
# Compila y sube la app y su API a tu servidor (solo código: los datos viven en la base de datos del servidor).
# Uso: SERVIDOR=usuario@tu-servidor [LLAVE=~/.ssh/tu_llave] [DOMINIO=finanzas.ejemplo.com] bash scripts/publicar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SERVIDOR:?Define SERVIDOR=usuario@host}"
LLAVE="${LLAVE:-$HOME/.ssh/id_ed25519}"
DOMINIO="${DOMINIO:-finanzas.ejemplo.com}"
pnpm test
pnpm build
# Que nunca salgan datos privados (un respaldo o la carpeta datos-privados) junto con la app
if grep -rqlE '"movimientos":\[|"deudores":\[' dist || [ -d dist/datos-privados ]; then
  echo "dist trae datos privados; no se publica" >&2; exit 1
fi
rsync -az --delete -e "ssh -i $LLAVE" dist/ "$SERVIDOR:/var/www/finanzas/"
# API: el código sin dependencias ni pruebas; .env (con la contraseña de la base) vive solo en el servidor
rsync -az -e "ssh -i $LLAVE" --exclude node_modules --exclude '*.test.*' --exclude .env \
  servidor/package.json servidor/pnpm-lock.yaml servidor/esquema.sql servidor/src "$SERVIDOR:/var/www/finanzas-api/"
ssh -i "$LLAVE" "$SERVIDOR" 'cd /var/www/finanzas-api && pnpm install --prod --frozen-lockfile --ignore-workspace >/dev/null \
  && set -a && . ./.env && set +a && psql "$DATABASE_URL" -q -f esquema.sql && pm2 restart finanzas-api --update-env >/dev/null && echo "API reiniciada"'
echo "Publicado en https://$DOMINIO"
