import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: "Baker's Map",
	summary: {
		'ja-JP': '画像を引き伸ばして切り分け、積み直す変換を繰り返します。逆方向の変換も選べます。',
		'en-US': 'Repeatedly stretches, cuts, and stacks the image using the baker\'s map, with forward and inverse directions.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['transform', 'glitch', 'math', 'experimental'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		iterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Iterations', control: { controlType: 'range', min: 0, max: 16, step: 1 } },
			defaultValue: 3,
		},
		direction: {
			dataType: { kind: 'enum', options: ['forward', 'inverse'] },
			ui: { label: 'Direction', control: { labels: { forward: 'Forward', inverse: 'Inverse' } } },
			defaultValue: 'forward',
		},
		axis: {
			dataType: { kind: 'enum', options: ['x', 'y'] },
			ui: { label: 'Axis', control: { labels: { x: 'X', y: 'Y' } } },
			defaultValue: 'x',
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
