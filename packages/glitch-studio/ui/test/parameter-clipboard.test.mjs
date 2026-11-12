import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export * from './src/utility/parameter-clipboard.ts';
		export * from './src/utility/parameter-clipboard-actions.ts';
		export { clipboardText } from './src/utility/clipboard-text.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { createShapeTimelineLayer } from './src/utility/shape-timeline-layer.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
		export { default as definition } from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'parameter-clipboard-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			contents: path === 'effects'
				? "import definition from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };"
				: 'export const preferences = { s: { forceTypeSafety: true } };', loader: 'ts', resolveDir: uiDirectory,
		}));
	} }],
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
const { createParameterClipboard, parseParameterClipboard, prepareParameterBindingPaste, prepareProjectParameterPaste, resolveProjectClipboardTarget,
	handleProjectParameterClipboard, handlePreviewParameterClipboard, createVisualModuleClipboardSource, clipboardText,
	COMMAND_DEFS, UndoRedo, definition, createShapeTimelineLayer, createInlineKeyframesTimeline } = compiled.exports;
const clone = value => structuredClone(value);

function fixture(projectSessionId = 'session') {
	const makeNode = id => ({ id, type: 'effect', effectId: definition.id, params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, clone(def.defaultValue)])) });
	const node = makeNode('destination');
	const upstream = makeNode('upstream');
	const visualModule = { customParameterDefs: [], customParameterValues: {}, id: 'visualModule', nodes: [node, upstream], automationGraphs: [], paramDefs: [], outputDefs: [] };
	const layer = { id: 'effect', layerType: 'effect', effectId: definition.id, automationGraphs: [], effectParamValues: {} };
	const shape = createShapeTimelineLayer('rectangle', 0);
	shape.id = 'shape';
	const scene = { id: 'scene', layers: [layer, shape] };
	const state = { visualModules: { value: [visualModule] }, timelineScenes: { value: [scene] }, automationGraphs: { value: [] }, players: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const context = { id: 'same-saved-project', isDisposed: false, stateManager: history };
	const target = { kind: 'node', visualModuleTarget: { visualModuleId: visualModule.id }, nodeId: node.id, paramPath: ['foo', 'node'] };
	const timelineTarget = { kind: 'timeline', sceneId: scene.id, layerId: layer.id, parameterTarget: 'effect', paramPath: ['foo', 'node'] };
	const resolve = (requestedTarget = target) => resolveProjectClipboardTarget(state, projectSessionId, requestedTarget);
	const copy = (binding, requestedTarget = target) => {
		const resolved = resolve(requestedTarget);
		return parseParameterClipboard(JSON.stringify(createParameterClipboard(resolved.def, binding, resolved.context.source)));
	};
	return { projectSessionId, node, upstream, visualModule, layer, shape, scene, state, history, context, target, timelineTarget, resolve, copy };
}

