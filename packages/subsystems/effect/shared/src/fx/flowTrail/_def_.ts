import { defineEffect } from '../../effect-definition.ts';

const halfLifeAt60Fps = (retention: number) => -Math.LN2 / Math.log(retention) * 1000 / 60;

export default defineEffect({
	id: 'flowTrail',
	displayName: 'Flow Trail',
	description: {
		'ja-JP': '移動速度に応じた太さの軌跡を描き、ぼかした流れで移流させます。',
		'en-US': 'Paints speed-sensitive trails and advects them with a blurred flow field.',
	},
	kind: 'generate',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'utility'],
	paramDefs: {
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		emit: { dataType: { kind: 'bool' }, ui: { label: 'Emit', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		strength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		radius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Radius', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		fullRadiusSpeed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Full Radius Speed', control: { controlType: 'range', min: 0.01, max: 10, step: 0.01 } },
			// 1920pxの基準画面で100px/frame、60Hzに相当する長辺単位/秒。
			defaultValue: { inputSource: 'literal', value: 3.125 },
		},
		inputHalfLife: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Pointer Momentum Half-Life (ms)', control: { controlType: 'range', min: 0, max: 1000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: halfLifeAt60Fps(0.8) },
		},
		velocityHalfLife: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Motion Half-Life (ms)', control: { controlType: 'range', min: 0, max: 5000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: halfLifeAt60Fps(0.975) },
		},
		halfLife: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Slow Trail Half-Life (ms)', control: { controlType: 'range', min: 0, max: 5000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: halfLifeAt60Fps(0.95) },
		},
		fastHalfLife: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fast Trail Half-Life (ms)', control: { controlType: 'range', min: 0, max: 5000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: halfLifeAt60Fps(0.8) },
		},
		advectionStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Advection', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		smoothing: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Flow Smoothing Radius', control: { controlType: 'range', min: 0, max: 0.2, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 1 / 30 },
		},
		noiseStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Turbulence', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.375 },
		},
		noiseSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Turbulence Size', control: { controlType: 'range', min: 0.001, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 1 / 9.6 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
		scalar: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
