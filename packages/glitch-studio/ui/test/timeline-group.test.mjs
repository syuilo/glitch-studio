import { i18nPlugin } from './helpers/i18n.mjs';
import { createDragActionsFixture } from './helpers/timeline-drag-actions.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		export { createTimelineDragActions } from './src/utility/timeline-drag-actions.ts';
		export { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
		export * from './src/utility/timeline-clip-move.ts';
		export * from './src/utility/timeline-container.ts';
		export { createTimelineLayerActions } from './src/utility/timeline-layer-actions.ts';
		export * from '@gs/subsystems_timeline_shared/container-range.ts';
		export * from '@gs/subsystems_timeline_shared/layer-tree.ts';
		export * from '@gs/glitch-studio_shared/project/renderer-state.ts';
		export * from './src/utility/timeline-selection.ts';
		export * from './src/utility/timeline-keyframe-lanes.ts';
		export * from './src/utility/timeline-snapping.ts';
		export * from './src/utility/timeline-scene.ts';
		export { createVoicevoxTimelineLayer } from './src/utility/voicevox-timeline-layer.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { ProjectRenderValidation } from './src/ProjectRenderValidation.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { getTimelineClipMoveBounds, getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
		export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
		export { default as arrayDefinition } from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [i18nPlugin, { name: 'clip-move-dependencies', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', resolveDir: uiDirectory,
			contents: path === 'effects'
				? "import definition from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };"
				: 'export const preferences = { s: { forceTypeSafety: true } };',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, UndoRedo, ProjectRenderValidation, prepareTimelineContainerMove, duplicateTimelineLayers, findTimelineLayer,
	createVoicevoxTimelineLayer, applyRendererProjectChanges, findRendererVisualModule, createTimelineLayerActions } = module.exports;
const literal = value => ({ inputSource: 'literal', value });
const keys = times => ({ inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
	keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false,
		keyframes: times.map(x => ({ id: String(x), x, value: 1, interpolation: { type: 'linear' } })) } });
const sound = (id, start = 1000) => ({ id, name: id, layerType: 'audio', isDisabled: false, automationGraphs: [],
	clips: [{ id: 'clip', startMs: start, durationMs: 500, sourceInMs: 12.25, sourceOutMs: 512.25, playbackRate: 1, loop: false, assetId: 'asset' }], audioParamValues: { volume: keys([100, 2000]) } });
const group = (id, layers = []) => ({ id, name: id, layerType: 'group', layers, isDisabled: false, coordinateSpace: 'screen', automationGraphs: [],
	compositingParamValues: { opacity: keys([200, 3000]) }, audioParamValues: { volume: literal(0.5) } });
function fixture(t, layers) {
	t.mock.method(console, 'log', () => {});
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	return { scene, state, history: new UndoRedo(state, COMMAND_DEFS) };
}

function observeValidation(f) {
	const validation = new ProjectRenderValidation({ ...f.state, players: { value: [] }, resolution: { value: { width: 16, height: 16 } },
		timelineFps: { value: 60 }, timelineMotionBlur: { value: { enabled: false, shutterAngle: 180, samples: 0 } } }, {});
	validation.reset();
	f.history.onChange(changes => validation.update(changes));
	return validation;
}

const customScalar = (id, nameForReference = id) => ({ id, nameForReference, dataType: { kind: 'scalar' }, ui: { label: nameForReference, control: { controlType: 'number' } }, defaultValue: literal(0), canNode: false });

// 【カスタムパラメータの定義・値・削除をUndo/Redoし、Groupの時間移動にもキーを含める】
// 新しい保存先だけを特別扱いすると、履歴やコンテナ移動で定義・値・キーが取り残されてしまう。
test('edits custom definitions and bindings with history and includes custom keyframe lanes', t => {
	const child = group('child');
	const parent = group('parent', [child]);
	const f = fixture(t, [parent]);
	const target = { sceneId: 'scene', layerId: child.id };
	f.history.commit('updateTimelineLayerCustomParameter', { ...target, definition: customScalar('speed') });
	assert.equal(child.customParameterDefs[0].nameForReference, 'speed');
	f.history.undo();
	assert.equal(child.customParameterDefs, undefined);
	f.history.redo();
	f.history.commit('editTimelineLayerParam', { ...target, target: 'customParameter', paramPath: ['speed'], edit: { kind: 'keyframesTimelineInline', value: keys([100, 800]) } });
	assert.equal(module.exports.getLayerKeyframeParameters(f.state, child).find(parameter => parameter.target === 'customParameter').paramPath[0], 'speed');
	assert.deepEqual(prepareTimelineContainerMove(f.state, parent).keyframes.filter(key => key.target === 'customParameter').map(key => key.x), [100, 800]);
	f.history.commit('removeTimelineLayerCustomParameter', { ...target, parameterId: 'speed' });
	assert.deepEqual(child.customParameterDefs, []);
	assert.equal(child.customParameterValues.speed, undefined);
	f.history.undo();
	assert.equal(child.customParameterValues.speed.inputSource, 'keyframesTimelineInline');
	f.history.undo();
	assert.equal(child.customParameterValues, undefined);
	f.history.redo();
	assert.deepEqual(child.customParameterValues.speed.keyframesTimeline.keyframes.map(key => key.x), [100, 800]);
});

// 【直接参照は祖先へ接続できるがカスタムパラメータから自身への接続は保存しない】
// CommandでもUIと同じ範囲を守り、Group複製では内部の参照IDだけを付け替える必要がある。
test('validates custom reference scope and remaps internal references when duplicating groups', t => {
	const child = group('child');
	child.customParameterDefs = [customScalar('forward')];
	const root = group('root', [group('parent', [child])]);
	root.customParameterDefs = [customScalar('speed')];
	root.customParameterValues = { speed: literal(0.25) };
	const f = fixture(t, [root]);
	const target = { sceneId: 'scene', layerId: child.id, target: 'customParameter', paramPath: ['forward'] };
	const reference = { inputSource: 'timelineLayerCustomParameterReference', layerId: root.id, parameterId: 'speed' };
	f.history.commit('editTimelineLayerParam', { ...target, edit: { kind: 'timelineLayerCustomParameterReference', value: reference } });
	f.history.commit('editTimelineLayerParam', { ...target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'timelineLayerCustomParameterReference', value: { ...reference, layerId: child.id, parameterId: 'forward' } } });
	assert.equal(child.compositingParamValues.opacity.layerId, child.id);
	assert.throws(() => COMMAND_DEFS.editTimelineLayerParam.create({ ...target, edit: { kind: 'timelineLayerCustomParameterReference', value: { ...reference, layerId: child.id, parameterId: 'forward' } } }).execute(f.state), /available layer/);
	const [copy] = duplicateTimelineLayers([root]);
	const copiedChild = copy.layers[0].layers[0];
	assert.equal(copiedChild.customParameterValues.forward.layerId, copy.id);
	assert.equal(copiedChild.customParameterValues.forward.parameterId, 'speed');
	assert.equal(copiedChild.compositingParamValues.opacity.layerId, copiedChild.id);
	const [externalCopy] = duplicateTimelineLayers([child]);
	assert.equal(externalCopy.customParameterValues.forward.layerId, root.id);
	f.history.undo();
	f.history.undo();
	assert.equal(child.customParameterValues, undefined);
	f.history.redo();
	assert.deepEqual(child.customParameterValues.forward, reference);
});

// 【マスク参照は複製範囲内だけIDを付け替え、削除のUndoでは元の参照を復元する】
// 対象とマスク元の同時複製が元のマスクを使い続けたり、参照専用の設定が失われる不具合を防ぐ。
test('remaps internal layer masks and preserves references through deletion and undo', t => {
	const source = { ...group('source'), isIncludedInComposite: false, layerMask: null };
	const target = { ...group('target'), isIncludedInComposite: true, layerMask: { sourceLayerId: source.id, channel: 'luminance', inverted: true } };
	const [targetCopy, sourceCopy] = duplicateTimelineLayers([target, source]);
	assert.equal(targetCopy.layerMask.sourceLayerId, sourceCopy.id);
	assert.equal(sourceCopy.isIncludedInComposite, false);
	const [externalCopy] = duplicateTimelineLayers([target]);
	assert.equal(externalCopy.layerMask.sourceLayerId, source.id);
	const f = fixture(t, [target, source]);
	f.history.commit('removeTimelineLayer', { sceneId: f.scene.id, layerId: source.id });
	assert.equal(target.layerMask.sourceLayerId, source.id);
	f.history.undo();
	assert.equal(f.scene.layers[1].id, source.id);
	assert.deepEqual(f.scene.layers[0].layerMask, { sourceLayerId: source.id, channel: 'luminance', inverted: true });
});

// 【マスクの設定と通常描画用のキーを複製・移動でも保持する】
// マスク時に使わないブレンド設定も保存データの一部であり、表示を隠すことを理由に
// Group移動への追従対象や複製対象から外すと、通常描画へ戻した際の動きが変わってしまう。
test('preserves mask settings and inactive blend keys when duplicating or moving a group', () => {
	const layer = group('masked');
	layer.mask = { channel: 'luminance', inverted: true };
	layer.compositingParamValues.blendMode = keys([400, 700]);
	layer.compositingParamValues.blendMode.keyframesTimeline.dataType = { kind: 'blendMode' };
	for (const key of layer.compositingParamValues.blendMode.keyframesTimeline.keyframes) key.value = 'multiply';
	const state = { visualModules: { value: [] } };
	const move = prepareTimelineContainerMove(state, layer);
	assert.deepEqual(move.keyframes.filter(key => key.paramPath[0] === 'blendMode').map(key => key.x), [400, 700]);
	const [copy] = duplicateTimelineLayers([layer]);
	assert.deepEqual(copy.mask, layer.mask);
	assert.notEqual(copy.mask, layer.mask);
	assert.deepEqual(copy.compositingParamValues, layer.compositingParamValues);
	const parameters = module.exports.getLayerKeyframeParameters(state, layer);
	assert.equal(parameters.find(parameter => parameter.paramPath[0] === 'opacity').def.ui.label, 'Mask strength');
});

// 【別Sceneに静的エラーがあっても、階層編集とScene追加を妨げない】
// Commandで全Sceneを再検証すると、無関係なエラーを修正するための操作まで失敗する。
// 診断を保持したまま変更対象だけを検証し、Undo/Redoでも同じ経路を使うことを確認する。
test('edits a tree and adds a scene without revalidating unrelated scene parameters', t => {
	const f = fixture(t, [group('first'), group('second')]);
	const brokenLayer = group('broken-layer');
	brokenLayer.compositingParamValues.opacity = { inputSource: 'node', nodeId: 'missing' };
	f.state.timelineScenes.value.push({ id: 'broken', name: 'Broken', resolution: { mode: 'project' }, layers: [brokenLayer] });
	const validation = observeValidation(f);
	const diagnostic = validation.errorMessage.value;
	assert.match(diagnostic, /Unsupported layer parameter input source/);
	let reads = 0;
	const brokenParameters = brokenLayer.compositingParamValues;
	Object.defineProperty(brokenLayer, 'compositingParamValues', { get() { reads++; return brokenParameters; } });
	f.history.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: ['first', 'second'], group: group('parent') });
	assert.equal(validation.errorMessage.value, diagnostic);
	f.history.undo();
	f.history.redo();
	f.history.commit('addScene', { id: 'added', name: 'Added', resolution: { mode: 'project' }, layers: [] });
	assert.equal(validation.errorMessage.value, diagnostic);
	f.history.undo();
	f.history.redo();
	assert.equal(reads, 0);
	assert.deepEqual(f.scene.layers[0].layers.map(layer => layer.id), ['first', 'second']);
	assert.equal(f.state.timelineScenes.value.at(-1).id, 'added');
});

