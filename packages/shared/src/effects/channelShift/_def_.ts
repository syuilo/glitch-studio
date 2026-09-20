import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'channelShift',
	displayName: 'Channel Shift',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'vector', min: -1, max: 1, step: 0.01, label: 'Amount', default: () => ({ inputSource: 'literal', value: [0.02, 0] }) },
		leftSignal: { type: 'color', asRgbSwitch: true, label: 'L signal', default: () => ({ inputSource: 'literal', value: [1, 0, 0, 1] }) },
		rightSignal: { type: 'color', asRgbSwitch: true, label: 'R signal', default: () => ({ inputSource: 'literal', value: [0, 0, 1, 1] }) },
		blendMode: { type: 'blendMode', label: 'Blend mode', default: () => ({ inputSource: 'literal', value: 'lighten' }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
