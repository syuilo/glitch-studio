import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Quadtree Filter',
	summary: {
		'ja-JP': '入力画像を色の変化に応じた大きさの四角形に分割し、モザイク状に表現します。',
		'en-US': 'Creates a mosaic by dividing the input image into squares sized according to color variation.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['stylized', 'experimental'],
	thumbnail: {
		mode: 'customParameters',
		params: { threshold: 0.014, minDivisions: 6, borderWidth: 0.08 },
	},
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Thresold',
				control: {
					controlType: 'range',
					min: 0,
					max: 0.15,
					step: 0.00001,
				},
			},
			defaultValue: 0.005,
		},
		minDivisions: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Min Divisions',
				control: {
					controlType: 'range',
					min: 1,
					max: 64,
					step: 1,
				},
			},
			defaultValue: 4,
		},
		maxIterations: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Max Iterations',
				control: {
					controlType: 'range',
					min: 1,
					max: 16,
					step: 1,
				},
			},
			defaultValue: 10,
		},
		borderWidth: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Border Width',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: 0,
		},
		borderAbsolute: { dataType: { kind: 'bool' }, ui: { label: 'Border Absolute', control: {} }, defaultValue: false },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
