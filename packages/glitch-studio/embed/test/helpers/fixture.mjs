export const literal = value => ({ inputSource: 'literal', value });
export const parameter = (kind, value, name = kind) => ({
	nameForReference: name, canNode: false, dataType: { kind },
	ui: { label: name, control: {} }, defaultValue: value,
});

export function shaderDefinition(code) {
	return {
		shaderApiVersion: 1, kind: 'generate', paramDefs: {},
		outputDefs: { output: { nameForReference: 'color', dataType: { kind: 'color' } } },
		primaryInputParameter: null, primaryOutput: 'output', resolutionInputParameters: [], code,
	};
}

export function fixture() {
	return {
		name: 'Portable Custom Node Graph Effect', gsVersion: 'test', assets: [], players: [], customShaderEffects: [], customNodeGraphEffects: [],
		aspectRatio: 2, settings: { resolutionScale: 1, maxPixels: 8294400, fpsLimit: null }, initialParameters: {},
		customNodeGraphEffect: {
			kind: 'generate', paramDefs: { levelId: parameter('scalar', 0.25, 'level') },
			primaryInputParameter: null, primaryOutput: 'output', resolutionInputParameters: [],
			outputDefs: { output: { dataType: { kind: 'color' } } },
			outputSources: { output: { nodeId: 'fill', outputPort: 'output' } },
			nodes: [{ id: 'fill', effectSource: { type: 'nativeEffect', id: 'fill' },
				params: { color: { inputSource: 'expression', expression: '[PUBLIC("level"), 0, 0, 1]' } } }],
		},
	};
}
