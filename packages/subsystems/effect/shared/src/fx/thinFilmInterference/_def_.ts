import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'thinFilmInterference',
	displayName: 'Thin Film Interference',
	description: {
		'ja-JP': '薄膜の干渉による反射色や透過色を生成し、シャボン玉のような虹色を作ります。',
		'en-US': 'Generates thin-film reflection or transmission colors to create soap-bubble-like iridescence.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'light', 'convert'],
	paramDefs: {
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Thickness Input', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		minimumThickness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Minimum Thickness (nm)', control: { controlType: 'range', min: 0, max: 2000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		maximumThickness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Thickness (nm)', control: { controlType: 'range', min: 0, max: 2000, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1000 },
		},
		filmIor: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Film IOR', control: { controlType: 'range', min: 1, max: 3, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.33 },
		},
		substrateIor: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Substrate IOR', control: { controlType: 'range', min: 1, max: 3, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		incidenceAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Incidence Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		mode: {
			dataType: { kind: 'enum', options: ['reflection', 'transmission'] },
			ui: { label: 'Mode', control: { labels: { reflection: 'Reflection', transmission: 'Transmission' } } },
			defaultValue: { inputSource: 'literal', value: 'reflection' },
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
	resolutionInputParameters: ['input', 'incidenceAngle', 'lightColor', 'opacity'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
