import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rasterDesync',
	displayName: 'Raster Desync',
	description: {
		'ja-JP': '画像を画素列として読み直し、行幅の誤りや読み取り位置のずれ、再同期によるグリッチを加えます。元画像の細部を保持します。',
		'en-US': 'Reinterprets the image as a raster stream with incorrect row strides, read offsets, and synchronization loss while preserving input detail.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'distortion', 'stylized'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
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
			defaultValue: { inputSource: 'literal', value: 32 },
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
			defaultValue: { inputSource: 'literal', value: 1 },
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
			defaultValue: { inputSource: 'literal', value: 0 },
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
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		corruption: { dataType: { kind: 'bool' }, ui: { label: 'Random Desynchronization', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
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
			defaultValue: { inputSource: 'literal', value: 1 },
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
			defaultValue: { inputSource: 'literal', value: 20 },
		},
		resynchronization: { dataType: { kind: 'bool' }, ui: { label: 'Restart Synchronization', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
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
			defaultValue: { inputSource: 'literal', value: 64 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
