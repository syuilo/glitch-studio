import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'opticalFlow',
	displayName: 'Optical flow',
	description: {
		'ja-JP': 'フレーム間の動きを推定し、移動方向と大きさをベクトル場として出力します。',
		'en-US': 'Estimates motion between frames and outputs its direction and magnitude as a vector field.',
	},
	kind: 'modify',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'analysis'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		confidence: { dataType: { kind: 'scalar' }, ui: { label: 'Confidence threshold', control: { controlType: 'range', min: 0, max: 0.01, step: 0.0001 } }, defaultValue: { inputSource: 'literal', value: 0.0001 } },
		smoothing: { dataType: { kind: 'scalar' }, ui: { label: 'Smoothing', control: { controlType: 'range', min: 0, max: 3, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'output',
});
