import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { ProjectValidationState } = await loadShaderSource(fileURLToPath(new URL('../src/project-validation-state.ts', import.meta.url)));
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: {} }, defaultValue: literal(0) };
const color = { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: literal([0, 0, 0, 0]) };
const definitions = { effect: { paramDefs: { amount: scalar, input: color } } };
const connection = nodeId => ({ inputSource: 'node', nodeId, outputPort: 'output' });
const node = (id, input = null) => ({ id, type: 'effect', effectId: 'effect', isBypass: false, resolution: { mode: 'context' }, params: { amount: literal(1), input: connection(input) } });
const visualModule = (id, nodes) => ({ id, name: id, nodes, paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] });
const nodeChange = (visualModuleId, node) => ({ type: 'node', target: { visualModuleId }, node, changes: [{ type: 'parameter', kind: 'value' }] });

// 【値編集では別ノードや別Visual Moduleを再検証しない】
// 検証済みの設定に触れるだけでも失敗するgetterを設け、全体走査への退行を検出する。
// 値の変更を大量のグラフへ波及させないことが、この刷新の性能上の契約となる。
test('validates only the edited node when its references are unchanged', () => {
	const first = node('first');
	const unrelated = node('unrelated');
	const state = { visualModules: [visualModule('one', [first, unrelated]), visualModule('two', [node('other')])], timelineScenes: [] };
	const validation = new ProjectValidationState(definitions);
	validation.replace(state);
	assert.equal(validation.valid, true);
	Object.defineProperty(unrelated, 'params', { get() { throw new Error('Unrelated node was revalidated'); } });
	const edited = { ...first, params: { ...first.params, amount: literal('2') } };
	const next = { ...state, visualModules: [{ ...state.visualModules[0], nodes: [edited, unrelated] }, state.visualModules[1]] };
	validation.apply(next, [nodeChange('one', edited)]);
	assert.equal(validation.valid, true);
});

// 【未使用・バイパス中の循環も更新時に検出し、修正で診断を置き換える】
// 描画を開始しない状態でも診断を出す。エラーの累積で修正後も停止し続けないことを保証する。
test('blocks unused cyclic graphs and clears diagnostics after repairing the connection', () => {
	const first = { ...node('first', 'second'), isBypass: true };
	const second = node('second', 'first');
	const state = { visualModules: [visualModule('one', [first, second])], timelineScenes: [] };
	const validation = new ProjectValidationState(definitions);
	validation.replace(state);
	assert.equal(validation.valid, false);
	assert.match(validation.diagnostics.firstMessage, /Circular reference/);
	const edited = { ...first, params: { ...first.params, input: connection(null) } };
	validation.apply({ ...state, visualModules: [visualModule('one', [edited, second])] }, [nodeChange('one', edited)]);
	assert.equal(validation.diagnostics.errorCount, 0);
});

// 【公開入力の変更は参照索引から利用レイヤーを再検証する】
// Scene自体が変更されなくても引数が不正になる。内部ノードのエラーを親へ複製する必要はない。
test('revalidates callers after changing a public parameter contract', () => {
	const definition = { ...scalar, id: 'value', nameForReference: 'Value', canNode: false };
	const source = { ...visualModule('one', []), paramDefs: [definition] };
	const layer = { id: 'layer', layerType: 'visualModule', name: 'Layer', visualModuleId: source.id, visualModuleParamValues: { value: literal('2') }, clips: [], automationGraphs: [], compositingParamValues: {} };
	const state = { visualModules: [source], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }] };
	const validation = new ProjectValidationState(definitions);
	validation.replace(state);
	assert.equal(validation.valid, true);
	const edited = { ...source, paramDefs: [{ ...definition, dataType: { kind: 'enum', options: ['a'] }, defaultValue: literal('a') }] };
	validation.apply({ ...state, visualModules: [edited] }, [{ type: 'visualModule', target: { visualModuleId: source.id }, visualModule: edited }]);
	assert.equal(validation.valid, false);
	assert.ok(validation.diagnostics.entries.some(entry => entry.unit.includes('layer:')));
});

// 【値の静的検証と式の評価結果の検証を区別する】
// 不正な保存値は描画を止めるが、式を実行せずに戻り値を推測してはいけない。
test('checks stored scalar values without executing expressions', () => {
	const source = visualModule('one', [node('first')]);
	const validation = new ProjectValidationState(definitions);
	validation.replace({ visualModules: [source], timelineScenes: [] });
	const invalid = { ...source.nodes[0], params: { ...source.nodes[0].params, amount: literal('not a number') } };
	validation.apply({ visualModules: [visualModule('one', [invalid])], timelineScenes: [] }, [nodeChange('one', invalid)]);
	assert.equal(validation.valid, false);
	const expression = { ...invalid, params: { ...invalid.params, amount: { inputSource: 'expression', expression: '"not a number"' } } };
	validation.apply({ visualModules: [visualModule('one', [expression])], timelineScenes: [] }, [nodeChange('one', expression)]);
	assert.equal(validation.valid, true);
});

// 【倍率の変更は明示寸法だけを再検証し、値や接続の検証を繰り返さない】
// 元の設定が正しくても倍率を上げるとGPU上限を超える。環境条件の変更を
// 検証結果へ反映しつつ、変更されないパラメータを走査しないことを保証する。
test('refreshes configured dimension limits without revisiting parameters', () => {
	const effect = { ...node('first'), resolution: { mode: 'customAbsolute', width: 10000, height: 10 } };
	const state = { visualModules: [visualModule('one', [effect])], timelineScenes: [] };
	const validation = new ProjectValidationState(definitions);
	validation.setOptions([], 0.5, 8192);
	validation.replace(state);
	assert.equal(validation.valid, true);
	Object.defineProperty(effect, 'params', { get() { throw new Error('Parameters were revalidated'); } });
	validation.setOptions([], 1, 8192);
	assert.equal(validation.valid, false);
	assert.match(validation.diagnostics.firstMessage, /resolution exceeds/);
	validation.setOptions([], 0.5, 8192);
	assert.equal(validation.valid, true);
});
