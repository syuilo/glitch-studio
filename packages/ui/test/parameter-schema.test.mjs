import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// データ型とUIの組み合わせ・デフォルト値・ネストした値の型推論を検証する。
test('checks parameter controls and infers values independently of controls', () => {
	const fileName = fileURLToPath(new URL('./parameter-schema.fixture.ts', import.meta.url)).replaceAll('\\', '/');
	const source = `
import { defineEffect, type EffectOptionSchema, type GetEffectOptionsSchemaValues, type VisualModuleParamDef } from '../../shared/src/effect-definition.ts';
import type { EffectParamDef } from '../../shared/src/types.ts';
import type { VisualModule } from '../../shared/src/types.ts';
import type { EffectOutputsSchema } from '../../shared/src/effect-definition.ts';
import type { DataType, TextureDataType } from '../../shared/src/data-type.ts';

type AssertNever<T extends never> = T;
type AllDataTypesHaveSchemas = AssertNever<Exclude<DataType, EffectOptionSchema['dataType']>>;
type AllSchemasUseCommonDataTypes = AssertNever<Exclude<EffectOptionSchema['dataType'], DataType>>;
const scalarOutput = { dataType: 'scalar', primary: true } as const satisfies EffectOutputsSchema[string];
const moduleOutput: VisualModule['outputDefs'][number] = { ...scalarOutput, id: 'out', name: 'out', label: 'Out', isPrimaryOutput: true };
const textureType: TextureDataType = scalarOutput.dataType;
// @ts-expect-error 旧numberデータ型は使用しない
const oldNumber: DataType = 'number';
// @ts-expect-error 参照IDはテクスチャ出力のデータ型ではない
const referenceOutput: EffectOutputsSchema[string] = { dataType: 'assetReference', primary: true };

const number = { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1 }, label: 'Value', default: () => ({ inputSource: 'literal', value: 0.5 } as const) } as const;
const color = { dataType: 'color', ui: { control: 'color' }, label: 'Color' } as const satisfies EffectOptionSchema;
// @ts-expect-error colorではrangeを使用できない
const badColor: EffectOptionSchema = { ...color, ui: { control: 'range', min: 0, max: 1 } };
// @ts-expect-error 実行時の共通定義でも制約を維持する
const badParam: EffectParamDef = { ...color, ui: { control: 'seed' }, default: () => ({ inputSource: 'literal', value: 0 }) };
// @ts-expect-error rangeの範囲は必須
const missingBounds: EffectOptionSchema = { ...number, ui: { control: 'range' } };
const external = { ...color, id: 'c', name: 'color', defaultValue: [1, 0, 0, 1], canNode: true, isPrimaryInput: false } satisfies VisualModuleParamDef;
// @ts-expect-error 外部パラメータでも同じ組み合わせ制約を適用する
const badExternal: VisualModuleParamDef = { ...external, ui: { control: 'number' } };
const schemas = {
 amount: number,
 seed: { ...number, ui: { control: 'seed' } },
 angle: { ...number, ui: { control: 'angle' } },
 color,
 mode: { dataType: 'enum', ui: { control: 'enum' }, label: 'Mode', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
 asset: { dataType: 'assetReference', ui: { control: 'image' }, label: 'Asset' },
 player: { dataType: 'playerReference', ui: { control: 'player' }, label: 'Player' },
 values: { dataType: 'array', label: 'Values', item: number },
} as const satisfies Record<string, EffectOptionSchema>;
type Values = GetEffectOptionsSchemaValues<typeof schemas>;
const values: Values = { amount: 2, seed: 1.25, angle: -0.5, color: [1, 0, 0, 1], mode: 'a', asset: null, player: 'player-id', values: [1, 2] };
// @ts-expect-error enumの候補のunionを維持する
const badMode: Values['mode'] = 'c';
// @ts-expect-error 配列要素も数値として推論する
const badArray: Values['values'] = ['a'];
defineEffect({ id: 'test', displayName: 'Test', tags: [], paramDefs: { amount: number }, outputs: {} });
// @ts-expect-error numberのdefaultに文字列を許可しない
defineEffect({ id: 'bad', displayName: 'Bad', tags: [], paramDefs: { amount: { ...number, default: () => ({ inputSource: 'literal', value: 'bad' }) } }, outputs: {} });
`;
	const options = {
		strict: true, noEmit: true, skipLibCheck: true, types: [],
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
