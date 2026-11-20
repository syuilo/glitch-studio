import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Exposure',
	summary: {
		'ja-JP': 'linear RGBの光量をEV単位で調整します。HDR・負値を保持します。',
		'en-US': 'Adjusts linear RGB exposure in EV while preserving HDR and negative values.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		exposure: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Exposure (EV)',
				control: {
					controlType: 'range',
					min: -10,
					max: 10,
					step: 0.1,
				},
			},
			canNode: true,
			defaultValue: 0,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
