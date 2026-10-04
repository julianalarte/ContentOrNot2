// background-scripts/background.js

// ================== Variables base (tuyas) ==================
importScripts("../content-scripts/ConEx/algorithm/ConEx/namespace-shim.js", "../content-scripts/ConEx/algorithm/ConEx/Config.js", "../content-scripts/config-override.js");
let processing = false;
let pressed = false;
let processed = false;
var notification = "my-notification";

var error = false;

var TabId;
var description;

if (typeof browser == "undefined")
  var browser = chrome;

var _supportsPromises = false;
try {
  _supportsPromises = browser.runtime.getPlatformInfo() instanceof Promise;
}
catch (e) {}

// ================== Utilidades compartidas ==================
/** Normaliza URL para comparar con el oro (quitamos hash). */
function normalize(u) {
  try { const x = new URL(u); x.hash = ''; return x.toString(); }
  catch { return (u || '').trim(); }
}

// Pestañas del lote (para no interferir con notificaciones/acciones del modo manual)
const batchTabs = new Set();
// Tiempos por pestaña del lote
const startedAtByTab = new Map();

// ================== Modo MANUAL (tuyo) ==================

// Listener original: click en el icono de la extensión
browser.action.onClicked.addListener((tab) => {
  var description;
  TabId = tab.id;

  description = browser.i18n.getMessage("extractingMessage");
  browser.action.setBadgeText({text: "Ex", tabId: TabId});
  browser.action.setTitle({title: description, tabId: TabId});
  var bgp =  browser.tabs.getCurrent();
  messagePassing();
  browser.action.disable(tab.id);
});

// Trata los mensajes del content script (modo manual)
function treatMessage(message, sender, sendResponse) {
  // Si el mensaje proviene de una pestaña del lote, ignoramos (el modo lote se gestiona abajo).
  if (sender?.tab?.id && batchTabs.has(sender.tab.id)) return;

  if (message.content == "message") {
    var header = browser.i18n.getMessage("messageTitle");
    var content1 = browser.i18n.getMessage("bodyMessage");

    browser.notifications.create(notification, {
      "type": "basic",
      "iconUrl": browser.runtime.getURL("icons/c2.png"),
      "title": header,
      "message": content1
    });
  }
  else if (message.content == "endExtraction") {
    endExtraction();
  }
  else if (message.content == "error") {
    error = true;
    browser.notifications.clear(notification);
    endExtraction();
  }
}
browser.runtime.onMessage.addListener(treatMessage);

function messagePassing() {
  var queryInfo = { active: true, currentWindow: true };

  chrome.tabs.query(queryInfo, function(tabs) {
    if (!tabs || !tabs.length) return;
    browser.tabs.sendMessage(
      tabs[0].id,
      { greeting: "" } // Tu browserOverlay.js arranca con cualquier mensaje
    );
  });
}

function sendMessageToTabs(tabs) {
  browser.tabs.sendMessage(
    tabs[0].id,
    {greeting: ""}
  ).catch(onError);
}

function onError(errorMsg) {
  console.log("Error: "+ errorMsg);

  var header = browser.i18n.getMessage("errorTitle");
  var content1 = browser.i18n.getMessage("errorMessage");
  var description = browser.i18n.getMessage("errorMessage");

  browser.notifications.create(notification, {
    "type": "basic",
    "iconUrl": browser.runtime.getURL("icons/c2.png"),
    "title": header,
    "message": content1
  });

  browser.action.setBadgeText({text: "Error", tabId: TabId});
  browser.action.setTitle({title: description, tabId: TabId});
}

function endExtraction() {
  browser.action.enable(TabId);

  if(error) {
    browser.action.setIcon({path: "/icons/c3.png", tabId: TabId});
    browser.action.setBadgeText({text: "Error", tabId: TabId});
    browser.tabs.reload();
  }
  else {
    if(!pressed){
      browser.action.setBadgeText({text: "End", tabId: TabId});
      browser.action.setIcon({path: "/icons/con-right.png", tabId: TabId});
      description = browser.i18n.getMessage("backToWeb");
      pressed = true;
    }
    else {
      browser.action.setBadgeText({text: "", tabId: TabId});
      browser.action.setIcon({path: "/icons/con-left.png", tabId: TabId});
      description = browser.i18n.getMessage("backToContent");
      pressed = false;
    }
  }

  error = false;
}

function updated(tabId, changeInfo, tab) {
  // No toques iconos/badges si es una pestaña del lote
  if (batchTabs.has(tabId)) return;

  if (tabId == TabId && changeInfo.status === 'complete') {
    pressed = false;
    browser.action.setIcon({path: "/icons/c3.png", tabId: TabId});
    description = browser.i18n.getMessage("extensionDescription");
    browser.action.setTitle({title: description, tabId: TabId});
    browser.action.setBadgeText({text: "", tabId: TabId});
  }
}
browser.tabs.onUpdated.addListener(updated);

// ================== Modo LOTE de URLs (nuevo) ==================

