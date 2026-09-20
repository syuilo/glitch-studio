import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorDisplacement',
	displayName: 'Vector displacement',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		vector: { type: 'vector', label: 'Vector', canNode: true, mim: -1, max: 1, default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		amount: { type: 'range', label: 'Amount', min: -1, max: 1, step: 0.001, default: () => ({ inputSource: 'literal', value: 0.05 }) },
		flipX: { type: 'bool', label: 'Flip X', default: () => ({ inputSource: 'literal', value: false }) },
		flipY: { type: 'bool', label: 'Flip Y', default: () => ({ inputSource: 'literal', value: false }) },
		rotation: { type: 'angle', label: 'Rotation', default: () => ({ inputSource: 'literal', value: 0 }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
