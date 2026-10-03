import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
// GPUやストレージに依存する登録情報だけを差し替え、実際の定義・Command・パス解決を使う。
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: {
		contents: `
			export { COMMAND_DEFS } from './src/commands.ts';
			export { resolveNodeParam, walkNodeParams } from './src/utility/node-params.ts';
			export { createResetParameterBinding } from './src/utility/parameter-default.ts';
			export { default as definition } from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts';
		`,
		resolveDir: uiDirectory, loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'array-parameter-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			loader: 'ts', resolveDir: uiDirectory,
			contents: path === 'preferences'
				? 'export const preferences = { s: { forceTypeSafety: false } };'
				: "import definition from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, definition, resolveNodeParam, walkNodeParams, createResetParameterBinding } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

function fixture() {
	const node = {
		id: 'node', type: 'effect', effectId: definition.id,
		params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
	};
	const state = { visualModules: { value: [{ id: 'module', nodes: [node] }] } };
	return { state, node, target: { visualModuleId: 'module', nodeId: node.id, paramPath: ['buzzs'] } };
}

// 【挿入・並べ替えの後も、同じIDの要素を編集・削除する】
// 編集開始時のindexが変わっても、その位置を占めた別要素に操作を適用してはいけない。
// 別ノードの同じ既定IDとも衝突せず、配線の列挙も同じIDパスを使う必要がある。
test('targets element IDs across insertions and reordering', () => {
	const { state, node, target } = fixture();
	const otherNode = { ...structuredClone(node), id: 'other' };
	state.visualModules.value[0].nodes.push(otherNode);
	const edit = COMMAND_DEFS.updateParamAsLiteral.create({ ...target, paramPath: ['buzzs', 'first', 'x'], value: 0.75 });
	const remove = COMMAND_DEFS.removeArrayParamElement.create({ ...target, elementId: 'first' });
	const inserted = { id: 'inserted', binding: structuredClone(definition.paramDefs.buzzs.element.defaultValue) };
	node.params.buzzs.value.unshift(inserted);
	edit.execute(state);
	assert.equal(resolveNodeParam(node, ['buzzs', 'first', 'x']).value.value, 0.75);
	assert.equal(inserted.binding.value.x.value, 0);
	assert.equal(resolveNodeParam(otherNode, ['buzzs', 'first', 'x']).value.value, 0);
	assert.ok([...walkNodeParams(node)].some(({ path }) => JSON.stringify(path) === JSON.stringify(['buzzs', 'first', 'image'])));
	node.params.buzzs.value.reverse();
	edit.undo(state);
	assert.equal(resolveNodeParam(node, ['buzzs', 'first', 'x']).value.value, 0);
	edit.execute(state);
	remove.execute(state);
	assert.deepEqual(node.params.buzzs.value.map(element => element.id), ['inserted']);
	remove.undo(state);
	assert.equal(resolveNodeParam(node, ['buzzs', 'first', 'x']).value.value, 0.75);
});

// 【削除済みIDへの操作は、残っている要素を変更せず失敗する】
// 遅れて届いた編集や削除を、以前のindexへフォールバックして適用しない。
test('rejects stale element targets without changing another element', () => {
	const { state, node, target } = fixture();
	const edit = COMMAND_DEFS.updateParamAsLiteral.create({ ...target, paramPath: ['buzzs', 'first', 'x'], value: 1 });
	node.params.buzzs.value = [{ id: 'replacement', binding: structuredClone(definition.paramDefs.buzzs.element.defaultValue) }];
	const before = structuredClone(node.params);
	assert.throws(() => edit.execute(state), /Unknown array element/);
	assert.throws(() => COMMAND_DEFS.removeArrayParamElement.create({ ...target, elementId: 'first' }).execute(state), /Unknown array element/);
	assert.deepEqual(node.params, before);
});

// 【追加とリセットのUndo/Redoは、一度発行した要素IDを復元する】
// 既定値のコピーと既存要素のリセットは異なる操作。リセット後に古いIDの参照を復活させず、
// RedoでさらにIDを変えて後続Commandの参照を壊すことも避ける。
test('preserves generated IDs through undo and redo of additions and resets', () => {
	const { state, node, target } = fixture();
	const original = structuredClone(node.params.buzzs);
	const add = COMMAND_DEFS.addArrayParamElement.create(target);
	add.execute(state);
	const added = structuredClone(node.params.buzzs);
	assert.notEqual(added.value[1].id, added.value[0].id);
	assert.deepEqual(added.value[1].binding, definition.paramDefs.buzzs.element.defaultValue);
	add.undo(state);
	assert.deepEqual(node.params.buzzs, original);
	add.execute(state);
	assert.deepEqual(node.params.buzzs, added);

	const reset = COMMAND_DEFS.resetNodeParam.create(target);
	reset.execute(state);
	const resetValue = structuredClone(node.params.buzzs);
	assert.equal(resetValue.value.length, 1);
	assert.ok(added.value.every(element => element.id !== resetValue.value[0].id));
	assert.deepEqual(resetValue.value[0].binding, original.value[0].binding);
	reset.undo(state);
	assert.deepEqual(node.params.buzzs, added);
	reset.execute(state);
	assert.deepEqual(node.params.buzzs, resetValue);
	assert.equal(definition.paramDefs.buzzs.defaultValue.value[0].id, 'first');

	const path = ['buzzs', resetValue.value[0].id];
	COMMAND_DEFS.updateParamAsLiteral.create({ ...target, paramPath: [...path, 'x'], value: 1 }).execute(state);
	COMMAND_DEFS.resetNodeParam.create({ ...target, paramPath: path }).execute(state);
	assert.equal(node.params.buzzs.value[0].id, resetValue.value[0].id);
	assert.deepEqual(node.params.buzzs.value[0].binding, original.value[0].binding);
});

// 【構造体・配列が入れ子でも内部の要素IDだけを再発行する】
// color/vectorの成分配列やアニメーションのIDは別の概念なので変更しない。
// 同じローカルIDを持つ別配列にも再帰し、定義そのものは書き換えない。
test('renews nested array IDs without rewriting colors or automation graph identities', () => {
	const graph = { inputSource: 'automationGraphInline', automationGraph: { isNormalized: true, points: [{ id: 'point', x: 0, y: 1 }] }, trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'clamp' };
	const scalarArray = { kind: 'array', elementType: { kind: 'scalar' } };
	const itemType = { kind: 'struct', fields: { samples: scalarArray, color: { kind: 'color' }, vector: { kind: 'vector' }, graph: { kind: 'scalar' } } };
	const sample = { id: 'first', binding: literal(2) };
	const def = {
		dataType: { kind: 'struct', fields: { groups: { kind: 'array', elementType: itemType }, samples: scalarArray } },
		defaultValue: literal({
			groups: literal([{ id: 'first', binding: literal({ samples: literal([structuredClone(sample)]), color: literal([1, 0, 0, 0.5]), vector: literal([0, 1]), graph }) }]),
			samples: literal([sample]),
		}),
	};
	const before = structuredClone(def);
	const reset = createResetParameterBinding(def);
	const group = reset.value.groups.value[0];
	assert.notEqual(group.id, 'first');
	assert.notEqual(group.binding.value.samples.value[0].id, 'first');
	assert.notEqual(reset.value.samples.value[0].id, 'first');
	assert.deepEqual(group.binding.value.color, literal([1, 0, 0, 0.5]));
	assert.deepEqual(group.binding.value.vector, literal([0, 1]));
	assert.deepEqual(group.binding.value.graph, graph);
	assert.deepEqual(def, before);
});
