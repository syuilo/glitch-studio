import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dilateErode',
	displayName: 'Dilate / Erode',
	description: {
		'ja-JP': 'スカラーマスクの領域を広げたり狭めたりします。',
		'en-US': 'Expands or shrinks regions in a scalar mask.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		operation: {
			dataType: { kind: 'enum', options: ['dilate', 'erode'] },
			ui: { label: 'Operation', control: { labels: { dilate: 'Dilate', erode: 'Erode' } } },
			defaultValue: { inputSource: 'literal', value: 'dilate' },
		},
		// 正方形の形態演算を段階的に合成するため、半径は描画全体で共通にする。
		radius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Radius (Reference Ratio)', control: { controlType: 'number', min: 0, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.01 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