const batchState = {
  queue: [],
  running: 0,
  maxConcurrency: 3,
  timeoutMs: 20000,
  postLoadDelay: 2500,
  stopRequested: false,
  // Resultados: añadimos predicted/gold/correct para evaluación
  results: [], // { url, ok, isContent, predicted, gold, correct, error, ms }
  goldMap: {}, // urlNormalizada -> 'CONTENT' | 'INDICE'
  metrics: { tp:0, tn:0, fp:0, fn:0, total:0, evaluated:0 }
};

// Recibe órdenes desde la Options page y los dictámenes del content
browser.runtime.onMessage.addListener((msg, sender) => {
  // Arrancar el lote
  if (msg?.type === 'BATCH_START') {
    const { urls, concurrency, timeout, postLoadDelay, goldMap } = msg.payload || {};
    batchState.queue = (urls || []).map(u => ({ url: u }));
    batchState.results = [];
    batchState.maxConcurrency = Math.max(1, Math.min(10, Number(concurrency) || 3));
    batchState.timeoutMs = Number(timeout) || 20000;
    batchState.postLoadDelay = (postLoadDelay !== undefined) ? Number(postLoadDelay) : batchState.postLoadDelay;
    batchState.stopRequested = false;
    batchState.goldMap = goldMap || {};
    batchState.metrics = { tp:0, tn:0, fp:0, fn:0, total: batchState.queue.length, evaluated:0 };
    tickBatch();
  }

  if (msg?.type === 'BATCH_STOP') {
    batchState.stopRequested = true; // dejamos terminar las que están en curso
  }

  // Resultado de tu extractor (enviado desde ContentExtractor.extractedWebContent)
  if (msg?.type === 'PAGE_RESULT') {
    const tabId = sender?.tab?.id;
    const url = msg?.payload?.url || '';
    const hasContent = !!(msg?.payload?.result); // true => CONTENT
    const startedAt = startedAtByTab.get(tabId) || Date.now();
    const ms = Date.now() - startedAt;

    const predicted = hasContent ? 'CONTENT' : 'INDICE';
    const gold = batchState.goldMap[ normalize(url) ];
    
    // ── Log de diagnóstico TED ─────────────────────────────────
    const score  = msg?.payload?.repetitionScore;
    const details = msg?.payload?.tedDetails;
    if (score !== null && score !== undefined) {
        console.log(`[TED] ${url}`);
        console.log(`  score=${score.toFixed(3)}  isIndex=${msg?.payload?.isIndex}  bestDepth=${details?.bestDepth}`);
        if (details?.levelStats) {
            for (const [depth, s] of Object.entries(details.levelStats)) {
                console.log(`  depth=${depth}  nodes=${s.nodes}  sim=${s.similarity?.toFixed(3)}  textCov=${s.textCoverage?.toFixed(3)}  weighted=${s.weighted?.toFixed(3)}`);
            }
        }
    }
    // ──────────────────────────────────────────────────────────	
	
	let correct = null;
    if (gold === 'CONTENT' || gold === 'INDICE') {
      correct = (predicted === gold);
      batchState.metrics.evaluated++;
      if (gold === 'CONTENT' && predicted === 'CONTENT') batchState.metrics.tp++;
      else if (gold === 'INDICE' && predicted === 'INDICE') batchState.metrics.tn++;
      else if (gold === 'INDICE' && predicted === 'CONTENT') batchState.metrics.fp++;
      else if (gold === 'CONTENT' && predicted === 'INDICE') batchState.metrics.fn++;
    }

	batchState.results.push({
		url,
		ok: true,
		isContent: hasContent,
		predicted, gold, correct,
		error: null,
		ms,
		// ── Campos TED ──
		repetitionScore: msg?.payload?.repetitionScore ?? null,
		bestDepth:       msg?.payload?.tedDetails?.bestDepth ?? null,
		bestSim:         msg?.payload?.tedDetails?.levelStats?.[msg?.payload?.tedDetails?.bestDepth]?.similarity ?? null,
		bestTextCov:     msg?.payload?.tedDetails?.levelStats?.[msg?.payload?.tedDetails?.bestDepth]?.textCoverage ?? null,
		bestNodes:       msg?.payload?.tedDetails?.levelStats?.[msg?.payload?.tedDetails?.bestDepth]?.nodes ?? null,
	});

    if (tabId) {
      batchTabs.delete(tabId);
      startedAtByTab.delete(tabId);
      try { browser.tabs.remove(tabId); } catch (e) {}
    }
    batchState.running = Math.max(0, batchState.running - 1);
    progressBatch(`✓ ${url} → ${hasContent ? 'CONTENIDO' : 'ÍNDICE'} (${ms} ms)`);
    if (gold === 'CONTENT' || gold === 'INDICE') {
      progressBatch(`   ↳ gold=${gold} | predicted=${predicted} | ${correct ? '✔️ acierto' : '❌ fallo'}`);
    }
    tickBatch();
  }

  // Error desde el content
  if (msg?.type === 'PAGE_ERROR') {
    const tabId = sender?.tab?.id;
    const url = msg?.payload?.url || '';
    const err = msg?.payload?.error || 'unknown';
    const startedAt = startedAtByTab.get(tabId) || Date.now();
    const ms = Date.now() - startedAt;

    batchState.results.push({
      url,
      ok: false,
      isContent: null,
      predicted: null,
      gold: batchState.goldMap[ normalize(url) ],
      correct: false,
      error: err,
      ms
    });

    if (tabId) {
      batchTabs.delete(tabId);
      startedAtByTab.delete(tabId);
      try { browser.tabs.remove(tabId); } catch (e) {}
    }
    batchState.running = Math.max(0, batchState.running - 1);
    progressBatch(`✗ ${url} → ERROR: ${err}`);
    tickBatch();
  }
});

