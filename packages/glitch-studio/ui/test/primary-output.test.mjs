import { prepareTestCommand } from './helpers/prepared-command.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// GPU・ストレージに依存する登録情報だけ差し替え、実際の出力編集コマンドを使う。
const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export { COMMAND_DEFS } from './src/commands.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)),
		loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{
		name: 'primary-output-test-dependencies',
		setup(build) {
			build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'primary-output-test' }));
			build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'primary-output-test' }));
			build.onLoad({ filter: /.*/, namespace: 'primary-output-test' }, ({ path }) => ({
				contents: path === 'preferences'
					? 'export const preferences = { s: { forceTypeSafety: false } };'
					: 'export const effectDefinitions = {};',
				loader: 'ts',
			}));
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS } = module.exports;

function fixture() {
	const customNodeGraphEffect = { id: 'customNodeGraphEffect', outputDefs: [
		{ id: 'a', name: 'a', label: 'A', dataType: { kind: 'color' } },
		{ id: 'b', name: 'b', label: 'B', dataType: { kind: 'color' } },
		{ id: 'scalar', name: 'scalar', label: 'Scalar', dataType: { kind: 'scalar' } },
	], primaryOutputId: 'a' };
	const state = { customNodeGraphEffects: { value: [customNodeGraphEffect] } };
	const command = (name, payload) => prepareTestCommand(COMMAND_DEFS[name], { target: { customNodeGraphEffectId: 'customNodeGraphEffect' }, ...payload });
	return { customNodeGraphEffect, state, command };
}

// 主出力の切り替え・解除とUndo/Redoで参照を復元する。
// 出力定義から独立した参照になっても、履歴操作で表示対象を失わないようにする。
test('switches and clears the primary output with undo and redo', () => {
	const { customNodeGraphEffect, state, command } = fixture();
	for (const primaryOutputId of ['b', null]) {
		const before = structuredClone(customNodeGraphEffect);
		const change = command('setCustomNodeGraphEffectPrimaryOutput', { primaryOutputId });
		change.execute(state);
		assert.equal(customNodeGraphEffect.primaryOutputId, primaryOutputId);
		assert.deepEqual(customNodeGraphEffect.outputDefs, before.outputDefs);
		change.undo(state);
		assert.deepEqual(customNodeGraphEffect, before);
		change.execute(state);
		assert.equal(customNodeGraphEffect.primaryOutputId, primaryOutputId);
	}
	for (const primaryOutputId of ['missing', 'scalar']) {
		assert.throws(() => command('setCustomNodeGraphEffectPrimaryOutput', { primaryOutputId }).execute(state), /color output/);
		assert.equal(customNodeGraphEffect.primaryOutputId, null);
	}
});

// 出力削除・型変更の際に主出力の参照を解除し、Undoで復元する。
// 存在しない出力や非カラー出力を主出力として残さないための検証。
test('clears invalidated primary references and restores them on undo', () => {
	for (const [name, payload] of [
		['removeCustomNodeGraphEffectOutput', { target: { customNodeGraphEffect: { customNodeGraphEffectId: 'customNodeGraphEffect' }, outputId: 'a' } }],
		['replaceCustomNodeGraphEffectOutputDefinition', { target: { customNodeGraphEffect: { customNodeGraphEffectId: 'customNodeGraphEffect' }, outputId: 'a' }, definition: { name: 'a', label: 'A', dataType: { kind: 'scalar' } } }],
	]) {
		const { customNodeGraphEffect, state, command } = fixture();
		const before = structuredClone(customNodeGraphEffect);
		const change = command(name, payload);
		change.execute(state);
		assert.equal(customNodeGraphEffect.primaryOutputId, null);
		change.undo(state);
		assert.deepEqual(customNodeGraphEffect, before);
		change.execute(state);
		assert.equal(customNodeGraphEffect.primaryOutputId, null);
	}
});

// 主出力がない場合の色出力追加とUndo/Redoを検証する。
// 既存の主出力を上書きせず、追加を取り消したときに参照だけが残るのを防ぐ。
test('assigns newly added color outputs only when no primary exists', () => {
	for (const primaryOutputId of ['a', null]) {
		const { customNodeGraphEffect, state, command } = fixture();
		customNodeGraphEffect.primaryOutputId = primaryOutputId;
		const before = structuredClone(customNodeGraphEffect);
		const add = command('createCustomNodeGraphEffectOutput', { customNodeGraphEffect: { customNodeGraphEffectId: 'customNodeGraphEffect' }, definition: { name: 'new', label: 'New', dataType: { kind: 'color' } } });
		const added = add.execute(state);
		assert.equal(customNodeGraphEffect.primaryOutputId, primaryOutputId ?? added.outputId);
		add.undo(state);
		assert.deepEqual(customNodeGraphEffect, before);
		add.execute(state);
		assert.equal(customNodeGraphEffect.primaryOutputId, primaryOutputId ?? added.outputId);
	}
});
