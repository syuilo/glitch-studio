import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'noise',
	displayName: 'Noise',
	description: {
		'ja-JP': '複数のノイズを重ねたフラクタルノイズを生成します。座標場を入力して模様を変形できます。',
		'en-US': 'Generates fractal noise by layering noise octaves, with coordinate field input for domain warping.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['noise', 'utility'],
	paramDefs: {
		noiseType: {
			dataType: { kind: 'enum', options: ['value', 'simplex', 'perlin', 'worley', 'flow'] },
			ui: { label: 'Noise Type', control: { labels: { value: 'Value Noise', simplex: 'Simplex Noise', perlin: 'Perlin Noise', worley: 'Worley Noise', flow: 'Flow Noise' } } },
			defaultValue: { inputSource: 'literal', value: 'value' },
		},
		fractalMode: {
			dataType: { kind: 'enum', options: ['fbm', 'turbulence', 'ridged', 'pingPong'] },
			ui: { label: 'Fractal Mode', control: { labels: { fbm: 'fBm', turbulence: 'Turbulence', ridged: 'Ridged', pingPong: 'Ping Pong' } } },
			defaultValue: { inputSource: 'literal', value: 'fbm' },
		},
		pingPongStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Ping Pong Strength', isAdvanced: true, control: { controlType: 'number', min: 0, max: 10, step: 0.1 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		// Timeとは独立した回転位相。全段で共有して1 turnの周期を保ち、
		// CPUで折り返してからuniformへ渡すため、canNodeにはしない。
		flowPhase: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Flow Phase (Turns)', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		flowStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Flow Strength', control: { controlType: 'number', min: 0, max: 2, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		coordinateSource: {
			dataType: { kind: 'enum', options: ['screen', 'input'] },
			ui: { label: 'Coordinate Source', control: { labels: { screen: 'Screen', input: 'Input' } } },
			defaultValue: { inputSource: 'literal', value: 'screen' },
		},
		coordinates: {
			dataType: { kind: 'vector' },
			ui: { label: 'Coordinates', control: { controlType: 'vector', min: -0.5, max: 0.5, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		density: {
			dataType: { kind: 'vector' },
			ui: { label: 'Density', control: { controlType: 'dimension', min: 0, max: 1000 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [4, 4] },
		},
		offset: {
			dataType: { kind: 'vector' },
			ui: { label: 'Offset', control: { controlType: 'vector', min: -16, max: 16, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		octaves: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Octaves', control: { controlType: 'number', min: 1, max: 16, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		gain: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Gain', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		lacunarity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Lacunarity', control: { controlType: 'number', min: 0, max: 8, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		octaveRotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Octave Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		// Timeは経過時間が長くなっても動きを滑らかに保つため、
		// 16bitの入力テクスチャを経由せず32bitのuniformで渡す。
		time: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		outputMin: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Output Min', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		outputMax: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Output Max', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: null,
	// Coordinate Sourceは通常パラメータなので、切り替えても解像度が変わらないようにする。
	resolutionInputParameters: ['coordinates'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