// 【Scene追加の静的エラーはCommandを拒否せず診断し、Undoで解除する】
// 不正な編集状態もプロジェクトに保持する方針に揃え、検証の入口を二重にしない。
// ID衝突だけはUndoで別Sceneを削除し得るため、追加前に拒否する必要がある。
test('diagnoses added scene settings through validation while rejecting duplicate scene IDs', t => {
	const f = fixture(t, []);
	const validation = observeValidation(f);
	const added = { id: 'added', name: 'Added', resolution: { mode: 'customAbsolute', width: 0, height: 0 }, layers: [] };
	f.history.commit('addScene', added);
	assert.notEqual(validation.errorMessage.value, null);
	assert.equal(f.state.timelineScenes.value.at(-1).id, 'added');
	f.history.undo();
	assert.equal(validation.errorMessage.value, null);
	f.history.redo();
	assert.notEqual(validation.errorMessage.value, null);
	assert.throws(() => f.history.commit('addScene', added), /Duplicate scene ID/);
	assert.equal(f.state.timelineScenes.value.length, 2);
});

function layerMenuFixture(f, ids, overrides = {}) {
	const selection = { value: { kind: 'layers', ids } };
	let menu;
	let active = true;
	const alerts = [];
	const actions = createTimelineLayerActions({
		stateManager: f.history, scene: f.scene, selection, isActive: () => active,
		readLayerMediaDurations: async layer => Object.fromEntries(module.exports.flattenTimelineLayers([layer])
			.filter(child => child.layerType === 'audio').map(child => [child.id, Object.fromEntries(child.clips.map(clip => [clip.id, 5000]))])),
		selectLayer: layer => { selection.value = { kind: 'layers', ids: [layer.id] }; },
		canWrap: () => true, groupSelection: () => {}, transformSelection: () => {}, focusTimeline: () => {},
		ui: { contextMenu: items => { menu = items; }, inputText: async () => ({ canceled: false, result: 'Renamed' }), alert: error => alerts.push(error) },
		...overrides,
	});
	return { selection, alerts, deactivate: () => { active = false; },
		open(id) { actions.showMenu({ button: 2, ctrlKey: true }, findTimelineLayer(f.scene.layers, id)); return menu; },
	};
}