const sampling = { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' };
const connected = { inputSource: 'node', nodeId: 'upstream', outputPort: 'output', ...sampling };
const playback = { trimmedDurationMs: null, offsetMode: 'start', wrapMode: 'clamp' };
const scalarDefinition = { dataType: { kind: 'scalar' }, ui: { label: 'Scalar', control: { controlType: 'number' } }, defaultValue: { inputSource: 'literal', value: 0 } };

// 【保存ファイル内のIDが一致する別セッションへノード参照を貼り付けない】
// 同じプロジェクトのコピーを同時に開くと、プロジェクト・Visual Module・ノードのIDが
// すべて一致する。別の内容への誤接続を防ぎつつ、参照を含まない値は引き続き移せる。
test('separates copied project sessions while allowing reference-free values', async t => {
	t.mock.method(console, 'log', () => {});
	const from = fixture('source-session');
	const to = fixture('destination-session');
	assert.equal(from.context.id, to.context.id);
	let text = '';
	const clipboard = { writeText: async value => { text = value; }, readText: async () => text };
	from.node.params.foo.value.node = clone(connected);
	await handleProjectParameterClipboard(from.context, from.projectSessionId, from.target, 'copy', () => true, clipboard);
	assert.equal(JSON.parse(text).source.projectSessionId, from.projectSessionId);
	const before = clone(to.node.params);
	await handleProjectParameterClipboard(to.context, to.projectSessionId, to.target, 'paste', () => true, clipboard);
	assert.deepEqual(to.node.params, before);
	assert.equal(to.history.undoStack.value.length, 0);
	from.node.params.foo.value.node = { inputSource: 'literal', value: [1, 0, 0, 1] };
	await handleProjectParameterClipboard(from.context, from.projectSessionId, from.target, 'copy', () => true, clipboard);
	await handleProjectParameterClipboard(to.context, to.projectSessionId, to.target, 'paste', () => true, clipboard);
	assert.deepEqual(to.node.params.foo.value.node, from.node.params.foo.value.node);
	to.history.undo();
	assert.deepEqual(to.node.params, before);
	to.history.redo();
	assert.deepEqual(to.node.params.foo.value.node, from.node.params.foo.value.node);
});

// 【別名保存でファイルIDが変わっても、同じセッションの参照は有効なままにする】
// OSクリップボードの読み取り待ちに別名保存しても、参照先のオブジェクトは変わらない。
// セッションの寿命と保存ファイルの識別を分離し、不必要に貼り付けを失効させない。
test('preserves references in the same session across Save As during a pending paste', async t => {
	t.mock.method(console, 'log', () => {});
	const f = fixture();
	const text = JSON.stringify(f.copy(connected));
	const reading = Promise.withResolvers();
	const pending = handleProjectParameterClipboard(f.context, f.projectSessionId, f.target, 'paste', () => true, { readText: () => reading.promise });
	f.context.id = 'saved-as';
	reading.resolve(text);
	await pending;
	assert.deepEqual(f.node.params.foo.value.node, connected);
	assert.equal(f.history.undoStack.value.length, 1);
});

// 【Live PreviewのPlayer参照も、同じ保存IDを持つ別セッションへ持ち込まない】
// プレビュー引数はCommandを通らないため、通常パラメータとは別の入口でも
// 実行中のセッションIDを使う必要がある。同一セッションでは別名保存後も適用する。
test('scopes live preview player references to their source session', async () => {
	const from = fixture('source-session');
	const to = fixture('destination-session');
	const definition = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: { inputSource: 'literal', value: null } };
	const binding = { inputSource: 'literal', value: { type: 'player', playerId: 'player' } };
	for (const f of [from, to]) {
		f.visualModule.paramDefs = [{ ...definition, id: 'arg', nameForReference: 'arg' }];
		f.state.players.value.push({ id: 'player' });
	}
	let text = '';
	const clipboard = { writeText: async value => { text = value; }, readText: async () => text };
	await handlePreviewParameterClipboard(from.context, from.projectSessionId, from.visualModule.id, ['arg'], 'copy', () => ({ arg: binding }), () => true, () => {}, clipboard);
	let applied = null;
	const paste = f => handlePreviewParameterClipboard(f.context, f.projectSessionId, f.visualModule.id, ['arg'], 'paste', () => ({}), () => true, (_id, value) => { applied = value; }, clipboard);
	await paste(to);
	assert.equal(applied, null);
	from.context.id = 'saved-as';
	await paste(from);
	assert.deepEqual(applied, binding);
});

// 【カスタム値のコピー・貼り付けと内部参照を、所有Visual Moduleの範囲に限定する】
// 同じIDの別Visual Moduleや外部公開引数へ内部参照を持ち込まず、値の貼り付けはUndoできるようにする。
test('copies custom values with undo and confines custom references to their owning Visual Module', async () => {
	const f = fixture();
	f.visualModule.customParameterDefs = ['source', 'destination'].map(id => ({ ...scalarDefinition, id, nameForReference: id, canNode: false }));
	f.visualModule.customParameterValues = { source: { inputSource: 'expression', expression: 'PUBLIC("speed") * 2', expressionModifier: { enabled: true, code: 'VALUE + TIME' } } };
	const source = { kind: 'customParameter', visualModuleTarget: f.target.visualModuleTarget, paramPath: ['source'] };
	const destination = { ...source, paramPath: ['destination'] };
	let text = '';
	const clipboard = { writeText: async value => { text = value; }, readText: async () => text };
	await handleProjectParameterClipboard(f.context, f.projectSessionId, source, 'copy', () => true, clipboard);
	await handleProjectParameterClipboard(f.context, f.projectSessionId, destination, 'paste', () => true, clipboard);
	assert.deepEqual(f.visualModule.customParameterValues.destination, f.visualModule.customParameterValues.source);
	f.history.undo();
	assert.equal(f.visualModule.customParameterValues.destination, undefined);
	f.history.redo();
	assert.deepEqual(f.visualModule.customParameterValues.destination, f.visualModule.customParameterValues.source);
	const reference = f.copy({ inputSource: 'visualModuleCustomParameterValueReference', parameterId: 'source' }, source);
	const context = f.resolve(destination).context;
	assert.ok(prepareParameterBindingPaste(scalarDefinition, reference, context));
	assert.equal(prepareParameterBindingPaste(scalarDefinition, reference, { ...context, source: { ...context.source, owner: { kind: 'visualModule', target: { visualModuleId: 'other' } } } }), null);
	assert.equal(prepareParameterBindingPaste(scalarDefinition, reference, { ...context, kind: 'preview' }), null);
});

