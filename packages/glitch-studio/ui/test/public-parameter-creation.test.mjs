import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', isAdvanced: true, control: { controlType: 'range', min: -1, max: 2, step: 0.01 } }, defaultValue: literal(0) };
const array = { dataType: { kind: 'array', elementType: scalar.dataType }, element: { defaultValue: literal(0) },
	ui: { label: 'Weights', control: { element: scalar.ui.control } }, defaultValue: literal([{ id: 'first', binding: literal(0.2) }, { id: 'second', binding: literal(0.8) }]) };
const effect = { id: 'test', paramDefs: { amount: scalar, weights: array } };
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { commitVisualModuleEdit } from './src/utility/visual-module-edit.ts';
		export { createPublicParameterFromLiteral } from './src/utility/public-parameter-creation.ts';
	` },
	plugins: [i18nPlugin, { name: 'public-parameter-platform', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, ({ path }) => ({ path: path.includes('preferences') ? 'preferences' : 'effects', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', contents: path === 'preferences'
			? 'export const preferences = { s: { forceTypeSafety: true } };'
			: `export const effectDefinitions = { test: ${JSON.stringify(effect)} };` }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, UndoRedo, commitVisualModuleEdit, createPublicParameterFromLiteral } = module.exports;

function fixture() {
	const node = { id: 'node', type: 'effect', effectId: 'test', params: { amount: literal(0.3), weights: structuredClone(array.defaultValue) } };
	const visualModule = { id: 'visual-module', nodes: [node], paramDefs: [], primaryInputId: null, primaryAudioInputId: null, automationGraphs: [] };
	const layer = { id: 'layer', name: 'Layer', layerType: 'effect', effectId: 'test', automationGraphs: [], effectParamValues: structuredClone(node.params) };
	const scene = { id: 'scene', resolution: { mode: 'customAbsolute', width: 1600, height: 800 }, layers: [layer] };
	const state = { visualModules: { value: [visualModule] }, timelineScenes: { value: [scene] }, resolution: { value: { width: 1600, height: 800 } } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	return { node, visualModule, layer, scene, state, history, changes };
}

for (const inline of [false, true]) {
	// 【通常とインラインのVisual Moduleで、作成・接続を一つのUndoにする】
	// エディタの通知から実際のCommandまでを通し、型・UI・現在値の引き継ぎと
	// Redo時のID維持、元の詳細設定を公開先に持ち込まないことを確認する。
	test(`creates and connects a public parameter in an inline Visual Module: ${inline}`, () => {
		const f = fixture();
		const target = inline ? { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' } : { visualModuleId: f.visualModule.id };
		if (inline) f.scene.layers.push({ id: 'inline', layerType: 'inlineVisualModule', visualModule: f.visualModule });
		const before = structuredClone(f.visualModule);
		commitVisualModuleEdit(f.history, target, { kind: 'editNodeParam', nodeId: f.node.id, edit: { kind: 'createPublicParameter', paramPath: ['amount'] } });
		const definition = f.visualModule.paramDefs[0];
		assert.deepEqual(definition.dataType, scalar.dataType);
		assert.deepEqual(definition.ui, { label: 'Amount', control: scalar.ui.control });
		assert.deepEqual(definition.defaultValue, literal(0.3));
		assert.equal(definition.canNode, false);
		assert.equal(definition.nameForReference, 'amount');
		assert.deepEqual(f.node.params.amount, { inputSource: 'visualModulePublicParameterReference', parameterId: definition.id });
		assert.equal(f.history.undoStack.value.length, 1);
		assert.equal(f.changes[0][0].type, 'visualModule');
		const after = structuredClone(f.visualModule);
		f.history.undo();
		assert.deepEqual(f.visualModule, before);
		f.history.redo();
		assert.deepEqual(f.visualModule, after);
	});
}

for (const scope of ['visualModule', 'timeline']) {
	// 【配列の末端だけを公開し、同名の参照名を衝突させない】
	// 配列の安定IDと兄弟Bindingを維持し、既存定義を上書きしない。
	// 元定義とのオブジェクト共有も避け、公開先のUI編集が元のエフェクトへ漏れないことを確認する。
	test(`promotes an array leaf with a unique name in ${scope}`, () => {
		const f = fixture();
		const existing = { ...structuredClone(scalar), canNode: false, id: 'existing', nameForReference: 'weights' };
		if (scope === 'visualModule') f.visualModule.paramDefs.push(existing);
		else f.layer.publicParameterDefs = [existing];
		const owner = scope === 'visualModule' ? f.visualModule : f.layer;
		const before = structuredClone(owner);
		f.history.commit(scope === 'visualModule' ? 'createVisualModulePublicParameterFromParam' : 'createTimelineLayerPublicParameterFromParam', {
			...(scope === 'visualModule' ? { visualModuleId: f.visualModule.id, nodeId: f.node.id } : { sceneId: 'scene', layerId: f.layer.id, target: 'effect' }), paramPath: ['weights', 'second'],
		});
		const definitions = scope === 'visualModule' ? f.visualModule.paramDefs : f.layer.publicParameterDefs;
		const values = scope === 'visualModule' ? f.node.params : f.layer.effectParamValues;
		assert.equal(definitions[1].nameForReference, 'weights_2');
		assert.deepEqual(definitions[1].defaultValue, literal(0.8));
		assert.deepEqual(values.weights.value[0], array.defaultValue.value[0]);
		assert.equal(values.weights.value[1].id, 'second');
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
// Visual Moduleの引数が未保存でも現在の既定値を引き継ぎ、他の利用レイヤーへ
// 影響させない。Undoで不要な保存値と公開パラメータ定義を残さないことも保証する。
test('promotes an unset inline Visual Module argument into its owning timeline layer', () => {
	const f = fixture();
	f.visualModule.paramDefs = [{ ...structuredClone(scalar), id: 'amount', nameForReference: 'amount', canNode: false, defaultValue: literal(0.75) }];
	f.layer = { id: 'inline', layerType: 'inlineVisualModule', visualModule: f.visualModule, visualModuleParamValues: {}, automationGraphs: [] };
	f.scene.layers = [f.layer];
	const before = structuredClone(f.layer);
	f.history.commit('createTimelineLayerPublicParameterFromParam', { sceneId: 'scene', layerId: f.layer.id, target: 'module', paramPath: ['amount'] });
	const definition = f.layer.publicParameterDefs[0];
	assert.deepEqual(definition.defaultValue, literal(0.75));
	assert.deepEqual(f.layer.visualModuleParamValues.amount, { inputSource: 'timelineLayerPublicParameterReference', layerId: f.layer.id, parameterId: definition.id });
	assert.equal(f.visualModule.paramDefs.length, 1);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.deepEqual(f.changes[0][0].changes, [{ type: 'definition' }, { type: 'parameter', target: 'module', kind: 'connection' }]);
	const after = structuredClone(f.layer);
	f.history.undo();
	assert.deepEqual(f.layer, before);
	f.history.redo();
	assert.deepEqual(f.layer, after);
});

// 【Camera Zの既定値は所属Sceneの基準解像度で引き継ぐ】
// 値が未保存のときも正方形用の距離を使わず、公開操作で画角を変えないための確認。
test('uses the owning scene resolution when promoting an unset camera distance', () => {
	const f = fixture();
	f.state.resolution.value = { width: 800, height: 1600 };
	const layer = { id: 'camera', layerType: 'camera', cameraParamValues: {}, automationGraphs: [] };
	f.scene.layers.push(layer);
	f.history.commit('createTimelineLayerPublicParameterFromParam', { sceneId: 'scene', layerId: layer.id, target: 'camera', paramPath: ['z'] });
	assert.ok(Math.abs(layer.publicParameterDefs[0].defaultValue.value - 0.25 / Math.tan(Math.PI / 8)) < 1e-10);
	f.history.undo();
	assert.deepEqual(layer.cameraParamValues, {});
	assert.equal(layer.publicParameterDefs, undefined);
});

// 【スコープを変えると意味が変わる入力は、Commandから直接呼んでも変更しない】
// メニュー表示後の状態変更や誤った呼び出しでも、式・接続・加工式・コンテナが
// 途中まで公開されないようにし、失敗時は履歴と保存状態を維持する。
test('rejects nonliteral bindings modifiers and containers without changing state or history', () => {
	for (const scope of ['visualModule', 'timeline']) {
		for (const binding of [
			{ inputSource: 'expression', expression: 'PUBLIC("amount")' },
			{ inputSource: 'node', nodeId: 'other', outputPort: 'output' },
			{ ...literal(0.3), expressionModifier: { enabled: true, code: 'VALUE' } },
			{ ...literal(0.3), expressionModifier: { enabled: false, code: 'VALUE' } },
			array.defaultValue,
		]) {
			const f = fixture();
			const path = binding === array.defaultValue ? ['weights'] : ['amount'];
			if (scope === 'visualModule') f.node.params[path[0]] = structuredClone(binding);
			else f.layer.effectParamValues[path[0]] = structuredClone(binding);
			const before = structuredClone(f.state);
			assert.throws(() => f.history.commit(scope === 'visualModule' ? 'createVisualModulePublicParameterFromParam' : 'createTimelineLayerPublicParameterFromParam', {
				...(scope === 'visualModule' ? { visualModuleId: f.visualModule.id, nodeId: f.node.id } : { sceneId: 'scene', layerId: f.layer.id, target: 'effect' }), paramPath: path,
			}), /Only literal/);
			assert.deepEqual(f.state, before);
			assert.equal(f.history.undoStack.value.length, 0);
			assert.deepEqual(f.changes, []);
		}
	}
	const f = fixture();
	assert.throws(() => f.history.commit('createTimelineLayerPublicParameterFromParam', { sceneId: 'scene', layerId: f.layer.id, target: 'publicParameter', paramPath: ['amount'] }), /cannot be promoted/);
});

// 【表示名が日本語や数字でも、空でなく重複しないsnake caseの参照名を発行する】
// 表示名と式用の識別子を混同せず、自動生成後も既存の定義編集UIで変更できるようにする。
test('generates valid unique reference names without altering labels or sharing mutable values', () => {
	for (const [label, expected] of [['ぼかし量', 'my_param_3'], ['2D Offset', 'param_2_d_offset'], ['Size Reference', 'size_reference']]) {
		const definition = createPublicParameterFromLiteral({ ...scalar, ui: { ...scalar.ui, label } }, literal(0.3), [{ nameForReference: 'my_param' }, { nameForReference: 'my_param_2' }]);
		assert.equal(definition.nameForReference, expected);
		assert.equal(definition.ui.label, label);
	}
	const color = { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: literal([0, 0, 0, 0]), canNode: true };
	const value = literal([1, 0.5, 0, 0.25]);
	const definition = createPublicParameterFromLiteral(color, value, []);
	definition.defaultValue.value[0] = 0;
	assert.deepEqual(value.value, [1, 0.5, 0, 0.25]);
	assert.equal(definition.canNode, false);
});
