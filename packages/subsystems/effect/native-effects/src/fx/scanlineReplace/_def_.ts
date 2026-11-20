import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Scanline Replace',
	summary: {
		'ja-JP': '横帯ごとに画像AからBへ切り替え、切替中の帯へ横ずれと色ずれを加えます。',
		'en-US': 'Replaces image A with image B in horizontal bands, adding displacement and chromatic shifts during each band transition.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'glitch'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: 0,
		},
		bandSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Band Size (Reference Ratio)', control: { controlType: 'range', min: 0.001, max: 0.25, step: 0.001 } },
			defaultValue: 0.04,
		},
		stagger: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Stagger', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 1,
		},
		softness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Softness (Transition Duration)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 0.15,
		},
		displacement: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Displacement (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: 0.05,
		},
		chromaticShift: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Chromatic Shift (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: 0.003,
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});

