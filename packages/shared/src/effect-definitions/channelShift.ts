import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'channelShift',
	displayName: 'Channel Shift',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'vector', min: -1, max: 1, step: 0.01, label: 'Amount', default: () => ({ type: 'literal', value: [0.02, 0] }) },
		leftSignal: { type: 'signal', label: 'L signal', default: () => ({ type: 'literal', value: [true, false, false] }) },
		rightSignal: { type: 'signal', label: 'R signal', default: () => ({ type: 'literal', value: [false, false, true] }) },
		blendMode: { type: 'blendMode', label: 'Blend mode', default: () => ({ type: 'literal', value: 'lighten' }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ type: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
