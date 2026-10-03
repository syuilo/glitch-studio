import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveParameter, walkParameters } from '../src/parameter/parameter-path.ts';
import { mapParameterTree, walkParameterLeaves } from '../src/parameter/parameter-tree.ts';

const literal = value => ({ inputSource: 'literal', value });
const scalar = {
	dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } },
	defaultValue: literal(0),
};
const item = {
	dataType: { kind: 'struct', fields: { amount: scalar.dataType } },
	ui: { label: 'Item', control: { fields: { amount: scalar.ui } } },
	fields: { amount: { defaultValue: scalar.defaultValue } },
	defaultValue: literal({ amount: scalar.defaultValue }),
};
const items = {
	dataType: { kind: 'array', elementType: item.dataType },
	ui: { label: 'Items', control: { element: item.ui.control } },
	element: { fields: item.fields, defaultValue: item.defaultValue },
	defaultValue: literal([{ id: 'first', binding: literal({ amount: { inputSource: 'expression', expression: 'TIME' } }) }]),
};
const group = {
	dataType: { kind: 'struct', fields: { items: items.dataType } },
	ui: { label: 'Group', control: { fields: { items: items.ui } } },
	fields: { items: { element: items.element, defaultValue: items.defaultValue } },
	defaultValue: literal({ items: items.defaultValue }),
};

function createValues() {
	return { group: literal({ items: literal([
		{ id: 'first', binding: literal({ amount: { inputSource: 'expression', expression: 'TIME' } }) },
		{ id: 'second', binding: literal({ amount: { inputSource: 'testReference', referenceId: 'source' } }) },
	]) }) };
}

// 【親の具体型から子のBinding型を推論せず、利用ドメインを明示する】
// 実行時の走査結果だけでは、子をliteralと誤認する型の退行を検出できない。
// 型引数の指定漏れ・未分岐のvalue参照・別ドメインへの書き込みをコンパイラーで拒否する。
test('requires an explicit binding domain and preserves leaf and setter types', () => {
	const directory = fileURLToPath(new URL('../', import.meta.url));
	const configPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	assert.equal(config.error, undefined);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory, undefined, configPath);
	const program = ts.createProgram([fileURLToPath(new URL('./parameter-tree.types.ts', import.meta.url))], parsed.options);
	const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
	assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
		getCanonicalFileName: name => name, getCurrentDirectory: ts.sys.getCurrentDirectory, getNewLine: () => '\n',
	}));
});

// 【literalの構造体と配列の下で、式とドメイン固有方式をそのまま走査する】
// 親の入力方式を子へ適用したり、評価用indexと編集用IDを混同すると、
// 評価結果や編集対象が変わるため、両方のパスと末端のBindingを確認する。
test('traverses mixed leaf bindings with index and ID paths', () => {
	const values = createValues();
	const before = structuredClone(values);
	const evaluatedLeaves = [...walkParameterLeaves({ group }, values)];
	assert.deepEqual(evaluatedLeaves.map(({ param, path }) => [path, param.inputSource]), [
		[['group', 'items', 0, 'amount'], 'expression'],
		[['group', 'items', 1, 'amount'], 'testReference'],
	]);
	assert.deepEqual([...walkParameters({ group }, values)].map(({ value, path }) => [path, value.inputSource]), [
		[['group', 'items', 'first', 'amount'], 'expression'],
		[['group', 'items', 'second', 'amount'], 'testReference'],
	]);
	const visited = [];
	const result = mapParameterTree(group, values.group, ['group'], (def, binding, path) => {
		assert.equal(def.dataType.kind, 'scalar');
		visited.push(path);
		return binding.inputSource === 'expression' ? binding.expression : binding.referenceId;
	});
	assert.deepEqual(result, { items: [{ amount: 'TIME' }, { amount: 'source' }] });
	assert.deepEqual(visited, evaluatedLeaves.map(({ path }) => path));
	assert.deepEqual(values, before);
});

// 【末端の入力方式を変えても親のliteralと配列要素IDは維持する】
// ドメイン全体のBindingで書き込む契約が、ネストした編集の保存形式を変えないことを確認する。
test('replaces nested leaf bindings without changing their containers or IDs', () => {
	const values = createValues();
	const replacement = { inputSource: 'testReference', referenceId: 'replacement' };
	resolveParameter({ group }, values, ['group', 'items', 'first', 'amount']).setValue(replacement);
	assert.equal(resolveParameter({ group }, values, ['group', 'items', 'first', 'amount']).value, replacement);
	assert.equal(values.group.inputSource, 'literal');
	assert.deepEqual(values.group.value.items.value.map(element => element.id), ['first', 'second']);
	assert.equal(resolveParameter({ group }, values, ['group', 'items', 'second', 'amount']).value.referenceId, 'source');
	assert.throws(() => resolveParameter({ group }, values, ['group', 'items', 'missing', 'amount']), /Unknown array element/);
});

// 【未設定のコンテナは、既定値に含まれる非literalの末端も走査する】
// Bindingの型を明示する変更で、既定値の補完や式の検出を失わないようにする。
test('walks expression defaults when a root parameter is missing', () => {
	const leaves = [...walkParameters({ group }, {})];
	assert.deepEqual(leaves.map(({ path, value }) => [path, value]), [
		[['group', 'items', 'first', 'amount'], { inputSource: 'expression', expression: 'TIME' }],
	]);
});
