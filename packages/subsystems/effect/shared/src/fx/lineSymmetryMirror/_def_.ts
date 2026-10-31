import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lineSymmetryMirror',
	displayName: 'Line Symmetry Mirror',
	description: {
		'ja-JP': '入力画像の片側を反対側へ鏡映し、左右・上下に対称な画像を作ります。',
		'en-US': 'Mirrors one half of the input image onto the other horizontally and vertically.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['transform'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		horizontal: {
			dataType: { kind: 'enum', options: ['leftToRight', 'none', 'rightToLeft'] },
			ui: { label: 'Horizontal', control: { labels: { leftToRight: 'Left to Right', none: 'None', rightToLeft: 'Right to Left' } } },
			defaultValue: { inputSource: 'literal', value: 'leftToRight' },
		},
		vertical: {
			dataType: { kind: 'enum', options: ['topToBottom', 'none', 'bottomToTop'] },
			ui: { label: 'Vertical', control: { labels: { topToBottom: 'Top to Bottom', none: 'None', bottomToTop: 'Bottom to Top' } } },
			defaultValue: { inputSource: 'literal', value: 'none' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
