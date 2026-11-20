import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Sample Image',
	summary: {
		'ja-JP': 'ベクトル場の値を絶対座標として、その位置の入力画像の色を出力します。',
		'en-US': 'Samples the input image at absolute positions supplied by a vector field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		coordinates: {
			dataType: { kind: 'vector' },
			ui: { label: 'Coordinates', control: { controlType: 'vector', min: -0.5, max: 0.5, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
	},
	primaryInputParameter: 'input',
	// 座標場は参照位置を指定する制御入力なので、画像の自動解像度を変更しない。
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
