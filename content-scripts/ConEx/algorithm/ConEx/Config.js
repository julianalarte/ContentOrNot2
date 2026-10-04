ConEx.conex.Config =
{
	// Umbral de repetitionScore por encima del cual la página se clasifica
	// como índice (isIndex: true). Rango [0, 1].
	indexThreshold: 0.55,

	// Número mínimo de nodos hermanos reales (mismo padre) para activar
	// la comparación TED en ese grupo.
	minSiblingsForCheck: 4,

	// Profundidad máxima del árbol DOM a la que se buscan grupos de hermanos.
	maxDepthForCheck: 12,

	// Tamaño máximo de subárbol (nodos) para TED exacto.
	maxSubtreeSize: 60
}
