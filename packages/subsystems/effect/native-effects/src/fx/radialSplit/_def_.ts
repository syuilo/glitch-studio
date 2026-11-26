import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Radial Split',
	summary: {
		'ja-JP': '複数の画像や色を、一定幅の隙間を持つ均等な扇形の領域へ配置します。',
		'en-US': 'Arranges images or colors in equal angular sectors with constant-width gaps.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transform', 'utility'],
	thumbnail: {
		mode: 'customParameters',
		params: {
			inputs: [
				[0.92, 0.12, 0.07, 1],
				[0.98, 0.65, 0.06, 1],
				[0.05, 0.48, 0.43, 1],
				[0.09, 0.22, 0.78, 1],
			],
			gap: 0.016,
		},
	},
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Inputs', control: { element: {} } },
			defaultValue: [
				[0, 0, 0, 0],
				[0, 0, 0, 0],
			],
			element: { canNode: true, defaultValue: [0, 0, 0, 0] },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: [0, 0],
		},
		startAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Start Angle', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		direction: {
			dataType: { kind: 'enum', options: ['clockwise', 'counterclockwise'] },
			ui: { label: 'Direction', control: { labels: { clockwise: 'Clockwise', counterclockwise: 'Counterclockwise' } } },
			defaultValue: 'clockwise',
		},
		gap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gap', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: 0,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
