import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'birefringence',
	displayName: 'Birefringence',
	description: {
		'ja-JP': '厚み・複屈折量・速軸の向きから、2枚の偏光板越しに見える干渉色を生成します。',
		'en-US': 'Generates interference colors between two polarizers from thickness, birefringence, and fast-axis orientation.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'light', 'simulation', 'convert'],
	paramDefs: {
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Thickness Input', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		minimumThickness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Minimum Thickness (µm)', control: { controlType: 'range', min: 0, max: 200, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		maximumThickness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Thickness (µm)', control: { controlType: 'range', min: 0, max: 200, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 100 },
		},
		birefringence: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Birefringence (Δn)', control: { controlType: 'range', min: 0, max: 0.02, step: 0.0001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.01 },
		},
		fastAxisAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fast Axis Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.125 },
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
		lightColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Light Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		brightness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Brightness', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		opacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input', 'birefringence', 'fastAxisAngle', 'lightColor', 'opacity'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
