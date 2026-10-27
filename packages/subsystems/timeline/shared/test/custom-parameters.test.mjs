import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = name => loadSource(fileURLToPath(new URL('../src/' + name, import.meta.url)));
const { TimelineParameterBindingEvaluator } = await load('parameter-binding-evaluator.ts');
const { createTimelineLayerEvaluationScope } = await load('evaluation-scope.ts');
const { getTimelineLayerCustomParameterContext, getTimelineLayerCustomParameterSources, validateTimelineLayerCustomParameterDefinitions } = await load('custom-parameters.ts');
const { validateTimelineParameterTree } = await load('parameter-binding.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const scalar = (id, nameForReference = id) => ({ id, nameForReference, dataType: { kind: 'scalar' }, ui: { label: id, control: { controlType: 'number' } }, defaultValue: literal(0), canNode: false });
const layer = (id, customParameterDefs = [], customParameterValues = {}, layers = []) => ({ id, name: id, layerType: 'group', layers, automationGraphs: [], customParameterDefs, customParameterValues });
const reference = (layerId, parameterId) => ({ inputSource: 'timelineLayerCustomParameterReference', layerId, parameterId });
const evaluator = new TimelineParameterBindingEvaluator();
function evaluate(layers, owner, binding, time = 0, definition = scalar('target')) {
	const context = getTimelineLayerCustomParameterContext(layers, owner.id);
	return evaluator.evaluate(binding, createTimelineLayerEvaluationScope({ time, isExport: true, automationGraphs: owner.automationGraphs, customParameters: context }), -1, definition);
}

// 【通常の式は自身だけ、カスタムパラメータの式は直接の親だけを参照する】
// 同名の定義が階層に並んでも、所有レイヤーの環境で評価を進めれば循環せず値を加工できる。
test('resolves PARAM in the owning layer and forwards only from the immediate parent', () => {
	const child = layer('child', [scalar('child-speed', 'speed')], { 'child-speed': expression('PARAM("speed") * 3') });
	const parent = layer('parent', [scalar('parent-speed', 'speed')], { 'parent-speed': expression('PARAM("speed") + 1') }, [child]);
	const root = layer('root', [scalar('root-speed', 'speed')], { 'root-speed': literal(2) }, [parent]);
	assert.equal(evaluate([root], child, expression('PARAM("speed")')), 9);
	assert.equal(evaluate([root], parent, expression('PARAM("speed")')), 3);
	assert.equal(evaluate([root], root, expression('PARAM("speed")')), 2);
});

// 【直接の親に定義がなければ祖父母の同名定義を自動探索しない】
// 自身の別カスタムパラメータも不可とし、暗黙の継承や同一レイヤー内の循環を作らない。
test('does not search grandparents or siblings for expression names', () => {
	const child = layer('child', [scalar('speed'), scalar('local')], { speed: expression('PARAM("local")'), local: literal(10) });
	const parent = layer('parent', [], {}, [child]);
	const root = layer('root', [scalar('local')], { local: literal(2) }, [parent]);
	assert.throws(() => evaluate([root], child, expression('PARAM("speed")')), /Unknown or unavailable/);
	child.customParameterDefs = [];
	assert.throws(() => evaluate([root], child, expression('PARAM("local")')), /Unknown or unavailable/);
});

// 【直接参照は祖先を選べるがカスタムパラメータの値から自身へは戻れない】
// 明示したIDは名前探索と異なる範囲を持ち、間のレイヤーで受け渡す定義がなくても利用できる。
test('allows explicit ancestor references and excludes self references in custom values', () => {
	const child = layer('child', [scalar('forward')], { forward: reference('root', 'speed') });
	const parent = layer('parent', [], {}, [child]);
	const root = layer('root', [scalar('speed')], { speed: literal(7) }, [parent]);
	assert.equal(evaluate([root], child, reference('root', 'speed')), 7);
	assert.equal(evaluate([root], child, reference('child', 'forward')), 7);
	const context = getTimelineLayerCustomParameterContext([root], child.id);
	assert.deepEqual(getTimelineLayerCustomParameterSources(context, true).map(source => source.id), ['parent', 'root']);
	child.customParameterValues.forward = reference('child', 'forward');
	assert.equal(evaluate([root], child, expression('PARAM("forward")')), 0);
});

// 【参照先の名前変更・削除・階層移動で別の同名定義へ切り替えない】
// 参照情報を保存したまま既定値を使うため、元の定義や階層を復元すれば同じ接続へ戻れる。
test('retains explicit identity across renaming and unresolved references', () => {
	const child = layer('child');
	const root = layer('root', [scalar('speed')], { speed: literal(5) }, [child]);
	const binding = reference(root.id, 'speed');
	root.customParameterDefs[0].nameForReference = 'renamed';
	assert.equal(evaluate([root], child, binding), 5);
	root.layers = [];
	assert.equal(evaluate([root, child], child, binding), 0);
	root.layers = [child];
	assert.equal(evaluate([root], child, binding), 5);
	assert.deepEqual(binding, reference('root', 'speed'));
});

// 【親のカスタムパラメータは親の時計・ローカルグラフ・加工式で評価する】
// 子の同名グラフや変数で親の値が変化せず、シーク順によらず現在時刻の値を再計算する。
test('uses owner graphs and scene time and does not retain values across seeks', () => {
	const graph = value => ({ id: 'graph', nameForReference: 'motion', isNormalized: false, points: [{ id: 'point', x: 0, y: value, handleLeft: null, handleRight: null }] });
	const child = layer('child');
	const parent = layer('parent', [scalar('speed')], { speed: { ...expression('GRAPH("motion", TIME_MS, "clamp") + TIME'), expressionModifier: { enabled: true, code: 'VALUE * 2' } } }, [child]);
	parent.automationGraphs = [graph(3)];
	child.automationGraphs = [graph(99)];
	assert.equal(evaluate([parent], child, reference('parent', 'speed'), 1000), 8);
	assert.equal(evaluate([parent], child, reference('parent', 'speed'), 250), 6.5);
	assert.equal(evaluate([parent], child, reference('parent', 'speed'), 1000), 8);
});

// 【名前参照から得た配列を式で変更しても保存値へ漏らさない】
// 複数の利用者が同じ色を参照する際に、先の式の変更が後の利用者へ影響することを防ぐ。
test('copies referenced values and validates explicit reference types', () => {
	const definition = { ...scalar('color'), dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: literal([1, 0, 0, 1]) };
	const owner = layer('owner', [definition]);
	assert.deepEqual(evaluate([owner], owner, expression('let color = PARAM("color")\ncolor[0] = 0\ncolor'), 0, definition), [0, 0, 0, 1]);
	assert.deepEqual(definition.defaultValue.value, [1, 0, 0, 1]);
	assert.throws(() => evaluate([owner], owner, reference('owner', 'color')), /type mismatch/);
});

// 【レイヤー内の参照名を一意にし、Visual Module固有の入力は許可しない】
// Timelineの定義・BindingがVisual Moduleの公開入力やノード接続へ依存しないことを保証する。
test('validates local definitions and keeps timeline references separate from Visual Module', () => {
	assert.throws(() => validateTimelineLayerCustomParameterDefinitions([scalar('one', 'speed'), scalar('two', 'speed')]), /reference name/);
	assert.throws(() => validateTimelineLayerCustomParameterDefinitions([{ ...scalar('one'), canNode: true }]), /node inputs/);
	assert.doesNotThrow(() => validateTimelineParameterTree(scalar('one'), reference(null, null)));
	assert.throws(() => validateTimelineParameterTree(scalar('one'), { inputSource: 'visualModuleCustomParameterReference', parameterId: 'one' }), /Unsupported/);
	const root = layer('root', [scalar('one')], { one: expression('PARAM("one")') });
	assert.throws(() => evaluate([root], root, expression('PARAM("one")')), /Unknown or unavailable/);
	assert.throws(() => evaluate([root], root, expression('PARAM(1)')), /requires a parameter name/);
});

// 【未選択・削除済みの直接参照は定義の既定値へ戻し、enumでも不正なnullを返さない】
// 参照方式へ切り替えてから候補を選ぶまでの正常な未設定状態でプレビューを失敗させない。
test('uses definition defaults for unselected references including enum values', () => {
	const owner = layer('owner');
	const definition = { ...scalar('direction'), dataType: { kind: 'enum', options: ['left', 'right'] }, ui: { label: 'Direction', control: { labels: {} } }, defaultValue: literal('right') };
	assert.equal(evaluate([owner], owner, reference(null, null), 0, definition), 'right');
	assert.equal(evaluate([owner], owner, reference('removed', 'direction'), 0, definition), 'right');
	assert.throws(() => validateTimelineLayerCustomParameterDefinitions([{ ...definition, dataType: { kind: 'enum', options: ['left', 'left'] } }]), /non-empty and unique/);
});
