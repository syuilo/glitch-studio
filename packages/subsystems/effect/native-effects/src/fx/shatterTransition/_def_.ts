import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Shatter Transition',
	summary: {
		'ja-JP': '画像Aを不規則な三角形の破片に分け、3D空間で飛散・回転させて画像Bへ切り替えます。',
		'en-US': 'Breaks image A into irregular triangular shards that scatter and rotate in 3D, revealing image B.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'transform'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' }, ui: { label: 'A', control: {} }, canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		inputB: {
			dataType: { kind: 'color' }, ui: { label: 'B', control: {} }, canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, canNode: true,
			defaultValue: 0,
		},
		fragmentSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fragment Size (Reference Ratio)', control: { controlType: 'range', min: 0.01, max: 1, step: 0.001 } },
			defaultValue: 0.08,
		},
		irregularity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Irregularity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.8,
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.001 } },
			defaultValue: [0, 0],
		},
		spread: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Spread (Reference Ratio)', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
			defaultValue: 0.6,
		},
		depth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Depth (Reference Ratio)', control: { controlType: 'range', min: -2, max: 2, step: 0.01 } },
			defaultValue: -2,
		},
		rotation: {
			dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: 0.75,
		},
		gravity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gravity (Reference Ratio)', control: { controlType: 'range', min: -2, max: 2, step: 0.01 } },
			defaultValue: 0.25,
		},
		stagger: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Stagger', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.3,
		},
		perspective: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Perspective', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.5,
		},
		shading: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shading', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.6,
		},
		seed: {
			dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		coverage: { dataType: { kind: 'scalar' }, label: 'Coverage',
			inputParameters: ['progress', 'fragmentSize', 'irregularity', 'center', 'spread', 'depth', 'rotation', 'gravity', 'stagger', 'perspective', 'seed', 'sizeReference'],
		},
	},
	primaryOutput: 'output',
});
