import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorDisplacement',
	displayName: 'Vector displacement',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		vector: { dataType: 'vector', ui: { control: 'vector', max: 1 }, label: 'Vector', canNode: true, mim: -1, default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		amount: { dataType: 'number', ui: { control: 'range', min: -1, max: 1, step: 0.001 }, label: 'Amount', default: () => ({ inputSource: 'literal', value: 0.05 }) },
		flipX: { dataType: 'bool', ui: { control: 'bool' }, label: 'Flip X', default: () => ({ inputSource: 'literal', value: false }) },
		flipY: { dataType: 'bool', ui: { control: 'bool' }, label: 'Flip Y', default: () => ({ inputSource: 'literal', value: false }) },
		rotation: { dataType: 'number', ui: { control: 'angle' }, label: 'Rotation', default: () => ({ inputSource: 'literal', value: 0 }) },
		wrap: { dataType: 'wrapMode', ui: { control: 'wrapMode' }, label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
