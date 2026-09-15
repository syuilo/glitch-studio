import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'blockShuffle',
	displayName: 'Block shuffle',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Amount', default: () => ({ type: 'literal', value: 0.5 }) },
		size: { type: 'vector', min: 0, max: 1, step: 0.01, label: 'Size', canNode: true, default: () => ({ type: 'literal', value: [0.9, 0.9] }) },
		fitMode: { type: 'fitMode', label: 'Fit mode', default: () => ({ type: 'literal', value: 'contain' }) },
		randomSwap: { type: 'bool', label: 'Random swap', default: () => ({ type: 'literal', value: true }) },
		randomRotation: { type: 'bool', label: 'Random rotation', default: () => ({ type: 'literal', value: false }) },
		randomFlipX: { type: 'bool', label: 'Random flip X', default: () => ({ type: 'literal', value: false }) },
		randomFlipY: { type: 'bool', label: 'Random flip Y', default: () => ({ type: 'literal', value: false }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