// 【右クリックは複数選択を保持し、未選択の行だけ単独選択へ切り替える】
// 選択済みの行で毎回単独選択すると、メニューからまとめて操作できなくなる。
// クリップ選択中の右クリックもレイヤー操作へ切り替え、Renameは単独選択時だけ出す。
test('keeps selected layers on right click and offers rename only for one layer', t => {
	const f = fixture(t, [group('a'), group('b'), group('c')]);
	const controls = layerMenuFixture(f, ['a', 'b']);
	assert.deepEqual(controls.open('b').map(item => item.id), ['wrapInTransform', 'group', 'duplicate', 'delete']);
	assert.deepEqual(controls.selection.value.ids, ['a', 'b']);
	assert.deepEqual(controls.open('c').map(item => item.id), ['wrapInTransform', 'group', 'rename', 'duplicate', 'delete']);
	assert.deepEqual(controls.selection.value.ids, ['c']);
	controls.selection.value = { kind: 'clips', clips: [{ layerId: 'a', clipId: 'clip' }] };
	controls.open('a');
	assert.deepEqual(controls.selection.value, { kind: 'layers', ids: ['a'] });
});

// 【複数複製は子を二重に作らず、階層・音声参照・一回のUndoを保つ】
// グループと子の同時選択や、別々の選択レイヤーを参照するBindingでも、
// 元の木を変更せずコピー側へ参照を付け替え、Redoで同じIDと配置を再現する。
test('duplicates selected roots together above their sources with one undo', async t => {
	const visual = { id: 'visual', name: 'Visual', layerType: 'visualModule', isDisabled: false, automationGraphs: [],
		clips: [], compositingParamValues: {}, visualModuleId: 'shared', visualModuleParamValues: { audio: { inputSource: 'anotherLayerAudio', layerId: 'audio' } } };
	const f = fixture(t, [group('parent', [sound('audio')]), visual]);
	f.state.assets.value = [{ id: 'asset', fileDataType: 'audio/wav' }];
	const before = structuredClone(f.scene);
	const controls = layerMenuFixture(f, ['audio', 'visual', 'parent']);
	await controls.open('parent').find(item => item.id === 'duplicate').action();
	const [parentCopy, parent, visualCopy, originalVisual] = f.scene.layers;
	assert.equal(parent.id, 'parent');
	assert.equal(originalVisual.id, 'visual');
	assert.equal(parentCopy.layers.length, 1);
	assert.equal(visualCopy.visualModuleParamValues.audio.layerId, parentCopy.layers[0].id);
	assert.notEqual(parentCopy.layers[0].clips[0].id, 'clip');
	assert.deepEqual(parent, before.layers[0]);
	assert.deepEqual(controls.selection.value.ids, [visualCopy.id, parentCopy.id]);
	assert.equal(f.history.undoStack.value.length, 1);
	const after = structuredClone(f.scene);
	f.history.undo(); assert.deepEqual(f.scene, before);
	f.history.redo(); assert.deepEqual(f.scene, after);
});

