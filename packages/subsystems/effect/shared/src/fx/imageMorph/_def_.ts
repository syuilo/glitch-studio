import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'imageMorph',
	displayName: 'Image Morph',
	description: {
		'ja-JP': '2つの画像の対応を推定し、中間の形へ変形してなめらかに混ぜ合わせます。',
		'en-US': 'Estimates bidirectional image correspondences and warps both inputs into an intermediate shape before blending.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'composite', 'analysis'],
	paramDefs: {
		inputA: { dataType: { kind: 'color' }, ui: { label: 'Input A', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		inputB: { dataType: { kind: 'color' }, ui: { label: 'Input B', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		progress: { dataType: { kind: 'scalar' }, ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		warpStrength: { dataType: { kind: 'scalar' }, ui: { label: 'Warp Strength', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		linkBlendToProgress: { dataType: { kind: 'bool' }, ui: { label: 'Link Blend to Progress', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		blend: { dataType: { kind: 'scalar' }, ui: { label: 'Blend', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		searchRange: { dataType: { kind: 'scalar' }, ui: { label: 'Search Range', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.2 } },
		smoothness: { dataType: { kind: 'scalar' }, ui: { label: 'Smoothness', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		confidenceGuard: { dataType: { kind: 'bool' }, ui: { label: 'Confidence Guard', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		analysisResolution: { dataType: { kind: 'scalar' }, ui: { label: 'Analysis Resolution (Short Side)', control: { controlType: 'range', min: 32, max: 512, step: 1, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: 128 } },
		pyramidLevels: { dataType: { kind: 'scalar' }, ui: { label: 'Pyramid Levels', control: { controlType: 'range', min: 1, max: 6, step: 1 } }, defaultValue: { inputSource: 'literal', value: 4 } },
		iterations: { dataType: { kind: 'scalar' }, ui: { label: 'Iterations Per Level', control: { controlType: 'range', min: 1, max: 32, step: 1 } }, defaultValue: { inputSource: 'literal', value: 8 } },
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		warpA: { dataType: { kind: 'vector' }, label: 'Warp A', canLazyAllocation: true },
		warpB: { dataType: { kind: 'vector' }, label: 'Warp B', canLazyAllocation: true },
		confidence: { dataType: { kind: 'scalar' }, label: 'Confidence', canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
