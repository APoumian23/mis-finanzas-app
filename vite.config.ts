/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Versión = cuándo se compiló, en hora de Ciudad de México (se ve en Más → Actualizar app)
  define: { __VERSION__: JSON.stringify(new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" }).format(new Date())) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt", // la app avisa y el usuario decide cuándo actualizar
      includeAssets: ["icono.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Mis Finanzas",
        short_name: "Finanzas",
        description: "Control de gastos, tarjetas, préstamos y lo que te deben.",
        lang: "es-MX",
        theme_color: "#0f766e",
        background_color: "#f6f7f5",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icono-192.png", sizes: "192x192", type: "image/png" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png" },
          { src: "icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,mjs,woff2}"],
        navigateFallbackDenylist: [/^\/api\//], // la API nunca se responde con la app guardada
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Motor y modelo de español del OCR (se bajan la primera vez que lees un PDF escaneado)
        runtimeCaching: [{
          urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/.*(tesseract|tessdata).*/,
          handler: "CacheFirst",
          options: { cacheName: "ocr", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
        }],
      },
    }),
  ],
  // En desarrollo, /api va a la API local (cd servidor && DATABASE_URL=… PUERTO=3260 node src/index.js)
  server: { proxy: { "/api": "http://127.0.0.1:3260" } },
  test: { environment: "node" },
});
