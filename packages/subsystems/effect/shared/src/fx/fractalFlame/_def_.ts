import { defineEffect } from '../../effect-definition.ts';
import { MAXIMUM_TRANSFORM_COUNT, MAXIMUM_ORBIT_COUNT, MAXIMUM_ITERATIONS, MAXIMUM_BURN_IN } from './flame-settings.ts';
import type { FlameTransform } from './flame-settings.ts';

const variationTypes = {
	linear: { kind: 'scalar' }, sinusoidal: { kind: 'scalar' }, spherical: { kind: 'scalar' }, swirl: { kind: 'scalar' },
	horseshoe: { kind: 'scalar' }, polar: { kind: 'scalar' }, handkerchief: { kind: 'scalar' }, heart: { kind: 'scalar' },
} as const;
const variationControl = { controlType: 'range', min: -2, max: 2, step: 0.01 } as const;
const variationControls = { fields: {
	linear: { label: 'Linear', control: variationControl }, sinusoidal: { label: 'Sinusoidal', control: variationControl },
	spherical: { label: 'Spherical', control: variationControl }, swirl: { label: 'Swirl', control: variationControl },
	horseshoe: { label: 'Horseshoe', control: variationControl }, polar: { label: 'Polar', control: variationControl },
	handkerchief: { label: 'Handkerchief', control: variationControl }, heart: { label: 'Heart', control: variationControl },
} };

function transformDefaultValue(position: [number, number], scale: [number, number], rotation: number, colorPosition: number, variations: Partial<FlameTransform['variations']>) {
	return { inputSource: 'literal' as const, value: {
		weight: { inputSource: 'literal' as const, value: 1 },
		position: { inputSource: 'literal' as const, value: position },
		rotation: { inputSource: 'literal' as const, value: rotation },
		scale: { inputSource: 'literal' as const, value: scale },
		shear: { inputSource: 'literal' as const, value: 0 },
		colorPosition: { inputSource: 'literal' as const, value: colorPosition },
		variations: { inputSource: 'literal' as const, value: {
			linear: { inputSource: 'literal' as const, value: variations.linear ?? 0 },
			sinusoidal: { inputSource: 'literal' as const, value: variations.sinusoidal ?? 0 },
			spherical: { inputSource: 'literal' as const, value: variations.spherical ?? 0 },
			swirl: { inputSource: 'literal' as const, value: variations.swirl ?? 0 },
			horseshoe: { inputSource: 'literal' as const, value: variations.horseshoe ?? 0 },
			polar: { inputSource: 'literal' as const, value: variations.polar ?? 0 },
			handkerchief: { inputSource: 'literal' as const, value: variations.handkerchief ?? 0 },
			heart: { inputSource: 'literal' as const, value: variations.heart ?? 0 },
		} },
	} };
}

const addedTransform = transformDefaultValue([0, 0], [0.7, 0.7], 0, 0.5, { linear: 1 });