// 【複数削除は親子の選択順に依存せず、一回で全階層を復元できる】
// 子を先に削除した履歴を個別に残すと、Undo一回で元の状態に戻らない。
test('deletes overlapping parent and child selections atomically', t => {
	const f = fixture(t, [group('parent', [group('child')]), group('outside'), group('keep')]);
	const before = structuredClone(f.scene);
	const controls = layerMenuFixture(f, ['parent', 'child', 'outside']);
	controls.open('child').find(item => item.id === 'delete').action();
	assert.deepEqual(f.scene.layers.map(layer => layer.id), ['keep']);
	assert.deepEqual(controls.selection.value.ids, []);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo(); assert.deepEqual(f.scene, before);
	f.history.redo(); assert.deepEqual(f.scene.layers.map(layer => layer.id), ['keep']);
});

// 【リネームはCommandで記録し、ダイアログ待ちのScene切り替えを無視する】
// 非同期入力が完了した時点で閉じたタイムラインへ変更を適用しない。
test('renames through history and ignores results after the timeline closes', async t => {
	const f = fixture(t, [group('a')]);
	const controls = layerMenuFixture(f, ['a']);
	await controls.open('a').find(item => item.id === 'rename').action();
	assert.equal(f.scene.layers[0].name, 'Renamed');
	f.history.undo(); assert.equal(f.scene.layers[0].name, 'a');
	const pending = controls.open('a').find(item => item.id === 'rename').action();
	controls.deactivate();
	await pending;
	assert.equal(f.scene.layers[0].name, 'a');
	assert.equal(f.history.undoStack.value.length, 0);
});

