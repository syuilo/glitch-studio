import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Pointer Trail',
	summary: {
		'ja-JP': 'ポインターの動きを、時間とともに減衰するベクトル場として出力します。',
		'en-US': 'Outputs pointer motion as a vector field that fades over time.',
	},
	kind: 'generate',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'interactive', 'utility'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		strength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Strength',
				control: {
					controlType: 'range',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: 0.3,
		},

		radius: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Radius',
				control: {
					controlType: 'range',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: 0.3,
		},
		halfLife: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Half-Life (ms)',
				control: {
					controlType: 'range',
					min: 1,
					max: 5000,
					step: 1,
				},
			},
			defaultValue: 300,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
		scalar: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
