import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
/* `base` = prefix untuk aset & rute SPA.
   - Dev local / Vercel / custom domain : biarkan default "/".
   - GitHub Pages *project site* (https://<user>.github.io/Satu-Album/) :
       VITE_BASE=/Satu-Album/ npm run build
     (jangan lupa pathSegmentsToKeep di public/404.html = 1) */
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
      "/uploads": "http://localhost:3001"
    }
  }
});