export default defineEffect({
	id: 'fractalFlame',
	displayName: 'Fractal Flame',
	description: {
		'ja-JP': '複数の非線形変換を組み合わせ、光の煙や花弁のようなフラクタル模様を生成します。',
		'en-US': 'Combines nonlinear transforms to generate luminous, smoke-like or petal-like fractal flames.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'math', 'gimmicky', 'experimental'],
	paramDefs: {
		transforms: {
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: {
				weight: { kind: 'scalar' }, position: { kind: 'vector' }, rotation: { kind: 'scalar' }, scale: { kind: 'vector' },
				shear: { kind: 'scalar' }, colorPosition: { kind: 'scalar' }, variations: { kind: 'struct', fields: variationTypes },
			} } },
			ui: { label: 'Transforms', control: { element: { fields: {
				weight: { label: 'Weight', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
				position: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
				rotation: { label: 'Rotation', control: { controlType: 'angle' } },
				scale: { label: 'Scale', control: { controlType: 'vector', min: -2, max: 2, step: 0.01 } },
				shear: { label: 'Shear', control: { controlType: 'range', min: -2, max: 2, step: 0.01 } },
				colorPosition: { label: 'Color Position', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
				variations: { label: 'Variations', control: variationControls },
			} } } },
			maxElements: MAXIMUM_TRANSFORM_COUNT,
			defaultValue: { inputSource: 'literal', value: [
				{ id: 'first', binding: transformDefaultValue([-0.14, 0.05], [0.6, 0.6], 0.08, 0.05, { linear: 0.25, swirl: 0.75 }) },
				{ id: 'second', binding: transformDefaultValue([0.14, -0.03], [0.55, 0.65], -0.12, 0.5, { sinusoidal: 1 }) },
				{ id: 'third', binding: transformDefaultValue([0, 0.14], [0.65, 0.55], 0.33, 0.95, { linear: 0.4, horseshoe: 0.3, spherical: 0.3 }) },
			] },
			element: {
				defaultValue: addedTransform,
				fields: {
					weight: { defaultValue: addedTransform.value.weight }, position: { defaultValue: addedTransform.value.position },
					rotation: { defaultValue: addedTransform.value.rotation }, scale: { defaultValue: addedTransform.value.scale },
					shear: { defaultValue: addedTransform.value.shear }, colorPosition: { defaultValue: addedTransform.value.colorPosition },
					variations: { defaultValue: addedTransform.value.variations, fields: {
						linear: { defaultValue: addedTransform.value.variations.value.linear }, sinusoidal: { defaultValue: addedTransform.value.variations.value.sinusoidal },
						spherical: { defaultValue: addedTransform.value.variations.value.spherical }, swirl: { defaultValue: addedTransform.value.variations.value.swirl },
						horseshoe: { defaultValue: addedTransform.value.variations.value.horseshoe }, polar: { defaultValue: addedTransform.value.variations.value.polar },
						handkerchief: { defaultValue: addedTransform.value.variations.value.handkerchief }, heart: { defaultValue: addedTransform.value.variations.value.heart },
					} },
				},
			},
		},
		symmetry: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Symmetry', control: { controlType: 'range', min: 1, max: 16, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 3 },
		},
		mirror: { dataType: { kind: 'bool' }, ui: { label: 'Mirror Symmetry', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		scale: {
			dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rotation: {
			dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		position: {
			dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		ramp: {
			dataType: { kind: 'colorRamp' }, ui: { label: 'Palette', control: {} },
			defaultValue: { inputSource: 'literal', value: { interpolation: 'linear', colorSpace: 'srgb', stops: [
				{ id: 'blue', position: 0, color: [0.08, 0.15, 0.8, 1] },
				{ id: 'cyan', position: 0.35, color: [0.05, 0.9, 1, 1] },
				{ id: 'pink', position: 0.7, color: [1, 0.1, 0.5, 1] },
				{ id: 'gold', position: 1, color: [1, 0.8, 0.25, 1] },
			] } },
		},
		colorPhase: {
			dataType: { kind: 'scalar' }, ui: { label: 'Color Phase', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		exposure: {
			dataType: { kind: 'scalar' }, ui: { label: 'Exposure', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		gamma: {
			dataType: { kind: 'scalar' }, ui: { label: 'Gamma', control: { controlType: 'range', min: 0.1, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 2.2 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		orbitCount: {
			dataType: { kind: 'scalar' }, ui: { label: 'Orbit Count', control: { controlType: 'range', min: 1, max: MAXIMUM_ORBIT_COUNT, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 512 },
		},
		iterations: {
			dataType: { kind: 'scalar' }, ui: { label: 'Iterations', control: { controlType: 'range', min: 1, max: MAXIMUM_ITERATIONS, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 512 },
		},
		burnIn: {
			dataType: { kind: 'scalar' }, ui: { label: 'Burn In', control: { controlType: 'range', min: 0, max: MAXIMUM_BURN_IN, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 64 },
		},
		densityResolution: {
			dataType: { kind: 'enum', options: ['256', '512', '1024', '2048'] },
			ui: { label: 'Density Resolution', control: { labels: { '256': '256', '512': '512', '1024': '1024', '2048': '2048' } } },
			defaultValue: { inputSource: 'literal', value: '512' },
		},
		densityRadius: {
			dataType: { kind: 'scalar' }, ui: { label: 'Density Radius', control: { controlType: 'range', min: 0.125, max: 2, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		density: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
