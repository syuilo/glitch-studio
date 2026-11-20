import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { MAXIMUM_TRANSFORM_COUNT, MAXIMUM_ORBIT_COUNT, MAXIMUM_ITERATIONS, MAXIMUM_BURN_IN } from './flame-settings.ts';
import type { FlameTransform } from './flame-settings.ts';

const variationTypes = {
	linear: { kind: 'scalar' }, sinusoidal: { kind: 'scalar' }, spherical: { kind: 'scalar' }, swirl: { kind: 'scalar' },
	horseshoe: { kind: 'scalar' }, polar: { kind: 'scalar' }, handkerchief: { kind: 'scalar' }, heart: { kind: 'scalar' },
} as const;
const variationControl = { controlType: 'range', min: -2, max: 2, step: 0.01 } as const;
const variationControls = { defaultExpanded: false, fields: {
	linear: { label: 'Linear', control: variationControl }, sinusoidal: { label: 'Sinusoidal', control: variationControl },
	spherical: { label: 'Spherical', control: variationControl }, swirl: { label: 'Swirl', control: variationControl },
	horseshoe: { label: 'Horseshoe', control: variationControl }, polar: { label: 'Polar', control: variationControl },
	handkerchief: { label: 'Handkerchief', control: variationControl }, heart: { label: 'Heart', control: variationControl },
} };

function transformDefaultValue(position: [number, number], scale: [number, number], rotation: number, colorPosition: number, variations: Partial<FlameTransform['variations']>) {
	return {
		weight: 1,
		position: position,
		rotation: rotation,
		scale: scale,
		shear: 0,
		colorPosition: colorPosition,
		variations: {
			linear: variations.linear ?? 0,
			sinusoidal: variations.sinusoidal ?? 0,
			spherical: variations.spherical ?? 0,
			swirl: variations.swirl ?? 0,
			horseshoe: variations.horseshoe ?? 0,
			polar: variations.polar ?? 0,
			handkerchief: variations.handkerchief ?? 0,
			heart: variations.heart ?? 0,
		},
	};
}

const addedTransform = transformDefaultValue([0, 0], [0.7, 0.7], 0, 0.5, { linear: 1 });

export default defineNativeEffect({
	displayName: 'Fractal Flame',
	summary: {
		'ja-JP': '複数の非線形変換を組み合わせ、光の煙や花弁のようなフラクタル模様を生成します。',
		'en-US': 'Combines nonlinear transforms to generate luminous, smoke-like or petal-like fractal flames.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'fractal', 'math', 'gimmicky', 'experimental'],
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
			defaultValue: [
				transformDefaultValue([-0.14, 0.05], [0.6, 0.6], 0.08, 0.05, { linear: 0.25, swirl: 0.75 }),
				transformDefaultValue([0.14, -0.03], [0.55, 0.65], -0.12, 0.5, { sinusoidal: 1 }),
				transformDefaultValue([0, 0.14], [0.65, 0.55], 0.33, 0.95, { linear: 0.4, horseshoe: 0.3, spherical: 0.3 }),
			],
			element: {
				defaultValue: addedTransform,
				fields: {
					weight: { defaultValue: addedTransform.weight }, position: { defaultValue: addedTransform.position },
					rotation: { defaultValue: addedTransform.rotation }, scale: { defaultValue: addedTransform.scale },
					shear: { defaultValue: addedTransform.shear }, colorPosition: { defaultValue: addedTransform.colorPosition },
					variations: { defaultValue: addedTransform.variations, fields: {
						linear: { defaultValue: addedTransform.variations.linear }, sinusoidal: { defaultValue: addedTransform.variations.sinusoidal },
						spherical: { defaultValue: addedTransform.variations.spherical }, swirl: { defaultValue: addedTransform.variations.swirl },
						horseshoe: { defaultValue: addedTransform.variations.horseshoe }, polar: { defaultValue: addedTransform.variations.polar },
						handkerchief: { defaultValue: addedTransform.variations.handkerchief }, heart: { defaultValue: addedTransform.variations.heart },
					} },
				},
			},
		},
		symmetry: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Symmetry', control: { controlType: 'range', min: 1, max: 16, step: 1 } },
			defaultValue: 3,
		},
		mirror: { dataType: { kind: 'bool' }, ui: { label: 'Mirror Symmetry', control: {} }, defaultValue: false },
		scale: {
			dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.1, max: 10, logarithmic: true } },
			defaultValue: 1,
		},
		rotation: {
			dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		position: {
			dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: [0, 0],
		},
		ramp: {
			dataType: { kind: 'colorRamp' }, ui: { label: 'Palette', control: {} },
			defaultValue: { interpolation: 'linear', colorSpace: 'srgb', repeatCount: 1, repeatMode: 'wrap', stops: [
				{ id: 'blue', position: 0, color: srgbToLinearSrgb([0.08, 0.15, 0.8, 1]) },
				{ id: 'cyan', position: 0.35, color: srgbToLinearSrgb([0.05, 0.9, 1, 1]) },
				{ id: 'pink', position: 0.7, color: srgbToLinearSrgb([1, 0.1, 0.5, 1]) },
				{ id: 'gold', position: 1, color: srgbToLinearSrgb([1, 0.8, 0.25, 1]) },
			] },
		},
		colorPhase: {
			dataType: { kind: 'scalar' }, ui: { label: 'Color Phase', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 0,
		},
		exposure: {
			dataType: { kind: 'scalar' }, ui: { label: 'Exposure', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: 2,
		},
		gamma: {
			dataType: { kind: 'scalar' }, ui: { label: 'Gamma', control: { controlType: 'range', min: 0.1, max: 4, step: 0.01 } },
			defaultValue: 2.2,
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
		orbitCount: {
			dataType: { kind: 'scalar' }, ui: { label: 'Orbit Count', control: { controlType: 'range', min: 1, max: MAXIMUM_ORBIT_COUNT, step: 1 } },
			defaultValue: 512,
		},
		iterations: {
			dataType: { kind: 'scalar' }, ui: { label: 'Iterations', control: { controlType: 'range', min: 1, max: MAXIMUM_ITERATIONS, step: 1 } },
			defaultValue: 512,
		},
		burnIn: {
			dataType: { kind: 'scalar' }, ui: { label: 'Burn In', control: { controlType: 'range', min: 0, max: MAXIMUM_BURN_IN, step: 1 } },
			defaultValue: 64,
		},
		densityResolution: {
			dataType: { kind: 'enum', options: ['256', '512', '1024', '2048'] },
			ui: { label: 'Density Resolution', control: { labels: { '256': '256', '512': '512', '1024': '1024', '2048': '2048' } } },
			defaultValue: '512',
		},
		densityRadius: {
			dataType: { kind: 'scalar' }, ui: { label: 'Density Radius', control: { controlType: 'range', min: 0.125, max: 2, logarithmic: true } },
			defaultValue: 0.5,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		density: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
