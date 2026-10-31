import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorFieldVisualization',
	displayName: 'Vector Field Visualization',
	description: {
		'ja-JP': 'ベクトル場をセル中心の矢印で可視化します。大きさに応じた長さとColor Ramp、ゼロ・上限超過の専用色、グリッドの太さを設定できます。ゼロベクトルは点として描画します。',
		'en-US': 'Visualizes a vector field with centered arrows. Magnitude controls length and a color ramp, with dedicated zero and overflow colors and adjustable grid width. Zero vectors appear as dots.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['utility', 'convert'],
	paramDefs: {
		vector: {
			dataType: { kind: 'vector' },
			ui: { label: 'Vector', control: { controlType: 'vector' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		density: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Density', control: { controlType: 'range', min: 1, max: 100, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 20 },
		},
		maximumMagnitude: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Magnitude', control: { controlType: 'number', min: 0.000001, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		lineWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Line Width', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.04 },
		},
		ramp: {
			dataType: { kind: 'colorRamp' },
			ui: { label: 'Ramp', control: {} },
			defaultValue: { inputSource: 'literal', value: {
				interpolation: 'linear', colorSpace: 'srgb', stops: [
					{ id: 'start', position: 0, color: [0.1, 0.6, 1, 1] },
					{ id: 'end', position: 1, color: [1, 0.85, 0.1, 1] },
				],
			} },
		},
		zeroColor: { dataType: { kind: 'color' }, ui: { label: 'Zero Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		overflowColor: { dataType: { kind: 'color' }, ui: { label: 'Overflow Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 0.1, 0.25, 1] } },
		// 数値の大きさと、画像上の変位方向の確認を切り替えられるよう、方向の解釈だけを分離する。
		directionSpace: {
			dataType: { kind: 'enum', options: ['component', 'displacement'] },
			ui: { label: 'Direction Space', control: { labels: { component: 'Vector Components', displacement: 'Image Displacement' } } },
			defaultValue: { inputSource: 'literal', value: 'component' },
		},
		gridWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Grid Width', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		gridColor: { dataType: { kind: 'color' }, ui: { label: 'Grid Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.15] } },
	},
	primaryInputParameter: 'vector',
	resolutionInputParameters: ['vector'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