function tickBatch() {
  if (batchState.stopRequested && batchState.running === 0) {
    return finishAndExportBatch();
  }
  while (batchState.running < batchState.maxConcurrency && batchState.queue.length) {
    const { url } = batchState.queue.shift();
    processUrlBatch(url);
    batchState.running++;
  }
  if (batchState.running === 0 && batchState.queue.length === 0) {
    finishAndExportBatch();
  }
}

function processUrlBatch(url) {
  const startedAt = Date.now();
  browser.tabs.create({ url, active: false }, (tab) => {
    if (!tab || (chrome && chrome.runtime && chrome.runtime.lastError)) {
      pushErrorBatch(url, `No se pudo abrir pestaña: ${chrome?.runtime?.lastError?.message || 'desconocido'}`, startedAt);
      return;
    }
    const tabId = tab.id;
    batchTabs.add(tabId);
    startedAtByTab.set(tabId, startedAt);

    // Timeout de seguridad
    const timer = setTimeout(() => {
      try { browser.tabs.remove(tabId); } catch (e) {}
      batchTabs.delete(tabId);
      startedAtByTab.delete(tabId);
      pushErrorBatch(url, `Timeout tras ${batchState.timeoutMs} ms`, startedAt);
    }, batchState.timeoutMs);

    // Listener específico para esta pestaña: cuando termina de cargar, arrancamos el extractor
    const onUpdated = (updatedTabId, changeInfo, updatedTab) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        browser.tabs.onUpdated.removeListener(onUpdated);
        setTimeout(() => {
          try {
            // Dispara tu extractor: tu browserOverlay.js reacciona a cualquier mensaje recibido
            browser.tabs.sendMessage(tabId, { greeting: "", __batch: true }, () => {
              // Esperaremos a PAGE_RESULT / PAGE_ERROR
            });
          } catch (e) {
            try { browser.tabs.remove(tabId); } catch (err) {}
            batchTabs.delete(tabId);
            startedAtByTab.delete(tabId);
            pushErrorBatch(url, `No se pudo iniciar el análisis: ${e?.message || e}`, startedAt);
          } finally {
            clearTimeout(timer);
          }
        }, batchState.postLoadDelay);
      }
    };
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

function pushErrorBatch(url, errorText, startedAt) {
  const ms = Date.now() - startedAt;
  batchState.results.push({ url, ok: false, isContent: null, predicted: null, gold: batchState.goldMap[ normalize(url) ], correct: false, error: errorText, ms });
  batchState.running = Math.max(0, batchState.running - 1);
  progressBatch(`✗ ${url} → ERROR: ${errorText}`);
  tickBatch();
}

function progressBatch(text) {
  try { browser.runtime.sendMessage({ type: 'BATCH_PROGRESS', text }); } catch(e) {}
}

function finishAndExportBatch() {
  const m = batchState.metrics;
  const denom = Math.max(1, m.evaluated);
  const accuracy = (m.tp + m.tn) / denom;
  const summary = {
    total: m.total,
    evaluated: m.evaluated,
    accuracy,
    tp: m.tp, tn: m.tn, fp: m.fp, fn: m.fn
  };

  const csv = toCSV(batchState.results);
  const fileName = `contentornot_results_${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;

  // Enviar CSV a la Options page para que lo descargue ella
  try {
    browser.runtime.sendMessage({ type: 'BATCH_DONE', fileName, summary, csv });
  } catch(e) {}

  try { browser.storage?.local?.set({ lastBatchResults: batchState.results, summary }); } catch(e) {}
}

function toCSV(rows) {
  const header = ['url','ok','isContent','predicted','gold','correct','error','ms',
                'repetitionScore','bestDepth','bestSim','bestTextCov','bestNodes'];

  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
	lines.push([
		esc(r.url), esc(r.ok), esc(r.isContent),
		esc(r.predicted), esc(r.gold), esc(r.correct),
		esc(r.error), esc(r.ms),
		esc(r.repetitionScore), esc(r.bestDepth),
		esc(r.bestSim), esc(r.bestTextCov), esc(r.bestNodes)
	].join(','));
  }
  return lines.join('\n');
}
// ================== FIN background.js ==================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_CONFIG") {
        sendResponse({
            indexThreshold:       ConEx.conex.Config.indexThreshold,
            minSiblingsForCheck:  ConEx.conex.Config.minSiblingsForCheck,
            maxDepthForCheck:     ConEx.conex.Config.maxDepthForCheck,
            maxSubtreeSize:       ConEx.conex.Config.maxSubtreeSize
        });
  }

  return true; // Necesario si respondes async
});
