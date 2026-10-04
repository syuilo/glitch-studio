import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'bloom',
	displayName: 'Bloom',
	description: {
		'ja-JP': '入力画像の明るい部分をにじませ、光の広がりを加えます。',
		'en-US': 'Spreads light from bright areas of the input image to create a glow.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['blur', 'light'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		inputBlendMode: { dataType: { kind: 'blendMode' }, ui: { label: 'Input Blend', control: {} }, defaultValue: { inputSource: 'literal', value: 'emission' } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.7 } },
		softKnee: { dataType: { kind: 'scalar' }, ui: { label: 'Soft knee', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		radius: { dataType: { kind: 'vector' }, ui: { label: 'Radius', control: { controlType: 'vector', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0.7, 0.7] } },
		quality: { dataType: { kind: 'scalar' }, ui: { label: 'Quality', control: { controlType: 'range', min: 0.1, max: 1, step: 0.05 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
