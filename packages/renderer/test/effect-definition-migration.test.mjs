import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const effectDirectory = new URL('../../shared/src/effect/fx/', import.meta.url);
const definitions = await Promise.all((await readdir(effectDirectory, { withFileTypes: true }))
	.filter(entry => entry.isDirectory() && existsSync(new URL(`${entry.name}/_def_.ts`, effectDirectory)))
	.map(async entry => (await import(new URL(`${entry.name}/_def_.ts`, effectDirectory))).default));

function checkParameter(dataType, settings, control) {
	assert.equal(typeof dataType.kind, 'string');
	assert.equal(settings.defaultValue.inputSource, 'literal');
	if (dataType.kind === 'array') {
		assert.ok(Array.isArray(settings.defaultValue.value));
		checkParameter(dataType.elementType, settings.element, control.element);
	} else if (dataType.kind === 'struct') {
		assert.deepEqual(Object.keys(settings.fields), Object.keys(dataType.fields));
		assert.deepEqual(Object.keys(control.fields), Object.keys(dataType.fields));
		for (const [key, field] of Object.entries(dataType.fields)) {
			assert.equal(typeof control.fields[key].label, 'string');
			checkParameter(field, settings.fields[key], control.fields[key].control);
		}
	} else if (dataType.kind === 'enum') {
		assert.ok(dataType.options.every(option => typeof option === 'string'));
		assert.equal(new Set(dataType.options).size, dataType.options.length);
		assert.ok(dataType.options.includes(settings.defaultValue.value));
		assert.deepEqual(Object.keys(control.labels).sort(), [...dataType.options].sort());
	}
}

// 全定義を実際に読み込み、選択肢・初期値・子設定の移行漏れを検出する。
test('keeps all effect schemas and string enum defaults consistent', () => {
	assert.ok(definitions.length > 0);
	for (const definition of definitions) {
		for (const parameter of Object.values(definition.paramDefs)) {
			checkParameter(parameter.dataType, parameter, parameter.ui.control);
		}
		for (const output of Object.values(definition.outputDefs)) {
			assert.ok(['scalar', 'color', 'vector', 'any'].includes(output.dataType.kind));
		}
	}
});

// 数値を表す選択肢も文字列で保存し、モード番号は意味のある名前へ置き換える。
test('uses string sizes and named processing modes', () => {
	const find = id => definitions.find(definition => definition.id === id).paramDefs;
	assert.equal(find('audioSpectrum').fftSize.defaultValue.value, '2048');
	assert.equal(find('audioSpectrogram').fftSize.defaultValue.value, '2048');
	assert.equal(find('histogram').resolution.defaultValue.value, '1');
	assert.equal(find('waveform').resolution.defaultValue.value, '1');
	for (const id of ['image', 'video']) {
		assert.deepEqual(find(id).sizeMode.dataType.options, ['stretch', 'cover', 'contain', 'original']);
		assert.equal(find(id).sizeMode.defaultValue.value, 'cover');
	}
	assert.deepEqual(find('rgbTo').mode.dataType.options, ['intensity', 'luminance']);
});

// 実定義から実行時の型を導き、enumの候補と子のcanNodeが失われないことを確認する。
test('infers string enums and nested shader inputs from migrated definitions', () => {
	const fileName = fileURLToPath(new URL('./effect-definition-migration.fixture.ts', import.meta.url)).replaceAll('\\', '/');
	const source = `
import type spectrum from '../../shared/src/effect/fx/audioSpectrum/_def_.ts';
import type nested from '../../shared/src/effect/fx/testStructArray/_def_.ts';
import type { EffectInstance } from '../../shared/src/effect/effect-implementation.ts';
type Spectrum = Parameters<EffectInstance<typeof spectrum.paramDefs>['render']>[0]['params'];
type Nested = Parameters<EffectInstance<typeof nested.paramDefs>['render']>[0]['params'];
const fftSize: Spectrum['fftSize'] = '2048';
// @ts-expect-error FFTサイズは数値ではなく文字列。
const numericFftSize: Spectrum['fftSize'] = 2048;
// @ts-expect-error 選択肢にないサイズは受け入れない。
const unsupportedFftSize: Spectrum['fftSize'] = '123';
const item: Nested['buzzs'][number] = { image: { kind: 'uniform', value: [1, 0, 0, 1] }, x: 0, y: 1 };
// @ts-expect-error 構造体内でもcanNodeの色はShaderInput。
const rawImage: Nested['buzzs'][number]['image'] = [1, 0, 0, 1];
const color: Nested['bars'][number] = [1, 0, 0, 1];
// @ts-expect-error canNodeでない色の要素は数値単体ではない。
const rawColor: Nested['bars'][number] = 1;
`;
	assertTypeChecks(fileName, source);
});


