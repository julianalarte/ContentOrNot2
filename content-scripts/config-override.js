// config-override.js
// Debe ejecutarse después de Config.js en cada contexto donde se use ConEx.conex.Config
(function applyConfigOverrides() {
  if (typeof chrome === 'undefined' || !chrome.storage) {
    console.warn('[ConfigOverride] chrome.storage no disponible en este contexto.');
    return;
  }

  const ALLOWED_KEYS = new Set([
    'textRatio',
    'multipleTextRatio',
    'minTextLength',
    'soloTextMultiplier',
    'wordsPerLinkFactor',
  ]);

  const MAX_RETRIES = 20;
  const RETRY_MS = 100;

  function apply(overrides) {
    const cfg = (typeof window !== 'undefined' ? window : self)?.ConEx?.conex?.Config;
    if (!cfg) return false;

    const before = { ...cfg };
    Object.entries(overrides || {}).forEach(([k, v]) => {
      if (!ALLOWED_KEYS.has(k)) return;
      if (typeof v === typeof cfg[k]) {
        cfg[k] = v;
      }
    });
    console.info('[ConfigOverride] aplicado. Antes:', before, 'Después:', cfg);
    return true;
  }

  function loadAndApply() {
    chrome.storage.sync.get('contentOrNot_config_overrides', (res) => {
      const overrides = res?.contentOrNot_config_overrides || {};
      apply(overrides);
    });
  }

  function waitAndApply(attempt = 0) {
    const cfg = (typeof window !== 'undefined' ? window : self)?.ConEx?.conex?.Config;
    if (cfg) {
      loadAndApply();
      return;
    }
    if (attempt < MAX_RETRIES) {
      setTimeout(() => waitAndApply(attempt + 1), RETRY_MS);
    } else {
      console.warn('[ConfigOverride] No se pudo aplicar: ConEx.conex.Config no está disponible.');
    }
  }

  // Primer intento (por si Config.js ya está)
  waitAndApply();

  // Hot reload de cambios desde storage
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!changes.contentOrNot_config_overrides) return;
    const newVal = changes.contentOrNot_config_overrides.newValue || {};
    const cfg = (typeof window !== 'undefined' ? window : self)?.ConEx?.conex?.Config;
    if (!cfg) return;

    Object.entries(newVal).forEach(([k, v]) => {
      if (ALLOWED_KEYS.has(k) && typeof v === typeof cfg[k]) {
        cfg[k] = v;
      }
    });
    console.info('[ConfigOverride] cambios en caliente aplicados:', newVal);
  });
})();