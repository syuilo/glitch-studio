import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

const definition = defineNativeEffect({
	displayName: 'Fill',
	summary: { 'ja-JP': '指定した単色を出力します。', 'en-US': 'Outputs a solid color.' },
	tags: ['color', 'utility'],
	kind: 'generate',
	dependsOnRenderHistory: false,
	paramDefs: {
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});

export default definition;
