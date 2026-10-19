import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { ProjectRenderValidation } from './src/ProjectRenderValidation.ts';
		export { PreviewRenderEngine } from './src/PreviewRenderEngine.ts';
		export { inspectTimelineLayer } from '@gs/subsystems_timeline_shared/static-validation.ts';
		export { createTimelineCameraParameterValues } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
		export { createTimelineTransformParameterValues } from '@gs/subsystems_timeline_shared/layers/transform/transform.ts';
		export { ref } from 'vue';
	` },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'definitions', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, args => ({ path: args.path, namespace: 'fixture' }));
		build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const effectDefinitions = {};' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { ProjectRenderValidation, PreviewRenderEngine, inspectTimelineLayer, createTimelineCameraParameterValues, createTimelineTransformParameterValues, ref } = module.exports;
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, canNode: true, ui: { label: 'Amount', control: { controlType: 'number' } }, defaultValue: literal(0) };
const definitions = { effect: { id: 'effect', paramDefs: { amount: scalar }, outputDefs: { output: { dataType: { kind: 'scalar' } } }, primaryInputParameter: 'amount' } };
const node = (id, amount = literal(0)) => ({ id, type: 'effect', effectId: 'effect', resolution: { mode: 'context' }, params: { amount }, isBypass: false });
const connection = id => ({ inputSource: 'node', nodeId: id, outputPort: 'output', fitMode: 'contain', wrapMode: 'clamp', filterMode: 'linear' });
const visualModule = (nodes, id = 'visualModule') => ({ id, nodes, paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] });
const scene = (id, layers = []) => ({ id, name: id, resolution: { mode: 'project' }, layers });
const sceneLayer = (id, sceneId) => ({ id, name: id, layerType: 'scene', clips: [{ id: 'clip', sceneId, startMs: 0, durationMs: 1000, contentOffsetMs: 0 }], compositingParamValues: {}, audioParamValues: {}, automationGraphs: [] });
const groupLayer = (id, layers) => ({ id, name: id, layerType: 'group', layers, compositingParamValues: {}, audioParamValues: {}, automationGraphs: [], isDisabled: false });
function fixture(visualModules = [], timelineScenes = []) {
	const state = { visualModules: ref(visualModules), timelineScenes: ref(timelineScenes), assets: ref([]), players: ref([]), resolution: ref({ width: 16, height: 16 }), timelineFps: ref(60), timelineMotionBlur: ref({ enabled: false, shutterAngle: 180, samples: 0 }) };
	const validation = new ProjectRenderValidation(state, definitions);
	validation.reset();
	return { state, validation };
}
const nodeChange = nodeId => [{ type: 'node', target: { visualModuleId: 'visualModule' }, nodeId, changes: [{ type: 'parameter', kind: 'value' }] }];

// 【LUTの参照先変更と同じIDの種類変更を再検証する】
// 通常値の変更を省略する静的shapeにLUT IDを含めないと、別Assetへの切替を見落とす。
// Asset差し替えの依存通知でも再検証し、誤った種類を描画へ渡さない。
test('revalidates LUT selection and asset replacement', () => {
	const selected = node('lut', literal('first'));
	const { state } = fixture([visualModule([selected])]);
	state.assets.value.push({ id: 'first', fileDataType: 'application/x-cube-lut' }, { id: 'second', fileDataType: 'font/ttf' });
	const lutDefinitions = { effect: { ...definitions.effect, primaryInputParameter: null, paramDefs: {
		amount: { dataType: { kind: 'assetReference', assetType: 'lut' }, ui: { label: 'LUT', control: {} }, defaultValue: literal(null) },
	} } };
	const validation = new ProjectRenderValidation(state, lutDefinitions);
	validation.reset();
	assert.equal(validation.errorMessage.value, null);
	selected.params.amount = literal('second');
	validation.update(nodeChange('lut'));
	assert.match(validation.errorMessage.value, /Incompatible Asset/);
	state.assets.value[1].fileDataType = 'application/x-cube-lut';
	validation.update([{ type: 'asset', assetId: 'second' }]);
	assert.equal(validation.errorMessage.value, null);
	selected.params.amount = literal(null);
	validation.update(nodeChange('lut'));
	assert.equal(validation.errorMessage.value, null);
});

function nestedParameterDefinition() {
	return {
		dataType: { kind: 'array', elementType: { kind: 'struct', fields: { asset: { kind: 'imageAssetTextureReference' } } } },
		ui: { label: 'Inputs', control: { element: { fields: { asset: { label: 'Asset', control: {} } } } } },
		element: { fields: { asset: { defaultValue: literal(null), canNode: false } }, defaultValue: literal({ asset: literal(null) }) },
		defaultValue: literal([]),
	};
}

// 【入れ子のパラメータ検証と参照収集を一度の走査で行う】
// 配列・構造体を検証後に再走査すると、入れ子や要素数に比例して編集の負荷が増える。
// 要素Bindingと末端Bindingの読み出しを数え、参照収集も同じ走査で行えることを確認する。
test('inspects nested timeline bindings once while collecting references', () => {
	const reads = [];
	const elements = ['first', 'second'].map(id => ({ id, get binding() {
		reads.push(id);
		return literal({ get asset() { reads.push(id + '/asset'); return literal(id + '-asset'); } });
	} }));
	const effect = { ...definitions.effect, paramDefs: { inputs: nestedParameterDefinition() } };
	const layer = { ...sceneLayer('layer', 'unused'), layerType: 'effect', effectId: 'effect',
		resolution: { mode: 'context' }, effectParamValues: { inputs: literal(elements) } };
	const references = [];
	inspectTimelineLayer(layer, undefined, effect, (def, binding) => {
		assert.equal(def.dataType.kind, 'imageAssetTextureReference');
		references.push(binding.value);
	});
	assert.deepEqual(reads, ['first', 'first/asset', 'second', 'second/asset']);
	assert.deepEqual(references, ['first-asset', 'second-asset']);
});

// 【レイヤー固有のパラメータも重複検証せず、通常のliteral値は静的検査から除外する】
// Textなどの個別検証器を共通検証より先に呼ぶと、同じパラメータが複数回検証される。
// literal値の型や範囲を検証する責務は、従来どおり実行時の評価側に残す。
test('inspects text parameters once without validating ordinary literal values', () => {
	let reads = 0;
	const layer = { ...sceneLayer('layer', 'unused'), layerType: 'text',
		textParamValues: { get text() { reads++; return literal(123); } } };
	const values = [];
	inspectTimelineLayer(layer, undefined, undefined, (_def, binding) => values.push(binding.value));
	assert.equal(reads, 1);
	assert.deepEqual(values, [123]);
});

for (const invalid of ['duplicate element', 'unknown field', 'missing field', 'container input', 'leaf input']) {
	// 【走査を統合しても、コンテナの構造と末端の入力制約を検証する】
	// 不正なBindingを配列・構造体内へ隠せると、レンダラーの検証済み設定という契約が崩れる。
	// 配列ID、構造体の項目、コンテナのliteral制約、末端のcanNodeをそれぞれ確認する。
	test(`rejects an invalid nested timeline parameter with ${invalid}`, () => {
		const values = { asset: literal(null) };
		const binding = literal([{ id: 'element', binding: literal(values) }]);
		let message;
		if (invalid === 'duplicate element') { binding.value.push({ id: 'element', binding: literal(values) }); message = /Duplicate array element ID/; }
		else if (invalid === 'unknown field') { values.other = literal(0); message = /Unknown struct field/; }
		else if (invalid === 'missing field') { delete values.asset; message = /Missing parameter binding/; }
		else if (invalid === 'container input') { binding.inputSource = 'layerInput'; message = /Container parameter must be literal/; }
		else { values.asset = { inputSource: 'layerInput' }; message = /Layer input is only available/; }
		const effect = { ...definitions.effect, paramDefs: { inputs: nestedParameterDefinition() } };
		const layer = { ...sceneLayer('layer', 'unused'), layerType: 'effect', effectId: 'effect',
			resolution: { mode: 'context' }, effectParamValues: { inputs: binding } };
		assert.throws(() => inspectTimelineLayer(layer, undefined, effect, () => {}), message);
	});
}

// 【通常のliteral編集では静的検証も循環探索も繰り返さない】
// 値調整のたびに全グラフを走査すると、描画から検証を移しても編集負荷が残る。
// 検証済み単位の検査を計数し、別ノードの検証も発生しないことを確認する。
test('reuses static validation for ordinary literal edits', () => {
	const { state, validation } = fixture([visualModule([node('first'), node('second')])]);
	let checks = 0;
	const check = validation.check.bind(validation);
	validation.check = (key, shape, inspect, ...options) => check(key, shape, () => { checks++; inspect(); }, ...options);
	let graphChecks = 0;
	const graphCheck = validation.checkNodeGraph.bind(validation);
	validation.checkNodeGraph = key => { graphChecks++; graphCheck(key); };
	state.visualModules.value[0].nodes[0].params.amount = literal('invalid numeric value');
	validation.update(nodeChange('first'));
	assert.equal(validation.errorMessage.value, null);
	assert.equal(checks, 0);
	assert.equal(graphChecks, 0);
});

// 【無効な枝の循環も編集時に検出し、配線修正で解除する】
// 描画経路やバイパスによって検証範囲を変えると、再有効化した時に初めて失敗する。
test('detects cycles in unused and bypassed nodes and clears them after editing', () => {
	const { state, validation } = fixture([visualModule([node('first', connection('second')), { ...node('second', connection('first')), isBypass: true }])]);
	assert.match(validation.errorMessage.value, /Circular node reference/);
	state.visualModules.value[0].nodes[1].params.amount = literal(1);
	validation.update(nodeChange('second'));
	assert.equal(validation.errorMessage.value, null);
});

// 【Scene参照の循環を描画開始前に止め、変更されたレイヤーから更新する】
// 音声計画や参照先Sceneの生成に入ってから無限再帰することを防ぐ。
test('updates scene cycles when a referenced scene clip changes', () => {
	const { state, validation } = fixture([], [scene('first', [sceneLayer('child', 'second')]), scene('second', [sceneLayer('child', 'first')])]);
	assert.match(validation.errorMessage.value, /Circular scene reference/);
	state.timelineScenes.value[1].layers[0].clips = [];
	validation.update([{ type: 'layer', sceneId: 'second', layerId: 'child', changes: [{ type: 'clips' }] }]);
	assert.equal(validation.errorMessage.value, null);
});

// 【共通の子Sceneを複数配置しても、循環参照とは診断しない】
// 旧全量検証の仕様をUIの検証入口へ移し、共有の子孫と現在の参照経路の循環を区別する。
test('accepts repeated scene placements and shared descendants in UI validation', () => {
	const scenes = [scene('root', [sceneLayer('first', 'child'), sceneLayer('second', 'child')]),
		scene('child', [sceneLayer('leaf', 'leaf')]), scene('leaf')];
	const { validation } = fixture([], scenes);
	assert.equal(validation.errorMessage.value, null);
});

for (const cycle of ['direct', 'indirect', 'disabled group']) {
	// 【直接・間接・無効なグループ内のScene循環をUIで診断する】
	// 描画経路から外れた枝でも、参照先を生成する前に循環を検出する必要がある。
	// 旧全量検証を削除しても、プロジェクト全体を停止する仕様を維持する。
	test(`diagnoses a ${cycle} scene cycle in UI validation`, () => {
		const root = scene('root', [sceneLayer('placement', cycle === 'indirect' ? 'child' : 'root')]);
		const scenes = cycle === 'indirect' ? [root, scene('child', [sceneLayer('back', 'root')])] : [root];
		if (cycle === 'disabled group') root.layers = [{ ...groupLayer('group', root.layers), isDisabled: true }];
		const { validation } = fixture([], scenes);
		assert.ok(validation.diagnostics.value.some(diagnostic => /Circular scene reference/.test(diagnostic.message)));
	});
}

// 【参照先Sceneの欠落を診断し、追加・削除でも利用レイヤーの診断を更新する】
// 編集したレイヤーだけの検証では、参照先を追加しても古いエラーが残り得る。
// 復旧と再度の欠落までを、新しいUI検証の入口で確認する。
test('diagnoses missing scenes and updates references after scene registration changes', () => {
	const { state, validation } = fixture([], [scene('root', [sceneLayer('placement', 'missing')])]);
	assert.match(validation.errorMessage.value, /Scene not found/);
	state.timelineScenes.value.push(scene('missing'));
	validation.update([{ type: 'scene', sceneId: 'missing' }]);
	assert.equal(validation.errorMessage.value, null);
	state.timelineScenes.value.pop();
	validation.update([{ type: 'scene', sceneId: 'missing' }]);
	assert.match(validation.errorMessage.value, /Scene not found/);
});

// 【Scene IDとグループをまたぐレイヤーIDの重複をUIで診断する】
// 旧全量検証を削除しても、IDで参照する対象が一意であることを検証する。
// グループ内のIDを修正した際に診断を解除できることも保証する。
test('diagnoses duplicate scene and nested layer IDs in UI validation', () => {
	const duplicates = fixture([], [scene('same'), scene('same')]);
	assert.match(duplicates.validation.errorMessage.value, /Duplicate scene ID/);
	const { state, validation } = fixture([], [scene('root', [groupLayer('same', []), groupLayer('parent', [groupLayer('same', [])])])]);
	assert.match(validation.errorMessage.value, /Duplicate layer ID/);
	state.timelineScenes.value[0].layers[1].layers[0].id = 'unique';
	validation.update([{ type: 'layerTree', sceneId: 'root' }]);
	assert.equal(validation.errorMessage.value, null);
});

// 【Sceneの解像度設定を旧全量検証ではなくUIの検証単位で診断する】
// 読み込み元がCommandを通らない場合にも、不正な寸法で描画を始めない。
// 設定変更で正常な解像度へ戻すと診断が解除されることを確認する。
test('diagnoses invalid scene resolutions and clears them after correction', () => {
	const root = { ...scene('root'), resolution: { mode: 'customAbsolute', width: 0, height: 16 } };
	const { state, validation } = fixture([], [root]);
	assert.match(validation.errorMessage.value, /Scene resolution/);
	state.timelineScenes.value[0].resolution.width = 16;
	validation.update([{ type: 'scene', sceneId: 'root' }]);
	assert.equal(validation.errorMessage.value, null);
});

// 【ルートとTransform配下のカメラ設定をUIで検証し、Group配下では診断する】
// 旧検証関数に付随していた正常な配置の確認を、実際の描画前検証へ移す。
// Transformはカメラの配置を許可し、Groupの境界は越えられない仕様を維持する。
test('accepts cameras under transforms and diagnoses cameras under groups in UI validation', () => {
	const camera = { id: 'camera', name: 'Camera', layerType: 'camera', automationGraphs: [],
		cameraParamValues: createTimelineCameraParameterValues(), clips: [{ id: 'clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }] };
	assert.equal(fixture([], [scene('root', [camera])]).validation.errorMessage.value, null);
	const transform = { id: 'transform', name: 'Transform', layerType: 'transform', layers: [camera], automationGraphs: [],
		transformParamValues: createTimelineTransformParameterValues() };
	assert.equal(fixture([], [scene('root', [transform])]).validation.errorMessage.value, null);
	assert.match(fixture([], [scene('root', [groupLayer('group', [transform])])]).validation.errorMessage.value, /Camera is inside a Group/);
});

// 【参照先の追加・削除では利用単位だけ再検証する】
// 不足していたVisual Moduleを追加した場合にも、レイヤーを編集し直す必要がない。
test('revalidates references after registration and deletion', () => {
	const layer = { ...sceneLayer('layer', 'unused'), layerType: 'visualModule', visualModuleId: 'missing', visualModuleParamValues: {} };
	const { state, validation } = fixture([], [scene('scene', [layer])]);
	assert.match(validation.errorMessage.value, /Visual Module not found/);
	state.visualModules.value = [visualModule([], 'missing')];
	validation.update([{ type: 'visualModuleRegistration', visualModuleId: 'missing' }]);
	assert.equal(validation.errorMessage.value, null);
	state.visualModules.value = [];
	validation.update([{ type: 'visualModuleRegistration', visualModuleId: 'missing' }]);
	assert.match(validation.errorMessage.value, /Visual Module not found/);
});

// 【Inline Visual Moduleの公開型変更では、同じ形の引数も所有レイヤーで再検証する】
// expressionという入力方式はscalarでは使えるがaudioSourceでは使えない。
// Bindingの形だけのキャッシュでは型変更を見落とすため、修正による診断解除まで確認する。
test('revalidates inline arguments when the public parameter type changes', () => {
	const parameter = { ...scalar, id: 'amount', nameForReference: 'Amount', canNode: false };
	const inlineVisualModule = { ...visualModule([]), paramDefs: [parameter] };
	const layer = { ...sceneLayer('inline', 'unused'), layerType: 'inlineVisualModule', visualModule: inlineVisualModule,
		visualModuleParamValues: { amount: { inputSource: 'expression', expression: '1' } } };
	const { state, validation } = fixture([], [scene('scene', [layer])]);
	assert.equal(validation.errorMessage.value, null);
	const current = state.timelineScenes.value[0].layers[0].visualModule;
	const changes = [{ type: 'visualModule', target: { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' } }];
	current.paramDefs[0] = { ...parameter, dataType: { kind: 'audioSource' }, defaultValue: literal(null) };
	validation.update(changes);
	assert.match(validation.errorMessage.value, /static input/);
	current.paramDefs[0] = parameter;
	validation.update(changes);
	assert.equal(validation.errorMessage.value, null);
});

// 【音声Bindingをscalarへ変わったInline引数に渡さない】
// 公開定義だけを変更しても既存のレイヤー引数は残る。
// レンダラーへ到達して実行時エラーになる前に、所有レイヤーで入力方式を拒否する。
test('rejects retained inline audio arguments after changing their public type', () => {
	const audio = { ...scalar, id: 'audio', nameForReference: 'Audio', canNode: false, dataType: { kind: 'audioSource' }, defaultValue: literal(null) };
	const layer = { ...sceneLayer('inline', 'unused'), layerType: 'inlineVisualModule',
		visualModule: { ...visualModule([]), paramDefs: [audio] }, visualModuleParamValues: { audio: { inputSource: 'lowerLayerAudio' } } };
	const { state, validation } = fixture([], [scene('scene', [layer])]);
	assert.equal(validation.errorMessage.value, null);
	state.timelineScenes.value[0].layers[0].visualModule.paramDefs[0] = { ...audio, dataType: { kind: 'scalar' }, defaultValue: literal(0) };
	validation.update([{ type: 'visualModule', target: { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' } }]);
	assert.match(validation.errorMessage.value, /Layer audio is not available/);
});

// 【静的エラー中はエンジンを持たず、修正後に最新設定で生成する】
// 同じエラー状態で編集を重ねても破棄を繰り返さず、差分を再送する必要をなくす。
test('disposes once on static failure and recreates only after correction', async () => {
	let created = 0, disposed = 0;
	const engine = new PreviewRenderEngine({ create: async () => { created++; }, dispose: () => { disposed++; } });
	await engine.enable();
	engine.setValidationError('cycle');
	engine.setValidationError('another cycle');
	await engine.retry();
	assert.equal(created, 1);
	assert.equal(disposed, 1);
	engine.setValidationError(null);
	await engine.retry();
	assert.equal(created, 2);
});

// 【実行時エラー後は再試行を要求されるまで停止する】
// 時間経過で自動的に再生成すると、同じ式の失敗による再起動ループが発生する。
test('latches runtime failures until an explicit retry', async () => {
	let created = 0, disposed = 0;
	const engine = new PreviewRenderEngine({ create: async () => { created++; }, dispose: () => { disposed++; } });
	await engine.enable();
	engine.fail(new Error('invalid enum'));
	assert.equal(engine.canRender.value, false);
	await Promise.resolve();
	assert.equal(created, 1);
	assert.equal(disposed, 1);
	await engine.retry();
	assert.equal(created, 2);
	assert.equal(engine.canRender.value, true);
});

// 【編集通知がなくても静的診断の解除後に一度だけ再生成する】
// Visual Module Live PreviewからTimelineへの切り替えはProjectの変更通知を出さない。
// その切り替えで診断が消えた場合にも、停止したエンジンを残してはいけない。
test('restarts after validation clears and coalesces retry requests', async () => {
	let created = 0;
	const engine = new PreviewRenderEngine({ create: async () => { created++; }, dispose() {} });
	await engine.enable();
	engine.setValidationError('invalid Visual Module Live Preview input');
	engine.setValidationError(null);
	engine.requestRetry();
	engine.requestRetry();
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(created, 2);
	assert.equal(engine.canRender.value, true);
});

// 【予約済みの再試行で、その後に発生した実行時エラーを解除しない】
// 設定変更と失敗通知が同じターンで届くことがある。
// 失敗以前の予約を実行すると、修正していない設定で自動再起動してしまう。
test('cancels scheduled retries on a subsequent runtime failure', async () => {
	let created = 0;
	const failure = new Error('draw failed');
	const reasons = [];
	const engine = new PreviewRenderEngine({ create: async () => { created++; }, dispose: reason => reasons.push(reason) });
	await engine.enable();
	engine.requestRetry();
	engine.fail(failure);
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(created, 1);
	assert.deepEqual(reasons, [failure]);
	assert.equal(engine.errorMessage.value, 'draw failed');
});

// 【初期化中の再試行をまとめ、書き出しのための停止後には再生成しない】
// 生成待ちに設定変更が重なっても、停止より前に予約された再試行でエンジンを復活させない。
test('coalesces retries and keeps queued retries suspended', async () => {
	const gate = Promise.withResolvers();
	let created = 0;
	const engine = new PreviewRenderEngine({ create: async () => { created++; await gate.promise; }, dispose() {} });
	const starting = engine.enable();
	const retry = engine.retry();
	engine.suspend();
	gate.resolve();
	await Promise.all([starting, retry]);
	assert.equal(created, 1);
	assert.equal(engine.canRender.value, false);
});

// 【初期化待ちにエラーと修正が起きても、旧設定の生成を復活させない】
// 診断が正常へ戻ったことだけを見ると、中断前のスナップショットを使って起動してしまう。
test('invalidates an old creation even if static errors are already corrected', async () => {
	const gate = Promise.withResolvers();
	const adopted = [];
	let version = 1;
	const engine = new PreviewRenderEngine({ create: async isCurrent => {
		const snapshot = version;
		await gate.promise;
		if (isCurrent()) adopted.push(snapshot);
	}, dispose() {} });
	const starting = engine.enable();
	engine.setValidationError('cycle');
	version = 2;
	engine.setValidationError(null);
	const corrected = engine.retry();
	gate.resolve();
	await Promise.all([starting, corrected]);
	assert.deepEqual(adopted, [2]);
});

// 【音声以外へ下層音声を渡す構造エラーは、Commandの拒否に依存せず診断する】
// 外部から読み込んだ設定や編集途中の状態もUIで一貫して扱うために必要な検査。
test('diagnoses invalid layer audio bindings before rendering', () => {
	const layer = { ...sceneLayer('layer', 'unused'), layerType: 'effect', effectId: 'effect', resolution: { mode: 'context' }, effectParamValues: { amount: { inputSource: 'lowerLayerAudio' } } };
	const { state, validation } = fixture([], [scene('scene', [layer])]);
	assert.match(validation.errorMessage.value, /Layer audio is not available/);
	state.timelineScenes.value[0].layers[0].effectParamValues.amount = literal(1);
	validation.update([{ type: 'layer', sceneId: 'scene', layerId: 'layer', changes: [{ type: 'parameter', target: 'effect', kind: 'inputSource' }] }]);
	assert.equal(validation.errorMessage.value, null);
});

const outputReference = (layerId, outputStage = 'source') => ({ inputSource: 'anotherLayerOutput', layerId, outputStage, fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
const imageEffectLayer = (id, binding = literal(0)) => ({ id, name: id, layerType: 'effect', effectId: 'effect', resolution: { mode: 'context' },
	clips: [{ id: 'clip', startMs: 0, durationMs: 1000, contentOffsetMs: 0 }], isDisabled: false, automationGraphs: [], compositingParamValues: {}, effectParamValues: { amount: binding } });
const imageLayerChange = layerId => [{ type: 'layer', sceneId: 'scene', layerId, changes: [{ type: 'parameter', target: 'effect', kind: 'connection' }] }];

// 【上層素材の参照と、下層合成を経由する循環を区別する】
// 配列の順序をそのまま素材の依存にすると成立する配線を拒否する。一方、出力段階の
// 切替やlayerInputを経由した循環も、描画前に静的診断へ反映する必要がある。
test('revalidates output stages lower inputs and layer order for image cycles', () => {
	const upper = imageEffectLayer('upper');
	const lower = imageEffectLayer('lower', outputReference('upper'));
	const f = fixture([], [scene('scene', [upper, lower])]);
	assert.equal(f.validation.errorMessage.value, null);
	lower.effectParamValues.amount = outputReference('upper', 'composited');
	f.validation.update(imageLayerChange('lower'));
	assert.match(f.validation.errorMessage.value, /Circular layer output reference/);
	lower.effectParamValues.amount = outputReference('upper');
	f.validation.update(imageLayerChange('lower'));
	assert.equal(f.validation.errorMessage.value, null);
	upper.effectParamValues.amount = { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' };
	f.validation.update(imageLayerChange('upper'));
	assert.match(f.validation.errorMessage.value, /Circular layer output reference/);
	f.state.timelineScenes.value[0].layers.reverse();
	f.validation.update([{ type: 'layerOrder', sceneId: 'scene' }]);
	assert.equal(f.validation.errorMessage.value, null);
});

// 【Group出力と子の相互参照は、無効化やクリップの空白で隠さない】
// 時刻や有効状態の変更で突然循環する構成を保存させず、同時表示されないクリップでも
// 静的な配線全体を検査する。別Groupの独立した子の参照は許可する。
test('detects ancestor and inactive image cycles across group boundaries', () => {
	const child = imageEffectLayer('child', outputReference('group'));
	const group = { ...groupLayer('group', [child]), isDisabled: true };
	const f = fixture([], [scene('scene', [group])]);
	assert.match(f.validation.errorMessage.value, /Circular layer output reference/);
	child.effectParamValues.amount = literal(0);
	f.validation.update(imageLayerChange('child'));
	assert.equal(f.validation.errorMessage.value, null);
	const other = imageEffectLayer('other', outputReference('child'));
	f.state.timelineScenes.value[0].layers.push(groupLayer('other-group', [other]));
	f.validation.update([{ type: 'layerTree', sceneId: 'scene' }]);
	assert.equal(f.validation.errorMessage.value, null);
	child.effectParamValues.amount = outputReference('other');
	other.clips[0].startMs = 2000;
	f.validation.update(imageLayerChange('child'));
	assert.match(f.validation.errorMessage.value, /Circular layer output reference/);
});

// 【公開主入力の既定の下層入力も画像依存に含め、明示的な未選択で解除できる】
// 保存値のない主入力を見落とすと、Visual Module経由の循環がGPU評価で初めて発覚する。
// 公開入力にはサンプリング設定がなくても有効であることも同時に確認する。
test('includes default public primary inputs in the image dependency graph', () => {
	const visual = visualModule([], 'visual');
	visual.paramDefs = [{ id: 'image', nameForReference: 'Image', dataType: { kind: 'color' }, canNode: true, ui: { label: 'Image', control: {} }, defaultValue: literal([0, 0, 0, 0]) }];
	visual.primaryInputId = 'image';
	const publicLayer = { ...imageEffectLayer('public'), layerType: 'visualModule', visualModuleId: 'visual', visualModuleParamValues: {} };
	const source = imageEffectLayer('source', outputReference('public'));
	const f = fixture([visual], [scene('scene', [publicLayer, source])]);
	assert.match(f.validation.errorMessage.value, /Circular layer output reference/);
	publicLayer.visualModuleParamValues.image = { inputSource: 'anotherLayerOutput', layerId: null, outputStage: 'source' };
	f.validation.update(imageLayerChange('public'));
	assert.equal(f.validation.errorMessage.value, null);
});

// 【Inlineの主入力変更とUndoで、既定の下層入力による循環を再検証する】
// 公開定義の再検証だけでは、追加・解除された画像依存がSceneの循環診断へ反映されない。
// 下層から上層素材を読む有効な配線を使い、主入力指定による循環の導入と解消の両方を確認する。
test('revalidates image cycles when an inline Visual Module primary input changes', () => {
	const visual = visualModule([]);
	visual.paramDefs = [{ id: 'image', nameForReference: 'Image', dataType: { kind: 'color' }, canNode: true, ui: { label: 'Image', control: {} }, defaultValue: literal([0, 0, 0, 0]) }];
	const inline = { ...imageEffectLayer('inline'), layerType: 'inlineVisualModule', visualModule: visual, visualModuleParamValues: {} };
	const f = fixture([], [scene('scene', [inline, imageEffectLayer('lower', outputReference('inline'))])]);
	const target = { sceneId: 'scene', inlineVisualModuleLayerId: 'inline' };
	assert.equal(f.validation.errorMessage.value, null);
	for (const primaryInputId of ['image', null, 'image', null]) {
		inline.visualModule.primaryInputId = primaryInputId;
		f.validation.update([{ type: 'visualModule', target }]);
		if (primaryInputId == null) assert.equal(f.validation.errorMessage.value, null);
		else assert.match(f.validation.errorMessage.value, /Circular layer output reference/);
	}
});

// 【配列・構造体の内部のcanNodeを、Visual Moduleの公開画像ポートと混同しない】
// Inノードが公開するのはルートの画像型だけで、内部BindingはCPU引数として評価される。
// UIがまだ公開していない保存値でも、画像Bindingを受け入れて描画中に失敗させない。
test('rejects image references in nonpublic nested Visual Module arguments', () => {
	const visual = visualModule([], 'visual');
	visual.paramDefs = [{ id: 'settings', nameForReference: 'Settings', canNode: false,
		dataType: { kind: 'struct', fields: { image: { kind: 'color' } } }, ui: { label: 'Settings', control: { fields: { image: { label: 'Image', control: {} } } } },
		fields: { image: { canNode: true, defaultValue: literal([0, 0, 0, 0]) } }, defaultValue: literal({ image: literal([0, 0, 0, 0]) }) }];
	const layer = { ...imageEffectLayer('public'), layerType: 'visualModule', visualModuleId: 'visual',
		visualModuleParamValues: { settings: literal({ image: { inputSource: 'anotherLayerOutput', layerId: null, outputStage: 'source' } }) } };
	const f = fixture([visual], [scene('scene', [layer])]);
	assert.match(f.validation.errorMessage.value, /Layer input is only available/);
});
