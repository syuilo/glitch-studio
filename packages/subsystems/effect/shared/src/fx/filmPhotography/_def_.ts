import type { ParameterDefinition_Scalar, ParameterDefinition_Struct } from '@gs/shared/parameter/parameter-definition.ts';
import { defineEffect } from '../../effect-definition.ts';
import { DEFAULT_BASE, DEFAULT_FILM_LAYERS, DEFAULT_PAPER, DEFAULT_PRINT } from './material.ts';
import type { FilmLayer } from './material.ts';

type ScalarControl = { label: string; min: number; max: number; step: number };

function scalarGroup<T extends Record<string, number>>(label: string, defaults: T, controls: Record<keyof T, ScalarControl>) {
	type Fields = { [K in keyof T]: { kind: 'scalar' } };
	const literal = (value: number) => ({ inputSource: 'literal' as const, value });
	const definition: ParameterDefinition_Struct<Fields> = {
		dataType: { kind: 'struct', fields: Object.fromEntries(Object.keys(defaults).map(key => [key, { kind: 'scalar' }])) as Fields },
		ui: { label, control: { fields: Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, {
			label: control.label, control: { controlType: 'range', min: control.min, max: control.max, step: control.step },
		}])) as ParameterDefinition_Struct<Fields>['ui']['control']['fields'] } },
		fields: Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { defaultValue: literal(value) }])) as ParameterDefinition_Struct<Fields>['fields'],
		defaultValue: { inputSource: 'literal', value: Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, literal(value)])) as ParameterDefinition_Struct<Fields>['defaultValue']['value'] },
	};
	return definition;
}

const layerControls: Record<keyof FilmLayer, ScalarControl> = {
	sensitivityCenter: { label: 'Sensitivity Center (nm)', min: 380, max: 780, step: 1 },
	sensitivityWidth: { label: 'Sensitivity Width (σ, nm)', min: 5, max: 100, step: 1 },
	speed: { label: 'Relative Sensitivity (EV)', min: -4, max: 4, step: 0.01 },
	gamma: { label: 'Development Gamma (D / log H)', min: 0, max: 2, step: 0.01 },
	maximumDensity: { label: 'Maximum Dye Density', min: 0, max: 5, step: 0.01 },
	toe: { label: 'Toe Shape', min: 0.1, max: 8, step: 0.1 },
	shoulder: { label: 'Shoulder Shape', min: 0.1, max: 8, step: 0.1 },
	fog: { label: 'Fog Dye Density', min: 0, max: 1, step: 0.01 },
	dyeCenter: { label: 'Dye Absorption Center (nm)', min: 380, max: 780, step: 1 },
	dyeWidth: { label: 'Dye Absorption Width (σ, nm)', min: 5, max: 150, step: 1 },
	secondaryAbsorption: { label: 'Secondary Absorption', min: 0, max: 1, step: 0.01 },
	secondaryCenter: { label: 'Secondary Absorption Center (nm)', min: 380, max: 780, step: 1 },
	secondaryWidth: { label: 'Secondary Absorption Width (σ, nm)', min: 5, max: 150, step: 1 },
};

const exposureParameter = (label: string): ParameterDefinition_Scalar & { canNode: true } => ({
	dataType: { kind: 'scalar' }, ui: { label, control: { controlType: 'range', min: -8, max: 8, step: 0.01 } },
	canNode: true, defaultValue: { inputSource: 'literal', value: 0 },
});

export default defineEffect({
	id: 'filmPhotography',
	displayName: 'Film Photography',
	description: {
		'ja-JP': '仮想カラーネガの分光感度・現像応答・色素吸収を設計し、印画紙への露光と反射まで計算します。',
		'en-US': 'Designs a virtual color negative through spectral sensitivity, development and dye absorption, then simulates photographic printing.',
	},
	kind: 'modify', dependsOnRenderHistory: false, tags: ['color', 'light', 'simulation'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		exposure: exposureParameter('Film Exposure (EV)'),
		printExposure: exposureParameter('Print Exposure (EV)'),
		redLayer: scalarGroup('Red-sensitive / Cyan-forming Layer', DEFAULT_FILM_LAYERS[0], layerControls),
		greenLayer: scalarGroup('Green-sensitive / Magenta-forming Layer', DEFAULT_FILM_LAYERS[1], layerControls),
		blueLayer: scalarGroup('Blue-sensitive / Yellow-forming Layer', DEFAULT_FILM_LAYERS[2], layerControls),
		base: scalarGroup('Film Base', DEFAULT_BASE, {
			density: { label: 'Neutral Density', min: 0, max: 1, step: 0.01 }, stain: { label: 'Stain Density', min: 0, max: 1, step: 0.01 },
			stainCenter: { label: 'Stain Absorption Center (nm)', min: 380, max: 780, step: 1 }, stainWidth: { label: 'Stain Absorption Width (σ, nm)', min: 5, max: 150, step: 1 },
		}),
		printer: scalarGroup('Print Light / Filtration', DEFAULT_PRINT, {
			temperature: { label: 'Blackbody Temperature (K)', min: 2000, max: 10000, step: 100 },
			cyan: { label: 'Cyan Filter Density', min: 0, max: 2, step: 0.01 }, magenta: { label: 'Magenta Filter Density', min: 0, max: 2, step: 0.01 }, yellow: { label: 'Yellow Filter Density', min: 0, max: 2, step: 0.01 },
		}),
		paper: scalarGroup('Print Paper Response', DEFAULT_PAPER, {
			gamma: { label: 'Development Gamma (D / log H)', min: 0, max: 5, step: 0.01 }, maximumDensity: { label: 'Maximum Dye Density', min: 0, max: 3, step: 0.01 },
			toe: { label: 'Toe Shape', min: 0.1, max: 8, step: 0.1 }, shoulder: { label: 'Shoulder Shape', min: 0.1, max: 8, step: 0.1 },
		}),
	},
	primaryInputParameter: 'input', resolutionInputParameters: ['input', 'exposure', 'printExposure'],
	outputDefs: { output: { dataType: { kind: 'color' } } }, primaryOutput: 'output',
});
