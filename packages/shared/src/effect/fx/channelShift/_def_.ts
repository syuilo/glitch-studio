import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'channelShift',
	displayName: 'Channel Shift',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: 'vector', ui: { label: 'Amount', control: 'vector', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: [0.02, 0] } },
		leftSignal: { dataType: 'color', ui: { label: 'L signal', control: 'color', asRgbSwitch: true }, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } },
		rightSignal: { dataType: 'color', ui: { label: 'R signal', control: 'color', asRgbSwitch: true }, defaultValue: { inputSource: 'literal', value: [0, 0, 1, 1] } },
		blendMode: { dataType: 'blendMode', ui: { label: 'Blend mode', control: 'blendMode' }, defaultValue: { inputSource: 'literal', value: 'lighten' } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
