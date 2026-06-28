// Runtime configuration. Overwritten at container start from $API_URL.
// Point the app at your API without rebuilding by editing this file or setting
// API_URL on the web container. Leave apiUrl empty to fall back to VITE_API_URL
// (build-time) or same-origin.
window.__WEGWEISER_CONFIG__ = {
  apiUrl: "",
  timeoutMs: 200000
};
