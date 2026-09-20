import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'transform',
	displayName: 'Transform',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		translation: { type: 'vector', label: 'Translation', min: -1, max: 1, step: 0.01, canNode: true, default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		scale: { type: 'vector', label: 'Scale', min: -1, max: 4, step: 0.01, canNode: true, default: () => ({ inputSource: 'literal', value: [1, 1] }) },
		rotation: { type: 'angle', label: 'Rotation', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		wrap: {
			type: 'wrapMode', label: 'Wrap', canNode: false, canTransparent: true,
			default: () => ({ inputSource: 'literal', value: 'transparent' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
