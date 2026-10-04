// namespace-shim.js
// Asegura que ConEx y ConEx.conex existen antes de evaluar Config.js
(function (g) {
  if (!g.ConEx) g.ConEx = {};
  if (!g.ConEx.conex) g.ConEx.conex = {};
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));