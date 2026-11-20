import { testGraph } from './helpers/effect-graph.mjs';
import { nodeParameterTarget } from './helpers/command-inputs.mjs';
import { prepareTestCommand } from './helpers/prepared-command.mjs';
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
			export { UndoRedo } from './src/utility/undo-redo.ts';
			export { commitCustomNodeGraphEffectEdit } from './src/utility/custom-node-graph-effect-edit.ts';
			export { resolveNodeParam, walkNodeParams } from './src/utility/node-params.ts';
			export { createResetParameterBinding } from './src/utility/parameter-default.ts';
			export { default as definition } from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts';
		`,
		resolveDir: uiDirectory, loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'array-parameter-test', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			loader: 'ts', resolveDir: uiDirectory,
			contents: path === 'preferences'
				? 'export const preferences = { s: { forceTypeSafety: false } };'
				: "import definition from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts'; export const nativeEffectDefinitions = { testStructArray: definition };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, UndoRedo, commitCustomNodeGraphEffectEdit, definition, resolveNodeParam, walkNodeParams, createResetParameterBinding } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

function fixture() {
	const node = {
		id: 'node', type: 'effect', effectSource: { type: 'nativeEffect', id: 'testStructArray' },
		params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
	};
	const state = { customNodeGraphEffects: { value: [{ id: 'customNodeGraphEffect', definition: testGraph({ nodes: [node] }) }] } };
	return { state, node, target: { customNodeGraphEffectId: 'customNodeGraphEffect', nodeId: node.id, paramPath: ['buzzs'] } };
}

function fixtureWithRemovedPublicInput() {
	const { state, node, target } = fixture();
	state.timelineScenes = { value: [] };
	const customNodeGraphEffect = state.customNodeGraphEffects.value[0];
	customNodeGraphEffect.definition.paramDefs = {};
	customNodeGraphEffect.definition.primaryInputParameter = null;
	customNodeGraphEffect.definition.primaryAudioInputParameter = null;

	node.params.buzzs.value.push({ id: 'second', binding: structuredClone(definition.paramDefs.buzzs.element.defaultValue) });
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const publicParameter = manager.commit('createCustomNodeGraphEffectPublicParameter', {
		customNodeGraphEffect: { customNodeGraphEffectId: customNodeGraphEffect.id },
		definition: { dataType: { kind: 'color' }, canNode: true, nameForReference: 'image', ui: { label: 'Image', control: {} }, defaultValue: literal([0, 0, 0, 0]) },
	});
	const imageParameter = nodeParameterTarget({ ...target, paramPath: ['buzzs', 'first', 'image'] });
	manager.commit('setCustomNodeGraphEffectNodeParameterSource', {
		...imageParameter, source: { inputSource: 'node', nodeId: 'globalIn', outputPort: publicParameter.parameterId, fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' },
	});
	manager.commit('removeCustomNodeGraphEffectPublicParameter', { target: publicParameter });
	return { state, node, target, customNodeGraphEffect, manager, publicParameter, imageParameter };
}

// 【型不一致を許可した接続を残して、別の配列要素を削除・Undo・Redoする】
// 設定に従って作成済みの接続を、配列全体の再検証で後から拒否してはいけない。
// UIの接続・削除経路を通し、ネストした要素IDごとに既存接続を認識できることを確認する。
test('removes sibling array elements while preserving existing mismatched connections', () => {
	const { state, node } = fixture();
	node.params.buzzs.value.push({ id: 'second', binding: structuredClone(definition.paramDefs.buzzs.element.defaultValue) });
	state.customNodeGraphEffects.value[0].definition.nodes.push({ ...structuredClone(node), id: 'scalar-source' });
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const customNodeGraphEffect = { customNodeGraphEffectId: 'customNodeGraphEffect' };
	commitCustomNodeGraphEffectEdit(manager, customNodeGraphEffect, { kind: 'editNodeParam', nodeId: node.id, edit: {
		kind: 'node', paramPath: ['buzzs', 'first', 'image'], value: { nodeId: 'scalar-source', outputPort: 'output' }, preserveSampling: false,
	} });
	const connected = structuredClone(node.params.buzzs);
	commitCustomNodeGraphEffectEdit(manager, customNodeGraphEffect, { kind: 'editNodeParam', nodeId: node.id, edit: {
		kind: 'removeElement', paramPath: ['buzzs'], elementId: 'second',
	} });
	assert.deepEqual(node.params.buzzs.value, [connected.value[0]]);
	manager.undo();
	assert.deepEqual(node.params.buzzs, connected);
	manager.redo();
	assert.deepEqual(node.params.buzzs.value, [connected.value[0]]);
});

// 【既存の型不一致は維持するが、新しいIDパスや接続先には型検証を適用する】
// 配列のindexだけで一致判定したり、既存接続があるだけで全体の型検証を無効にすると、
// strictのCommandから新規の型不一致まで導入できてしまう。
test('still rejects new mismatched connections when another connection is retained', () => {
	const { state, node, target } = fixture();
	state.customNodeGraphEffects.value[0].definition.nodes.push(...['scalar-source', 'another-source'].map(id => ({ ...structuredClone(node), id })));
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const parameter = nodeParameterTarget({ ...target, paramPath: ['buzzs', 'first', 'image'] });
	manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...parameter, source: { inputSource: 'node', nodeId: 'scalar-source', outputPort: 'output' } });
	const before = structuredClone(node.params.buzzs);
	assert.throws(() => manager.commit('setCustomNodeGraphEffectNodeParameterSource', {
		...parameter, source: { inputSource: 'node', nodeId: 'another-source', outputPort: 'output2' },
	}), /Node output type does not match/);
	const movedToNewId = structuredClone(before);
	movedToNewId.value[0].id = 'new-element';
	movedToNewId.value[0].binding.value.image = { inputSource: 'node', nodeId: 'scalar-source', outputPort: 'output2' };
	assert.throws(() => manager.commit('replaceCustomNodeGraphEffectNodeParameterBinding', {
		...nodeParameterTarget(target), binding: movedToNewId,
	}), /Node output type does not match/);
	assert.deepEqual(node.params.buzzs, before);
	assert.equal(manager.undoStack.value.length, 1);
});

// 【公開入力の削除で未解決になった接続を保持して、兄弟要素とサンプリングを編集する】
// 公開入力の削除はUndoで再接続できるよう参照IDを残すため、その接続が含まれるだけで
// 配列全体の編集を拒否してはいけない。編集と定義削除を順にUndo/Redoしても参照を維持する。
test('edits arrays and sampling while preserving connections to removed public inputs', () => {
	const { node, target, customNodeGraphEffect, manager, publicParameter, imageParameter } = fixtureWithRemovedPublicInput();
	const before = structuredClone(customNodeGraphEffect);
	assert.equal(Object.keys(customNodeGraphEffect.definition.paramDefs).length, 0);
	commitCustomNodeGraphEffectEdit(manager, { customNodeGraphEffectId: customNodeGraphEffect.id }, { kind: 'editNodeParam', nodeId: node.id, edit: {
		kind: 'removeElement', paramPath: target.paramPath, elementId: 'second',
	} });
	assert.deepEqual(node.params.buzzs.value, [before.definition.nodes[0].params.buzzs.value[0]]);
	const removed = structuredClone(customNodeGraphEffect);
	const stored = resolveNodeParam(node, imageParameter.parameterPath).value;
	const connection = { inputSource: 'node', nodeId: 'globalIn', outputPort: stored.parameterId, ...stored.sampling };
	const sampled = { ...connection, fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
	manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...imageParameter, source: sampled });
	assert.deepEqual(resolveNodeParam(node, imageParameter.parameterPath).value.sampling, { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' });
	const after = structuredClone(customNodeGraphEffect);
	manager.undo();
	assert.deepEqual(customNodeGraphEffect, removed);
	manager.undo();
	assert.deepEqual(customNodeGraphEffect, before);
	manager.undo();
	assert.equal(Object.keys(customNodeGraphEffect.definition.paramDefs)[0], publicParameter.parameterId);
	assert.deepEqual(resolveNodeParam(node, imageParameter.parameterPath).value, stored);
	manager.redo();
	assert.deepEqual(customNodeGraphEffect, before);
	manager.redo();
	assert.deepEqual(customNodeGraphEffect, removed);
	manager.redo();
	assert.deepEqual(customNodeGraphEffect, after);
});

// 【既存の未解決接続があっても、新しいIDパスや接続先の欠落は拒否する】
// 既存接続の保持を許可する例外を、新規の壊れた接続の作成に使えてはいけない。
// 型不一致を許す方針でも参照先の存在確認は必要で、失敗時に状態と履歴を変更しない。
test('rejects new missing connections even when an unresolved connection is retained', () => {
	const { node, target, customNodeGraphEffect, manager, imageParameter } = fixtureWithRemovedPublicInput();
	const before = structuredClone(customNodeGraphEffect);
	const historySize = manager.undoStack.value.length;
	const stored = resolveNodeParam(node, imageParameter.parameterPath).value;
	const connection = { inputSource: 'node', nodeId: 'globalIn', outputPort: stored.parameterId, ...stored.sampling };
	for (const source of [{ ...connection, nodeId: 'missing-node' }, { ...connection, outputPort: 'missing-port' }]) {
		assert.throws(() => manager.commit('setCustomNodeGraphEffectNodeParameterSource', {
			...imageParameter, source,
		}), /Node output not found/);
	}
	const movedToNewId = structuredClone(node.params.buzzs);
	movedToNewId.value[0].id = 'new-element';
	movedToNewId.value[0].binding.value.image = connection;
	assert.throws(() => manager.commit('replaceCustomNodeGraphEffectNodeParameterBinding', {
		...nodeParameterTarget(target), binding: movedToNewId,
	}), /Node output not found/);
	assert.deepEqual(customNodeGraphEffect, before);
	assert.equal(manager.undoStack.value.length, historySize);
});

// 【ネストしたパラメータの基準値編集でも加工式を保持し、加工式自体は独立してUndoする】
// 通常の値編集や入力方式の切替がBindingを作り直しても、加工式を消してはいけない。
// リセットだけは全体を既定値へ戻し、Undoで元の基準値と加工式を一緒に復元する。
test('preserves modifiers through node source edits and independent undo and redo', () => {
	const { state, node, target } = fixture();
	target.paramPath = ['buzzs', 'first', 'x'];
	const modifier = { enabled: true, code: 'VALUE + 1' };
	const add = prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterExpressionModifier, { ...nodeParameterTarget({ ...target }), expressionModifier: modifier });
	add.execute(state);
	const read = () => resolveNodeParam(node, target.paramPath).value;
	assert.deepEqual(read().expressionModifier, modifier);
	const edit = prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterSource, { ...nodeParameterTarget({ ...target }), source: { inputSource: 'literal', value: 0.75 } });
	edit.execute(state);
	assert.equal(read().value, 0.75);
	assert.deepEqual(read().expressionModifier, modifier);
	const source = prepareTestCommand(COMMAND_DEFS.switchCustomNodeGraphEffectNodeParameterInputSource, { ...nodeParameterTarget({ ...target }), inputSource: 'expression' });
	source.execute(state);
	assert.equal(read().expression, '0.75');
	assert.deepEqual(read().expressionModifier, modifier);
	const disable = prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterExpressionModifier, { ...nodeParameterTarget({ ...target }), expressionModifier: { ...modifier, enabled: false } });
	disable.execute(state);
	assert.equal(read().expressionModifier.enabled, false);
	disable.undo(state);
	assert.equal(read().expressionModifier.enabled, true);
	const reset = prepareTestCommand(COMMAND_DEFS.resetCustomNodeGraphEffectNodeParameter, { ...nodeParameterTarget(target) });
	reset.execute(state);
	assert.deepEqual(read(), literal(0));
	reset.undo(state);
	assert.deepEqual(read().expressionModifier, modifier);
	const remove = prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterExpressionModifier, { ...nodeParameterTarget({ ...target }), expressionModifier: null });
	remove.execute(state);
	assert.equal(read().expressionModifier, null);
	remove.undo(state);
	assert.deepEqual(read().expressionModifier, modifier);
});

// 【挿入・並べ替えの後も、同じIDの要素を編集・削除する】
// 編集開始時のindexが変わっても、その位置を占めた別要素に操作を適用してはいけない。
// 別ノードの同じ既定IDとも衝突せず、配線の列挙も同じIDパスを使う必要がある。
test('targets element IDs across insertions and reordering', () => {
	const { state, node, target } = fixture();
	const otherNode = { ...structuredClone(node), id: 'other' };
	state.customNodeGraphEffects.value[0].definition.nodes.push(otherNode);
	const edit = prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterSource, { ...nodeParameterTarget({ ...target, paramPath: ['buzzs', 'first', 'x'] }), source: { inputSource: 'literal', value: 0.75 } });
	const remove = prepareTestCommand(COMMAND_DEFS.removeCustomNodeGraphEffectNodeParameterArrayElements, { ...nodeParameterTarget({ ...target }), elementIds: ['first'] });
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
	const edit = prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterSource, { ...nodeParameterTarget({ ...target, paramPath: ['buzzs', 'first', 'x'] }), source: { inputSource: 'literal', value: 1 } });
	node.params.buzzs.value = [{ id: 'replacement', binding: structuredClone(definition.paramDefs.buzzs.element.defaultValue) }];
	const before = structuredClone(node.params);
	assert.throws(() => edit.execute(state), /Unknown array element/);
	assert.throws(() => prepareTestCommand(COMMAND_DEFS.removeCustomNodeGraphEffectNodeParameterArrayElements, { ...nodeParameterTarget({ ...target }), elementIds: ['first'] }).execute(state), /Array element not found/);
	assert.deepEqual(node.params, before);
});

// 【追加とリセットのUndo/Redoは、一度発行した要素IDを復元する】
// 既定値のコピーと既存要素のリセットは異なる操作。リセット後に古いIDの参照を復活させず、
// RedoでさらにIDを変えて後続Commandの参照を壊すことも避ける。
test('preserves generated IDs through undo and redo of additions and resets', () => {
	const { state, node, target } = fixture();
	const original = structuredClone(node.params.buzzs);
	const add = prepareTestCommand(COMMAND_DEFS.insertCustomNodeGraphEffectNodeParameterArrayElement, { ...nodeParameterTarget(target) });
	add.execute(state);
	const added = structuredClone(node.params.buzzs);
	assert.notEqual(added.value[1].id, added.value[0].id);
	assert.deepEqual(added.value[1].binding, definition.paramDefs.buzzs.element.defaultValue);
	add.undo(state);
	assert.deepEqual(node.params.buzzs, original);
	add.execute(state);
	assert.deepEqual(node.params.buzzs, added);

	const reset = prepareTestCommand(COMMAND_DEFS.resetCustomNodeGraphEffectNodeParameter, { ...nodeParameterTarget(target) });
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
	prepareTestCommand(COMMAND_DEFS.setCustomNodeGraphEffectNodeParameterSource, { ...nodeParameterTarget({ ...target, paramPath: [...path, 'x'] }), source: { inputSource: 'literal', value: 1 } }).execute(state);
	prepareTestCommand(COMMAND_DEFS.resetCustomNodeGraphEffectNodeParameter, { ...nodeParameterTarget({ ...target, paramPath: path }) }).execute(state);
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
