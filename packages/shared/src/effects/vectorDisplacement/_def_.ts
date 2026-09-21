import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorDisplacement',
	displayName: 'Vector displacement',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		vector: { dataType: 'vector', ui: { label: 'Vector', control: 'vector', max: 1 }, canNode: true, mim: -1, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: -1, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		flipX: { dataType: 'bool', ui: { label: 'Flip X', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		flipY: { dataType: 'bool', ui: { label: 'Flip Y', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		rotation: { dataType: 'scalar', ui: { label: 'Rotation', control: 'angle' }, defaultValue: { inputSource: 'literal', value: 0 } },
		wrap: { dataType: 'wrapMode', ui: { label: 'Wrap', control: 'wrapMode' }, defaultValue: { inputSource: 'literal', value: 'repeatMirrored' } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
