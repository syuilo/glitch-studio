import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelate',
	displayName: 'Pixelate',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		size: { dataType: 'vector', ui: { label: 'Size', control: 'vector', min: 0, max: 1, step: 0.001 }, canNode: true, defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit Mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		rotation: { dataType: 'scalar', ui: { label: 'Rotation', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		samples: { dataType: 'scalar', ui: { label: 'Samples', control: 'range', min: 1, max: 256, step: 1 }, defaultValue: { inputSource: 'literal', value: 16 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
