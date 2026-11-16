import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'cardFlip',
	displayName: 'Card Flip',
	description: {
		'ja-JP': '中央を軸にカードを180度回転させ、表の画像Aから裏の画像Bへ切り替えます。',
		'en-US': 'Rotates a card 180 degrees around its center, switching from image A on the front to image B on the back.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'transform'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		background: {
			dataType: { kind: 'color' },
			ui: { label: 'Background', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		flipDirection: {
			dataType: { kind: 'enum', options: ['left', 'right', 'top', 'bottom'] },
			ui: { label: 'Flip Direction', control: { labels: { left: 'Left Toward Viewer', right: 'Right Toward Viewer', top: 'Top Toward Viewer', bottom: 'Bottom Toward Viewer' } } },
			defaultValue: { inputSource: 'literal', value: 'right' },
		},
		perspective: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Perspective', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		shading: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shading', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.6 },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB', 'background'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