// 【別ウィンドウへのコピーで式・キー・グラフ・加工設定を独立したスナップショットとして保持する】
// コンテナの一部だけを移したり、コピー後の編集がクリップボードを変更すると設定を再現できない。
test('round trips complete nested bindings between projects and renews owned IDs', () => {
	const from = fixture('source-project');
	const to = fixture('destination-project');
	const target = { ...from.target, paramPath: ['buzzs'] };
	const binding = clone(from.node.params.buzzs);
	const fields = binding.value[0].binding.value;
	fields.x = { inputSource: 'expression', expression: 'TIME / 1000', expressionModifier: { enabled: true, code: 'VALUE * 2' } };
	fields.y = createInlineKeyframesTimeline(scalarDefinition);
	fields.y.keyframesTimeline.keyframes[0].x = 123;
	fields.image = { inputSource: 'automationGraphInline', ...playback, automationGraph: { isNormalized: true, points: [
		{ id: 'point', x: 0, y: 1, bezierControlPointA: [0, 0], bezierControlPointB: [1, 1] },
	] } };
	const clipboard = from.copy(binding, target);
	fields.x.expression = '999';
	const update = prepareProjectParameterPaste(to.state, to.projectSessionId, target, clipboard);
	assert.ok(update);
	const copiedFields = update.after.value[0].binding.value;
	assert.equal(copiedFields.x.expression, 'TIME / 1000');
	assert.deepEqual(copiedFields.x.expressionModifier, { enabled: true, code: 'VALUE * 2' });
	assert.equal(copiedFields.y.keyframesTimeline.keyframes[0].x, 123);
	assert.notEqual(update.after.value[0].id, binding.value[0].id);
	assert.notEqual(copiedFields.y.keyframesTimeline.keyframes[0].id, fields.y.keyframesTimeline.keyframes[0].id);
	assert.notEqual(copiedFields.image.automationGraph.points[0].id, 'point');
	assert.deepEqual(to.node.params.buzzs, update.before);
});

// 【型の構造を比較し、壊れたクリップボードと型の取り違えを無視する】
// JSONとして読めるだけでは不十分で、色とベクトル、列挙型の候補、キーの型も区別する。
test('rejects malformed payloads and compares enum, struct, array and any types exactly', () => {
	const f = fixture();
	for (const text of ['', 'hello', '{}', 'null', '{bad']) assert.equal(parseParameterClipboard(text), null);
	const clipboard = f.copy({ inputSource: 'literal', value: [1, 2, 3, 4] });
	const mutations = [
		data => { data.binding.value = [1, 2]; },
		data => { data.source.owner = { kind: 'unknown' }; },
		data => { data.dataType = { kind: 'not-a-type' }; },
		data => { data.binding = { inputSource: 'expression', expression: 1 }; },
		data => { data.binding = { inputSource: 'node', nodeId: 'upstream', outputPort: 'output', fitMode: 'wrong' }; },
	];
	for (const mutate of mutations) { const data = clone(clipboard); mutate(data); assert.equal(parseParameterClipboard(JSON.stringify(data)), null); }
	const destination = f.resolve().context;
	assert.equal(prepareParameterBindingPaste({ ...scalarDefinition, dataType: { kind: 'vector' } }, clipboard, destination), null);
	assert.equal(prepareParameterBindingPaste({ ...scalarDefinition, dataType: { kind: 'any' }, canNode: true }, clipboard, destination), null);
	const enumDef = { ...scalarDefinition, dataType: { kind: 'enum', options: ['a', 'b'] } };
	const enumClipboard = createParameterClipboard(enumDef, { inputSource: 'literal', value: 'a' }, destination.source);
	assert.ok(prepareParameterBindingPaste({ ...enumDef, dataType: { kind: 'enum', options: ['b', 'a'] } }, enumClipboard, destination));
	assert.equal(prepareParameterBindingPaste({ ...enumDef, dataType: { kind: 'enum', options: ['a', 'c'] } }, enumClipboard, destination), null);
	const arrayClipboard = f.copy(f.node.params.buzzs, { ...f.target, paramPath: ['buzzs'] });
	const arrayDef = clone(definition.paramDefs.buzzs);
	arrayDef.maxElements = 0;
	assert.equal(prepareParameterBindingPaste(arrayDef, arrayClipboard, destination), null);
	arrayDef.maxElements = 10;
	arrayDef.dataType.elementType.fields.x = { kind: 'bool' };
	assert.equal(prepareParameterBindingPaste(arrayDef, arrayClipboard, destination), null);
});

