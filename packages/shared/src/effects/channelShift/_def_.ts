import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'channelShift',
	displayName: 'Channel Shift',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { dataType: 'vector', ui: { control: 'vector', min: -1, max: 1, step: 0.01 }, label: 'Amount', default: () => ({ inputSource: 'literal', value: [0.02, 0] }) },
		leftSignal: { dataType: 'color', ui: { control: 'color', asRgbSwitch: true }, label: 'L signal', default: () => ({ inputSource: 'literal', value: [1, 0, 0, 1] }) },
		rightSignal: { dataType: 'color', ui: { control: 'color', asRgbSwitch: true }, label: 'R signal', default: () => ({ inputSource: 'literal', value: [0, 0, 1, 1] }) },
		blendMode: { dataType: 'blendMode', ui: { control: 'blendMode' }, label: 'Blend mode', default: () => ({ inputSource: 'literal', value: 'lighten' }) },
		wrap: { dataType: 'wrapMode', ui: { control: 'wrapMode' }, label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
