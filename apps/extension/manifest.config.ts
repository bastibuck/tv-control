import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "TV Control Netflix Bridge",
  version: "0.1.0",
  description: "Listens for TV control commands and opens Netflix in Chrome.",
  permissions: ["tabs", "storage", "scripting"],
  host_permissions: ["https://www.netflix.com/*"],
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://www.netflix.com/*"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
  action: {
    default_title: "TV Control Netflix Bridge",
  },
});
