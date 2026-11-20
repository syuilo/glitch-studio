import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Luminance Gradient',
	summary: {
		'ja-JP': '画像の輝度をぼかし、明るくなる方向と変化の急さをベクトル場として出力します。',
		'en-US': 'Smooths image luminance and outputs its direction and rate of increase as a vector field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	canHaveLongRunningRenderPass: true,
	tags: ['color', 'math', 'utility', 'convert'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		blurRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Radius', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: 0.01,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
		strength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Strength', control: { controlType: 'number', step: 0.01 } },
			defaultValue: 1,
		},
		normalize: {
			dataType: { kind: 'bool' },
			ui: { label: 'Normalize', control: {} },
			defaultValue: false,
		},
		alphaMode: {
			dataType: { kind: 'enum', options: ['include', 'ignore'] },
			ui: { label: 'Alpha Mode', control: { labels: { include: 'Include Alpha', ignore: 'Ignore Alpha' } } },
			defaultValue: 'include',
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
