import { defineNativeEffect } from '../src/effect-definition.ts';

const definition = {
	displayName: 'Test', summary: { 'en-US': '', 'ja-JP': '' }, tags: [], kind: 'generate', dependsOnRenderHistory: false,
	paramDefs: { gain: { dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } } },
	outputDefs: { image: { dataType: { kind: 'color' }, inputParameters: ['gain'] } }, primaryInputParameter: null, primaryOutput: 'image', resolutionInputParameters: [],
} as const;
defineNativeEffect({ ...definition, ui: { parameterLayout: ['gain'] } });
// 【Native Effectの入力依存と表示レイアウトは定義したパラメータIDだけを参照する】
// 運用時の検査を省いても、タイプミスで必要な入力が計画から外れないようにする。
// @ts-expect-error 未定義の出力入力依存
defineNativeEffect({ ...definition, outputDefs: { image: { dataType: { kind: 'color' }, inputParameters: ['missing'] } } });
// @ts-expect-error 表示レイアウトの重複
defineNativeEffect({ ...definition, ui: { parameterLayout: ['gain', 'gain'] } });
// @ts-expect-error 表示レイアウトの欠落
defineNativeEffect({ ...definition, ui: { parameterLayout: [] } });
// @ts-expect-error CPUの数値は寸法を持たない
defineNativeEffect({ ...definition, resolutionInputParameters: ['gain'] });
// @ts-expect-error CPUの数値を主音声入力にできない
defineNativeEffect({ ...definition, primaryAudioInputParameter: 'gain' });
