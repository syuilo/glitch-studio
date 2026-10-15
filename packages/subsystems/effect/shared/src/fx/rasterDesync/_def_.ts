import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rasterDesync',
	displayName: 'Raster desync',
	description: {
		'ja-JP': '画像を画素列として読み直し、行幅の誤りや読み取り位置のずれ、再同期によるグリッチを加えます。元画像の細部を保持します。',
		'en-US': 'Reinterprets the image as a raster stream with incorrect row strides, read offsets, and synchronization loss while preserving input detail.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'distortion', 'stylized'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		rasterDensity: { dataType: { kind: 'scalar' }, ui: { label: 'Raster density (short side)', control: { controlType: 'range', min: 1, max: 2048, step: 1, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: 32 } },
		rowWidthError: { dataType: { kind: 'scalar' }, ui: { label: 'Row width error (%)', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		readOffset: { dataType: { kind: 'scalar' }, ui: { label: 'Initial read offset (% of row)', control: { controlType: 'range', min: -100, max: 100, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		startPosition: { dataType: { kind: 'scalar' }, ui: { label: 'Start position', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		corruption: { dataType: { kind: 'bool' }, ui: { label: 'Random desynchronization', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		corruptionProbability: { dataType: { kind: 'scalar' }, ui: { label: 'Desynchronization probability', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		corruptionAmount: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum desynchronization (% of row)', control: { controlType: 'range', min: 0, max: 100, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 20 } },
		resynchronization: { dataType: { kind: 'bool' }, ui: { label: 'Restart synchronization', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		restartInterval: { dataType: { kind: 'scalar' }, ui: { label: 'Restart interval (rows)', control: { controlType: 'range', min: 1, max: 512, step: 1 } }, defaultValue: { inputSource: 'literal', value: 64 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
