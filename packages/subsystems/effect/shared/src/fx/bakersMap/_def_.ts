import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'bakersMap',
	displayName: "Baker's Map",
	description: {
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
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		iterations: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Iterations', control: { controlType: 'range', min: 0, max: 16, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 3 },
		},
		direction: {
			dataType: { kind: 'enum', options: ['forward', 'inverse'] },
			ui: { label: 'Direction', control: { labels: { forward: 'Forward', inverse: 'Inverse' } } },
			defaultValue: { inputSource: 'literal', value: 'forward' },
		},
		axis: {
			dataType: { kind: 'enum', options: ['x', 'y'] },
			ui: { label: 'Axis', control: { labels: { x: 'X', y: 'Y' } } },
			defaultValue: { inputSource: 'literal', value: 'x' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
