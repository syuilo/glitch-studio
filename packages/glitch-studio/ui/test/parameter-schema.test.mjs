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
import { defineEffect, type EffectOutputDefinitions } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { ParameterDefinition, ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import { colorBlendModes, type BlendMode } from '@gs/shared/color-blend.ts';
import type { EffectInstance } from '@gs/subsystems_effect_shared/effect-implementation.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName, type VisualModule, type VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { NodeOutputReference } from '@gs/subsystems_visual-module_shared/types.ts';
import type { DataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
type VisualModuleParamDef = VisualModule['paramDefs'][number];

type AssertNever<T extends never> = T;
type AllDataTypesHaveSchemas = AssertNever<Exclude<DataType, ParameterDefinition['dataType']>>;
type AllSchemasUseCommonDataTypes = AssertNever<Exclude<ParameterDefinition['dataType'], DataType>>;
const scalarOutput = { dataType: { kind: 'scalar' } } as const satisfies EffectOutputDefinitions[string];
const description = { 'ja-JP': '型検査用のエフェクトです。', 'en-US': 'An effect for type checking.' };
const outputDefinition = { id: 'outputs', displayName: 'Outputs', description, kind: 'generate', tags: [], paramDefs: {}, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: { scalar: scalarOutput, color: { dataType: { kind: 'color' } } }, primaryOutput: 'scalar' } as const;
defineEffect({ ...outputDefinition, tags: [], primaryOutput: 'color' });
defineEffect({ ...outputDefinition, tags: [], primaryOutput: null });
// @ts-expect-error 存在しない出力キーを主出力に指定できない
defineEffect({ ...outputDefinition, tags: [], primaryOutput: 'missing' });
// @ts-expect-error 主出力がない場合もnullを明示する
defineEffect({ id: 'missing-output', displayName: 'Missing', description, kind: 'generate', tags: [], paramDefs: {}, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: {} });
const moduleOutput: VisualModule['outputDefs'][number] = { ...scalarOutput, id: 'out', name: 'out', label: 'Out' };
const textureType: TextureDataType = scalarOutput.dataType;
// @ts-expect-error 旧numberデータ型は使用しない
const oldNumber: DataType = 'number';
// @ts-expect-error 参照IDはテクスチャ出力のデータ型ではない
const referenceOutput: EffectOutputDefinitions[string] = { dataType: { kind: 'assetReference' } };

const number = { dataType: { kind: 'scalar' }, ui: { control: { controlType: 'range', min: 0, max: 1 }, label: 'Value' }, defaultValue: { inputSource: 'literal', value: 0.5 } } as const;
const color = { dataType: { kind: 'color' }, ui: { control: {}, label: 'Color' }, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } } as const satisfies ParameterDefinition;
const blend = { dataType: { kind: 'blendMode' }, ui: { control: {}, label: 'Blend' }, defaultValue: { inputSource: 'literal', value: 'normal' } } as const satisfies ParameterDefinition;
const blendValue: BlendMode = 'multiply';
const blendNumber: number = colorBlendModes[blendValue];
// @ts-expect-error 存在しないモードを初期値に指定できない
const badBlend: ParameterDefinition = { ...blend, defaultValue: { inputSource: 'literal', value: 'invalid' } };
// replaceも共通の合成モードとしてパラメータに指定できる。
const replaceBlend: BlendMode = 'replace';
const replaceDefault: ParameterDefinition = { ...blend, defaultValue: { inputSource: 'literal', value: replaceBlend } };
// @ts-expect-error エフェクト定義経由でも不正な初期値を拒否する
defineEffect({ id: 'bad-blend', displayName: 'Bad blend', description, kind: 'generate', tags: [], paramDefs: { blend: { ...blend, defaultValue: { inputSource: 'literal', value: 'invalid' } } }, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: {}, primaryOutput: null });
type NestedBlendDefault = ParameterDefaultValue<{ kind: 'array'; elementType: { kind: 'struct'; fields: { mode: { kind: 'blendMode' } } } }>;
const nestedBlend: NestedBlendDefault = { inputSource: 'literal', value: [{ id: 'first', binding: { inputSource: 'literal', value: { mode: { inputSource: 'literal', value: 'screen' } } } }] };
// @ts-expect-error 配列・構造体内部の初期値にもモードの制約を適用する
const badNestedBlend: NestedBlendDefault = { inputSource: 'literal', value: [{ id: 'first', binding: { inputSource: 'literal', value: { mode: { inputSource: 'literal', value: 'invalid' } } } }] };
// @ts-expect-error 配列の初期値にも要素IDが必要
const missingElementId: NestedBlendDefault = { inputSource: 'literal', value: [{ binding: nestedBlend.value[0].binding }] };
// @ts-expect-error 子のBindingを直接配列に保存しない
const unwrappedElement: NestedBlendDefault = { inputSource: 'literal', value: [nestedBlend.value[0].binding] };
type BlendValues = Parameters<EffectInstance<{ blend: typeof blend }>['render']>[0]['params'];
const runtimeBlend: BlendValues['blend'] = 'screen';
// @ts-expect-error 実行時の型も初期値だけに絞らず、全モードのunionにする
const badRuntimeBlend: BlendValues['blend'] = 'invalid';
// @ts-expect-error colorではrangeを使用できない
defineEffect({ id: 'invalid-color', displayName: 'Invalid', description, kind: 'generate', tags: [], paramDefs: { color: { ...color, ui: { control: { controlType: 'range', min: 0, max: 1 }, label: 'Invalid' } } }, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: {}, primaryOutput: null });
// @ts-expect-error rangeの範囲は必須
const missingBounds: ParameterDefinition = { ...number, ui: { control: { controlType: 'range' }, label: 'Invalid' } };
const external = { ...color, id: visualModuleCustomParameterId('c'), nameForReference: visualModuleCustomParameterName('color'), defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] }, canNode: true } satisfies VisualModuleParamDef;
// @ts-expect-error 外部パラメータでも同じ組み合わせ制約を適用する
const badExternal: VisualModuleParamDef = { ...external, dataType: { kind: 'scalar' }, ui: { control: { controlType: 'range' }, label: 'Invalid' } };
const schemas = {
 amount: number,
 seed: { ...number, ui: { control: { controlType: 'seed' }, label: 'Seed' } },
 angle: { ...number, ui: { control: { controlType: 'angle' }, label: 'Angle' } },
 color,
 mode: { dataType: { kind: 'enum', options: ['a', 'b'] }, ui: { control: { labels: { a: 'A', b: 'B' } }, label: 'Mode' }, defaultValue: { inputSource: 'literal', value: 'a' } },
 asset: { dataType: { kind: 'assetReference' }, ui: { control: {}, label: 'Asset' }, defaultValue: { inputSource: 'literal', value: null } },
 player: { dataType: { kind: 'playerReference' }, ui: { control: {}, label: 'Player' }, defaultValue: { inputSource: 'literal', value: null } },
 input: { ...number, canNode: true },
 group: { dataType: { kind: 'struct', fields: { input: number.dataType } }, ui: { label: 'Group', control: { fields: { input: number.ui } } }, fields: { input: { defaultValue: number.defaultValue, canNode: true } }, defaultValue: { inputSource: 'literal', value: { input: number.defaultValue } } },
 values: { dataType: { kind: 'array', elementType: number.dataType }, ui: { label: 'Values', control: { element: number.ui.control } }, element: { defaultValue: number.defaultValue }, defaultValue: { inputSource: 'literal', value: [] } },
} as const satisfies Record<string, ParameterDefinition>;
type Values = Parameters<EffectInstance<typeof schemas>['render']>[0]['params'];
const values: Values = { amount: 2, seed: 1.25, angle: -0.5, color: [1, 0, 0, 1], mode: 'a', asset: null, player: { videoFrame: null, audio: null }, values: [1, 2], input: { kind: 'uniform', value: [2] }, group: { input: { kind: 'uniform', value: [3] } } };
// @ts-expect-error canNodeなパラメータは定数でもShaderInputで受け取る
const rawNodeInput: Values['input'] = 2;
// @ts-expect-error 構造体内のcanNodeにも同じ規約を適用する
const rawNestedInput: Values['group']['input'] = 3;
// @ts-expect-error enumの候補のunionを維持する
const badMode: Values['mode'] = 'c';
// @ts-expect-error 配列要素も数値として推論する
const badArray: Values['values'] = ['a'];
defineEffect({ id: 'test', displayName: 'Test', description, kind: 'generate', tags: [], paramDefs: { amount: number }, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: {}, primaryOutput: null });
// @ts-expect-error 主入力を持たない場合もnullを明示する
defineEffect({ id: 'missing-primary', displayName: 'Missing primary', description, kind: 'generate', tags: [], paramDefs: {}, outputDefs: {}, primaryOutput: null });
// @ts-expect-error numberのdefaultValueに文字列を許可しない
defineEffect({ id: 'bad', displayName: 'Bad', description, kind: 'generate', tags: [], paramDefs: { amount: { ...number, defaultValue: { inputSource: 'literal', value: 'bad' } } }, primaryInputParameter: null, resolutionInputParameter: null, outputDefs: {}, primaryOutput: null });
// @ts-expect-error パラメータ定義にはdefaultValueが必要
const missingDefault: ParameterDefinition = { dataType: { kind: 'scalar' }, ui: { control: { controlType: 'number' }, label: 'Missing' } };
// @ts-expect-error 真偽値をInノードの出力にできない
const boolInput: VisualModuleParamDef = { ...external, dataType: { kind: 'bool' }, ui: { control: {}, label: 'Bool' }, defaultValue: { inputSource: 'literal', value: false }, canNode: true };
// @ts-expect-error 接続のサンプリング設定は省略できない
const missingSampling: NodeOutputReference = { nodeId: 'node', outputPort: 'output' };
const externalValues: VisualModuleArgumentBindings = {};
// @ts-expect-error モジュールの外から内部ノードを参照できない
externalValues[external.id] = { inputSource: 'node', nodeId: null, outputPort: null };
// @ts-expect-error モジュールの外から内部カスタムパラメータを参照できない
externalValues[external.id] = { inputSource: 'externalCustomParameterInput', parameterId: external.id };
`;
	const options = {
		strict: true, noEmit: true, skipLibCheck: true, types: ['@webgpu/types', '@types/web'],
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
