import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Selector (Vector)',
	summary: {
		'ja-JP': 'Index に最も近いベクトル入力をひとつ選びます。',
		'en-US': 'Selects the vector input nearest to the specified index.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	thumbnail: { mode: 'none' },
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'vector' } },
			ui: { label: 'Inputs', control: { element: { controlType: 'vector', step: 0.01 } } },
			defaultValue: [
				[0, 0],
				[0, 0],
			],
			element: { canNode: true, defaultValue: [0, 0] },
		},
		index: { dataType: { kind: 'scalar' }, ui: { label: 'Index', control: { controlType: 'number', min: 0, step: 1 } }, defaultValue: 0 },
	},
	// Indexが変わっても下流の描画サイズが変わらないよう、自動解像度は候補全体の計画寸法から決める。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'output',
});
