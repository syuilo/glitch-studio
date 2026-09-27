import { defineEffect } from '../../effect-definition.ts';
import { colorBlendModes } from '../../../color-blend.ts';

export default defineEffect({
	id: 'bloom',
	displayName: 'Bloom',
	tags: [],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		inputBlendMode: {
			// Emissionは光の量を直接足すBloom専用の合成。それ以外は共通モードを使う。
			dataType: { kind: 'enum', options: ['emission', ...Object.keys(colorBlendModes)] },
			ui: {
				label: 'Input Blend',
				control: { labels: {
					emission: 'Emission', normal: 'Normal', add: 'Add', subtract: 'Subtract',
					multiply: 'Multiply', darken: 'Darken', lighten: 'Lighten', screen: 'Screen',
					overlay: 'Overlay', difference: 'Difference', exclusion: 'Exclusion', none: 'None',
					colorBurn: 'Color Burn', colorDodge: 'Color Dodge', softLight: 'Soft Light', hardLight: 'Hard Light',
					hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity', replace: 'Replace (B only)',
				} },
			},
			defaultValue: { inputSource: 'literal', value: 'emission' },
		},
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.7 } },
		softKnee: { dataType: { kind: 'scalar' }, ui: { label: 'Soft knee', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		radius: { dataType: { kind: 'vector' }, ui: { label: 'Radius', control: { controlType: 'vector', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0.7, 0.7] } },
		quality: { dataType: { kind: 'scalar' }, ui: { label: 'Quality', control: { controlType: 'range', min: 0.1, max: 1, step: 0.05 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	primaryInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
