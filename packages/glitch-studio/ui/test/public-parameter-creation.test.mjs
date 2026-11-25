import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { testNodesEffect } from './helpers/nodes-effect.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', isAdvanced: true, control: { controlType: 'range', min: -1, max: 2, step: 0.01 } }, defaultValue: 0 };
const array = { dataType: { kind: 'array', elementType: scalar.dataType }, element: { defaultValue: 0 },
	ui: { label: 'Weights', control: { element: scalar.ui.control } }, defaultValue: [0.2, 0.8] };
const weightDefaults = createDefaultParameterBinding(array);
const secondWeightId = weightDefaults.value[1].id;
const effect = { id: 'test', paramDefs: { amount: scalar, weights: array } };
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { commitNodesEffectEdit } from './src/utility/nodes-effect-edit.ts';
		export { createNamedParameterFromLiteral } from './src/utility/named-parameter-creation.ts';
	` },
	plugins: [i18nPlugin, { name: 'public-parameter-platform', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$|preferences\.ts$/ }, ({ path }) => ({ path: path.includes('preferences') ? 'preferences' : 'effects', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', contents: path === 'preferences'
			? 'export const preferences = { s: { forceTypeSafety: true } };'
			: `export const nativeEffectDefinitions = { test: ${JSON.stringify(effect)} };` }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, UndoRedo, commitNodesEffectEdit, createNamedParameterFromLiteral } = module.exports;

function fixture() {
	const node = { id: 'node', type: 'effect', effectSource: { type: 'nativeEffect', id: 'test' }, params: { amount: literal(0.3), weights: createDefaultParameterBinding(array) } };
	const nodesEffect = { id: 'nodes-effect', definition: testNodesEffect({ customParameterValues: {}, nodes: [node], primaryInputParameter: null, primaryAudioInputParameter: null, curveAnimations: [] }) };
	const layer = { id: 'layer', name: 'Layer', layerType: 'effect', effectSource: { type: 'nativeEffect', id: 'test' }, curveAnimations: [], effectParamValues: structuredClone(node.params) };
	const scene = { id: 'scene', resolution: { mode: 'customAbsolute', width: 1600, height: 800 }, layers: [layer] };
	const state = { nodesEffects: { value: [nodesEffect] }, timelineScenes: { value: [scene] }, resolution: { value: { width: 1600, height: 800 } } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	return { get node() { return nodesEffect.definition.nodes.find(candidate => candidate.id === node.id); }, nodesEffect, layer, scene, state, history, changes };
}


// 【配列の既定値が指定された要素数の上限を超えたら定義の受付で報告する】
// 定義を保存した後のWeb書き出しで初めて失敗することを防ぐ。空の外側配列でも、内側の追加用既定値を検証する。
test('rejects oversized initial arrays and nested element defaults before creating a public parameter', () => {
	const f = fixture();
	const nodesEffect = { nodesEffectId: f.nodesEffect.id };
	const definition = { ...array, nameForReference: 'weights', canNode: false, maxElements: 1 };
	const nestedDefinition = {
		nameForReference: 'weights', canNode: false,
		dataType: { kind: 'array', elementType: array.dataType },
		ui: { label: 'Weight groups', control: { element: array.ui.control } },
		defaultValue: [],
		element: { maxElements: 1, defaultValue: [0.2, 0.8], element: { defaultValue: 0 } },
	};
	for (const invalid of [definition, nestedDefinition]) {
		assert.throws(() => f.history.commit('createNodesEffectPublicParameter', { nodesEffect, definition: invalid }), /exceeds maxElements/);
	}
	assert.deepEqual(f.nodesEffect.definition.paramDefs, {});
	assert.equal(f.history.undoStack.value.length, 0);

	const { parameterId } = f.history.commit('createNodesEffectPublicParameter', {
		nodesEffect, definition: { ...definition, defaultValue: [0.2] },
	});
	assert.deepEqual(f.nodesEffect.definition.paramDefs[parameterId].defaultValue, [0.2]);
});

for (const inline of [false, true]) {
	// 【カスタム化の作成と接続を一回のUndoで戻し、Redoでも同じIDを使う】
	// メニュー由来の編集通知をCommandまで通し、公開と同名を許可しつつ
	// 元の固定値・型・UIを保持し、空だった定義・値もUndoで元に戻す。
	test(`creates and connects a custom parameter in an inline Nodes Effect: ${inline}`, () => {
		const f = fixture();
		const target = inline ? { sceneId: 'scene', layerId: 'inline' } : { nodesEffectId: f.nodesEffect.id };
		if (inline) f.scene.layers.push({ id: 'inline', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: f.nodesEffect.definition } });
		f.nodesEffect.definition.paramDefs['public-amount'] = { ...structuredClone(scalar), nameForReference: 'amount', canNode: false };
		const before = structuredClone(f.nodesEffect);
		commitNodesEffectEdit(f.history, target, { kind: 'editNodeParam', nodeId: f.node.id, edit: { kind: 'createCustomParameter', paramPath: ['amount'] } });
		const definition = Object.entries(f.nodesEffect.definition.customParameterDefs).map(([id, def]) => ({ ...def, id }))[0];
		assert.deepEqual(definition.dataType, scalar.dataType);
		assert.deepEqual(definition.ui, { label: 'Amount', control: scalar.ui.control });
		assert.notEqual(definition.ui.control, scalar.ui.control);
		assert.deepEqual(definition.defaultValue, 0.3);
		assert.equal(definition.canNode, false);
		assert.equal(definition.nameForReference, 'amount');
		assert.deepEqual(f.node.params.amount, { inputSource: 'nodesEffectCustomParameterValueReference', parameterId: definition.id });
		assert.equal(Object.keys(f.nodesEffect.definition.paramDefs).length, 1);
		assert.equal(f.history.undoStack.value.length, 1);
		assert.deepEqual(f.changes[0].map(change => change.type), ['nodesEffect']);
		const after = structuredClone(f.nodesEffect);
		f.history.undo();
		assert.deepEqual(f.nodesEffect, before);
		f.history.redo();
		assert.deepEqual(f.nodesEffect, after);
	});
}

// 【配列の末端をカスタム化し、既存の定義・値・兄弟Bindingを維持する】
// 名前の重複はカスタムの中だけで避け、公開と同名の参照名でも作成できるようにする。
test('promotes an array leaf without replacing existing custom definitions or values', () => {
	const f = fixture();
	const existing = { ...structuredClone(scalar), nameForReference: 'weights', canNode: false };
	f.nodesEffect.definition.customParameterDefs = { existing };
	f.nodesEffect.definition.customParameterValues = { existing: { inputSource: 'expression', expression: 'TIME' } };
	f.nodesEffect.definition.paramDefs = { 'public-weights': { ...existing, nameForReference: 'weights_2' } };
	const before = structuredClone(f.nodesEffect);
	f.history.commit('createNodesEffectCustomParameterFromParameter', { target: { nodesEffect: { nodesEffectId: f.nodesEffect.id }, nodeId: f.node.id }, parameterPath: ['weights', secondWeightId] });
	const definition = Object.entries(f.nodesEffect.definition.customParameterDefs).map(([id, def]) => ({ ...def, id }))[1];
	assert.equal(definition.nameForReference, 'weights_2');
	assert.deepEqual(definition.defaultValue, 0.8);
	assert.deepEqual(f.nodesEffect.definition.customParameterValues, before.definition.customParameterValues);
	assert.deepEqual(f.node.params.weights.value[0], before.definition.nodes[0].params.weights.value[0]);
	assert.deepEqual(f.node.params.weights.value[1], { id: secondWeightId, binding: { inputSource: 'nodesEffectCustomParameterValueReference', parameterId: definition.id } });
	const after = structuredClone(f.nodesEffect);
	f.history.undo();
	assert.deepEqual(f.nodesEffect, before);
	f.history.redo();
	assert.deepEqual(f.nodesEffect, after);
});

// 【移動できない入力はカスタム化のCommandからも拒否し、部分的な作成を残さない】
// メニュー表示後に入力が変わった場合も、ノード固有の式・接続・加工式を別スコープへ移さない。
test('rejects unsupported custom parameter promotion without changing state or history', () => {
	for (const binding of [
		{ inputSource: 'expression', expression: 'RESOLUTION[0]' },
		{ inputSource: 'node', nodeId: 'other', outputPort: 'output' },
		{ inputSource: 'keyframesTimelineInline', keyframesTimeline: { keyframes: [] } },
		{ ...literal(0.3), expressionModifier: { enabled: true, code: 'VALUE' } },
		{ ...literal(0.3), expressionModifier: { enabled: false, code: 'VALUE' } },
		weightDefaults,
	]) {
		const f = fixture();
		const path = binding === weightDefaults ? ['weights'] : ['amount'];
		f.node.params[path[0]] = structuredClone(binding);
		const before = structuredClone(f.state);
		assert.throws(() => f.history.commit('createNodesEffectCustomParameterFromParameter', {
			target: { nodesEffect: { nodesEffectId: f.nodesEffect.id }, nodeId: f.node.id }, parameterPath: path,
		}), /Only literal/);
		assert.deepEqual(f.state, before);
		assert.equal(f.history.undoStack.value.length, 0);
		assert.deepEqual(f.changes, []);
	}
});

for (const inline of [false, true]) {
	// 【カスタムの定義・値・参照を、通常配置とインライン配置の両方でUndoできる】
	// 公開と同名でも作成でき、名前変更でID参照を失わず、削除・復元・型変更が同じ履歴で戻ることを確認する。
	test(`edits custom parameter definitions and bindings with undo in an inline Nodes Effect: ${inline}`, () => {
		const f = fixture();
		const target = inline ? { sceneId: 'scene', layerId: 'inline' } : { nodesEffectId: f.nodesEffect.id };
		if (inline) f.scene.layers.push({ id: 'inline', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: f.nodesEffect.definition } });
		const definition = { ...scalar, id: 'custom-id', nameForReference: 'speed', canNode: false };
		const { id: customId, ...publicDefinition } = definition;
		f.nodesEffect.definition.paramDefs['public-id'] = publicDefinition;
		const before = structuredClone(f.nodesEffect);
		commitNodesEffectEdit(f.history, target, { kind: 'updateCustomParameter', definition });
		definition.id = Object.entries(f.nodesEffect.definition.customParameterDefs).map(([id, def]) => ({ ...def, id }))[0].id;
		const afterCreation = structuredClone(f.nodesEffect);
		f.history.undo();
		assert.deepEqual(f.nodesEffect, before);
		f.history.redo();
		assert.deepEqual(f.nodesEffect, afterCreation);
		commitNodesEffectEdit(f.history, target, { kind: 'editCustomParameter', parameterId: definition.id, edit: { kind: 'expression', value: 'PUBLIC("speed") * 2' } });
		commitNodesEffectEdit(f.history, target, { kind: 'editCustomParameter', parameterId: definition.id, edit: { kind: 'expressionModifier', value: { enabled: true, code: 'VALUE + TIME' } } });
		const binding = structuredClone(f.nodesEffect.definition.customParameterValues[definition.id]);
		commitNodesEffectEdit(f.history, target, { kind: 'editNodeParam', nodeId: f.node.id, edit: { kind: 'nodesEffectCustomParameterValueReference', paramPath: ['amount'], value: definition.id } });
		commitNodesEffectEdit(f.history, target, { kind: 'updateCustomParameter', definition: { ...definition, nameForReference: 'renamed' } });
		assert.equal(f.node.params.amount.parameterId, definition.id);
		assert.deepEqual(f.nodesEffect.definition.customParameterValues[definition.id], binding);
		assert.equal(Object.keys(f.nodesEffect.definition.paramDefs).length, 1);
		commitNodesEffectEdit(f.history, target, { kind: 'removeCustomParameter', parameterId: definition.id });
		assert.equal(f.node.params.amount.parameterId, definition.id);
		assert.equal(Object.keys(f.nodesEffect.definition.customParameterDefs).length, 0);
		f.history.undo();
		assert.equal(Object.entries(f.nodesEffect.definition.customParameterDefs).map(([id, def]) => ({ ...def, id }))[0].nameForReference, 'renamed');
		assert.deepEqual(f.nodesEffect.definition.customParameterValues[definition.id], binding);
		commitNodesEffectEdit(f.history, target, { kind: 'updateCustomParameter', definition: { ...definition, dataType: { kind: 'string' }, ui: { label: 'Text', control: {} }, defaultValue: 'initial' } });
		assert.equal(f.nodesEffect.definition.customParameterValues[definition.id], undefined);
		f.history.undo();
		assert.deepEqual(f.nodesEffect.definition.customParameterValues[definition.id], binding);
		assert.throws(() => commitNodesEffectEdit(f.history, target, { kind: 'updateCustomParameter', definition: { ...definition, id: 'duplicate', nameForReference: 'renamed' } }), /unique/);
		assert.ok(f.changes.some(changes => changes.some(change => change.type === 'nodesEffect' && change.customParameterValuesOnly === true)));
	});
}

for (const inline of [false, true]) {
	// 【通常とインラインのNodes Effectで、作成・接続を一つのUndoにする】
	// エディタの通知から実際のCommandまでを通し、型・UI・現在値の引き継ぎと
	// Redo時のID維持、元の詳細設定を公開先に持ち込まないことを確認する。
	test(`creates and connects a public parameter in an inline Nodes Effect: ${inline}`, () => {
		const f = fixture();
		const target = inline ? { sceneId: 'scene', layerId: 'inline' } : { nodesEffectId: f.nodesEffect.id };
		if (inline) f.scene.layers.push({ id: 'inline', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: f.nodesEffect.definition } });
		const before = structuredClone(f.nodesEffect);
		commitNodesEffectEdit(f.history, target, { kind: 'editNodeParam', nodeId: f.node.id, edit: { kind: 'createPublicParameter', paramPath: ['amount'] } });
		const definition = Object.entries(f.nodesEffect.definition.paramDefs).map(([id, def]) => ({ ...def, id }))[0];
		assert.deepEqual(definition.dataType, scalar.dataType);
		assert.deepEqual(definition.ui, { label: 'Amount', control: scalar.ui.control });
		assert.deepEqual(definition.defaultValue, 0.3);
		assert.equal(definition.canNode, false);
		assert.equal(definition.nameForReference, 'amount');
		assert.deepEqual(f.node.params.amount, { inputSource: 'nodesEffectPublicParameterReference', parameterId: definition.id });
		assert.equal(f.history.undoStack.value.length, 1);
		assert.equal(f.changes[0][0].type, 'nodesEffect');
		const after = structuredClone(f.nodesEffect);
		f.history.undo();
		assert.deepEqual(f.nodesEffect, before);
		f.history.redo();
		assert.deepEqual(f.nodesEffect, after);
	});
}

for (const scope of ['nodesEffect', 'timeline']) {
	// 【配列の末端だけを公開し、同名の参照名を衝突させない】
	// 配列の安定IDと兄弟Bindingを維持し、既存定義を上書きしない。
	// 元定義とのオブジェクト共有も避け、公開先のUI編集が元のエフェクトへ漏れないことを確認する。
	test(`promotes an array leaf with a unique name in ${scope}`, () => {
		const f = fixture();
		const existing = { ...structuredClone(scalar), canNode: false, id: 'existing', nameForReference: 'weights' };
		if (scope === 'nodesEffect') f.nodesEffect.definition.paramDefs[existing.id] = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== 'id'));
		else f.layer.publicParameterDefs = [existing];
		const owner = scope === 'nodesEffect' ? f.nodesEffect : f.layer;
		const before = structuredClone(owner);
		f.history.commit(scope === 'nodesEffect' ? 'createNodesEffectPublicParameterFromParameter' : 'createTimelineLayerPublicParameterFromParameter', {
			...(scope === 'nodesEffect' ? { target: { nodesEffect: { nodesEffectId: f.nodesEffect.id }, nodeId: f.node.id } } : { sceneId: 'scene', layerId: f.layer.id, parameterGroup: 'effect' }), parameterPath: ['weights', secondWeightId],
		});
		const definitions = scope === 'nodesEffect' ? Object.entries(f.nodesEffect.definition.paramDefs).map(([id, def]) => ({ ...def, id })) : f.layer.publicParameterDefs;
		const values = scope === 'nodesEffect' ? f.node.params : f.layer.effectParamValues;
		assert.equal(definitions[1].nameForReference, 'weights_2');
		assert.deepEqual(definitions[1].defaultValue, 0.8);
		assert.deepEqual(values.weights.value[0], weightDefaults.value[0]);
		assert.equal(values.weights.value[1].id, secondWeightId);
		assert.equal(values.weights.value[1].binding.parameterId, definitions[1].id);
		assert.equal(definitions[1].ui.control === array.ui.control.element, false);
		const after = structuredClone(owner);
		f.history.undo();
		assert.deepEqual(owner, before);
		f.history.redo();
		assert.deepEqual(owner, after);
	});
}

// 【Timelineで未保存の既定値を公開し、所有レイヤーだけへ接続する】
// Nodes Effectの引数が未保存でも現在の既定値を引き継ぎ、他の利用レイヤーへ
// 影響させない。Undoで不要な保存値と公開パラメータ定義を残さないことも保証する。
test('promotes an unset inline Nodes Effect argument into its owning timeline layer', () => {
	const f = fixture();
	f.nodesEffect.definition.paramDefs = { amount: { ...structuredClone(scalar), nameForReference: 'amount', canNode: false, defaultValue: 0.75 } };
	f.layer = { id: 'inline', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: f.nodesEffect.definition }, effectParamValues: {}, curveAnimations: [] };
	f.scene.layers = [f.layer];
	const before = structuredClone(f.layer);
	f.history.commit('createTimelineLayerPublicParameterFromParameter', { sceneId: 'scene', layerId: f.layer.id, parameterGroup: 'effect', parameterPath: ['amount'] });
	const definition = f.layer.publicParameterDefs[0];
	assert.deepEqual(definition.defaultValue, 0.75);
	assert.deepEqual(f.layer.effectParamValues.amount, { inputSource: 'timelineLayerPublicParameterReference', layerId: f.layer.id, parameterId: definition.id });
	assert.equal(Object.keys(f.nodesEffect.definition.paramDefs).length, 1);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.deepEqual(f.changes[0][0].changes, [{ type: 'definition' }, { type: 'parameter', target: 'effect', kind: 'connection' }]);
	const after = structuredClone(f.layer);
	f.history.undo();
	assert.deepEqual(f.layer, before);
	f.history.redo();
	assert.deepEqual(f.layer, after);
});

// 【Camera Zの既定値はSceneの比率によらず共通の距離で引き継ぐ】
// プロジェクトとSceneが異なる比率でも、未設定値の公開操作でカメラ距離を変えない。
test('uses the fixed default when promoting an unset camera distance', () => {
	const f = fixture();
	f.state.resolution.value = { width: 800, height: 1600 };
	const layer = { id: 'camera', layerType: 'camera', cameraParamValues: {}, curveAnimations: [] };
	f.scene.layers.push(layer);
	f.history.commit('createTimelineLayerPublicParameterFromParameter', { sceneId: 'scene', layerId: layer.id, parameterGroup: 'camera', parameterPath: ['z'] });
	assert.ok(Math.abs(layer.publicParameterDefs[0].defaultValue - 0.5 / Math.tan(Math.PI / 8)) < 1e-10);
	f.history.undo();
	assert.deepEqual(layer.cameraParamValues, {});
	assert.equal(layer.publicParameterDefs, undefined);
});

// 【スコープを変えると意味が変わる入力は、Commandから直接呼んでも変更しない】
// メニュー表示後の状態変更や誤った呼び出しでも、式・接続・加工式・コンテナが
// 途中まで公開されないようにし、失敗時は履歴と保存状態を維持する。
test('rejects nonliteral bindings modifiers and containers without changing state or history', () => {
	for (const scope of ['nodesEffect', 'timeline']) {
		for (const binding of [
			{ inputSource: 'expression', expression: 'PUBLIC("amount")' },
			{ inputSource: 'node', nodeId: 'other', outputPort: 'output' },
			{ ...literal(0.3), expressionModifier: { enabled: true, code: 'VALUE' } },
			{ ...literal(0.3), expressionModifier: { enabled: false, code: 'VALUE' } },
			weightDefaults,
		]) {
			const f = fixture();
			const path = binding === weightDefaults ? ['weights'] : ['amount'];
			if (scope === 'nodesEffect') f.node.params[path[0]] = structuredClone(binding);
			else f.layer.effectParamValues[path[0]] = structuredClone(binding);
			const before = structuredClone(f.state);
			assert.throws(() => f.history.commit(scope === 'nodesEffect' ? 'createNodesEffectPublicParameterFromParameter' : 'createTimelineLayerPublicParameterFromParameter', {
				...(scope === 'nodesEffect' ? { target: { nodesEffect: { nodesEffectId: f.nodesEffect.id }, nodeId: f.node.id } } : { sceneId: 'scene', layerId: f.layer.id, parameterGroup: 'effect' }), parameterPath: path,
			}), /Only literal/);
			assert.deepEqual(f.state, before);
			assert.equal(f.history.undoStack.value.length, 0);
			assert.deepEqual(f.changes, []);
		}
	}
	const f = fixture();
	assert.throws(() => f.history.commit('createTimelineLayerPublicParameterFromParameter', { sceneId: 'scene', layerId: f.layer.id, parameterGroup: 'publicParameter', parameterPath: ['amount'] }), /cannot be promoted/);
});

// 【表示名が日本語や数字でも、空でなく重複しないsnake caseの参照名を発行する】
// 表示名と式用の識別子を混同せず、自動生成後も既存の定義編集UIで変更できるようにする。
test('generates valid unique reference names without altering labels or sharing mutable values', () => {
	for (const [label, expected] of [['ぼかし量', 'my_param_3'], ['2D Offset', 'param_2_d_offset'], ['Size Reference', 'size_reference']]) {
		const definition = createNamedParameterFromLiteral({ ...scalar, ui: { ...scalar.ui, label } }, literal(0.3), [{ nameForReference: 'my_param' }, { nameForReference: 'my_param_2' }]);
		assert.equal(definition.nameForReference, expected);
		assert.equal(definition.ui.label, label);
	}
	const color = { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: [0, 0, 0, 0], canNode: true };
	const value = literal([1, 0.5, 0, 0.25]);
	const definition = createNamedParameterFromLiteral(color, value, []);
	definition.defaultValue[0] = 0;
	assert.deepEqual(value.value, [1, 0.5, 0, 0.25]);
	assert.equal(definition.canNode, false);
});

// 【一回の非同期グループで作成した参照を次のCommandへ渡し、失敗前の操作だけをUndoする】
// AiScriptのように生成IDを呼び出し側で用意できない利用でも、後続編集の対象を確定できる必要がある。
// 検証に失敗したCommandは状態と通知を残さず、先行した成功分は一履歴として手動で戻せる。
test('returns stable references and retains only successful changes in an asynchronous group', async () => {
	const f = fixture();
	const before = structuredClone(f.nodesEffect);
	let created;
	await assert.rejects(f.history.runGroup('Script', async () => {
		created = await f.history.execute('createNodesEffectCustomParameter', { nodesEffect: { nodesEffectId: f.nodesEffect.id }, definition: { ...scalar, canNode: false, nameForReference: 'created' } });
		await f.history.execute('setNodesEffectCustomParameterSource', { target: created, source: { inputSource: 'expression', expression: 'TIME' } });
		await f.history.execute('replaceNodesEffectNodeParameterBinding', { target: { nodesEffect: { nodesEffectId: f.nodesEffect.id }, nodeId: f.node.id }, parameterPath: ['weights'], binding: { inputSource: 'literal', value: [{ id: 'same', binding: literal(1) }, { id: 'same', binding: literal(2) }] } });
	}), /Duplicate array element ID/);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(f.changes.length, 2);
	assert.deepEqual(f.nodesEffect.definition.customParameterValues[created.parameterId], { inputSource: 'expression', expression: 'TIME' });
	const after = structuredClone(f.nodesEffect);
	created.parameterId = 'caller-mutated';
	f.history.undo();
	assert.deepEqual(f.nodesEffect, before);
	f.history.redo();
	assert.deepEqual(f.nodesEffect, after);
});

// 【配列要素の生成結果を編集へ渡し、No-opと失敗でRedoを壊さない】
// 要素IDはCommandが発行し、Redoでも同一にする。既存値の再設定や不正な位置への挿入は
// 履歴と通知を増やさず、取り消した操作をやり直せる状態を維持する。
test('returns array element paths and keeps redo on no-op or invalid edits', async () => {
	const f = fixture();
	const input = { target: { nodesEffect: { nodesEffectId: f.nodesEffect.id }, nodeId: f.node.id }, parameterPath: ['weights'] };
	const inserted = await f.history.execute('insertNodesEffectNodeParameterArrayElement', { ...input, beforeElementId: secondWeightId });
	assert.deepEqual(inserted.parameterPath.slice(0, -1), ['weights']);
	assert.equal(f.node.params.weights.value[1].id, inserted.parameterPath.at(-1));
	await f.history.execute('setNodesEffectNodeParameterSource', { ...inserted, source: literal(0.4) });
	assert.deepEqual(f.node.params.weights.value[1].binding, literal(0.4));
	f.history.undo();
	const notifications = f.changes.length;
	await f.history.execute('setNodesEffectNodeParameterSource', { ...inserted, source: literal(0) });
	await assert.rejects(f.history.execute('insertNodesEffectNodeParameterArrayElement', { ...input, beforeElementId: 'missing' }), /not found/);
	assert.equal(f.history.redoStack.value.length, 1);
	assert.equal(f.changes.length, notifications);
	f.history.redo();
	assert.deepEqual(f.node.params.weights.value[1].binding, literal(0.4));
});