// 【参照先の所有者と接続可能性を検査し、サンプリング設定を維持する】
// 別プロジェクトの同名IDや、同じVisual Module内でも自分自身・型違いのポートへ接続しない。
test('preserves connections only in their original available visual module scope', () => {
	const f = fixture();
	const clipboard = f.copy(connected);
	assert.deepEqual(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, clipboard).after.value.node, connected);
	assert.equal(prepareProjectParameterPaste(f.state, 'other-project', f.target, clipboard), null);
	const otherVisualModule = { ...f.visualModule, id: 'otherVisualModule' };
	f.state.visualModules.value.push(otherVisualModule);
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, { ...f.target, visualModuleTarget: { visualModuleId: otherVisualModule.id } }, clipboard), null);
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, { ...f.target, nodeId: 'upstream' }, clipboard), null);
	for (const outputPort of ['missing', 'output2']) {
		assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, f.copy({ ...connected, outputPort })), null);
	}
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, f.copy({ ...connected, nodeId: 'missing' })), null);
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, { ...f.target, paramPath: ['bars'] }, clipboard), null);
});

// 【ローカルAutomation GraphとプロジェクトAutomation Graphの参照範囲を区別する】
// 同じIDが見つかるだけでは別の定義へ接続してしまうため、コピー時の所有先も保持する。
test('resolves local and project automation graph references in their respective scopes', () => {
	const f = fixture();
	f.visualModule.automationGraphs.push({ id: 'local' });
	f.state.automationGraphs.value.push({ id: 'projectGraph' });
	const local = f.copy({ inputSource: 'automationGraphReference', automationGraphId: 'local', ...playback });
	const project = f.copy({ inputSource: 'automationGraphReference', automationGraphId: 'projectGraph', ...playback });
	assert.ok(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, local));
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.timelineTarget, local), null);
	assert.ok(prepareProjectParameterPaste(f.state, f.projectSessionId, f.timelineTarget, project));
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, project), null);
	const previewContext = { ...f.resolve().context, kind: 'preview' };
	assert.equal(prepareParameterBindingPaste(f.resolve().def, local, previewContext), null);
	assert.ok(prepareParameterBindingPaste(f.resolve().def, project, previewContext));
	assert.equal(prepareProjectParameterPaste(f.state, 'other', f.timelineTarget, project), null);
	f.visualModule.automationGraphs = [];
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, local), null);
});

// 【Timelineのレイヤー参照と相対入力、時刻の制約を保存先で検証する】
// ノード用Bindingや異なるSceneへの参照、正規化したキーの暗黙変換を防ぐ。
test('validates timeline references, relative sampling and absolute keyframe time', () => {
	const f = fixture();
	const reference = { inputSource: 'anotherLayerOutput', layerId: 'shape', outputStage: 'rendered', ...sampling };
	const clipboard = f.copy(reference, f.timelineTarget);
	assert.ok(prepareProjectParameterPaste(f.state, f.projectSessionId, f.timelineTarget, clipboard));
	assert.equal(prepareProjectParameterPaste(f.state, 'other', f.timelineTarget, clipboard), null);
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.target, clipboard), null);
	for (const layerId of ['missing', 'effect']) {
		assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, f.timelineTarget, f.copy({ ...reference, layerId }, f.timelineTarget)), null);
	}
	const relative = f.copy({ inputSource: 'lowerLayerOutput', ...sampling }, f.timelineTarget);
	assert.ok(prepareProjectParameterPaste(f.state, 'other', f.timelineTarget, relative));
	const scalarTarget = { ...f.timelineTarget, paramPath: ['buzzs', 'first', 'x'] };
	const keys = createInlineKeyframesTimeline(scalarDefinition);
	keys.keyframesTimeline.keyframes[0].x = 100;
	assert.ok(prepareProjectParameterPaste(f.state, f.projectSessionId, scalarTarget, f.copy(keys, scalarTarget)));
	keys.keyframesTimeline.isNormalized = true;
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, scalarTarget, f.copy(keys, scalarTarget)), null);
});

