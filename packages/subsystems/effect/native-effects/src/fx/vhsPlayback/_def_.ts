import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'VHS Playback',
	summary: {
		'ja-JP': 'VHSの記録信号を変調・復調し、トラッキング不良、テープの欠損、時間軸の乱れを再現します。',
		'en-US': 'Modulates and demodulates VHS recording signals to simulate tracking errors, tape dropouts, and time-base instability.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'distortion', 'color', 'stylized'],
	thumbnail: {
		mode: 'customParameters',
		params: { tapeDamage: 0.55, timeBaseError: 1.1, scanTimingDrift: 0.9 },
	},
	paramDefs: {
		input: {
			dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		tapeDamage: {
			dataType: { kind: 'scalar' }, ui: { label: 'Tape Damage', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true,
			defaultValue: 0,
		},
		tapeSurfaceLength: {
			dataType: { kind: 'scalar' }, ui: { label: 'Tape Surface Length (s)', control: { controlType: 'range', min: 0.05, max: 60, step: 0.01, logarithmic: true } },
			defaultValue: 4,
		},
		tapeSurfaceOffset: {
			dataType: { kind: 'scalar' }, ui: { label: 'Tape Surface Offset (s)', control: { controlType: 'number', step: 0.01 } },
			defaultValue: 0,
		},
		time: {
			dataType: { kind: 'scalar' }, ui: { label: 'Time (s)', control: { controlType: 'number', step: 0.01 } },
			defaultValue: 0,
		},
		tapeDisplacement: {
			dataType: { kind: 'vector' }, ui: { label: 'Tape Displacement', control: { controlType: 'vector', min: -0.01, max: 0.01, step: 0.00001 } }, canNode: true,
			defaultValue: [0, 0],
		},
		trackingOffset: {
			dataType: { kind: 'scalar' }, ui: { label: 'Tracking Offset (Tracks)', control: { controlType: 'range', min: -1.5, max: 1.5, step: 0.01 } },
			defaultValue: 0.1,
		},
		trackAlignmentError: {
			dataType: { kind: 'scalar' }, ui: { label: 'Track Alignment Error (Tracks)', control: { controlType: 'range', min: -3, max: 3, step: 0.01 } },
			defaultValue: 0.4,
		},
		timeBaseError: {
			dataType: { kind: 'scalar' }, ui: { label: 'Time Base Error (μs)', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: 0.3,
		},
		scanTimingDrift: {
			dataType: { kind: 'scalar' }, ui: { label: 'Scan Timing Drift (μs / Field)', control: { controlType: 'range', min: -8, max: 8, step: 0.01 } },
			defaultValue: 0.4,
		},
		headContact: {
			dataType: { kind: 'scalar' }, ui: { label: 'Head Contact', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		// 距離そのものではなく基準FM波長に対する比率。画面解像度に依存せず、
		// 微小な隙間を16bitのスカラー場でも十分な精度で表現できるようにする。
		headSeparation: {
			dataType: { kind: 'scalar' }, ui: { label: 'Head Separation (FM Wavelengths)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, canNode: true,
			defaultValue: 0,
		},
		headSwitching: {
			dataType: { kind: 'bool' }, ui: { label: 'Head Switching', control: {} },
			defaultValue: true,
		},
		headTimingDifference: {
			dataType: { kind: 'scalar' }, ui: { label: 'Head Timing Difference (μs)', control: { controlType: 'range', min: -8, max: 8, step: 0.01 } },
			defaultValue: 1.5,
		},
		dropoutRate: {
			dataType: { kind: 'scalar' }, ui: { label: 'Dropout Rate (/s)', control: { controlType: 'range', min: 0, max: 5000, step: 1 } },
			defaultValue: 120,
		},
		dropoutDuration: {
			dataType: { kind: 'scalar' }, ui: { label: 'Dropout Duration (μs)', control: { controlType: 'range', min: 0.1, max: 30, step: 0.1 } },
			defaultValue: 2,
		},
		dropoutDepth: {
			dataType: { kind: 'scalar' }, ui: { label: 'Dropout Depth', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		rfNoiseFloor: {
			dataType: { kind: 'scalar' }, ui: { label: 'RF Noise Floor (dB)', control: { controlType: 'range', min: -100, max: -12, step: 1 } },
			defaultValue: -42,
		},
		dropoutCompensation: {
			dataType: { kind: 'bool' }, ui: { label: 'Dropout Compensation', control: {} },
			defaultValue: true,
		},
		chromaCorrection: {
			dataType: { kind: 'scalar' }, ui: { label: 'Chroma Correction', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		timeBaseCorrection: {
			dataType: { kind: 'scalar' }, ui: { label: 'Time Base Correction', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0,
		},
		alphaMode: {
			dataType: { kind: 'enum', options: ['preserve', 'opaque'] },
			ui: { label: 'Alpha Mode', control: { labels: { preserve: 'Preserve Coverage', opaque: 'Composite on Background' } } },
			defaultValue: 'preserve',
		},
		backgroundColor: {
			dataType: { kind: 'color' }, ui: { label: 'Background Color', control: {} },
			defaultValue: [0, 0, 0, 1],
		},
		seed: {
			dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
