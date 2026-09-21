import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'transform',
	displayName: 'Transform',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		translation: { dataType: 'vector', ui: { label: 'Translation', control: 'vector', min: -1, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		scale: { dataType: 'vector', ui: { label: 'Scale', control: 'vector', min: -1, max: 4, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1] } },
		rotation: { dataType: 'scalar', ui: { label: 'Rotation', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		wrap: {
			dataType: 'wrapMode', ui: { label: 'Wrap', control: 'wrapMode' }, canNode: false, canTransparent: true,
			defaultValue: { inputSource: 'literal', value: 'transparent' },
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