// 【配列内の一箇所でも参照が無効なら、コンテナ全体を変更しない】
// 部分的な貼り付けでは、複数のパラメータを組み合わせた設定を再現できない。
test('rejects a whole container when one nested binding is incompatible', () => {
	const f = fixture();
	const target = { ...f.target, paramPath: ['buzzs'] };
	const binding = clone(f.node.params.buzzs);
	binding.value[0].binding.value.x = { inputSource: 'expression', expression: '123' };
	binding.value[0].binding.value.image = { ...connected, nodeId: 'missing' };
	const before = clone(f.node.params);
	assert.equal(prepareProjectParameterPaste(f.state, f.projectSessionId, target, f.copy(binding, target)), null);
	assert.deepEqual(f.node.params, before);
});

// 【公開パラメータは所有者・型・参照可能な階層を満たす場合だけ貼り付ける】
// 同名IDの別定義や、祖先以外のレイヤー、自分の公開パラメータ値への参照を持ち込まない。
test('validates public parameter references against their destination types and visible owners', () => {
	const f = fixture();
	const definition = { ...scalarDefinition, id: 'public_parameter', nameForReference: 'public_parameter', canNode: false };
	f.visualModule.paramDefs.push(definition);
	const nodeContext = f.resolve().context;
	const reference = createParameterClipboard(scalarDefinition, { inputSource: 'visualModulePublicParameterReference', parameterId: 'public_parameter' }, nodeContext.source);
	assert.ok(prepareParameterBindingPaste(scalarDefinition, reference, nodeContext));
	assert.equal(prepareParameterBindingPaste(f.resolve().def, { ...reference, dataType: f.resolve().def.dataType }, nodeContext), null);
	f.visualModule.paramDefs = [];
	assert.equal(prepareParameterBindingPaste(scalarDefinition, reference, nodeContext), null);
	f.layer.publicParameterDefs = [definition];
	const timelineContext = f.resolve(f.timelineTarget).context;
	const timelineReference = createParameterClipboard(scalarDefinition, { inputSource: 'timelineLayerPublicParameterReference', layerId: f.layer.id, parameterId: 'public_parameter' }, timelineContext.source);
	assert.ok(prepareParameterBindingPaste(scalarDefinition, timelineReference, timelineContext));
	assert.equal(prepareParameterBindingPaste(scalarDefinition, timelineReference, { ...timelineContext, parameterTarget: 'publicParameter' }), null);
	assert.equal(prepareParameterBindingPaste(scalarDefinition, timelineReference, f.resolve({ ...f.timelineTarget, layerId: f.shape.id, parameterTarget: 'compositing', paramPath: ['opacity'] }).context), null);
});

// 【Playerと音声レイヤーの参照を検証し、下位音声入力は貼り付け先の相対入力として扱う】
// 音声は同じaudioSource型でもVisual ModuleとTimelineで取得元の契約が異なる。
test('validates player and timeline audio inputs without transferring project resources', () => {
	const f = fixture();
	const definition = { dataType: { kind: 'audioSource' }, ui: { label: 'Audio', control: {} }, defaultValue: { inputSource: 'literal', value: null } };
	const nodeContext = f.resolve().context;
	f.state.players.value.push({ id: 'player' });
	const player = createParameterClipboard(definition, { inputSource: 'literal', value: { type: 'player', playerId: 'player' } }, nodeContext.source);
	assert.ok(prepareParameterBindingPaste(definition, player, nodeContext));
	assert.equal(prepareParameterBindingPaste(definition, player, { ...nodeContext, source: { ...nodeContext.source, projectSessionId: 'other' } }), null);
	f.state.players.value = [];
	assert.equal(prepareParameterBindingPaste(definition, player, nodeContext), null);
	const timelineContext = f.resolve(f.timelineTarget).context;
	assert.equal(prepareParameterBindingPaste(definition, player, timelineContext), null);
	f.scene.layers.push({ id: 'audio', layerType: 'audio' });
	const audio = createParameterClipboard(definition, { inputSource: 'anotherLayerAudio', layerId: 'audio' }, timelineContext.source);
	assert.ok(prepareParameterBindingPaste(definition, audio, timelineContext));
	assert.equal(prepareParameterBindingPaste(definition, audio, { ...timelineContext, source: { ...timelineContext.source, projectSessionId: 'other' } }), null);
	const lower = createParameterClipboard(definition, { inputSource: 'lowerLayerAudio' }, timelineContext.source);
	assert.ok(prepareParameterBindingPaste(definition, lower, { ...timelineContext, source: { ...timelineContext.source, projectSessionId: 'other' } }));
});

