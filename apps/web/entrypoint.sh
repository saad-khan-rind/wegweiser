#!/bin/sh
set -e
: "${PORT:=3000}"
: "${API_URL:=}"
: "${WEB_TIMEOUT_MS:=200000}"
# Inject runtime config so the static app can reach the API without a rebuild.
cat > /app/out/config.js <<JS
window.__WEGWEISER_CONFIG__ = { apiUrl: "${API_URL}", timeoutMs: ${WEB_TIMEOUT_MS} };
JS
echo "Wegweiser web: API_URL=${API_URL} on port ${PORT}"
exec node <<'JS'
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve("/app/out");
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  return path.join(root, normalized);
}

function resolveFile(urlPath) {
  if (urlPath === "/") return path.join(root, "index.html");
  if (urlPath === "/admin") return path.join(root, "admin", "index.html");
  const candidate = safePath(urlPath);
  if (!candidate.startsWith(root)) return "";
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  const index = path.join(candidate, "index.html");
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  return path.join(root, "404.html");
}

http.createServer((req, res) => {
  const file = resolveFile(req.url || "/");
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const status = file.endsWith("404.html") ? 404 : 200;
  res.writeHead(status, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`Wegweiser static server listening on ${port}`);
});
JS
