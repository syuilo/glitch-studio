import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blockShuffle',
	displayName: 'Block shuffle',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Amount', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		size: { type: 'vector', min: 0, max: 1, step: 0.01, label: 'Size', canNode: true, default: () => ({ inputSource: 'literal', value: [0.9, 0.9] }) },
		fitMode: { type: 'fitMode', label: 'Fit mode', default: () => ({ inputSource: 'literal', value: 'contain' }) },
		randomSwap: { type: 'bool', label: 'Random swap', default: () => ({ inputSource: 'literal', value: true }) },
		randomRotation: { type: 'bool', label: 'Random rotation', default: () => ({ inputSource: 'literal', value: false }) },
		randomFlipX: { type: 'bool', label: 'Random flip X', default: () => ({ inputSource: 'literal', value: false }) },
		randomFlipY: { type: 'bool', label: 'Random flip Y', default: () => ({ inputSource: 'literal', value: false }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
