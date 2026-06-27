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
exec serve -s out -l "${PORT}"
