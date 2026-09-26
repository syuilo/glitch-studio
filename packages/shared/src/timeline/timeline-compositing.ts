import type { ParameterDefinition } from '../parameter.ts';

export const timelineCompositingParamDefs = {
	blendMode: {
		dataType: {
			kind: 'enum',
			options: ['normal', 'replace', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorBurn', 'colorDodge', 'softLight', 'hardLight', 'add', 'subtract', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'none'],
		},
		ui: {
			label: 'Blend mode',
			control: {
				labels: {
					normal: 'Normal', replace: 'Replace (置き換え)', multiply: 'Multiply', screen: 'Screen',
					overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', colorBurn: 'Color burn',
					colorDodge: 'Color dodge', softLight: 'Soft light', hardLight: 'Hard light', add: 'Add',
					subtract: 'Subtract', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue',
					saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity', none: 'None',
				},
			},
		},
		defaultValue: { inputSource: 'literal', value: 'normal' }, canNode: false,
	},
	opacity: {
		dataType: { kind: 'scalar' }, ui: { label: 'Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	translation: {
		dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy', step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false,
	},
	scale: {
		dataType: { kind: 'vector' }, ui: { label: 'Scale', control: { controlType: 'xy', step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [1, 1] }, canNode: false,
	},
	rotation: {
		dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;
