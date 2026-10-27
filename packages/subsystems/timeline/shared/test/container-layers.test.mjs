import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = name => loadSource(fileURLToPath(new URL('../src/' + name, import.meta.url)));
const { createTimelineContainerLayer, convertTimelineContainerLayer, getTimelineContainerConversionTargets } = await load('container-layer.ts');
const { createTimelineLayerCustomParameterContextIndex, getTimelineLayerCustomParameterContext } = await load('custom-parameters.ts');
const { TimelineParameterBindingEvaluator } = await load('parameter-binding-evaluator.ts');
const { createTimelineLayerEvaluationScope } = await load('evaluation-scope.ts');
const { getTimelineLayerMaskSources, getTimelineLayerOutputDependencyGraph } = await load('layer-output.ts');
const { getSceneAudioClips } = await load('scene-audio.ts');
const { getActiveTimelineCamera } = await load('scene-camera.ts');
const { getSceneDuration } = await load('scenes.ts');
const { getTimelineRenderLayers } = await load('layer-tree.ts');
const literal = value => ({ inputSource: 'literal', value });
const scalar = id => ({ id, nameForReference: id, dataType: { kind: 'scalar' }, ui: { label: id, control: { controlType: 'number' } }, defaultValue: literal(0) });
const container = type => createTimelineContainerLayer(type, type, type);
const sound = () => ({ id: 'sound', layerType: 'audio', name: 'Sound', isDisabled: false, automationGraphs: [], audioParamValues: { volume: literal(1) }, clips: [{ id: 'clip', startMs: 100, durationMs: 200, sourceInMs: 0, sourceOutMs: 200, playbackRate: 1, loop: false, assetId: 'asset' }] });

// 【整理用コンテナだけを表示順に展開し、無効な枝と描画境界の内側を結果へ混ぜない】
// 結果配列への直接追加に変更しても、Group/Transformの子は各レンダラーが扱い、
// 通常レイヤー自身の無効化は従来どおり描画側で判定する必要がある。
test('collects render layers in order without crossing render boundaries or mutating the tree', () => {
	const image = id => ({ id, layerType: 'image', isDisabled: false, clips: [] });
	const top = image('top');
	const middle = image('middle');
	const bottom = { ...image('bottom'), isDisabled: true };
	const group = container('group');
	group.layers = [image('group-child')];
	const transform = container('transform');
	transform.isDisabled = true;
	transform.layers = [image('transform-child')];
	const disabledFolder = container('folder');
	disabledFolder.id = 'disabled-folder';
	disabledFolder.isDisabled = true;
	disabledFolder.layers = [image('hidden')];
	const parameters = container('parameterContainer');
	parameters.layers = [middle, disabledFolder, group, transform];
	const folder = container('folder');
	folder.layers = [parameters];
	const layers = [top, folder, sound(), { id: 'camera', layerType: 'camera' }, bottom];
	const snapshot = globalThis.structuredClone(layers);
	assert.deepEqual(getTimelineRenderLayers(layers), [top, middle, group, transform, bottom]);
	assert.deepEqual(layers, snapshot);
});

// 【フォルダには描画設定もパラメータ設定も持たせず、パラメータコンテナにも画像や音量を持たせない】
// UIで非表示にするだけでは保存時に作用が紛れ込むため、生成するデータ自体の責務を分ける。
test('creates organizing containers with only their supported capabilities', () => {
	const folder = container('folder');
	const parameters = container('parameterContainer');
	for (const key of ['automationGraphs', 'customParameterDefs', 'customParameterValues', 'compositingParamValues', 'audioParamValues', 'transformParamValues', 'forceDisableMotionBlur']) assert.equal(Object.hasOwn(folder, key), false);
	assert.deepEqual(parameters.automationGraphs, []);
	for (const key of ['compositingParamValues', 'audioParamValues', 'transformParamValues', 'forceDisableMotionBlur']) assert.equal(Object.hasOwn(parameters, key), false);
});