// 【複製の素材取得に失敗しても、一部だけを挿入せず選択と履歴を維持する】
// 複数選択の途中で失敗した場合に、見えない部分変更を残さない。
test('leaves the tree and history unchanged when duplication fails or becomes stale', async t => {
	const f = fixture(t, [group('a'), group('b')]);
	const before = structuredClone(f.scene);
	const failure = layerMenuFixture(f, ['a', 'b'], { readLayerMediaDurations: async () => { throw new Error('Missing media'); } });
	await failure.open('a').find(item => item.id === 'duplicate').action();
	assert.deepEqual(f.scene, before);
	assert.equal(f.history.undoStack.value.length, 0);
	assert.equal(failure.alerts[0].text, 'Missing media');
	const stale = layerMenuFixture(f, ['a', 'b']);
	const pending = stale.open('a').find(item => item.id === 'duplicate').action();
	f.scene.layers = [...f.scene.layers];
	await pending;
	assert.deepEqual(f.scene, before);
	assert.equal(f.history.undoStack.value.length, 0);
});

// 【複数複製の全素材を検証してから木を適用する】
// 最初の複製が有効でも、後続の素材長が不正なら全体を失敗させる。
test('validates every duplicate before applying the tree', t => {
	const f = fixture(t, [sound('a'), sound('b')]);
	f.state.assets.value = [{ id: 'asset', fileDataType: 'audio/wav' }];
	const copies = duplicateTimelineLayers(f.scene.layers);
	const before = structuredClone(f.scene);
	const sourceDurationsMs = Object.fromEntries(copies.map((layer, index) => [layer.id, { [layer.clips[0].id]: index ? 100 : 5000 }]));
	assert.throws(() => f.history.commit('duplicateTimelineLayers', { sceneId: 'scene',
		layers: copies.map((layer, index) => ({ layer, sourceLayerId: f.scene.layers[index].id })), sourceDurationsMs,
	}), /media duration/);
	assert.deepEqual(f.scene, before);
	assert.equal(f.history.undoStack.value.length, 0);
});

// 【グループの往復ドラッグで区間外のキー・発話・入れ子も一度だけ移動する】
// Scene参照の中身と素材オフセットは維持し、一回のUndo/Redoで最終位置を再現する。
test('moves the entire group including keys outside clips and restores merged drags', t => {
	const speech = createVoicevoxTimelineLayer(500);
	speech.id = 'speech';
	speech.utterances = [{ id: 'utterance', timeMs: 250, text: 'Hello', reading: null, styleId: 7, subtitleDuration: { mode: 'specified', durationMs: 300 } }];
	const placement = { ...sound('placement'), layerType: 'scene', compositingParamValues: {},
		clips: [{ id: 'clip', startMs: 1000, durationMs: 500, contentOffsetMs: 20.5, sceneId: 'child' }] };
	const rootGroup = group('group', [group('nested', [sound('sound'), speech]), placement]);
	const f = fixture(t, [rootGroup, sound('outside', 3000)]);
	const child = { id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [sound('child-audio')] };
	f.state.timelineScenes.value.push(child);
	const before = structuredClone(f.state.timelineScenes.value);
	const initial = prepareTimelineContainerMove(f.state, rootGroup);
	assert.equal(initial.minDelta, -100);
	for (const deltaMs of [1000, 0, -500, 300]) {
		f.history.commit('moveTimelineContainer', { sceneId: 'scene', layerId: 'group', initial, deltaMs }, 'drag');
		if (deltaMs === 0) assert.deepEqual(f.state.timelineScenes.value, before);
	}
	assert.equal(findTimelineLayer(f.scene.layers, 'sound').clips[0].startMs, 1300);
	assert.deepEqual(findTimelineLayer(f.scene.layers, 'sound').audioParamValues.volume.keyframesTimeline.keyframes.map(key => key.x), [400, 2300]);
	assert.equal(findTimelineLayer(f.scene.layers, 'sound').clips[0].sourceInMs, 12.25);
	assert.equal(speech.utterances[0].timeMs, 550);
	assert.equal(speech.utterances[0].subtitleDuration.durationMs, 300);
	assert.equal(placement.clips[0].contentOffsetMs, 20.5);
	assert.deepEqual(child, before[1]);
	assert.equal(f.history.undoStack.value.length, 1);
	const after = structuredClone(f.state.timelineScenes.value);
	for (let i = 0; i < 2; i++) {
		f.history.undo(); assert.deepEqual(f.state.timelineScenes.value, before);
		f.history.redo(); assert.deepEqual(f.state.timelineScenes.value, after);
	}
});

