import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'maskToSdf',
	displayName: 'Mask to SDF',
	description: {
		'ja-JP': 'スカラー場の閾値輪郭から符号付き距離を生成します。内側は負、外側は正で、描画領域の高さを1とします。画面外は背景として扱い、距離はJFAで近似します。',
		'en-US': 'Approximates signed distances to a scalar field threshold contour using JFA. Negative inside, positive outside, in render-height units. Treats the area outside the render bounds as background.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'convert', 'sdf'],
	paramDefs: {
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Threshold', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		invert: {
			dataType: { kind: 'bool' },
			ui: { label: 'Invert', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
