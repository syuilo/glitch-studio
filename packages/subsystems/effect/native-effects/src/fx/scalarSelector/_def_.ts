import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Selector (Scalar)',
	summary: {
		'ja-JP': 'Index に最も近いスカラー入力をひとつ選びます。',
		'en-US': 'Selects the scalar input nearest to the specified index.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'scalar' } },
			ui: { label: 'Inputs', control: { element: { controlType: 'number', step: 0.01 } } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: 0 } },
					{ id: 'second', binding: { inputSource: 'literal', value: 0 } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		},
		index: { dataType: { kind: 'scalar' }, ui: { label: 'Index', control: { controlType: 'number', min: 0, step: 1 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	// Indexが変わっても下流の描画サイズが変わらないよう、自動解像度は候補全体の計画寸法から決める。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