// 【未設定のカメラ値も、表示中のSceneの縦横比に対応する既定値をコピーする】
// 正方形用の定義の既定値をコピーすると、横長Sceneで貼り付けた際にカメラの位置が変わる。
test('copies an unset camera distance using the owning scene resolution', () => {
	const f = fixture();
	f.state.resolution = { value: { width: 200, height: 100 } };
	f.scene.resolution = { mode: 'project' };
	f.scene.layers.push({ id: 'camera', layerType: 'camera', automationGraphs: [], cameraParamValues: {} });
	const resolved = f.resolve({ ...f.timelineTarget, layerId: 'camera', parameterTarget: 'camera', paramPath: ['z'] });
	assert.equal(resolved.value.value, 0.5 / Math.tan(Math.PI / 8) / 2);
	assert.equal(resolved.before, null);
});

// 【ペーストを一操作として戻し、未設定状態と確定済みのIDをUndo/Redoで復元する】
// 加工式の残留や、RedoごとのID再発行、未編集の引数を保存値として残す問題を防ぐ。
test('replaces modifiers and restores absent roots and stable IDs through undo and redo', async t => {
	t.mock.method(console, 'log', () => {});
	const f = fixture();
	f.node.params.foo.value.node.expressionModifier = { enabled: true, code: 'VALUE * 9' };
	const clipboard = f.copy({ inputSource: 'literal', value: [1, 0, 0, 1] });
	const access = { async readText() { return JSON.stringify(clipboard); } };
	await handleProjectParameterClipboard(f.context, f.projectSessionId, f.target, 'paste', () => true, access);
	assert.equal(f.history.undoStack.value.length, 1);
	assert.equal(f.node.params.foo.value.node.expressionModifier, undefined);
	f.history.undo();
	assert.equal(f.node.params.foo.value.node.expressionModifier.code, 'VALUE * 9');
	f.history.redo();
	assert.deepEqual(f.node.params.foo.value.node, clipboard.binding);
	const target = { ...f.timelineTarget, paramPath: ['buzzs', 'first', 'y'] };
	const keys = createInlineKeyframesTimeline(scalarDefinition);
	const keyClipboard = f.copy(keys, target);
	await handleProjectParameterClipboard(f.context, f.projectSessionId, target, 'paste', () => true, { async readText() { return JSON.stringify(keyClipboard); } });
	const after = clone(f.layer.effectParamValues.buzzs);
	f.history.undo();
	assert.equal(Object.hasOwn(f.layer.effectParamValues, 'buzzs'), false);
	f.history.redo();
	assert.deepEqual(f.layer.effectParamValues.buzzs, after);
});

// 【読み取り中の終了・対象の削除と非互換データで履歴を増やさない】
// OSの非同期読み取りが完了した時点では、クリック時の対象が失効している場合がある。
test('ignores stale asynchronous reads and incompatible content without changing undo or redo', async t => {
	t.mock.method(console, 'log', () => {});
	for (const invalidate of [f => { f.context.isDisposed = true; }, f => { f.visualModule.nodes = [f.upstream]; },
		f => { f.visualModule.nodes[0] = clone(f.node); }]) {
		const f = fixture();
		const text = JSON.stringify(f.copy({ inputSource: 'literal', value: [1, 0, 0, 1] }));
		let finish;
		const promise = handleProjectParameterClipboard(f.context, f.projectSessionId, f.target, 'paste', () => true, { readText: () => new Promise(resolve => { finish = resolve; }) });
		invalidate(f);
		finish(text);
		await promise;
		assert.equal(f.history.undoStack.value.length, 0);
	}
	const f = fixture();
	f.history.redoStack.value.push({ sentinel: true });
	await handleProjectParameterClipboard(f.context, f.projectSessionId, f.target, 'paste', () => true, { async readText() { return '{}'; } });
	assert.equal(f.history.undoStack.value.length, 0);
	assert.equal(f.history.redoStack.value.length, 1);
});

