import { createDefaultColorRamp } from '@gs/shared/color-ramp.ts';
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorRamp',
	displayName: 'Color Ramp',
	description: {
		'ja-JP': 'スカラー値を、複数の色と位置で定義した対応表に従って色へ変換します。',
		'en-US': 'Maps scalar values to colors using a ramp of color stops.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'gradient', 'convert'],
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		ramp: { dataType: { kind: 'colorRamp' }, ui: { label: 'Ramp', control: {} }, defaultValue: { inputSource: 'literal', value: createDefaultColorRamp() } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
