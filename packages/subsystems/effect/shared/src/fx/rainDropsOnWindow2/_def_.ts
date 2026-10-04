import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rainDropsOnWindow2',
	displayName: 'Rain Drops On Window (Type 2)',
	description: {
		'ja-JP': '入力画像を、雨粒の付いた窓ガラス越しに見たように歪めます。',
		'en-US': 'Distorts the input image as if viewed through a window covered in raindrops.',
	},
	kind: 'modify',
	tags: ['distortion', 'liquid', 'gimmicky'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		density: { dataType: { kind: 'scalar' }, ui: { label: 'Density', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		scale: { dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.1, max: 5, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		refraction: { dataType: { kind: 'scalar' }, ui: { label: 'Refraction', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
