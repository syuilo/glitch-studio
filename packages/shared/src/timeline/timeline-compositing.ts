import type { ParameterDefinition } from '../parameter.ts';

export const timelineCompositingParamDefs: Record<string, ParameterDefinition> = {
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
	translationX: {
		dataType: 'scalar', ui: { control: 'number', label: 'Position X', step: 0.01 },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
	translationY: {
		dataType: 'scalar', ui: { control: 'number', label: 'Position Y', step: 0.01 },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
	scaleX: {
		dataType: 'scalar', ui: { control: 'number', label: 'Scale X', step: 0.01 },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	scaleY: {
		dataType: 'scalar', ui: { control: 'number', label: 'Scale Y', step: 0.01 },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	rotation: {
		dataType: 'scalar', ui: { control: 'angle', label: 'Rotation' },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
};
