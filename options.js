// options.js
const $ = sel => document.querySelector(sel);
const urlsEl = $('#urls');
const statusEl = $('#status');

// Importar archivo .txt/.csv al textarea
$('#import').addEventListener('click', async () => {
  const f = $('#file').files?.[0];
  if (!f) return;
  const text = await f.text();
  urlsEl.value = text.trim();
});

// Iniciar procesamiento por lotes
$('#start').addEventListener('click', async () => {
  const parsed = parseUrlBlock(urlsEl.value);
  const { urls, goldMap, issues, labeled, total } = parsed;

  const concurrency   = parseInt($('#concurrency').value || '3', 10);
  const timeout       = parseInt($('#timeout').value || '20000', 10);
  const postLoadDelay = parseInt($('#postLoadDelay').value || '1500', 10);

  if (!urls.length) {
    return append('Añade al menos una URL válida.');
  }

  // Avisos/errores del parseo (conflictos, etiquetas no válidas, líneas inválidas)
  if (issues.length) {
    append('Avisos durante el parseo:\n- ' + issues.join('\n- '));
  }

  chrome.runtime.sendMessage({
    type: 'BATCH_START',
    payload: { urls, concurrency, timeout, postLoadDelay, goldMap }
  });

  append(`Lanzado batch: ${total} URLs (etiquetadas=${labeled}), concurrencia=${concurrency}${labeled ? `, oro=${labeled}` : ''}`);
});

// Detener
$('#stop').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'BATCH_STOP' });
  append('Detención solicitada.');
});

// Recibir progreso y fin
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'BATCH_PROGRESS') append(msg.text);
  if (msg.type === 'BATCH_DONE') {
    append(`Completado. Fichero: ${msg.fileName}`);
    if (msg.summary) {
      append('\n=== Resumen evaluación ===');
      append(renderSummary(msg.summary));
    }
    // Descargar CSV directamente desde la Options page
    if (msg.csv) {
      const blob = new Blob([msg.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = msg.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
});

// ================== Utilidades ==================

function append(line) {
  statusEl.textContent += line + '\n';
  statusEl.scrollTop = statusEl.scrollHeight;
}

/** Normaliza URL quitando hash; si no es URL válida, devuelve cadena recortada. */
function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString();
  } catch {
    return (u || '').trim();
  }
}

/**
 * parseUrlBlock:
 * - Admite líneas con:
 *    URL
 *    URL,CONTENT
 *    URL,INDICE
 *    (también separador de tabulación)
 * - Ignora líneas vacías y líneas que empiezan por '#'
 * - Devuelve { urls[], goldMap{}, issues[], labeled, total }
 */
function parseUrlBlock(raw) {
  const lines = (raw || '').split(/\r?\n/);
  const urls = [];
  const goldMap = {};
  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Permite coma o tabulador como separador
    const parts = line.split(/[,\t]/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) continue;

    const rawUrl = parts[0];
    const url = normalizeUrl(rawUrl);

    // Validación básica de esquema
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      issues.push(`L${i + 1}: URL inválida "${rawUrl}"`);
      continue;
    }

    urls.push(url);

    if (parts.length >= 2) {
      const label = parts[1].toUpperCase();
      if (label === 'CONTENT' || label === 'INDICE') {
        if (goldMap[url] && goldMap[url] !== label) {
          issues.push(`L${i + 1}: conflicto de etiqueta para ${url}: "${goldMap[url]}" vs "${label}" → se usa la última`);
        }
        goldMap[url] = label;
      } else {
        issues.push(`L${i + 1}: etiqueta desconocida "${parts[1]}", se ignora`);
      }
    }
  }

  const labeled = Object.keys(goldMap).length;
  const total = urls.length;
  return { urls, goldMap, issues, labeled, total };
}

function renderSummary(s) {
  const lines = [];
  lines.push(`URLs evaluadas: ${s.evaluated} / ${s.total}`);
  lines.push(`Accuracy: ${(s.accuracy*100).toFixed(2)}%`);
  lines.push(`TP=${s.tp}  TN=${s.tn}  FP=${s.fp}  FN=${s.fn}`);
  return lines.join('\n');
}

// ========== Cargar valores efectivos de Config (vía background GET_CONFIG)
document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: "GET_CONFIG" }, (cfg) => {
    if (!cfg) return;
    $('#textRatio').value = cfg.textRatio;
    $('#multipleTextRatio').value = cfg.multipleTextRatio;
    $('#minTextLength').value = cfg.minTextLength;
    $('#soloTextMultiplier').value = cfg.soloTextMultiplier;
    $('#wordsPerLinkFactor').value = cfg.wordsPerLinkFactor;
  });
});