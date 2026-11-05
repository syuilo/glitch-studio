import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { decode, encode } from '@msgpack/msgpack';
import { build } from 'esbuild';

const bundle = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	entryPoints: ['./src/gsproj.ts'],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { decodeProjectFile, encodeProjectFile } = module.exports;

const literal = value => ({ inputSource: 'literal', value });
const timelineReference = (layerId = 'parent', parameterId = 'parameter-id') => ({ inputSource: 'timelineLayerCustomParameterReference', layerId, parameterId });
const createParameterDefinition = () => ({
	id: 'parameter-id', nameForReference: 'my_param',
	dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'number' } },
	defaultValue: literal(0), canNode: false,
});
const createParameterContainer = (id, overrides = {}) => ({
	id, name: id, layerType: 'parameterContainer', automationGraphs: [], layers: [], ...overrides,
});
const createStoredProject = (layers = [], visualModules = []) => ({
	id: 'project', gsVersion: '2.0.0-alpha.34', name: 'Project', description: '', author: '',
	automationGraphs: [], exportSettings: null, timelineFps: 60,
	timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
	resolution: { width: 640, height: 480 }, assets: [], generatedSpeech: [], players: [], visualModules,
	timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers }],
});

// 【旧フィールドを持つプロジェクトを読み込み、公開パラメータの定義・値・参照を保って再保存する】
// 同じgsVersionで保存されたファイルも存在するため、バージョン番号ではなく保存内容で変換する。
// Folder・Group・Transformの内側や別Sceneも対象とし、再保存後は旧フィールドが復活しないことを確認する。
test('migrates stored layer parameters across nested containers and scenes and saves the current format', async () => {
	const definition = createParameterDefinition();
	const child = createParameterContainer('child', {
		customParameterDefs: [definition], customParameterValues: { 'parameter-id': timelineReference() },
	});
	const transform = { ...createParameterContainer('transform'), layerType: 'transform', layers: [child] };
	const group = { ...createParameterContainer('group'), layerType: 'group', layers: [transform] };
	const parent = createParameterContainer('parent', {
		customParameterDefs: [definition], customParameterValues: { 'parameter-id': literal(0.75) }, layers: [group],
	});
	const folder = { id: 'folder', name: 'Folder', layerType: 'folder', layers: [parent] };
	const stored = createStoredProject([folder]);
	stored.timelineScenes.push({ id: 'other-scene', name: 'Other', resolution: { mode: 'project' }, layers: [
		createParameterContainer('other', { customParameterDefs: [], customParameterValues: {} }),
	] });
	stored.assets.push({ id: 'asset', name: 'Original bytes', fileDataType: 'application/octet-stream', fileData: new Uint8Array([0, 128, 255]) });
	const restored = decodeProjectFile(encode(stored), stored.gsVersion);
	const restoredFolder = restored.timelineScenes[0].layers[0];
	const restoredParent = restoredFolder.layers[0];
	const restoredChild = restoredParent.layers[0].layers[0].layers[0];
	assert.deepEqual(restoredParent.publicParameterDefs, [definition]);
	assert.deepEqual(restoredParent.publicParameterValues, { 'parameter-id': literal(0.75) });
	assert.deepEqual(restoredChild.publicParameterValues['parameter-id'], {
		...timelineReference(), inputSource: 'timelineLayerPublicParameterReference',
	});
	for (const layer of [restoredParent, restoredChild, restored.timelineScenes[1].layers[0]]) {
		assert.equal(Object.hasOwn(layer, 'customParameterDefs'), false);
		assert.equal(Object.hasOwn(layer, 'customParameterValues'), false);
	}
	assert.equal(Object.hasOwn(restoredFolder, 'publicParameterDefs'), false);
	assert.deepEqual(new Uint8Array(await restored.assets[0].fileData.arrayBuffer()), stored.assets[0].fileData);
	const saved = await encodeProjectFile(restored);
	assert.deepEqual(decode(saved).timelineScenes, restored.timelineScenes);
	assert.deepEqual(decodeProjectFile(saved).timelineScenes, restored.timelineScenes);
});

function createVisualModule(id) {
	return {
		id, name: id, automationGraphs: [], outputDefs: [], primaryOutputId: null, primaryInputId: null,
		paramDefs: [{ ...createParameterDefinition(), nameForReference: 'customParameterValues', ui: { label: 'Custom Parameter', control: {} } }],
		nodes: [{
			id: 'node', type: 'effect', effectId: 'fill', resolution: { mode: 'auto', scale: 1 },
			staticSettings: { inputSource: 'visualModuleCustomParameterReference' },
			params: {
				direct: { inputSource: 'visualModuleCustomParameterReference', parameterId: 'parameter-id' },
				previousFormat: { inputSource: 'externalCustomParameterInput', parameterId: 'parameter-id' },
				nested: literal([{ id: 'element', binding: literal({
					input: { inputSource: 'visualModuleCustomParameterReference', parameterId: 'parameter-id' },
				}) }]),
				customParameterDefs: literal('visualModuleCustomParameterReference'),
				expression: { inputSource: 'expression', expression: 'PARAM("customParameterValues")' },
			},
		}],
	};
}

