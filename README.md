# Mis Finanzas

Web app instalable (PWA) de finanzas personales, pensada para el celular y en español de México. Responde rápido
tres preguntas: **cuánto te queda para gastar este mes**, **qué tienes que pagar y cuándo**, y **cuándo terminas
de pagar tus deudas**.

## Qué hace

- **Tu mes:** ingresos, préstamos, compras a meses y gastos fijos; cuánto te queda para tus cosas y cuánto al día.
  Lo que te pasas en un mes se descuenta del siguiente.
- **Estados de cuenta en PDF:** lectores para BBVA, Banamex, HSBC (escaneados, con OCR en el navegador),
  American Express y Revolut. Cada lector comprueba que lo leído cuadre con los totales del estado.
- **Tarjetas:** las compras cuentan en el mes de su corte; vista por estado de cuenta (lo que ya cortó y lo que va
  del siguiente), "¿alcanza para cada banco?" con la tasa de cada tarjeta y el interés de pagar solo el mínimo.
- **Compras a meses**, **préstamos** (mensuales o quincenales, con o sin IVA, atraso y fecha de término) y
  **lo que te deben** otras personas.
- **Calendario de pagos**, estimado del mes que viene y fecha de "libre de deudas".
- **Funciona sin internet** y, si entras con tu cuenta, se sincroniza con tu propio servidor.
- **Se actualiza sola:** avisa cuando hay versión nueva y tiene un botón para buscarla.

## Tecnología

- App: Vite + React 19 + TypeScript + Tailwind 4, Dexie (IndexedDB), Recharts, pdf.js y Tesseract.js.
- PWA con `vite-plugin-pwa` (actualización con aviso, sin recargas sorpresa).
- Servidor de sincronización (`servidor/`): Hono + PostgreSQL, contraseñas con scrypt y sesión en cookie
  HttpOnly; cada registro gana por su cambio más reciente.
- Pruebas con Vitest.

## Correr en local

```bash
pnpm install
pnpm dev        # http://localhost:3250
pnpm test
pnpm build      # genera dist/
```

Para la sincronización, en otra terminal (con una base de PostgreSQL):

```bash
cd servidor && pnpm install
DATABASE_URL=postgres://usuario:contraseña@localhost/finanzas PUERTO=3260 node src/index.js
```

`pnpm dev` manda `/api` a `http://127.0.0.1:3260`. Para crear una cuenta: `node servidor/src/crear-usuario.js`.

## Estructura

- `src/pantallas/`: Inicio, Movimientos, Calendario, Préstamos, Compras a meses, Gráficas, Ajustes…
- `src/lib/calculos.ts`: el mes, préstamos, compras a meses, estimados y "libre de deudas".
- `src/lib/estados/`: un lector por banco registrado en `LECTORES` (`index.ts`); para agregar uno, crear
  `<banco>.ts` con `{ banco, detectar, leer }`.
- `src/lib/sync.ts` y `servidor/`: sincronización.
- `despliegue/`: ejemplo de nginx; `scripts/publicar.sh`: compila y sube a tu servidor
  (`SERVIDOR=usuario@host bash scripts/publicar.sh`).

## Privacidad

Tus datos no van en el repositorio: viven en el teléfono (IndexedDB) y, si lo usas, en tu propio servidor.
`datos-privados/` (respaldos y estados de cuenta de prueba) está en `.gitignore`.
