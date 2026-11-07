import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcdViewingAngle',
	displayName: 'LCD Viewing Angle',
	description: {
		'ja-JP': 'TN型液晶内の分光偏光伝搬を計算し、斜めから見たときの色・コントラスト・階調の変化を再現します。',
		'en-US': 'Simulates spectral polarization propagation through a TN LCD to reproduce off-axis color, contrast, and grayscale changes.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'light', 'simulation'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		horizontalViewingAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Horizontal Viewing Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		verticalViewingAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Vertical Viewing Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		cellThickness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Cell Thickness (µm)', control: { controlType: 'range', min: 0, max: 15, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 5 },
		},
		ordinaryIor: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Ordinary IOR', control: { controlType: 'range', min: 1, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.5 },
		},
		extraordinaryIor: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Extraordinary IOR', control: { controlType: 'range', min: 1, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.6 },
		},
		twistAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Twist Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		pretiltAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Pretilt Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 2 / 360 },
		},
		panelRotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Panel Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		polarizerAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Polarizer Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		analyzerAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Analyzer Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		calibrateFrontView: {
			dataType: { kind: 'bool' },
			ui: { label: 'Calibrate Front View', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		brightness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Brightness', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 2 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input', 'amount'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
