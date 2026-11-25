import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// 【パラメータとキーフレームの型・値・編集方法の対応を型検査する】
// データ型とUIの組み合わせ・デフォルト値・ネストした値の型推論を検証する。
// キーフレームの離散値にLinearを許したり、scalarに配列を保存したりできないことも確認し、
// 定義時と実行時で制約を揃えて不正な値がエフェクトまで渡るのを防ぐ。
test('checks parameter controls and infers values independently of controls', () => {
	const fileName = fileURLToPath(new URL('./parameter-schema.fixture.ts', import.meta.url)).replaceAll('\\', '/');
	const source = `
import type { KeyframesTimelineData, KeyframesTimelineKeyframe } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { TimelineFolderLayer, TimelineParameterContainerLayer, TimelineLayerWithParameters } from '@gs/subsystems_timeline_shared/types.ts';
const folder: TimelineFolderLayer = { id: 'folder', name: 'Folder', layerType: 'folder', color: null, isDisabled: false, isSolo: false, layers: [] };
const parameterContainer: TimelineParameterContainerLayer = { id: 'parameters', name: 'Parameters', layerType: 'parameterContainer', color: null, isDisabled: false, isSolo: false, curveAnimations: [], layers: [] };
// @ts-expect-error フォルダは整理だけを担当し、パラメータの定義を持てない
const folderWithParameters: TimelineFolderLayer = { ...folder, publicParameterDefs: [] };
// @ts-expect-error フォルダにCurve Animationを追加してパラメータのスコープを作らない
const folderWithCurveAnimations: TimelineFolderLayer = { ...folder, curveAnimations: [] };
// @ts-expect-error フォルダは値の編集・評価の所有者として扱わない
const parameterOwner: TimelineLayerWithParameters = folder;
const hold = { type: 'hold' } as const;
const linear = { type: 'linear' } as const;
const scalarKey: KeyframesTimelineKeyframe<{ kind: 'scalar' }> = { id: 'a', x: 0, value: 2, interpolation: linear };
const stringKeys: KeyframesTimelineData = { dataType: { kind: 'string' }, isNormalized: false, keyframes: [{ id: 'a', x: 0, value: 'Hello', interpolation: hold }] };
// @ts-expect-error scalarは1要素の配列ではなく素の数値を保存する
const arrayScalar: KeyframesTimelineKeyframe<{ kind: 'scalar' }> = { ...scalarKey, value: [2] };
// @ts-expect-error vectorの成分数は2に限る
const shortVector: KeyframesTimelineKeyframe<{ kind: 'vector' }> = { ...scalarKey, value: [2] };
// @ts-expect-error colorの成分数は4に限る
const shortColor: KeyframesTimelineKeyframe<{ kind: 'color' }> = { ...scalarKey, value: [2, 3] };
// @ts-expect-error 文字列にLinearを指定できない
const linearString: KeyframesTimelineData = { dataType: { kind: 'string' }, isNormalized: false, keyframes: [{ id: 'a', x: 0, value: 'Hello', interpolation: linear }] };
// @ts-expect-error boolの保存値に数値を使えない
const numberBool: KeyframesTimelineData = { dataType: { kind: 'bool' }, isNormalized: false, keyframes: [{ id: 'a', x: 0, value: 1, interpolation: hold }] };
// @ts-expect-error enumの候補のunionを維持する
const invalidEnumKey: KeyframesTimelineKeyframe<{ kind: 'enum'; options: readonly ['left', 'right'] }> = { id: 'a', x: 0, value: 'center', interpolation: hold };
// @ts-expect-error Binding経由でもタイムラインの型と値の対応を維持する
const mismatchedBinding: ValueParameterBinding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null, keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [{ id: 'a', x: 0, value: 'Hello', interpolation: hold }] } };
import { defineNativeEffect as defineEffect, type NativeEffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
type EffectOutputDefinitions = NativeEffectDefinition['outputDefs'];
import type { ParameterDefinition, ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import { colorBlendModes, type BlendMode } from '@gs/shared/color-blend.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { NodesEffect, NodesEffectArgumentBindings, NodeOutputReference } from '../src/types/nodes-effect-view.ts';
import type { DataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
type NodesEffectParamDef = NodesEffect['paramDefs'][number];

type AssertNever<T extends never> = T;
type AllDataTypesHaveSchemas = AssertNever<Exclude<DataType, ParameterDefinition['dataType']>>;
type AllSchemasUseCommonDataTypes = AssertNever<Exclude<ParameterDefinition['dataType'], DataType>>;
const scalarOutput = { dataType: { kind: 'scalar' } } as const satisfies EffectOutputDefinitions[string];
const summary = { 'ja-JP': '型検査用のエフェクトです。', 'en-US': 'An effect for type checking.' };
const outputDefinition = { id: 'outputs', displayName: 'Outputs', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: {}, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: { scalar: scalarOutput, color: { dataType: { kind: 'color' } } }, primaryOutput: 'scalar' } as const;
defineEffect({ ...outputDefinition, tags: [], primaryOutput: 'color' });
defineEffect({ ...outputDefinition, tags: [], primaryOutput: null });
// @ts-expect-error 存在しない出力キーを主出力に指定できない
defineEffect({ ...outputDefinition, tags: [], primaryOutput: 'missing' });
// @ts-expect-error 主出力がない場合もnullを明示する
defineEffect({ id: 'missing-output', displayName: 'Missing', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: {}, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {} });
const nodesEffectOutput: NodesEffect['outputDefs'][number] = { ...scalarOutput, id: 'out', name: 'out', label: 'Out' };
const textureType: TextureDataType = scalarOutput.dataType;
// @ts-expect-error 旧numberデータ型は使用しない
const oldNumber: DataType = 'number';
// @ts-expect-error 参照IDはテクスチャ出力のデータ型ではない
const referenceOutput: EffectOutputDefinitions[string] = { dataType: { kind: 'imageAssetTextureReference' } };

const number = { dataType: { kind: 'scalar' }, ui: { control: { controlType: 'range', min: 0, max: 1 }, label: 'Value' }, defaultValue: 0.5 } as const;
defineEffect({ ...outputDefinition, tags: [], paramDefs: { amount: number }, ui: { parameterLayout: [{ type: 'section', id: 'outer', label: 'Outer', children: [{ type: 'section', id: 'inner', label: 'Inner', defaultExpanded: false, children: ['amount'] }] }] } });
// @ts-expect-error レイアウト側の参照からパラメータキーを広げず、入れ子内の誤記も拒否する
defineEffect({ ...outputDefinition, tags: [], paramDefs: { amount: number }, ui: { parameterLayout: [{ type: 'section', id: 'outer', label: 'Outer', children: ['missing'] }] } });
// @ts-expect-error ルートに配置するパラメータも定義済みのキーに限定する
defineEffect({ ...outputDefinition, tags: [], paramDefs: { amount: number }, ui: { parameterLayout: ['missing'] } });
const color = { dataType: { kind: 'color' }, ui: { control: {}, label: 'Color' }, defaultValue: [1, 0, 0, 1] } as const satisfies ParameterDefinition;
// @ts-expect-error 素材参照は通常パラメータに定義できない
const videoAsset = { dataType: { kind: 'assetReference', assetType: 'video' }, ui: { control: {}, label: 'Video' }, defaultValue: null } as const satisfies ParameterDefinition;
// @ts-expect-error 素材参照は通常パラメータに定義できない
const fontAsset = { ...videoAsset, dataType: { kind: 'assetReference', assetType: 'font' } } as const satisfies ParameterDefinition;
// @ts-expect-error 素材参照は通常パラメータに定義できない
const lutAsset = { ...videoAsset, dataType: { kind: 'assetReference', assetType: 'lut' }, defaultValue: 'lut-id' } as const satisfies ParameterDefinition;
// @ts-expect-error 直接参照はAssetの種類を明示する
const missingAssetType: DataType = { kind: 'assetReference' };
// @ts-expect-error 未対応のAssetの種類を指定できない
const unknownAssetType: DataType = { kind: 'assetReference', assetType: 'unknown' };
// @ts-expect-error Asset参照の保存値はIDまたはnullであり、Assetオブジェクトではない
const invalidAssetDefault: ParameterDefinition = { ...videoAsset, defaultValue: { id: 'video' } };
// @ts-expect-error Asset自体への参照にはテクスチャのノード接続を許可しない
const assetNodeInput: ParameterDefinition = { ...fontAsset, canNode: true };
const videoSetting = { dataType: { kind: 'assetReference', assetType: 'video' }, ui: { label: 'Video' }, defaultValue: null } as const;
const staticSettingDefs = { video: videoSetting, font: { ...videoSetting, dataType: { kind: 'assetReference', assetType: 'font' } }, lut: { ...videoSetting, dataType: { kind: 'assetReference', assetType: 'lut' } } } as const;
type ResolvedStaticResources = import('@gs/subsystems_effect_renderer/effect-instance.ts').EffectStaticResources<{ staticSettingDefs: typeof staticSettingDefs }>;
// @ts-expect-error 設定値はBindingではなく素材IDを直接保存する
const invalidStaticValue: import('@gs/shared/static-setting.ts').StaticSettingValues<typeof staticSettingDefs> = { video: { inputSource: 'literal', value: 'video' }, font: null, lut: null };
const runtimeVideoFile: ResolvedStaticResources['video'] = new Blob();
const runtimeFontFile: ResolvedStaticResources['font'] = new Blob();
const runtimeLutFile: ResolvedStaticResources['lut'] = { url: 'https://example.test/lut.cube', size: 100, error: null };
const unselectedFont: ResolvedStaticResources['font'] = null;
// @ts-expect-error 動画の実行時入力はAssetではなくFileSourceである
const videoAssetObject: ResolvedStaticResources['video'] = { id: 'video', fileData: new Blob(), width: 640, height: 360 };
// @ts-expect-error フォントの実行時入力はGPUTextureではなくFileSourceである
const fontTexture: ResolvedStaticResources['font'] = {} as GPUTexture;
const blend = { dataType: { kind: 'blendMode' }, ui: { control: {}, label: 'Blend' }, defaultValue: 'normal' } as const satisfies ParameterDefinition;
const blendValue: BlendMode = 'multiply';
const blendNumber: number = colorBlendModes[blendValue];
// @ts-expect-error 存在しないモードを初期値に指定できない
const badBlend: ParameterDefinition = { ...blend, defaultValue: 'invalid' };
// replaceも共通の合成モードとしてパラメータに指定できる。
const replaceBlend: BlendMode = 'replace';
const replaceDefault: ParameterDefinition = { ...blend, defaultValue: replaceBlend };
// @ts-expect-error エフェクト定義経由でも不正な初期値を拒否する
defineEffect({ id: 'bad-blend', displayName: 'Bad blend', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: { blend: { ...blend, defaultValue: 'invalid' } }, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null });
type NestedBlendDefault = ParameterDefaultValue<{ kind: 'array'; elementType: { kind: 'struct'; fields: { mode: { kind: 'blendMode' } } } }>;
const nestedBlend: NestedBlendDefault = [{ mode: 'screen' }];
// @ts-expect-error 配列・構造体内部の初期値にもモードの制約を適用する
const badNestedBlend: NestedBlendDefault = [{ mode: 'invalid' }];
// @ts-expect-error 要素IDは利用側のBindingに属する
const elementWithId: NestedBlendDefault = [{ ...nestedBlend[0], id: 'first' }];
// @ts-expect-error 配列の初期要素はデータ型に対応する値を直接指定する
const wrappedElement: NestedBlendDefault = [{ inputSource: 'literal', value: nestedBlend[0] }];
type BlendValues = Parameters<NativeEffectImplementation<{ blend: typeof blend }>['init']>[0]['inputs'];
const runtimeBlend: BlendValues['blend']['value'] = 'screen';
// @ts-expect-error 実行時の型も初期値だけに絞らず、全モードのunionにする
const badRuntimeBlend: BlendValues['blend']['value'] = 'invalid';
// @ts-expect-error colorではrangeを使用できない
defineEffect({ id: 'invalid-color', displayName: 'Invalid', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: { color: { ...color, ui: { control: { controlType: 'range', min: 0, max: 1 }, label: 'Invalid' } } }, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null });
// @ts-expect-error rangeの範囲は必須
const missingBounds: ParameterDefinition = { ...number, ui: { control: { controlType: 'range' }, label: 'Invalid' } };
const external = { ...color, id: 'c', nameForReference: 'color', defaultValue: [1, 0, 0, 1], canNode: true } satisfies NodesEffectParamDef;
// @ts-expect-error 外部パラメータでも同じ組み合わせ制約を適用する
const badExternal: NodesEffectParamDef = { ...external, dataType: { kind: 'scalar' }, ui: { control: { controlType: 'range' }, label: 'Invalid' } };
const schemas = {
 amount: number,
 seed: { ...number, ui: { control: { controlType: 'seed' }, label: 'Seed' } },
 angle: { ...number, ui: { control: { controlType: 'angle' }, label: 'Angle' } },
 color,
 mode: { dataType: { kind: 'enum', options: ['a', 'b'] }, ui: { control: { labels: { a: 'A', b: 'B' } }, label: 'Mode' }, defaultValue: 'a' },
 input: { ...number, canNode: true },
 group: { dataType: { kind: 'struct', fields: { input: number.dataType } }, ui: { label: 'Group', control: { fields: { input: number.ui } } }, fields: { input: { defaultValue: number.defaultValue, canNode: true } }, defaultValue: { input: number.defaultValue } },
 values: { dataType: { kind: 'array', elementType: number.dataType }, ui: { label: 'Values', control: { element: number.ui.control } }, element: { defaultValue: number.defaultValue }, defaultValue: [] },
} as const satisfies Record<string, ParameterDefinition>;
type Values = Parameters<NativeEffectImplementation<typeof schemas>['init']>[0]['inputs'];
// @ts-expect-error canNodeなパラメータは定数でも画像入力として受け取る
const rawNodeInput: Values['input'] = 2;
// @ts-expect-error 構造体内のcanNodeにも同じ規約を適用する
const rawNestedInput: Values['group']['fields']['input'] = 3;
// @ts-expect-error enumの候補のunionを維持する
const badMode: Values['mode']['value'] = 'c';
// @ts-expect-error 配列要素も数値として推論する
const badArray: Values['values']['elements'][number]['value'] = 'a';
defineEffect({ id: 'test', displayName: 'Test', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: { amount: number }, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null });
// @ts-expect-error 主入力を持たない場合もnullを明示する
defineEffect({ id: 'missing-primary', displayName: 'Missing primary', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: {}, outputDefs: {}, primaryOutput: null });
// @ts-expect-error numberのdefaultValueに文字列を許可しない
defineEffect({ id: 'bad', displayName: 'Bad', summary, kind: 'generate', dependsOnRenderHistory: false, tags: [], paramDefs: { amount: { ...number, defaultValue: 'bad' } }, primaryInputParameter: null, resolutionInputParameters: [], outputDefs: {}, primaryOutput: null });
// @ts-expect-error パラメータ定義にはdefaultValueが必要
const missingDefault: ParameterDefinition = { dataType: { kind: 'scalar' }, ui: { control: { controlType: 'number' }, label: 'Missing' } };
// @ts-expect-error 真偽値をInノードの出力にできない
const boolInput: NodesEffectParamDef = { ...external, dataType: { kind: 'bool' }, ui: { control: {}, label: 'Bool' }, defaultValue: false, canNode: true };
// @ts-expect-error 接続のサンプリング設定は省略できない
const missingSampling: NodeOutputReference = { nodeId: 'node', outputPort: 'output' };
const externalValues: NodesEffectArgumentBindings = {};
// @ts-expect-error Nodes Effectの外から内部ノードを参照できない
externalValues[external.id] = { inputSource: 'node', nodeId: null, outputPort: null };
// @ts-expect-error Nodes Effectの外から内部公開パラメータを参照できない
externalValues[external.id] = { inputSource: 'nodesEffectPublicParameterReference', parameterId: external.id };

// 表示範囲のUIは中心vector・倍率scalarを必須とし、回転scalarは省略できる。
// 見た目の指定だけで、別の型や不足したフィールドをプレビュー編集へ渡さない。
import mandelbrot from '@gs/subsystems_effect_native-effects/fx/mandelbrot/_def_.ts';
import imageTrap from '@gs/subsystems_effect_native-effects/fx/imageTrap/_def_.ts';
import magneticPendulum from '@gs/subsystems_effect_native-effects/fx/magneticPendulum/_def_.ts';
import doublePendulumFractal from '@gs/subsystems_effect_native-effects/fx/doublePendulumFractal/_def_.ts';
defineEffect({ ...outputDefinition, tags: [], paramDefs: { view: mandelbrot.paramDefs.view } });
defineEffect({ ...outputDefinition, tags: [], paramDefs: { imageTrapView: imageTrap.paramDefs.view, magneticView: magneticPendulum.paramDefs.view, doublePendulumView: doublePendulumFractal.paramDefs.view } });
const unrelatedStruct = {
	dataType: { kind: 'struct', fields: { amount: { kind: 'scalar' } } },
	ui: { label: 'Unrelated', control: { controlType: 'viewport2d', spanAtZoomOne: 4, fields: { amount: number.ui } } },
	fields: { amount: { defaultValue: number.defaultValue } },
	defaultValue: { amount: number.defaultValue },
} as const;
// @ts-expect-error 必須の表示範囲フィールドがないstructにはviewport2dを指定できない
defineEffect({ ...outputDefinition, tags: [], paramDefs: { view: unrelatedStruct } });
const wrongCenter = { ...mandelbrot.paramDefs.view, dataType: { kind: 'struct', fields: { center: { kind: 'scalar' }, zoom: { kind: 'scalar' }, rotation: { kind: 'scalar' } } },
	ui: { ...mandelbrot.paramDefs.view.ui, control: { ...mandelbrot.paramDefs.view.ui.control, fields: { ...mandelbrot.paramDefs.view.ui.control.fields, center: number.ui } } },
	fields: { ...mandelbrot.paramDefs.view.fields, center: { defaultValue: number.defaultValue } },
	defaultValue: { ...mandelbrot.paramDefs.view.defaultValue, center: number.defaultValue },
} as const;
// @ts-expect-error centerはscalarではなくvectorである必要がある
defineEffect({ ...outputDefinition, tags: [], paramDefs: { view: wrongCenter } });
const wrongRotation = { ...imageTrap.paramDefs.view,
	dataType: { kind: 'struct', fields: { ...imageTrap.paramDefs.view.dataType.fields, rotation: { kind: 'vector' } } },
	ui: { ...imageTrap.paramDefs.view.ui, control: { ...imageTrap.paramDefs.view.ui.control, fields: { ...imageTrap.paramDefs.view.ui.control.fields, rotation: imageTrap.paramDefs.view.ui.control.fields.center } } },
	fields: { ...imageTrap.paramDefs.view.fields, rotation: imageTrap.paramDefs.view.fields.center },
	defaultValue: { ...imageTrap.paramDefs.view.defaultValue, rotation: imageTrap.paramDefs.view.defaultValue.center },
} as const;
// @ts-expect-error rotationを指定する場合はscalarである必要がある
defineEffect({ ...outputDefinition, tags: [], paramDefs: { view: wrongRotation } });
`;
	const options = {
		// 実際のUIと同じraw importの型宣言を読み込み、参照先のWGSLを未解決にしない。
		strict: true, noEmit: true, skipLibCheck: true, types: ['@webgpu/types', '@types/web', 'vite/client'],
		typeRoots: [fileURLToPath(new URL('../../renderer/node_modules', import.meta.url))],
		target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
	};
	const host = ts.createCompilerHost(options);
	const getSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (name, ...args) => name === fileName
		? ts.createSourceFile(name, source, options.target, true)
		: getSourceFile(name, ...args);
	const program = ts.createProgram([fileName], options, host);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
	}));
});