// 【Live Previewへの貼り付けも、読み取り中の終了・対象削除後には適用しない】
// プロジェクト履歴を使わないプレビュー引数でも、遅れて返ったOSのクリップボード結果を失効させる。
test('ignores delayed preview parameter pastes after disposal or target changes', async () => {
	for (const invalidate of [f => { f.context.isDisposed = true; },
		f => { f.state.visualModules.value = []; }]) {
		const f = fixture();
		f.visualModule.paramDefs = [{ ...scalarDefinition, id: 'arg', nameForReference: 'arg' }];
		const values = { arg: { inputSource: 'literal', value: 5 } };
		const source = createVisualModuleClipboardSource(f.projectSessionId, { visualModuleId: f.visualModule.id }, f.visualModule);
		const clipboard = createParameterClipboard(scalarDefinition, { inputSource: 'literal', value: 12 }, source);
		const reading = Promise.withResolvers();
		let applied = false;
		const pending = handlePreviewParameterClipboard(f.context, f.projectSessionId, f.visualModule.id, ['arg'], 'paste', () => values, () => true,
			() => { applied = true; }, { readText: () => reading.promise });
		invalidate(f);
		reading.resolve(JSON.stringify(clipboard));
		await pending;
		assert.equal(applied, false);
		assert.equal(values.arg.value, 5);
	}
});

// 【別ウィンドウのコピーをテキストだけで受け渡し、Live Previewでも同じ検証を使う】
// メモリ上のオブジェクトの同一性や、コピー元ウィンドウが開いていることに依存させない。
test('copies across independent window contexts and supports live preview without project history', async t => {
	t.mock.method(console, 'log', () => {});
	const from = fixture('from');
	const to = fixture('to');
	let text = '';
	const access = { async readText() { return text; }, async writeText(value) { text = value; } };
	from.node.params.foo.value.node = { inputSource: 'expression', expression: '[1, 0, 0, 1]', expressionModifier: { enabled: false, code: 'VALUE' } };
	await handleProjectParameterClipboard(from.context, from.projectSessionId, from.target, 'copy', () => true, access);
	from.node.params.foo.value.node.expression = 'null';
	await handleProjectParameterClipboard(to.context, to.projectSessionId, to.target, 'paste', () => true, access);
	assert.equal(to.node.params.foo.value.node.expression, '[1, 0, 0, 1]');
	to.visualModule.paramDefs = [{ ...scalarDefinition, id: 'arg', nameForReference: 'arg' }];
	const values = { arg: { inputSource: 'literal', value: 5 } };
	const source = createVisualModuleClipboardSource(from.projectSessionId, { visualModuleId: from.visualModule.id }, from.visualModule);
	text = JSON.stringify(createParameterClipboard(scalarDefinition, { inputSource: 'expression', expression: 'TIME' }, source));
	await handlePreviewParameterClipboard(to.context, to.projectSessionId, to.visualModule.id, ['arg'], 'paste', () => values, () => true, (id, binding) => { values[id] = binding; }, access);
	assert.deepEqual(values.arg, { inputSource: 'expression', expression: 'TIME' });
	assert.equal(to.history.undoStack.value.length, 1);
});

// 【WebとElectronのクリップボードを同じインターフェースで読み書きする】
// Electronでブラウザの権限確認に依存せず、Web版では標準APIを使う。
test('uses the desktop bridge when present and otherwise the web clipboard', async t => {
	const calls = [];
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	t.after(() => {
		if (originalWindow == null) delete globalThis.window;
		else Object.defineProperty(globalThis, 'window', originalWindow);
		if (originalNavigator == null) delete globalThis.navigator;
		else Object.defineProperty(globalThis, 'navigator', originalNavigator);
	});
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop: { async readClipboardText() { return 'desktop'; }, async writeClipboardText(text) { calls.push(text); } } } });
	assert.equal(await clipboardText.readText(), 'desktop');
	await clipboardText.writeText('text');
	assert.deepEqual(calls, ['text']);
	window.desktop = null;
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { async readText() { return 'web'; }, async writeText(text) { calls.push(text); } } } });
	assert.equal(await clipboardText.readText(), 'web');
	await clipboardText.writeText('browser');
	assert.deepEqual(calls, ['text', 'browser']);
});
