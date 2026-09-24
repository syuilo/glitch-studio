import { visualModuleCustomParameterId, visualModuleCustomParameterName, type VisualModuleParamDef } from './types.ts';
import type { ScalarParamUi } from './effect-definition.ts';

const scalar = (id: string, label: string, value: number, ui: ScalarParamUi): VisualModuleParamDef => ({
	id: visualModuleCustomParameterId(id), name: visualModuleCustomParameterName(id), dataType: 'scalar', ui: { ...ui, label },
	defaultValue: { inputSource: 'literal', value }, canNode: false, isPrimaryInput: false,
});

// 軸ごとにscalarとすることで、位置・拡縮にも既存のautomation graphを直接割り当てられる。
export const timelineCompositingParamDefs: VisualModuleParamDef[] = [
	{
		id: visualModuleCustomParameterId('blendMode'), name: visualModuleCustomParameterName('blendMode'), dataType: 'enum', ui: { control: 'enum', label: 'Blend mode' },
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
		defaultValue: { inputSource: 'literal', value: 'normal' }, canNode: false, isPrimaryInput: false,
	},
	scalar('opacity', 'Opacity', 1, { control: 'range', min: 0, max: 1, step: 0.01 }),
	scalar('translationX', 'Position X', 0, { control: 'number', step: 0.01 }),
	scalar('translationY', 'Position Y', 0, { control: 'number', step: 0.01 }),
	scalar('scaleX', 'Scale X', 1, { control: 'number', step: 0.01 }),
	scalar('scaleY', 'Scale Y', 1, { control: 'number', step: 0.01 }),
	scalar('rotation', 'Rotation', 0, { control: 'angle' }),
];
