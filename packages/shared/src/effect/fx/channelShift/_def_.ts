import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'channelShift',
	displayName: 'Channel Shift',
	tags: [],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'vector' }, ui: { label: 'Amount', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [0.02, 0] } },
		leftSignal: { dataType: { kind: 'color' }, ui: { label: 'L signal', control: { controlType: 'signal' } }, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } },
		rightSignal: { dataType: { kind: 'color' }, ui: { label: 'R signal', control: { controlType: 'signal' } }, defaultValue: { inputSource: 'literal', value: [0, 0, 1, 1] } },
		channelBlendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Channel Blend', control: {} }, defaultValue: { inputSource: 'literal', value: 'lighten' } },
		inputBlendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Input Blend', control: {} }, defaultValue: { inputSource: 'literal', value: 'replace' } },
	},
	primaryInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