// 【階層操作は兄弟順とIDを保存し、不正な移動では部分変更を残さない】
// グループ自身への移動や非連続選択のグループ化で木を壊さず、解除もUndoできるようにする。
test('groups, reparents and ungroups atomically with stable child IDs', t => {
	const f = fixture(t, [sound('a'), sound('b'), sound('c')]);
	const before = structuredClone(f.scene);
	assert.throws(() => f.history.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: ['a', 'c'], group: group('invalid') }), /consecutive/);
	assert.deepEqual(f.scene, before);
	f.history.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: ['a', 'b'], group: group('group') });
	assert.deepEqual(f.scene.layers[0].layers.map(layer => layer.id), ['a', 'b']);
	f.history.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: ['b'], group: group('nested') });
	const grouped = structuredClone(f.scene);
	assert.throws(() => f.history.commit('moveTimelineLayer', { sceneId: 'scene', layerId: 'group', parentId: 'nested', beforeId: null }), /itself/);
	assert.deepEqual(f.scene, grouped);
	f.history.commit('moveTimelineLayer', { sceneId: 'scene', layerId: 'c', parentId: 'nested', beforeId: 'b' });
	assert.deepEqual(findTimelineLayer(f.scene.layers, 'nested').layers.map(layer => layer.id), ['c', 'b']);
	f.history.undo(); assert.deepEqual(f.scene, grouped);
	f.history.commit('unwrapTimelineLayer', { sceneId: 'scene', layerId: 'group' });
	assert.deepEqual(f.scene.layers.map(layer => layer.id), ['a', 'nested', 'c']);
	f.history.undo(); assert.deepEqual(f.scene, grouped);
});

// 【複製内の音声参照は複製先へ、外部参照は元のIDへ向ける】
// 入れ子のパラメータも対応し、元のグループや共有定義を書き換えない。
test('remaps internal audio references while preserving external references when duplicating', () => {
	const original = group('group', [sound('sound'), group('nested', [{ id: 'visual', name: 'Visual', layerType: 'visualModule',
		isDisabled: false, automationGraphs: [], clips: [], compositingParamValues: {}, visualModuleId: 'shared',
		visualModuleParamValues: { internal: { inputSource: 'anotherLayerAudio', layerId: 'sound' }, external: { inputSource: 'anotherLayerAudio', layerId: 'outside' },
			items: { inputSource: 'array', items: [{ id: 'item', value: { inputSource: 'anotherLayerAudio', layerId: 'group' } }] } },
	}])]);
	const before = structuredClone(original);
	const [copy] = duplicateTimelineLayers([original]);
	const visual = copy.layers[1].layers[0];
	assert.notEqual(copy.id, original.id);
	assert.notEqual(copy.layers[0].clips[0].id, original.layers[0].clips[0].id);
	assert.equal(visual.visualModuleParamValues.internal.layerId, copy.layers[0].id);
	assert.equal(visual.visualModuleParamValues.external.layerId, 'outside');
	assert.equal(visual.visualModuleParamValues.items.items[0].value.layerId, copy.id);
	assert.deepEqual(original, before);
});

// 【子レイヤーへのWorker差分で親や兄弟の状態を壊さない】
// 編集対象の経路だけをコピーし、描画中の古いスナップショットとインライン定義を維持する。
test('applies nested renderer patches without mutating the previous tree', () => {
	const child = sound('sound');
	const visual = { id: 'visual', layerType: 'inlineVisualModule', visualModule: { nodes: [] } };
	const original = { visualModules: [], timelineScenes: [{ id: 'scene', layers: [group('group', [child, visual])] }] };
	const next = applyRendererProjectChanges(original, [{ type: 'layer', sceneId: 'scene', layerId: 'sound', layer: { ...child, isDisabled: true }, changes: [{ type: 'disabled' }] }]);
	assert.equal(findTimelineLayer(original.timelineScenes[0].layers, 'sound').isDisabled, false);
	assert.equal(findTimelineLayer(next.timelineScenes[0].layers, 'sound').isDisabled, true);
	assert.equal(findRendererVisualModule(next, { sceneId: 'scene', inlineVisualModuleLayerId: 'visual' }), visual.visualModule);
	assert.equal(next.timelineScenes[0].layers[0].layers[1], visual);
});

