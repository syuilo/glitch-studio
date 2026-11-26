import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

const definition = defineNativeEffect({
	displayName: 'Feedback',
	summary: {
		'ja-JP': '入力データを時間とともに蓄積・減衰させたり、変化をなめらかにしたりします。',
		'en-US': 'Accumulates and fades input data over time or smooths its changes.',
	},
	kind: 'modify',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'utility'],
	thumbnail: { mode: 'none' },
	paramDefs: {
		input: {
			dataType: { kind: 'any' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		mode: { dataType: { kind: 'enum', options: ['add', 'interpolate'] }, ui: { label: 'Mode', control: { labels: { add: 'Add', interpolate: 'Interpolate' } } }, defaultValue: 'add' },
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
			defaultValue: 1,
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
			defaultValue: 300,
		},
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: false },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});

export default definition;
