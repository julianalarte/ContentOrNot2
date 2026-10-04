/**
 * The main process of the webExtension.
 *   Input:  The body of the webpage loaded in the current tab.
 *   Output: { hasContent: bool, isIndex: bool, mainContent: body,
 *             repetitionScore: number, tedDetails: object }
 *
 * Pipeline:
 *   1. preprocess      – remove scripts/styles/iframes/dialogs
 *   2. removeNotAllowed – remove nodes with negative-token class/id
 *   3. removeUnwanted  – remove nav/footer/header/button/input…
 *   4. Structural repetition detection via ontology-aware TED
 *      - group non-leaf nodes by depth
 *      - compute pairwise TED (unordered children, ontology cost)
 *      - derive repetitionScore ∈ [0,1]
 *      - classify: repetitionScore > threshold → isIndex
 *
 * @authors Josep Silva and Julián Alarte (original)
 *          Extended with ontology-TED structural classifier
 * @version 2.0
 */
ConEx.conex.Content = function(body)
{
    // ─────────────────────────────────────────────────────────────
    // Config-level constants (can be moved to ConEx.conex.Config)
    // ─────────────────────────────────────────────────────────────

    /**
     * Threshold: repetitionScore above this value → page is an index.
     * 0 = "any similarity counts", 1 = "only perfect clones count".
     * 0.55 is a good starting point; tune with real pages.
     */
    const INDEX_THRESHOLD = (ConEx.conex.Config.indexThreshold !== undefined)
        ? ConEx.conex.Config.indexThreshold
        : 0.55;

    /**
     * Minimum number of sibling subtrees at the same depth needed to
     * trigger the repetition check at that level.
     * A page with only 3-4 siblings at every depth is unlikely an index
     * (an article with 3-4 sections is normal content).
     * Real index pages typically have 5+ repeated cards/items.
     */
    const MIN_SIBLINGS_FOR_CHECK = (ConEx.conex.Config.minSiblingsForCheck !== undefined)
        ? ConEx.conex.Config.minSiblingsForCheck
        : 5;

    /**
     * Maximum subtree size (node count) considered for TED.
     * Very large subtrees are expensive; skip or approximate them.
     */
    const MAX_SUBTREE_SIZE = (ConEx.conex.Config.maxSubtreeSize !== undefined)
        ? ConEx.conex.Config.maxSubtreeSize
        : 60;

    /**
     * Profundidad máxima a la que se buscan grupos de nodos repetidos.
     * Por encima de esta profundidad los nodos suelen ser filas de tabla,
     * items de lista interna u otros elementos repetitivos que no indican
     * que la página sea un índice (ej: referencias de Wikipedia a depth 9).
     */
    const MAX_DEPTH_FOR_CHECK = (ConEx.conex.Config.maxDepthForCheck !== undefined)
        ? ConEx.conex.Config.maxDepthForCheck
        : 12;

    /**
     * Número mínimo de filas (TR hijos directos de TBODY/TABLE) para
     * considerar una tabla como "listado repetitivo" y permitir que sus
     * TR entren en el análisis TED.
     * - Tabla de datos / infobox:  2-10 filas  → excluir (contenido)
     * - Tabla de noticias/índice: 10+ filas    → incluir (índice)
     */
    const MIN_TABLE_ROWS_FOR_INDEX = 20;

    /**
     * Tamaño máximo de subárbol (en nodos) para considerar un ítem de
     * lista como "trivial" y excluirlo del análisis.
     * - li de menú o referencia: 1-4 nodos  → excluir
     * - li de noticia/card:      5+ nodos   → incluir
     */
    const SIMPLE_ITEM_MAX_SIZE = 4;

    // ─────────────────────────────────────────────────────────────
    // Negative tokens (kept from original)
    // ─────────────────────────────────────────────────────────────
    this.negativeTokens = ["cookie","error","gdpr","banner","carousel",
        "consent","caption","swiper","dp-dfg-item","listing","header",
        "menu","navigation","media","video"];

    // ─────────────────────────────────────────────────────────────
    // ① ONTOLOGY  (Paso A + B del documento)
    // ─────────────────────────────────────────────────────────────

    /**
     * φ: Tag → ontological class
     * Leaves (ignored in TED cost) are mapped to "leaf".
     */
    const TAG_CLASS = {
        // structural / sección
        section: "seccion", article: "seccion", main: "seccion",
        // structural / agrupación
        div: "agrupacion", aside: "agrupacion", details: "agrupacion",
        // lista
        ul: "lista", ol: "lista", dl: "lista",
        // tabla
        table: "tabla", thead: "tabla", tbody: "tabla", tfoot: "tabla",
        tr: "tabla", td: "tabla", th: "tabla",
        // texto (inline – ignoradas como hojas en TED)
        p: "texto", h1: "texto", h2: "texto", h3: "texto",
        h4: "texto", h5: "texto", h6: "texto",
        span: "texto", strong: "texto", em: "texto", b: "texto",
        i: "texto", small: "texto", label: "texto", a: "texto",
        // embebido
        img: "embebido", video: "embebido", audio: "embebido",
        picture: "embebido", figure: "embebido", iframe: "embebido",
        canvas: "embebido", svg: "embebido",
        // formulario
        input: "formulario", select: "formulario", textarea: "formulario",
        form: "formulario", button: "formulario", fieldset: "formulario",
        // interacción
        nav: "interaccion", menu: "interaccion",
        // hoja (nodo de texto puro, ignorado)
        "#text": "leaf"
    };

    /**
     * Clases que se consideran "hojas ignoradas" en el TED:
     * su cost_rename = 0 y no se desciende en ellas.
     */
    const LEAF_CLASSES = new Set(["texto", "embebido", "formulario", "interaccion", "leaf"]);

    /**
     * d_ontología – Opción 2: matriz de costes definida manualmente.
     * Simétrica; diagonal = 0.
     *
     * Clases estructurales: seccion, agrupacion, lista, tabla
     * Clases hoja (ignoradas): texto, embebido, formulario, interaccion
     *
     * Distancias extra del enunciado (texto libre del docx):
     *   misma etiqueta            → 0
     *   ambos estructurales       → 0.2
     *   contenedor ↔ inline       → 0.7
     *   totalmente distinto       → 1
     */
    const D_ONT = (() => {
        const C = ["seccion","agrupacion","lista","tabla","texto","embebido","formulario","interaccion"];
        // Matriz base (triangular superior; se espeja)
        const raw = {
            seccion:     { seccion:0,   agrupacion:0.2, lista:0.3, tabla:0.5, texto:0.8, embebido:0.8, formulario:1,   interaccion:0.7 },
            agrupacion:  { agrupacion:0, lista:0.3,     tabla:0.5, texto:0.8, embebido:0.8, formulario:1, interaccion:0.7 },
            lista:       { lista:0,      tabla:0.4,     texto:0.8, embebido:0.8, formulario:1, interaccion:0.7 },
            tabla:       { tabla:0,      texto:0.8,     embebido:0.8, formulario:1, interaccion:0.7 },
            texto:       { texto:0,      embebido:0.9,  formulario:0.9, interaccion:0.7 },
            embebido:    { embebido:0,   formulario:0.9, interaccion:0.7 },
            formulario:  { formulario:0, interaccion:0.7 },
            interaccion: { interaccion:0 }
        };
        // Build full symmetric map
        const m = {};
        for (const a of C) {
            m[a] = {};
            for (const b of C) {
                if (raw[a] && raw[a][b] !== undefined)      m[a][b] = raw[a][b];
                else if (raw[b] && raw[b][a] !== undefined) m[a][b] = raw[b][a];
                else m[a][b] = 1;
            }
        }
        return m;
    })();

    /**
     * φ(tag, node): tag string → ontological class.
     * Caso especial: <a> con hijos elemento actúa como contenedor (agrupacion),
     * no como texto inline. Detectado cuando se pasa el nodo real.
     */
    this._phi = function(tag, node) {
        if (!tag) return "agrupacion";
        const t = tag.toLowerCase();
        // <a> contenedor: si tiene hijos elemento, tratarlo como agrupacion
        if (t === 'a' && node) {
            for (let i = 0; i < node.childNodes.length; i++) {
                if (node.childNodes[i].nodeType === 1) return "agrupacion";
            }
        }
        return TAG_CLASS[t] || "agrupacion";  // desconocido → agrupacion
    };

    /** d_ont(classA, classB) */
    this._dOnt = function(ca, cb) {
        if (ca === cb) return 0;
        if (D_ONT[ca] && D_ONT[ca][cb] !== undefined) return D_ONT[ca][cb];
        return 1;
    };

    // ─────────────────────────────────────────────────────────────
    // ② TED  (Paso 3 del documento – matching sin orden)
    // ─────────────────────────────────────────────────────────────

    /**
     * cost_rename(n1, n2):
     *   0                          si ambos son hojas ignoradas
     *   d_ont(φ(tag1), φ(tag2))   en otro caso
     */
    this._costRename = function(tag1, tag2) {
        const c1 = this._phi(tag1);
        const c2 = this._phi(tag2);
        if (LEAF_CLASSES.has(c1) && LEAF_CLASSES.has(c2)) return 0;
        return this._dOnt(c1, c2);
    };

    /**
     * cost_delete / cost_insert(n):
     *   depende solo de la clase ontológica.
     *   seccion = caro (1.0), agrupacion = intermedio (0.5),
     *   lista/tabla = 0.6, hojas = barato (0.2)
     */
    this._costDelete = function(tag) {
        const c = this._phi(tag);
        const w = { seccion:1.0, agrupacion:0.5, lista:0.6, tabla:0.6,
                    texto:0.2, embebido:0.2, formulario:0.3, interaccion:0.4, leaf:0.1 };
        return w[c] !== undefined ? w[c] : 0.5;
    };

    /** Contar nodos de un subárbol (sin nodos de texto puro) */
    this._subtreeSize = function(node) {
        if (!node || node.nodeType === 3) return 0;
        let s = 1;
        for (let i = 0; i < node.childNodes.length; i++)
            s += this._subtreeSize(node.childNodes[i]);
        return s;
    };

    /**
     * Obtener hijos elemento (nodeType==1) no ignorados como hojas.
     * Las hojas de la ontología SÍ se incluyen como nodos terminales
     * pero NO se desciende en ellos.
     */
    this._elementChildren = function(node) {
        const ch = [];
        if (!node) return ch;
        for (let i = 0; i < node.childNodes.length; i++) {
            const c = node.childNodes[i];
            if (c.nodeType === 1) ch.push(c);
        }
        return ch;
    };

    /**
     * Matching óptimo sin orden entre dos listas de hijos
     * usando el algoritmo húngaro simplificado (O(n²·m)).
     *
     * Devuelve el coste mínimo de emparejar los hijos de t1 con los de t2,
     * más los costes de inserción/eliminación de los no emparejados.
     *
     * Para mantener la complejidad razonable en el browser usamos
     * el algoritmo greedy de asignación de coste mínimo (suficiente
     * para la heurística de detección de índices).
     */
    this._matchChildren = function(ch1, ch2, memo) {
        const n = ch1.length;
        const m = ch2.length;

        if (n === 0 && m === 0) return 0;

        // Matriz de costes TED entre cada par de hijos
        const cost = [];
        for (let i = 0; i < n; i++) {
            cost[i] = [];
            for (let j = 0; j < m; j++) {
                cost[i][j] = this._ted(ch1[i], ch2[j], memo);
            }
        }

        // Asignación greedy de mínimo coste (aproximación suficiente)
        const usedJ = new Array(m).fill(false);
        const usedI = new Array(n).fill(false);
        let totalCost = 0;

        // Construir lista de todos los pares ordenados por coste
        const pairs = [];
        for (let i = 0; i < n; i++)
            for (let j = 0; j < m; j++)
                pairs.push([cost[i][j], i, j]);
        pairs.sort((a, b) => a[0] - b[0]);

        for (const [c, i, j] of pairs) {
            if (!usedI[i] && !usedJ[j]) {
                totalCost += c;
                usedI[i] = true;
                usedJ[j] = true;
            }
        }

        // Penalizar los no emparejados
        for (let i = 0; i < n; i++)
            if (!usedI[i]) totalCost += this._costDelete(ch1[i].tagName);
        for (let j = 0; j < m; j++)
            if (!usedJ[j]) totalCost += this._costDelete(ch2[j].tagName);

        return totalCost;
    };

    /**
     * TED(t1, t2) con memoización.
     *
     * TED(t1,t2) = cost_rename(t1,t2) + matchChildren(children(t1), children(t2))
     *
     * Si alguno de los dos supera MAX_SUBTREE_SIZE se usa una
     * aproximación rápida basada solo en la firma ontológica.
     */
    this._ted = function(t1, t2, memo) {
        if (!t1 && !t2) return 0;
        if (!t1) return this._costDelete(t2 ? t2.tagName : null);
        if (!t2) return this._costDelete(t1 ? t1.tagName : null);

        // Clave de memoización
        const k = (t1._tedId || 0) + ":" + (t2._tedId || 0);
        if (memo && memo[k] !== undefined) return memo[k];

        const size1 = this._subtreeSize(t1);
        const size2 = this._subtreeSize(t2);

        let result;

        if (size1 > MAX_SUBTREE_SIZE || size2 > MAX_SUBTREE_SIZE) {
            // Aproximación rápida: solo coste de renombre + diferencia de tamaño normalizada
            const renCost = this._costRename(t1.tagName, t2.tagName);
            const sizeDiff = Math.abs(size1 - size2) / Math.max(size1, size2, 1);
            result = (renCost + sizeDiff) / 2;
        } else {
            const renCost = this._costRename(t1.tagName, t2.tagName);

            // Si ambos son hojas ontológicas, no descendemos
            const c1 = this._phi(t1.tagName);
            const c2 = this._phi(t2.tagName);
            if (LEAF_CLASSES.has(c1) && LEAF_CLASSES.has(c2)) {
                result = 0; // cost_rename de hojas = 0
            } else {
                const ch1 = this._elementChildren(t1);
                const ch2 = this._elementChildren(t2);
                result = renCost + this._matchChildren(ch1, ch2, memo);
            }
        }

        if (memo) memo[k] = result;
        return result;
    };

    /**
     * Normalizar TED al rango [0,1] dividiéndolo por el tamaño máximo
     * del subárbol mayor (cota superior heurística).
     */
    this._tedNormalized = function(t1, t2, memo) {
        const raw = this._ted(t1, t2, memo);
        const maxSize = Math.max(this._subtreeSize(t1), this._subtreeSize(t2), 1);
        return Math.min(raw / maxSize, 1);
    };

    // ─────────────────────────────────────────────────────────────
    // ③ AGRUPACIÓN POR PROFUNDIDAD y cálculo de repetición
    // ─────────────────────────────────────────────────────────────

    /**
     * Asignar IDs únicos a todos los nodos elemento para memoización TED.
     */
    this._assignTedIds = function(node, counter) {
        if (!node || node.nodeType !== 1) return counter;
        node._tedId = counter++;
        for (let i = 0; i < node.childNodes.length; i++)
            counter = this._assignTedIds(node.childNodes[i], counter);
        return counter;
    };

    /**
     * Recoger todos los nodos elemento agrupados por profundidad.
     * Solo incluye nodos cuyo tamaño de subárbol >= minSize
     * y cuya clase ontológica NO sea hoja.
     */
    /**
     * Cuenta los TR hijos directos de un nodo TABLE/TBODY/THEAD/TFOOT.
     * Usado para distinguir tablas de datos (pocas filas) de tablas-índice.
     */
    this._countTableRows = function(tableNode) {
        let rows = 0;
        for (let i = 0; i < tableNode.childNodes.length; i++) {
            const ch = tableNode.childNodes[i];
            if (!ch || ch.nodeType !== 1) continue;
            if (ch.tagName === "TR") { rows++; continue; }
            // TBODY/THEAD/TFOOT: contar sus TR hijos
            if (ch.tagName === "TBODY" || ch.tagName === "THEAD" || ch.tagName === "TFOOT") {
                for (let j = 0; j < ch.childNodes.length; j++)
                    if (ch.childNodes[j] && ch.childNodes[j].tagName === "TR") rows++;
            }
        }
        return rows;
    };

    /**
     * Recoge grupos de nodos hermanos (mismo padre) que sean candidatos
     * a ser items de un índice. Cada grupo es la lista de hijos elemento
     * de un nodo padre, filtrada por los criterios habituales.
     *
     * Devuelve un array de grupos: cada grupo es un array de nodos hermanos.
     * Solo se incluyen grupos con >= MIN_SIBLINGS_FOR_CHECK elementos.
     */
    this._siblingGroups = function(node, depth, groups) {
        if (!node || node.nodeType !== 1) return;
        if (depth > MAX_DEPTH_FOR_CHECK) return;

        // Recoger hijos elemento de este nodo que pasen los filtros
        const parentTag = node.tagName;
        // Excluir BODY como padre — sus hijos (header/main/footer) son
        // siempre heterogéneos y generan grupos espurios con textCov=1.0
        const skipGroup = (parentTag === 'BODY');
        const grandParentTag = node.parentNode ? node.parentNode.tagName : null;

        const children = [];
        for (let i = 0; i < node.childNodes.length; i++) {
            const ch = node.childNodes[i];
            if (!ch || ch.nodeType !== 1) continue;

            const cls = this._phi(ch.tagName, ch);
            const isInsideTd = parentTag === "TD" || parentTag === "TH";
            const parentIsList = parentTag === "UL" || parentTag === "OL" || parentTag === "DL";
            const sz = this._subtreeSize(ch);

            // Filtro de tabla: TR solo si la tabla tiene muchas filas
            let isSmallTableRow = false;
            if (ch.tagName === "TR") {
                const tableNode = (parentTag === "TABLE") ? node
                    : (grandParentTag === "TABLE") ? node.parentNode
                    : null;
                const rows = tableNode ? this._countTableRows(tableNode) : 0;
                isSmallTableRow = rows < MIN_TABLE_ROWS_FOR_INDEX;
            }

            if (!LEAF_CLASSES.has(cls) &&
                ch.tagName !== "BODY" &&
                !isInsideTd &&
                !isSmallTableRow &&
                !(parentIsList && sz <= SIMPLE_ITEM_MAX_SIZE) &&
                sz >= 3) {
                children.push(ch);
            }
        }

        // Si este nodo tiene suficientes hijos candidatos, es un grupo.
        // Excepción: si el padre es BODY y todos los hijos son elementos
        // de layout estructural (section/article/main/aside/nav/header/footer/div),
        // solo incluir si hay >= 5 hijos de la misma tagName (cards reales).
        if (children.length >= MIN_SIBLINGS_FOR_CHECK) {
            let skipGroup2 = false;
            if (skipGroup) {
                // Padre es BODY: solo incluir si los hijos son cards repetidas
                // (misma tagName en mayoría), no layout estructural variado
                const tagCounts = {};
                for (const ch of children) {
                    tagCounts[ch.tagName] = (tagCounts[ch.tagName] || 0) + 1;
                }
                const maxTagCount = Math.max(...Object.values(tagCounts));
                // Si ninguna tagName domina con >= 80% de los nodos, es layout
                skipGroup2 = maxTagCount < children.length * 0.8;
            }
            if (!skipGroup2) {
                groups.push({ nodes: children, depth });
            }
        }

        // Descender en todos los hijos elemento (no solo los candidatos)
        for (let i = 0; i < node.childNodes.length; i++) {
            this._siblingGroups(node.childNodes[i], depth + 1, groups);
        }
    };

    /**
     * Para un array de nodos al mismo nivel, calcular la similitud
     * estructural media entre todos los pares.
     *
     * similarityScore = 1 - avg(TED_normalized(i, j))  para todos i < j
     *
     * Si la similitud media es alta → los nodos son estructuralmente repetidos.
     */
    this._levelSimilarity = function(nodes) {
        if (nodes.length < 2) return 0;
        const memo = {};
        let sumSim = 0;
        let count = 0;

        // Filtrar outliers de tamaño antes de muestrear.
        // En una página como aesan, el contenedor principal (DIV.normal, textLen=22268)
        // convive con los items del listado (DIV.small-4, textLen~200-400).
        // Si incluimos el outlier en el sample, la similitud media cae a 0.
        // Estrategia: calcular mediana de tamaños y excluir nodos cuyo tamaño
        // supere 4× la mediana (son contenedores, no items).
        const nodeSizes = nodes.map(n => this._subtreeSize(n));
        const sorted_sizes = nodeSizes.slice().sort((a,b) => a-b);
        const median = sorted_sizes[Math.floor(sorted_sizes.length / 2)];
        const filtered = nodes.filter((n, i) => nodeSizes[i] <= median * 4);

        // Si el filtrado deja menos de MIN_SIBLINGS_FOR_CHECK nodos, usar todos
        const pool = filtered.length >= 2 ? filtered : nodes;

        // Tomar los 8 más grandes del pool filtrado (los items más ricos del listado)
        const poolSorted = pool.slice().sort((a,b) => this._subtreeSize(b) - this._subtreeSize(a));
        const sample = poolSorted.slice(0, 8);
        for (let i = 0; i < sample.length; i++) {
            for (let j = i + 1; j < sample.length; j++) {
                const dist = this._tedNormalized(sample[i], sample[j], memo);
                sumSim += (1 - dist);
                count++;
            }
        }
        const structuralSim = count > 0 ? sumSim / count : 0;

        // Factor de uniformidad de tamaño:
        // En un índice las cards tienen tamaños muy parecidos (CV bajo).
        // En contenido real las secciones varían mucho (CV alto).
        // CV = stdDev / mean; lo invertimos para que CV alto → factor bajo.
        const sizes = sample.map(n => this._subtreeSize(n));
        const mean  = sizes.reduce((a,b)=>a+b,0) / sizes.length;
        if (mean === 0) return 0;
        const variance = sizes.reduce((a,b)=>a+(b-mean)**2,0) / sizes.length;
        const cv = Math.sqrt(variance) / mean;  // coeficiente de variación
        // Penalización: CV > 0.5 empieza a reducir el score;
        //               CV > 1.5 lo anula casi completamente.
        const uniformityFactor = Math.max(0, 1 - cv * 0.7);

        return structuralSim * uniformityFactor;
    };

    /**
     * Cuenta caracteres de texto (sin espacios) en un subárbol.
     * Ignora nodos dentro de <A> para no contar texto de enlaces.
     */
    this._countText = function(node, insideSkip) {
        if (!node) return 0;
        if (node.nodeType === 3) {
            if (insideSkip) return 0;
            return (node.textContent || '').replace(/\s+/g, '').length;
        }
        if (node.nodeType !== 1) return 0;
        const tag = node.tagName;
        // Ignorar SVG, SCRIPT, STYLE, CANVAS — su contenido no es texto legible
        if (tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CANVAS') return 0;
        let total = 0;
        for (let i = 0; i < node.childNodes.length; i++)
            total += this._countText(node.childNodes[i], insideSkip);
        return total;
    };

    /**
     * Calcular el repetitionScore global de la página.
     *
     * La clave es ponderar por FRACCIÓN DE TEXTO, no de nodos DOM.
     * Un widget de "noticias relacionadas" puede tener muchos nodos
     * pero poco texto respecto al cuerpo del artículo. Si las estructuras
     * repetidas solo representan el 15% del texto total, no es un índice.
     *
     * Sube por los ancestros de un nodo buscando el primer <main> o [role=main].
     * Si no encuentra ninguno antes del body, devuelve body.
     * Solo usamos main (no article/section) porque son demasiado genéricos:
     * las secciones de "relacionadas" también se implementan con <section>/<article>.
     */
    this._semanticAncestor = function(node, body) {
        let cur = node;
        while (cur && cur !== body) {
            const tag = cur.tagName ? cur.tagName.toUpperCase() : '';
            if (tag === 'MAIN') return cur;
            if (cur.role === 'main') return cur;
            cur = cur.parentNode;
        }
        return body;
    };

    /**
     * Fórmula: score = similitud × textCoverage × countFactor
     *   - similitud:    TED entre pares de nodos hermanos (0=distintos, 1=idénticos)
     *   - textCoverage: fracción del texto total de la página en esos nodos
     *   - countFactor:  escala log con el número de nodos repetidos
     *
     * Devuelve { score, bestDepth, details }
     */
    this._computeRepetitionScore = function(body) {
        // Asignar IDs para memoización
        this._assignTedIds(body, 1);

        // Recoger grupos de hermanos reales (mismo padre)
        const groups = [];
        this._siblingGroups(body, 0, groups);

        // totalText se calcula por grupo: usa el primer ancestro semántico
        // (main/article/section) del grupo como referencia, o body si no hay ninguno.
        // Esto excluye sidebars y widgets en otras ramas sin tocar el DOM.
        const bodyText = Math.max(this._countText(body), 1);
        let bestScore = 0;
        let bestDepth = -1;
        const details = {};

        for (const group of groups) {
            const { nodes, depth } = group;

            const sim = this._levelSimilarity(nodes);

            const parent = nodes[0] ? nodes[0].parentNode : null;
            const ancestor = this._semanticAncestor(nodes[0], body);
            const ancestorText = this._countText(ancestor);
            // Fallback a body si el ancestro semántico es demasiado pequeño (<5% body)
            const totalText = Math.max(
                ancestorText > bodyText * 0.05 ? ancestorText : bodyText,
                1
            );
            const levelText = nodes.reduce((s, n) => s + this._countText(n), 0);
            const textCoverage = levelText / totalText;

            // Factor de cantidad
            const countFactor = Math.min(Math.log2(nodes.length) / Math.log2(12), 1);

            // Cobertura efectiva: boost si sim muy alta y muchos nodos
            let effectiveCov;
            if (sim >= 0.85 && nodes.length >= 20) {
                effectiveCov = Math.min(textCoverage * 5, 1);
            } else {
                effectiveCov = Math.min(textCoverage * 2, 1);
            }

            // Penalización de dominancia: si hay un hermano fuera del grupo
            // con más de 3× el texto del grupo completo, es un widget secundario.
            // Umbral de 3× para no penalizar índices con cabeceras/pies pequeños.
            let maxSiblingText = 0;
            if (parent) {
                for (let i = 0; i < parent.childNodes.length; i++) {
                    const sib = parent.childNodes[i];
                    if (sib && sib.nodeType === 1 && !nodes.includes(sib)) {
                        const st = this._countText(sib);
                        if (st > maxSiblingText) maxSiblingText = st;
                    }
                }
            }
            const groupText = nodes.reduce((s, n) => s + this._countText(n), 0);
            // Solo penalizar si el hermano más grande tiene más de 3× el texto del grupo
            const dominanceFactor = maxSiblingText > groupText * 3
                ? groupText / (groupText + maxSiblingText)
                : 1;

            const weighted = sim * effectiveCov * countFactor * dominanceFactor;

            // Guardar en details con clave depth (puede haber varios grupos al mismo depth)
            const key = depth;
            if (!details[key] || weighted > details[key].weighted) {
                details[key] = { nodes: nodes.length, similarity: sim, textCoverage, weighted };
            }

            if (weighted > bestScore) {
                bestScore = weighted;
                bestDepth = depth;
            }
        }

        return { score: bestScore, bestDepth, details };
    };

    // ─────────────────────────────────────────────────────────────
    // ④ LIMPIEZA (tomada del código original)
    // ─────────────────────────────────────────────────────────────

    this.preprocess = function(node) {
        if (node.tagName === "SCRIPT" || node.tagName === "STYLE" ||
            node.tagName === "IFRAME" || node.role === "dialog") {
            const nodo = document.createElement('div');
            nodo.textContent = "";
            node.parentNode.replaceChild(nodo, node);
        }
        if (node && node.childNodes.length > 0) {
            const children = node.childNodes;
            for (let i = 0; i < children.length; i++)
                this.preprocess(children[i]);
        }
    };

    this.removeNotAllowed = function(node) {
        if (node && node.nodeType === 1 && node.tagName !== undefined) {
            const classes = node.className + " ";
            const ids = node.id + " ";
            let found = false;
            for (let i = 0; i < this.negativeTokens.length; i++) {
                if (classes.includes(this.negativeTokens[i]) ||
                    ids.includes(this.negativeTokens[i])) {
                    found = true;
                    break;
                }
            }
            if (found && node.parentNode) {
                const nodo = document.createElement('div');
                nodo.textContent = "";
                node.parentNode.replaceChild(nodo, node);
                return; // no seguir descendiendo en el nodo reemplazado
            }
        }
        if (node && node.childNodes.length > 0) {
            const children = node.childNodes.length;
            for (let i = 0; i < children; i++)
                this.removeNotAllowed(node.childNodes[i]);
        }
    };

    this.removeUnwanted = function(node) {
        if (node && (node.tagName === "FIELDSET" || node.tagName === "LABEL" ||
            node.tagName === "BUTTON" || node.tagName === "INPUT" ||
            node.tagName === "SELECT" || node.tagName === "NAV" ||
            node.tagName === "FOOTER" || node.tagName === "HEADER" ||
            node.tagName === "NOSCRIPT")) {
            const nodo = document.createElement('div');
            nodo.textContent = "";
            node.parentNode.replaceChild(nodo, node);
            return;
        }
        if (node && node.childNodes.length > 0) {
            const children = node.childNodes.length;
            for (let i = 0; i < children; i++)
                this.removeUnwanted(node.childNodes[i]);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // ⑤ PROCESO PRINCIPAL
    // ─────────────────────────────────────────────────────────────

    this.processContent = function(body) {

        // — Fase 1: Limpieza del DOM —
        this.preprocess(body);
        this.removeNotAllowed(body);
        this.removeUnwanted(body);

        // — Fase 2: Detección de repetición estructural via TED —
        const rep = this._computeRepetitionScore(body);

        const isIndex   = rep.score > INDEX_THRESHOLD;
        const hasContent = !isIndex;

        return {
            hasContent,
            isIndex,
            mainContent: body,
            repetitionScore: rep.score,
            tedDetails: {
                bestDepth:  rep.bestDepth,
                threshold:  INDEX_THRESHOLD,
                levelStats: rep.details
            }
        };
    };

    return this.processContent(body);
};