function assertTypeChecks(fileName, source) {
	const configPath = fileURLToPath(new URL('../../shared/tsconfig.json', import.meta.url));
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL('../../shared/', import.meta.url)));
	const host = ts.createCompilerHost(parsed.options);
	const originalGetSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (name, ...args) => name.replaceAll('\\', '/') === fileName
		? ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
		: originalGetSourceFile(name, ...args);
	const program = ts.createProgram([fileName], parsed.options, host);
	const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file?.fileName.replaceAll('\\', '/') === fileName);
	assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getCurrentDirectory: ts.sys.getCurrentDirectory,
		getCanonicalFileName: name => name,
		getNewLine: () => '\n',
	}));
}

// 変数やスプレッドを経由しても、dataTypeにないキーがUI・初期値・子設定へ混入しない。
// 必須キーの欠落と配列内の構造体も確認し、汎用Recordへの推論の後退を検出する。
test('rejects unknown and missing struct fields in effect definitions', () => {
	const fileName = fileURLToPath(new URL('./exact-effect-definition.fixture.ts', import.meta.url)).replaceAll('\\', '/');
	const source = `
import { defineEffect } from '../../shared/src/effect/effect-definition.ts';
import definition from '../../shared/src/effect/fx/testStructArray/_def_.ts';
const struct = definition.paramDefs.foo;
const array = definition.paramDefs.buzzs;
const uiField = struct.ui.control.fields.node;
const fieldSettings = struct.fields.node;
const binding = struct.defaultValue.value.node;
// 正しいフィールドと既存のBindingは受け入れる。
const valid = defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { struct, array } });
const preserved: true = valid.paramDefs.struct.fields.node.canNode;
// @ts-expect-error UIに存在しないfieldを追加できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { struct: { ...struct, ui: { ...struct.ui, control: { fields: { ...struct.ui.control.fields, typo: uiField } } } } } });
// @ts-expect-error 初期値に存在しないfieldを追加できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { struct: { ...struct, defaultValue: { inputSource: 'literal', value: { node: binding, typo: binding } } } } });
// @ts-expect-error 子設定に存在しないfieldを追加できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { struct: { ...struct, fields: { ...struct.fields, typo: fieldSettings } } } });
// @ts-expect-error UIの必須fieldを省略できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { struct: { ...struct, ui: { ...struct.ui, control: { fields: {} } } } } });
// @ts-expect-error 初期値の必須fieldを省略できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { struct: { ...struct, defaultValue: { inputSource: 'literal', value: {} } } } });
// @ts-expect-error 配列の要素UIに存在しないfieldを追加できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { array: { ...array, ui: { ...array.ui, control: { element: { fields: { ...array.ui.control.element.fields, typo: uiField } } } } } } });
// @ts-expect-error 配列内の構造体初期値にも存在しないfieldを追加できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { array: { ...array, defaultValue: { inputSource: 'literal', value: [{ inputSource: 'literal', value: { ...array.element.defaultValue.value, typo: binding } }] } } } });
// @ts-expect-error 要素追加時の初期値にも存在しないfieldを追加できない。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { array: { ...array, element: { ...array.element, defaultValue: { inputSource: 'literal', value: { ...array.element.defaultValue.value, typo: binding } } } } } });
// @ts-expect-error 正しいfield名でもリテラルの型は一致する必要がある。
defineEffect({ ...definition, primaryInputParameter: null, paramDefs: { array: { ...array, element: { ...array.element, defaultValue: { inputSource: 'literal', value: { ...array.element.defaultValue.value, x: { inputSource: 'literal', value: 'bad' } } } } } } });
`;
	assertTypeChecks(fileName, source);
});
