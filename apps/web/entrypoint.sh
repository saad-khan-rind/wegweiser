#!/bin/sh
set -e
: "${PORT:=3000}"
: "${API_URL:=}"
: "${WEB_TIMEOUT_MS:=200000}"

# Inject runtime config so the static SPA can reach the API without a rebuild.
cat > /app/dist/config.js <<JS
window.__WEGWEISER_CONFIG__ = { apiUrl: "${API_URL}", timeoutMs: ${WEB_TIMEOUT_MS} };
JS

echo "Wegweiser web: API_URL=${API_URL} on port ${PORT}"

exec node <<'JS'
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve("/app/dist");
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return path.join(root, normalized);
}

// Serve real files when they exist; fall back to index.html for every other
// route so client-side routing (e.g. /admin) works on direct load / refresh.
function resolveFile(urlPath) {
  if (urlPath === "/" || urlPath === "") return path.join(root, "index.html");
  const candidate = safePath(urlPath);
  if (!candidate.startsWith(root)) return path.join(root, "index.html");
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return path.join(root, "index.html");
}

http
  .createServer((req, res) => {
    const file = resolveFile(req.url || "/");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`Wegweiser static server listening on ${port}`);
  });
JS
