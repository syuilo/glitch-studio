import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'feedback',
	displayName: 'Feedback',
	description: {
		'ja-JP': '入力データを時間とともに蓄積・減衰させたり、変化をなめらかにしたりします。',
		'en-US': 'Accumulates and fades input data over time or smooths its changes.',
	},
	kind: 'modify',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'any' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		mode: { dataType: { kind: 'enum', options: ['add', 'interpolate'] }, ui: { label: 'Mode', control: { labels: { add: 'Add', interpolate: 'Interpolate' } } }, defaultValue: { inputSource: 'literal', value: 'add' } },
		strength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Strength',
				control: {
					controlType: 'range',
					min: 0,
					max: 10,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		halfLife: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Half-Life (ms)',
				control: {
					controlType: 'range',
					min: 0,
					max: 10000,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 300 },
		},
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
