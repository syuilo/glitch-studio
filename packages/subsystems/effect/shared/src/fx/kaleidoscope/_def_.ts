import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'kaleidoscope',
	displayName: 'Kaleidoscope',
	description: {
		'ja-JP': '入力画像の扇形領域を円周方向に鏡映・反復し、万華鏡のような模様を作ります。',
		'en-US': 'Mirrors and repeats a wedge of the input image around a center to create a kaleidoscope pattern.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['transform', 'pattern'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		// 鏡映前後の扇形を合わせた組の数。6なら30°の扇形が12枚並ぶ。
		repetitions: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Repetitions',
				control: {
					controlType: 'range',
					min: 1,
					max: 32,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 6 },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Center',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sourceCenter: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Source Center',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		sourceRotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Source Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Zoom',
				control: {
					controlType: 'range',
					min: 0.01,
					max: 8,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
