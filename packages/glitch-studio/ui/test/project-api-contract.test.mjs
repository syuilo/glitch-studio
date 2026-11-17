import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { z } from 'zod';
		export { definePublicCommand, withCommandContract } from './src/commands/definition.ts';
		export { describeProjectApi } from './src/project-api/contract.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
	` },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { z, definePublicCommand, withCommandContract, describeProjectApi, UndoRedo } = loaded.exports;

function contract(inputSchema, resultSchema) {
	return { inputSchema, resultSchema, description: 'Change project text.', examples: ['Command:edit({ name: "Example" })'] };
}

// 【不正な入力は変更の準備より前に拒否する】
// AiScriptからの型のない呼び出しでも、Command内部の取得や非同期処理を始めず、
// 状態やUndo/Redoを変更しないことを確認する。
test('rejects invalid input before preparing or recording a command', () => {
	let prepared = false;
	const command = definePublicCommand({
		label: 'Edit', ...contract(z.object({ name: z.string() }), z.null()),
		prepare() { prepared = true; return { result: undefined, change: null }; },
	});
	const manager = new UndoRedo({}, { edit: command });
	assert.throws(() => manager.commit('edit', { name: 42 }), /Edit input: name:/);
	assert.equal(prepared, false);
	assert.equal(manager.undoStack.value.length, 0);
});

// 【入れ子の入力方式が不正でも、修正すべきフィールドの完全なパスを返す】
// unionの各枝のエラーは相対パスなので、外側の引数パスを失うとAPI利用者が
// どの値を修正すべきか判断できなくなる。
test('includes the full parameter path for invalid nested union inputs', () => {
	const command = definePublicCommand({
		label: 'Edit', ...contract(z.object({ source: z.union([
			z.object({ type: z.literal('number'), value: z.number() }),
			z.object({ type: z.literal('text'), value: z.string() }),
		]) }), z.null()),
		prepare() { throw new Error('Invalid input reached prepare'); },
	});
	const manager = new UndoRedo({}, { edit: command });
	assert.throws(() => manager.commit('edit', { source: { type: 'text', value: [] } }), /source.value:/);
	const discriminated = definePublicCommand({
		label: 'Edit', ...contract(z.object({ source: z.discriminatedUnion('type', [
			z.object({ type: z.literal('text'), value: z.string() }),
			z.object({ type: z.literal('number'), value: z.number() }),
		]) }), z.null()),
		prepare() { throw new Error('Invalid input reached prepare'); },
	});
	assert.throws(() => new UndoRedo({}, { edit: discriminated }).commit('edit', { source: { type: 'other' } }), /source.type:/);
});

// 【戻り値の不正は同期・非同期のどちらでも状態への反映前に検出する】
// 変更を適用した後にAPI失敗を返すと、呼び出し側の再試行が変更を重複させるため、
// prepareの結果を検証してから既存のUndoRedoへ返す。
test('rejects invalid results before applying synchronous and asynchronous changes', async () => {
	for (const asynchronous of [false, true]) {
		const state = { name: 'Before' };
		const command = definePublicCommand({
			label: 'Edit', ...contract(z.object({}), z.object({ id: z.string() })),
			prepare() {
				const prepared = { result: { id: 123 }, change: {
					apply(current) { current.name = 'After'; }, revert(current) { current.name = 'Before'; }, changes: [],
				} };
				return asynchronous ? Promise.resolve(prepared) : prepared;
			},
		});
		const manager = new UndoRedo(state, { edit: command });
		await assert.rejects(manager.execute('edit', {}), /Edit result: id:/);
		assert.equal(state.name, 'Before');
		assert.equal(manager.undoStack.value.length, 0);
	}
});

// 【契約は値を矯正せず、既存の定義フィールドやHDR値を保持する】
// スキーマライブラリの既定動作で未知フィールドを削除すると、Queryで取得した
// ドメインデータを再設定したときに内容が失われる。nullと省略も勝手に補完しない。
test('preserves original fields and nullish input while validating an existing definition', () => {
	const input = { name: null, data: { value: 4.5, domainField: 'kept' }, extra: true };
	let received;
	const command = withCommandContract({ label: 'Edit', prepare(_state, value) { received = value; return { result: undefined, change: null }; } },
		contract(z.object({ name: z.string().nullish(), data: z.object({ value: z.number() }) }), z.null()));
	const manager = new UndoRedo({}, { edit: command });
	assert.equal(manager.commit('edit', input), undefined);
	assert.deepEqual(received, input);
	assert.equal(manager.undoStack.value.length, 0);
	assert.throws(() => manager.commit('edit', { data: { value: '4.5' } }), /data.value/);
});

// 【公開用の資料はJSONだけで取得でき、取得後の変更は実行契約へ戻らない】
// MCPなどの別プロセスへ渡す際にZodオブジェクトや関数を含めず、呼び出し元が
// サンプルやスキーマを書き換えても次の取得と入力検証を変えない。
test('returns detached JSON documentation with a null result for void commands', () => {
	const definition = contract(z.object({ name: z.string().nullish().describe('Optional name.') }), z.null());
	const first = describeProjectApi('Command:edit', 'command', 1, definition);
	assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
	assert.equal(first.resultSchema.type, 'null');
	assert.equal(first.inputSchema.properties.name.description, 'Optional name.');
	first.examples.push('Changed');
	first.inputSchema.properties.name.description = 'Changed';
	const second = describeProjectApi('Command:edit', 'command', 1, definition);
	assert.equal(second.examples.length, 1);
	assert.equal(second.inputSchema.properties.name.description, 'Optional name.');
});
