import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { localDocumentPlugin } from "./vite-plugin-local-document";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), localDocumentPlugin(projectRoot)],
  base: "/editor/",
  server: {
    port: 5173
  }
});
