import { defineNativeEffect } from '../src/effect-definition.ts';

const definition = {
	displayName: 'Test', summary: { 'en-US': '', 'ja-JP': '' }, tags: [], kind: 'generate', dependsOnRenderHistory: false,
	paramDefs: { gain: { dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: 0 } },
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

// 【サムネイルの画像入力とパラメータ指定はNative Effectの定義に従う】
// ピッカー用の設定を既存の値や配線から独立させつつ、誤ったIDや値による生成失敗を定義時に検出する。
const thumbnailDefinition = defineNativeEffect({
	...definition,
	paramDefs: {
		...definition.paramDefs,
		inputA: { dataType: { kind: 'color' }, canNode: true, ui: { label: 'Input A', control: {} }, defaultValue: [0, 0, 0, 0] },
		tint: { dataType: { kind: 'color' }, ui: { label: 'Tint', control: {} }, defaultValue: [0, 0, 0, 1] },
		field: { dataType: { kind: 'vector' }, canNode: true, ui: { label: 'Field', control: { controlType: 'vector' } }, defaultValue: [0, 0] },
	},
	primaryInputParameter: 'inputA',
});
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'none' } });
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'static' } });
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'defaultParameters', inputs: { inputA: 'sceneA' } } });
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'customParameters', inputs: {}, params: { gain: 1, tint: [1, 0.5, 0, 1] } } });
// @ts-expect-error 定義されていない入力には画像を接続できない
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'defaultParameters', inputs: { inputA: 'sceneA', inputB: 'sceneB' } } });
// @ts-expect-error 接続不可のcolorパラメータに画像を割り当てている
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'defaultParameters', inputs: { tint: 'sceneA' } } });
// @ts-expect-error 画像の割り当て先はcolor入力のみ
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'defaultParameters', inputs: { field: 'sceneA' } } });
// @ts-expect-error 定義されていない共通画像ID
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'defaultParameters', inputs: { inputA: 'unknown' } } });
// @ts-expect-error gainは数値を受け取る
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'customParameters', params: { gain: true } } });
// @ts-expect-error 定義されていないパラメータID
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'customParameters', params: { gain: 1, unknown: 1 } } });
// @ts-expect-error 既定値で生成する方式にパラメータの上書きはない
defineNativeEffect({ ...thumbnailDefinition, thumbnail: { mode: 'defaultParameters', params: { gain: 1 } } });
// @ts-expect-error 自動生成にはcolorの主出力が必要
defineNativeEffect({ ...definition, outputDefs: { image: { dataType: { kind: 'scalar' } } }, thumbnail: { mode: 'defaultParameters' } });
