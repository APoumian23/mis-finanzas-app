// Arranca la API en 127.0.0.1 (nginx la publica en /api). Lee DATABASE_URL y PUERTO del entorno.
import { serve } from "@hono/node-server";
import postgres from "postgres";
import { crearApp } from "./app.js";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
const sql = postgres(url, { max: 5, idle_timeout: 30 });
const puerto = Number(process.env.PUERTO ?? 3260);
const app = crearApp(sql, { seguro: process.env.NODE_ENV === "production" });

serve({ fetch: app.fetch, hostname: "127.0.0.1", port: puerto }, () => console.log(`Mis Finanzas API en 127.0.0.1:${puerto}`));
