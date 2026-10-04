// Adapted from Paper Design's Water (Apache-2.0; see ../../../renderer/src/effect-implementations/water/LICENSE).
// Modified for WebGPU node inputs, without background or image layout controls.
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'water',
	displayName: 'Water',
	description: {
		'ja-JP': '入力画像に、水面越しに見たような揺らぎや光の模様を加えます。',
		'en-US': 'Adds ripples and light patterns to the input image as if viewed through water.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'liquid', 'gimmicky', 'stylized'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		colorHighlight: { dataType: { kind: 'color' }, ui: { label: 'Highlight color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		colorHighlightAlpha: { dataType: { kind: 'scalar' }, ui: { label: 'Highlight alpha', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		highlights: { dataType: { kind: 'scalar' }, ui: { label: 'Highlights', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.07 } },
		layering: { dataType: { kind: 'scalar' }, ui: { label: 'Layering', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		edges: { dataType: { kind: 'scalar' }, ui: { label: 'Edges', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		waves: { dataType: { kind: 'scalar' }, ui: { label: 'Waves', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		caustic: { dataType: { kind: 'scalar' }, ui: { label: 'Caustic', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
		density: { dataType: { kind: 'scalar' }, ui: { label: 'Density', control: { controlType: 'range', min: 1, max: 1000, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: 20 } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		speed: { dataType: { kind: 'scalar' }, ui: { label: 'Speed', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		frame: { dataType: { kind: 'scalar' }, ui: { label: 'Frame offset (ms)', control: { controlType: 'number', step: 1 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
