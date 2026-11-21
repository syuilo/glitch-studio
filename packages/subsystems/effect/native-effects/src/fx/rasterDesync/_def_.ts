import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Raster Desync',
	summary: {
		'ja-JP': '画像の読み取りの同期が乱れたような、行のずれや画像の崩れを加えます。',
		'en-US': 'Creates shifted rows and scrambled imagery resembling a loss of raster synchronization.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'distortion'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		rasterDensity: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Raster Density (Reference)',
				control: {
					controlType: 'range',
					min: 1,
					max: 2048,
					step: 1,
					logarithmic: true,
				},
			},
			defaultValue: 32,
		},
		rowWidthError: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Row Width Error (%)',
				control: {
					controlType: 'range',
					min: -10,
					max: 10,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		readOffset: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Initial Read Offset (% of Row)',
				control: {
					controlType: 'range',
					min: -100,
					max: 100,
					step: 0.1,
				},
			},
			defaultValue: 0,
		},
		startPosition: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Start Position',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: 0,
		},
		corruption: { dataType: { kind: 'bool' }, ui: { label: 'Random Desynchronization', control: {} }, defaultValue: true },
		corruptionProbability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Desynchronization Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: 1,
		},
		corruptionAmount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Desynchronization (% of Row)',
				control: {
					controlType: 'range',
					min: 0,
					max: 100,
					step: 0.1,
				},
			},
			defaultValue: 20,
		},
		resynchronization: { dataType: { kind: 'bool' }, ui: { label: 'Restart Synchronization', control: {} }, defaultValue: true },
		restartInterval: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Restart Interval (Rows)',
				control: {
					controlType: 'range',
					min: 1,
					max: 512,
					step: 1,
				},
			},
			defaultValue: 64,
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
