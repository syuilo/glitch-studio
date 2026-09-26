import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// データ型とUIの組み合わせ・デフォルト値・ネストした値の型推論を検証する。
test('checks parameter controls and infers values independently of controls', () => {
	const fileName = fileURLToPath(new URL('./parameter-schema.fixture.ts', import.meta.url)).replaceAll('\\', '/');
	const source = `
import { defineEffect, type EffectOutputDefinitions } from '../../shared/src/effect/effect-definition.ts';
import type { ParameterDefinition } from '../../shared/src/parameter.ts';
import type { EffectInstance } from '../../shared/src/effect/effect-implementation.ts';
import { visualModuleCustomParameterId, visualModuleCustomParameterName, type VisualModule, type VisualModuleParameterBindings } from '../../shared/src/visual-module/types.ts';
import type { NodeOutputReference } from '../../shared/src/visual-module/types.ts';
import type { DataType, TextureDataType } from '../../shared/src/data-type.ts';
type VisualModuleParamDef = VisualModule['paramDefs'][number];

type AssertNever<T extends never> = T;
type AllDataTypesHaveSchemas = AssertNever<Exclude<DataType, ParameterDefinition['dataType']>>;
type AllSchemasUseCommonDataTypes = AssertNever<Exclude<ParameterDefinition['dataType'], DataType>>;
const scalarOutput = { dataType: { kind: 'scalar' }, primary: true } as const satisfies EffectOutputDefinitions[string];
const moduleOutput: VisualModule['outputDefs'][number] = { ...scalarOutput, id: 'out', name: 'out', label: 'Out', isPrimaryOutput: true };
const textureType: TextureDataType = scalarOutput.dataType;
// @ts-expect-error 旧numberデータ型は使用しない
const oldNumber: DataType = 'number';
// @ts-expect-error 参照IDはテクスチャ出力のデータ型ではない
const referenceOutput: EffectOutputDefinitions[string] = { dataType: { kind: 'assetReference' }, primary: true };

const number = { dataType: { kind: 'scalar' }, ui: { control: { controlType: 'range', min: 0, max: 1 }, label: 'Value' }, defaultValue: { inputSource: 'literal', value: 0.5 } } as const;
const color = { dataType: { kind: 'color' }, ui: { control: {}, label: 'Color' }, defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] } } as const satisfies ParameterDefinition;
// @ts-expect-error colorではrangeを使用できない
defineEffect({ id: 'invalid-color', displayName: 'Invalid', tags: [], paramDefs: { color: { ...color, ui: { control: { controlType: 'range', min: 0, max: 1 }, label: 'Invalid' } } }, primaryInputParameter: null, outputDefs: {} });
// @ts-expect-error rangeの範囲は必須
const missingBounds: ParameterDefinition = { ...number, ui: { control: { controlType: 'range' }, label: 'Invalid' } };
const external = { ...color, id: visualModuleCustomParameterId('c'), nameForReference: visualModuleCustomParameterName('color'), defaultValue: { inputSource: 'literal', value: [1, 0, 0, 1] }, canNode: true, isPrimaryInput: false } satisfies VisualModuleParamDef;
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
defineEffect({ id: 'test', displayName: 'Test', tags: [], paramDefs: { amount: number }, primaryInputParameter: null, outputDefs: {} });
// @ts-expect-error 主入力を持たない場合もnullを明示する
defineEffect({ id: 'missing-primary', displayName: 'Missing primary', tags: [], paramDefs: {}, outputDefs: {} });
// @ts-expect-error numberのdefaultValueに文字列を許可しない
defineEffect({ id: 'bad', displayName: 'Bad', tags: [], paramDefs: { amount: { ...number, defaultValue: { inputSource: 'literal', value: 'bad' } } }, primaryInputParameter: null, outputDefs: {} });
// @ts-expect-error パラメータ定義にはdefaultValueが必要
const missingDefault: ParameterDefinition = { dataType: { kind: 'scalar' }, ui: { control: { controlType: 'number' }, label: 'Missing' } };
// @ts-expect-error 真偽値をInノードの出力にできない
const boolInput: VisualModuleParamDef = { ...external, dataType: { kind: 'bool' }, ui: { control: {}, label: 'Bool' }, defaultValue: { inputSource: 'literal', value: false }, canNode: true };
// @ts-expect-error 接続のサンプリング設定は省略できない
const missingSampling: NodeOutputReference = { nodeId: 'node', outputPort: 'output' };
const externalValues: VisualModuleParameterBindings = {};
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
