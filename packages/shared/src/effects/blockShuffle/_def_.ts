import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blockShuffle',
	displayName: 'Block shuffle',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Amount', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		size: { dataType: 'vector', ui: { control: 'vector', min: 0, max: 1, step: 0.01 }, label: 'Size', canNode: true, default: () => ({ inputSource: 'literal', value: [0.9, 0.9] }) },
		fitMode: { dataType: 'fitMode', ui: { control: 'fitMode' }, label: 'Fit mode', default: () => ({ inputSource: 'literal', value: 'contain' }) },
		randomSwap: { dataType: 'bool', ui: { control: 'bool' }, label: 'Random swap', default: () => ({ inputSource: 'literal', value: true }) },
		randomRotation: { dataType: 'bool', ui: { control: 'bool' }, label: 'Random rotation', default: () => ({ inputSource: 'literal', value: false }) },
		randomFlipX: { dataType: 'bool', ui: { control: 'bool' }, label: 'Random flip X', default: () => ({ inputSource: 'literal', value: false }) },
		randomFlipY: { dataType: 'bool', ui: { control: 'bool' }, label: 'Random flip Y', default: () => ({ inputSource: 'literal', value: false }) },
		seed: { dataType: 'scalar', ui: { control: 'seed' }, label: 'Seed', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
