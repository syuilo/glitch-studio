import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'transform',
	displayName: 'Transform',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		translation: { dataType: 'vector', ui: { control: 'vector', min: -1, max: 1, step: 0.01 }, label: 'Translation', canNode: true, default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		scale: { dataType: 'vector', ui: { control: 'vector', min: -1, max: 4, step: 0.01 }, label: 'Scale', canNode: true, default: () => ({ inputSource: 'literal', value: [1, 1] }) },
		rotation: { dataType: 'scalar', ui: { control: 'angle' }, label: 'Rotation', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		wrap: {
			dataType: 'wrapMode', ui: { control: 'wrapMode' }, label: 'Wrap', canNode: false, canTransparent: true,
			default: () => ({ inputSource: 'literal', value: 'transparent' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