// 【変換は機能を追加する6方向だけ許可し、ID・子・定義・保存Bindingを維持する】
// 変換で参照先が変わったり、式・キーをその時点の評価値へ焼き付けたりしないことを確認する。
test('converts only in the allowed directions and preserves identity and saved bindings', () => {
	const expected = { folder: ['parameterContainer', 'transform', 'group'], parameterContainer: ['transform', 'group'], transform: ['group'], group: [] };
	for (const type of Object.keys(expected)) {
		const source = container(type);
		source.color = [0.2, 0.3, 0.4, 1];
		source.isDisabled = true;
		source.layers = [sound()];
		if (type !== 'folder') {
			source.customParameterDefs = [scalar('speed')];
			source.customParameterValues = { speed: { inputSource: 'expression', expression: 'TIME', expressionModifier: { enabled: true, code: 'VALUE * 2' } } };
		}
		assert.deepEqual(getTimelineContainerConversionTargets(source), expected[type]);
		for (const target of Object.keys(expected)) {
			if (!expected[type].includes(target)) { assert.throws(() => convertTimelineContainerLayer(source, target), /Unsupported/); continue; }
			const result = convertTimelineContainerLayer(source, target);
			assert.equal(result.id, source.id);
			assert.equal(result.name, source.name);
			assert.deepEqual(result.color, source.color);
			assert.equal(result.isDisabled, true);
			assert.equal(result.layers, source.layers);
			if (type !== 'folder') assert.deepEqual(result.customParameterValues, source.customParameterValues);
			if (target === 'group') assert.equal(result.compositingMode, 'flat');
		}
	}
	const transform = container('transform');
	transform.forceDisableMotionBlur = true;
	transform.transformParamValues.z = { inputSource: 'expression', expression: 'TIME', expressionModifier: { enabled: true, code: 'VALUE + 1' } };
	const group = convertTimelineContainerLayer(transform, 'group');
	assert.deepEqual(group.compositingParamValues.depth, transform.transformParamValues.z);
	assert.deepEqual(group.compositingParamValues.position, transform.transformParamValues.position);
	assert.equal(group.forceDisableMotionBlur, true);
	assert.equal(Object.hasOwn(group, 'transformParamValues'), false);
});

// 【フォルダはPARAMの親探索を透過し、空のパラメータコンテナはスコープを作る】
// 整理だけで既存の式を壊さず、明示的なスコープの追加では外側の定義へ暗黙にフォールバックしない。
test('skips folders in parameter scope and stops at empty parameter containers', () => {
	const parent = container('transform');
	parent.customParameterDefs = [scalar('speed')];
	parent.customParameterValues = { speed: literal(4) };
	const folder = container('folder');
	const child = container('parameterContainer');
	child.id = 'child';
	child.customParameterDefs = [scalar('speed')];
	child.customParameterValues = { speed: { inputSource: 'expression', expression: 'PARAM("speed") * 2' } };
	folder.layers = [child];
	parent.layers = [folder];
	const read = () => new TimelineParameterBindingEvaluator().evaluate({ inputSource: 'expression', expression: 'PARAM("speed")' }, createTimelineLayerEvaluationScope({ time: 100, isExport: false, automationGraphs: [], customParameters: getTimelineLayerCustomParameterContext([parent], child.id) }), 0, scalar('result'));
	const index = createTimelineLayerCustomParameterContextIndex([parent]);
	assert.equal(index.has(folder.id), false);
	assert.deepEqual(index.get(child.id).ancestors.map(owner => owner.id), [parent.id]);
	assert.deepEqual(index.get(child.id), getTimelineLayerCustomParameterContext([parent], child.id));
	assert.equal(read(), 8);
	const empty = container('parameterContainer');
	empty.id = 'empty';
	empty.layers = folder.layers;
	folder.layers = [empty];
	assert.throws(read, /Unknown or unavailable/);
});

// 【描画・音声・カメラ・参照境界を新しいコンテナで変更せず、無効化だけを子孫へ適用する】
// フォルダへ入れたことでマスク候補が消えたり、カメラや素材音声が見つからなくなる退行を防ぐ。
test('passes masks audio and cameras through organizing containers while honoring disabled ancestors', () => {
	const folder = container('folder');
	const parameters = container('parameterContainer');
	const image = { id: 'image', name: 'Image', layerType: 'image', isDisabled: false, clips: [], layerMask: null, automationGraphs: [], isIncludedInComposite: true };
	const background = { ...image, id: 'background' };
	const camera = { id: 'camera', layerType: 'camera', isDisabled: false, forceDisableMotionBlur: false, clips: [{ id: 'clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] };
	parameters.layers = [image, camera, sound()];
	folder.layers = [parameters];
	const layers = [folder, background];
	assert.deepEqual(getTimelineLayerMaskSources(layers, image.id).map(source => source.id), [background.id]);
	assert.deepEqual(getTimelineLayerOutputDependencyGraph(layers, () => []), getTimelineLayerOutputDependencyGraph([image, background], () => []));
	assert.equal(getActiveTimelineCamera(layers, 100).layer.id, camera.id);
	const scene = { id: 'scene', layers };
	assert.equal(getSceneDuration(scene), 1000);
	assert.equal(getSceneAudioClips([scene], scene.id).length, 1);
	folder.isDisabled = true;
	assert.equal(getActiveTimelineCamera(layers, 100), null);
	assert.deepEqual(getSceneAudioClips([scene], scene.id), []);
	assert.equal(parameters.isDisabled, false);
});
