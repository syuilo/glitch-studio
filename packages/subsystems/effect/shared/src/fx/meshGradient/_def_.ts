import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'meshGradient',
	displayName: 'Mesh Gradient',
	description: {
		'ja-JP': '複数の色がなめらかに混ざり合うグラデーションを生成します。',
		'en-US': 'Generates a gradient with multiple colors blending smoothly into one another.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['color', 'gradient'],
	paramDefs: {
		colors: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Colors', control: { element: {} } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: [224 / 255, 234 / 255, 1, 1] } },
					{ id: 'second', binding: { inputSource: 'literal', value: [36 / 255, 29 / 255, 154 / 255, 1] } },
					{ id: 'third', binding: { inputSource: 'literal', value: [247 / 255, 80 / 255, 146 / 255, 1] } },
					{ id: 'fourth', binding: { inputSource: 'literal', value: [159 / 255, 80 / 255, 211 / 255, 1] } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		},
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		distortion: { dataType: { kind: 'scalar' }, ui: { label: 'Distortion', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		swirl: { dataType: { kind: 'scalar' }, ui: { label: 'Swirl', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		grainMixer: { dataType: { kind: 'scalar' }, ui: { label: 'Grain Mixer', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		grainOverlay: { dataType: { kind: 'scalar' }, ui: { label: 'Grain Overlay', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		scale: { dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.01, max: 4, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		offset: { dataType: { kind: 'vector' }, ui: { label: 'Offset', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
