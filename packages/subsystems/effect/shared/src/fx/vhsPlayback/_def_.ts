import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vhsPlayback',
	displayName: 'VHS Playback',
	description: {
		'ja-JP': 'VHSの記録信号を変調・復調し、トラッキング不良、テープの欠損、時間軸の乱れを再現します。',
		'en-US': 'Modulates and demodulates VHS recording signals to simulate tracking errors, tape dropouts, and time-base instability.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'distortion', 'color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		amount: {
			dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		time: {
			dataType: { kind: 'scalar' }, ui: { label: 'Time (s)', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		trackingOffset: {
			dataType: { kind: 'scalar' }, ui: { label: 'Tracking Offset (Tracks)', control: { controlType: 'range', min: -1.5, max: 1.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		trackAlignmentError: {
			dataType: { kind: 'scalar' }, ui: { label: 'Track Alignment Error (Tracks)', control: { controlType: 'range', min: -3, max: 3, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.4 },
		},
		timeBaseError: {
			dataType: { kind: 'scalar' }, ui: { label: 'Time Base Error (μs)', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.3 },
		},
		tapeDeformation: {
			dataType: { kind: 'scalar' }, ui: { label: 'Tape Deformation (μs / Field)', control: { controlType: 'range', min: -8, max: 8, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.4 },
		},
		headContact: {
			dataType: { kind: 'scalar' }, ui: { label: 'Head Contact', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		headSpacingLoss: {
			dataType: { kind: 'scalar' }, ui: { label: 'Head Spacing Loss', isAdvanced: true, control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		headSwitching: {
			dataType: { kind: 'bool' }, ui: { label: 'Head Switching', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		headTimingDifference: {
			dataType: { kind: 'scalar' }, ui: { label: 'Head Timing Difference (μs)', control: { controlType: 'range', min: -8, max: 8, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.5 },
		},
		dropoutRate: {
			dataType: { kind: 'scalar' }, ui: { label: 'Dropout Rate (/s)', control: { controlType: 'range', min: 0, max: 5000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 120 },
		},
		dropoutDuration: {
			dataType: { kind: 'scalar' }, ui: { label: 'Dropout Duration (μs)', control: { controlType: 'range', min: 0.1, max: 30, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		dropoutDepth: {
			dataType: { kind: 'scalar' }, ui: { label: 'Dropout Depth', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		rfNoiseFloor: {
			dataType: { kind: 'scalar' }, ui: { label: 'RF Noise Floor (dB)', control: { controlType: 'range', min: -100, max: -12, step: 1 } },
			defaultValue: { inputSource: 'literal', value: -42 },
		},
		dropoutCompensation: {
			dataType: { kind: 'bool' }, ui: { label: 'Dropout Compensation', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		chromaCorrection: {
			dataType: { kind: 'scalar' }, ui: { label: 'Chroma Correction', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		timeBaseCorrection: {
			dataType: { kind: 'scalar' }, ui: { label: 'Time Base Correction', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		alphaMode: {
			dataType: { kind: 'enum', options: ['preserve', 'opaque'] },
			ui: { label: 'Alpha Mode', control: { labels: { preserve: 'Preserve Coverage', opaque: 'Composite on Background' } } },
			defaultValue: { inputSource: 'literal', value: 'preserve' },
		},
		backgroundColor: {
			dataType: { kind: 'color' }, ui: { label: 'Background Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] },
		},
		seed: {
			dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