// 【仮クリップのドラッグは開始時の範囲を使い、内部クリップへスナップしない】
// 通常クリップの選択や範囲選択に奪われず、往復ドラッグ・一回のUndoに到達することを確認する。
test('moves virtual group clips through the timeline handler with stable snapping and one undo', async t => {
	const rootGroup = group('group', [sound('inside', 1000)]);
	const outside = sound('outside', 3000);
	const f = fixture(t, [rootGroup, outside]);
	const before = structuredClone(f.scene);
	const controls = createDragActionsFixture(module.exports, f, { currentTime: 4000 });
	controls.actions.onGroupMoveStart({ button: 0, isPrimary: true }, rootGroup);
	const drag = controls.move;
	assert.deepEqual(controls.selection.value, { kind: 'layers', ids: ['group'] });
	assert.ok(drag.points.length > 0);
	assert.equal(drag.times.includes(1000), false);
	assert.equal(drag.times.includes(1500), false);
	assert.ok(drag.times.includes(3000));
	drag.apply(200, 'drag');
	drag.apply(0, 'drag');
	assert.deepEqual(f.scene, before);
	drag.apply(1900, 'drag');
	assert.equal(rootGroup.layers[0].clips[0].startMs, 2900);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.scene, before);
});

// 【追加・貼り付けは子孫IDと素材長まで検証してから一括で適用する】
// グループの直下だけを検証すると、入れ子でIDが衝突したり不正な素材区間を保存してしまう。
test('validates every descendant before adding or pasting a group', t => {
	const f = fixture(t, [sound('existing')]);
	f.state.assets.value = [{ id: 'asset', fileDataType: 'audio/wav' }];
	const before = structuredClone(f.scene);
	for (const command of ['addTimelineLayer', 'pasteTimelineLayer']) {
		const payload = { sceneId: 'scene', sourceLayerId: 'existing', layer: group('new', [group('nested', [sound('existing')])]), sourceDurationsMs: { fresh: { clip: 1000 } } };
		assert.throws(() => f.history.commit(command, payload), /Duplicate layer ID/);
		payload.layer.layers[0].layers[0].id = 'fresh';
		assert.throws(() => f.history.commit(command, { ...payload, sourceDurationsMs: undefined }), /Media duration is required/);
		assert.throws(() => f.history.commit(command, { ...payload, sourceDurationsMs: { fresh: { clip: 100 } } }), /media duration/);
		assert.deepEqual(f.scene, before);
		f.history.commit(command, payload);
		assert.ok(findTimelineLayer(f.scene.layers, 'fresh'));
		f.history.undo();
		assert.deepEqual(f.scene, before);
	}
});

// 【レイヤーをまたいでクリップIDが同じでも、それぞれの素材長で検証する】
// グループ内の別素材に長い方の長さを流用すると、不正な区間を保存できてしまう。
// 短い方で上書きされたために有効な貼り付けが失敗する逆方向の問題も防ぐ。
test('scopes media durations by layer when clip IDs repeat inside groups', t => {
	const f = fixture(t, []);
	f.state.assets.value = ['short-asset', 'long-asset'].map(id => ({ id, fileDataType: 'audio/wav' }));
	const short = sound('short');
	short.clips[0] = { ...short.clips[0], assetId: 'short-asset', sourceInMs: 0, sourceOutMs: 100, playbackRate: 1, loop: false, durationMs: 100 };
	const long = sound('long');
	long.clips[0] = { ...long.clips[0], assetId: 'long-asset', sourceInMs: 0, sourceOutMs: 900, playbackRate: 1, loop: false, durationMs: 900 };
	const root = group('root', [short, group('nested', [long])]);
	const sourceDurationsMs = { short: { clip: 100 }, long: { clip: 1000 } };
	for (const command of ['addTimelineLayer', 'pasteTimelineLayer']) {
		const payload = { sceneId: 'scene', sourceLayerId: 'missing', layer: root, sourceDurationsMs };
		f.history.commit(command, payload);
		assert.deepEqual(f.scene.layers[0], root);
		f.history.undo();
		assert.deepEqual(f.scene.layers, []);
		short.clips[0].durationMs = 101;
		short.clips[0].sourceOutMs = 101;
		assert.throws(() => f.history.commit(command, payload), /Clip exceeds/);
		assert.deepEqual(f.scene.layers, []);
		short.clips[0].durationMs = 100;
		short.clips[0].sourceOutMs = 100;
	}
});

