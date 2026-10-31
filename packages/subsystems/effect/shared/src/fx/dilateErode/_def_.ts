import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dilateErode',
	displayName: 'Dilate / Erode',
	description: {
		'ja-JP': '正方形の範囲の最大値・最小値でスカラーマスクを膨張・収縮させます。半径は出力の短辺に対する割合で指定し、画素単位へ切り上げます。出力範囲外は端の値を延長します。',
		'en-US': 'Dilates or erodes a scalar mask using the maximum or minimum over a square neighborhood. Radius is a fraction of the output short side, rounded up to pixels. Output edges are extended.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
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
