export const literal = value => ({ inputSource: 'literal', value });
export const parameter = (kind, value, name = kind) => ({
	id: name, nameForReference: name, canNode: false, dataType: { kind },
	ui: { label: name, control: {} }, defaultValue: literal(value),
});

export function fixture() {
	return {
		name: 'Portable Visual Module', gsVersion: 'test', assets: [], players: [], customShaderEffects: [],
		aspectRatio: 2, settings: { resolutionScale: 1, maxPixels: 8294400, fpsLimit: null }, initialParameters: {},
		visualModule: {
			paramDefs: [parameter('scalar', 0.25, 'level')], customParameterDefs: [], customParameterValues: {}, automationGraphs: [],
			primaryInputId: null, primaryOutputId: 'output',
			outputDefs: [{ id: 'output', name: 'output', label: 'Output', dataType: { kind: 'color' } }],
			nodes: [
				{ id: 'fill', type: 'effect', effectId: 'fill', displayName: 'Fill', isBypass: false, resolution: { mode: 'context', scale: 1 }, staticSettings: {},
					params: { color: { inputSource: 'expression', expression: '[PUBLIC("level"), 0, 0, 1]' } } },
				{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'fill', outputPort: 'output' } } },
			],
		},
	};
}
