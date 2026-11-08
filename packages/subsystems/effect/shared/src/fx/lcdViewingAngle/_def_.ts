import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcdViewingAngle',
	displayName: 'LCD Viewing Angle',
	description: {
		'ja-JP': '液晶画面を斜めから見たような、視線方向に応じた色・階調の変化や階調反転を加えます。',
		'en-US': 'Simulates viewing-angle-dependent color shifts, contrast loss, and grayscale inversion on an LCD screen.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'stylized'],
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
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.125 },
		},
		verticalViewingAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Vertical Viewing Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		colorShift: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Color Shift', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		contrastLoss: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Contrast Loss', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		inversion: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Inversion', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input', 'horizontalViewingAngle', 'verticalViewingAngle', 'amount'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
