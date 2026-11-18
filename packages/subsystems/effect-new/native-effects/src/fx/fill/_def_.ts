import { defineNativeEffect } from '../../native-effect-definition.ts';

export default defineNativeEffect({
	id: 'fill',
	displayName: 'Fill',
	summary: {
		'ja-JP': '指定した単色を出力します。',
		'en-US': 'Outputs a solid color.',
	},
	tags: ['color', 'utility'],
	dependsOnRenderHistory: false,
	kind: 'generate',
	paramDefs: {
		color: {
			dataType: { kind: 'color' },
			ui: { label: 'Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
