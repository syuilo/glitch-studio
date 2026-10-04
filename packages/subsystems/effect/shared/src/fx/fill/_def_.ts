import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'fill',
	displayName: 'Fill',
	description: {
		'ja-JP': '指定した単色を出力します。',
		'en-US': 'Outputs a solid color.',
	},
	kind: 'generate',
	tags: ['color', 'utility'],
	paramDefs: {
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
