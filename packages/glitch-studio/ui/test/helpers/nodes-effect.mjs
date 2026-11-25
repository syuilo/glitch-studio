// テストが操作するポートとノードだけを宣言し、他のフィールドには有効な空のグラフの値を使う。
export function testNodesEffect(fields = {}) {
	return {
		kind: 'modify', paramDefs: {}, primaryInputParameter: null, primaryOutput: 'output', resolutionInputParameters: [],
		outputDefs: { output: { label: 'Output', dataType: { kind: 'color' } } }, nodes: [], outputSources: {},
		customParameterDefs: {}, customParameterValues: {}, curveAnimations: [], ...fields,
	};
}