// 【グループの平面化方式だけを変更してUndoで戻す】
// 深度モードの切り替えは子のZや合成設定を書き換えない。解除・再選択したときも、
// 元の値を再利用でき、Redoで同じ階層を保持できることを確認する。
test('changes group depth mode without rewriting descendants', t => {
	const f = fixture(t, [group('group', [sound('audio')])]);
	const descendants = structuredClone(f.scene.layers[0].layers);
	f.history.commit('changeTimelineGroupMode', { sceneId: 'scene', layerId: 'group', mode: 'preserveDepth' });
	assert.equal(f.scene.layers[0].compositingMode, 'preserveDepth');
	assert.deepEqual(f.scene.layers[0].layers, descendants);
	f.history.undo(); assert.equal(f.scene.layers[0].compositingMode, undefined);
	f.history.redo(); assert.equal(f.scene.layers[0].compositingMode, 'preserveDepth');
	assert.deepEqual(f.scene.layers[0].layers, descendants);
});

// 【座標空間の切り替えはZのキーや子レイヤーを保持し、Undo/Redoでもレンダラーへ通知する】
// 画面配置へ戻しても空間配置用のアニメーションを失わないようにする。
// グループと配下の映像レイヤーを独立に変更でき、時間によるBindingは作られない。
test('changes coordinate space independently of animated parameters and descendants', t => {
	const child = createVoicevoxTimelineLayer(0);
	const root = group('root', [child]);
	const f = fixture(t, [root]);
	for (const layer of [root, child]) {
		assert.equal(layer.coordinateSpace, 'screen');
		layer.compositingParamValues.depth = keys([100, 400]);
		const original = structuredClone(layer);
		const notifications = [];
		const unsubscribe = f.history.onChange(changes => notifications.push(changes));
		f.history.commit('setTimelineLayerCoordinateSpace', { sceneId: 'scene', layerId: layer.id, coordinateSpace: 'world' });
		assert.deepEqual(layer, { ...original, coordinateSpace: 'world' });
		f.history.undo();
		assert.deepEqual(layer, original);
		f.history.redo();
		assert.deepEqual(layer, { ...original, coordinateSpace: 'world' });
		assert.deepEqual(notifications, Array.from({ length: 3 }, () => [{ type: 'layer', sceneId: 'scene', layerId: layer.id, changes: [{ type: 'coordinateSpace' }] }]));
		unsubscribe();
	}
});

// 【音声・カメラ・Transformには座標空間の設定を付加しない】
// 映像を平面として合成しないレイヤーへ設定が漏れると、UIと保存形式の責務が曖昧になる。
test('rejects coordinate space changes for nonvisual layers without modifying history', t => {
	for (const layerType of ['audio', 'camera', 'transform']) {
		const layer = { ...sound('layer'), layerType };
		const original = structuredClone(layer);
		const f = fixture(t, [layer]);
		assert.throws(() => f.history.commit('setTimelineLayerCoordinateSpace', { sceneId: 'scene', layerId: layer.id, coordinateSpace: 'world' }), /Coordinate space requires a visual layer/);
		assert.deepEqual(layer, original);
		assert.equal(f.history.undoStack.value.length, 0);
	}
});

// 【Group・Sceneの複製範囲に含まれる画像参照だけを複製先へ付け替える】
// 範囲外の素材まで新IDへ変えると参照切れになり、範囲内を元IDのままにすると複製後も
// 元Groupの素材を読む。公開入力とネストしたEffect入力の両方で同じ規則を維持する。
test('remaps internal image output references while preserving external image sources', () => {
	const reference = (layerId, outputStage) => ({ inputSource: 'anotherLayerOutput', layerId, outputStage });
	const source = group('source');
	const effect = { id: 'effect', layerType: 'effect', clips: [], effectParamValues: { inputs: { inputSource: 'literal', value: [
		{ id: 'first', binding: { ...reference('source', 'rendered'), fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' } },
		{ id: 'second', binding: { ...reference('outside', 'composited'), fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' } },
	] } } };
	const publicLayer = { id: 'public', layerType: 'visualModule', clips: [], visualModuleParamValues: { image: reference('source', 'source') } };
	const original = group('root', [source, effect, publicLayer]);
	const [copy] = duplicateTimelineLayers([original]);
	const [copiedSource, copiedEffect, copiedPublic] = copy.layers;
	assert.notEqual(copiedSource.id, source.id);
	assert.equal(copiedEffect.effectParamValues.inputs.value[0].binding.layerId, copiedSource.id);
	assert.equal(copiedEffect.effectParamValues.inputs.value[1].binding.layerId, 'outside');
	assert.equal(copiedPublic.visualModuleParamValues.image.layerId, copiedSource.id);
	assert.equal(copiedEffect.effectParamValues.inputs.value[0].binding.outputStage, 'rendered');
	assert.equal(original.layers[1].effectParamValues.inputs.value[0].binding.layerId, 'source');
});
