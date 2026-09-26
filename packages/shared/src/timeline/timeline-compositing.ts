import type { ParameterDefinition } from '../parameter.ts';

export const timelineCompositingParamDefs = {
	blendMode: {
		dataType: 'enum', ui: { control: 'enum', label: 'Blend mode' },
		options: [
			{ value: 'normal', label: 'Normal' }, { value: 'replace', label: 'Replace (置き換え)' },
			{ value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' },
			{ value: 'overlay', label: 'Overlay' }, { value: 'darken', label: 'Darken' },
			{ value: 'lighten', label: 'Lighten' }, { value: 'colorBurn', label: 'Color burn' },
			{ value: 'colorDodge', label: 'Color dodge' }, { value: 'softLight', label: 'Soft light' },
			{ value: 'hardLight', label: 'Hard light' }, { value: 'add', label: 'Add' },
			{ value: 'subtract', label: 'Subtract' }, { value: 'difference', label: 'Difference' },
			{ value: 'exclusion', label: 'Exclusion' }, { value: 'hue', label: 'Hue' },
			{ value: 'saturation', label: 'Saturation' }, { value: 'color', label: 'Color' },
			{ value: 'luminosity', label: 'Luminosity' }, { value: 'none', label: 'None' },
		],
		defaultValue: { inputSource: 'literal', value: 'normal' }, canNode: false,
	},
	opacity: {
		dataType: 'scalar', ui: { control: 'range', label: 'Opacity', min: 0, max: 1, step: 0.01 },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	translation: {
		dataType: 'vector', ui: { control: 'xy', label: 'Position', step: 0.01 },
		defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false,
	},
	scale: {
		dataType: 'vector', ui: { control: 'xy', label: 'Scale', step: 0.01 },
		defaultValue: { inputSource: 'literal', value: [1, 1] }, canNode: false,
	},
	rotation: {
		dataType: 'scalar', ui: { control: 'angle', label: 'Rotation' },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;