// 【通常とインラインのVisual Moduleで旧参照を変換し、配列・構造体の子も取りこぼさない】
// リネーム前から残っていたexternalCustomParameterInputも、同じ公開パラメータ参照へ変換する。
// パラメータ名・参照名・表示名・式・literal文字列・静的設定は、旧名称を含んでもユーザーのデータとして保持する。
test('migrates registered and inline Visual Module references without rewriting user data', () => {
	const registered = createVisualModule('registered');
	const inline = createVisualModule('inline');
	const stored = createStoredProject([{
		id: 'inline-layer', name: 'Inline', layerType: 'inlineVisualModule', automationGraphs: [], clips: [],
		visualModule: inline, visualModuleParamValues: {},
	}], [registered]);
	const restored = decodeProjectFile(encode(stored));
	for (const visualModule of [restored.visualModules[0], restored.timelineScenes[0].layers[0].visualModule]) {
		const node = visualModule.nodes[0];
		const expected = { inputSource: 'visualModulePublicParameterReference', parameterId: 'parameter-id' };
		assert.deepEqual(node.params.direct, expected);
		assert.deepEqual(node.params.previousFormat, expected);
		assert.deepEqual(node.params.nested.value[0].binding.value.input, expected);
		assert.deepEqual(visualModule.paramDefs, registered.paramDefs);
		assert.deepEqual(node.params.customParameterDefs, registered.nodes[0].params.customParameterDefs);
		assert.deepEqual(node.params.expression, registered.nodes[0].params.expression);
		assert.deepEqual(node.staticSettings, registered.nodes[0].staticSettings);
	}
});

for (const [layerType, parameterGroup] of [
	['group', 'compositingParamValues'], ['audio', 'audioParamValues'], ['visualModule', 'visualModuleParamValues'],
	['effect', 'effectParamValues'], ['camera', 'cameraParamValues'], ['transform', 'transformParamValues'],
	['shape', 'shape'], ['text', 'textParamValues'], ['voicevox', 'subtitleParamValues'],
]) {
	// 【各レイヤーの通常パラメータに保存された旧参照を、入れ子も含めて変換する】
	// 公開パラメータの値だけでなく、合成・音量・エフェクト・文字などの利用側も移行しないと
	// 読み込み後に接続が切れる。未選択を表すnullと配列要素IDもそのまま維持する。
	test(`migrates nested timeline references in ${parameterGroup}`, () => {
		const layer = {
			id: 'layer', name: 'Layer', layerType, automationGraphs: [], layers: [],
			effectId: 'fill', resolution: { mode: 'auto', scale: 1 }, visualModuleId: 'registered',
			[parameterGroup]: { input: literal([{ id: 'element', binding: literal({ value: timelineReference(null, null) }) }]) },
		};
		const restored = decodeProjectFile(encode(createStoredProject([layer]))).timelineScenes[0].layers[0];
		assert.deepEqual(restored[parameterGroup].input.value, [{ id: 'element', binding: literal({
			value: { inputSource: 'timelineLayerPublicParameterReference', layerId: null, parameterId: null },
		}) }]);
		assert.equal(Object.hasOwn(restored, 'publicParameterDefs'), false);
		assert.equal(Object.hasOwn(restored, 'publicParameterValues'), false);
	});
}

// 【新形式を優先し、定義と値が別々の形式でも変換を繰り返してデータを上書きしない】
// 空配列・空オブジェクトも明示された新しい設定として扱う。旧フィールドの削除と
// 定義・値それぞれの移行を独立させ、再読込時に古い保存値が復活することを防ぐ。
test('preserves explicit current fields and migrates mixed fields independently and idempotently', async () => {
	const definition = createParameterDefinition();
	const current = createParameterContainer('current', { publicParameterDefs: [definition], publicParameterValues: { 'parameter-id': literal(5) } });
	const mixed = createParameterContainer('mixed', { customParameterDefs: [definition], publicParameterValues: { 'parameter-id': literal(6) } });
	const mixedValues = createParameterContainer('mixed-values', { publicParameterDefs: [definition], customParameterValues: { 'parameter-id': literal(8) } });
	const conflicting = createParameterContainer('conflicting', {
		customParameterDefs: [definition], customParameterValues: { 'parameter-id': literal(7) },
		publicParameterDefs: [], publicParameterValues: {},
	});
	const restored = decodeProjectFile(encode(createStoredProject([current, mixed, mixedValues, conflicting])));
	const [restoredCurrent, restoredMixed, restoredMixedValues, restoredConflicting] = restored.timelineScenes[0].layers;
	assert.deepEqual(restoredCurrent, current);
	assert.deepEqual(restoredMixed.publicParameterDefs, [definition]);
	assert.deepEqual(restoredMixed.publicParameterValues, mixed.publicParameterValues);
	assert.equal(Object.hasOwn(restoredMixed, 'customParameterDefs'), false);
	assert.deepEqual(restoredMixedValues.publicParameterDefs, [definition]);
	assert.deepEqual(restoredMixedValues.publicParameterValues, mixedValues.customParameterValues);
	assert.equal(Object.hasOwn(restoredMixedValues, 'customParameterValues'), false);
	assert.deepEqual(restoredConflicting.publicParameterDefs, []);
	assert.deepEqual(restoredConflicting.publicParameterValues, {});
	assert.equal(Object.hasOwn(restoredConflicting, 'customParameterDefs'), false);
	assert.equal(Object.hasOwn(restoredConflicting, 'customParameterValues'), false);
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(restored)), restored);
});
