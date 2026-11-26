import { testNodesEffect } from './helpers/nodes-effect.mjs';
import { createTestProject } from './helpers/project.mjs';
import { i18nPlugin } from './helpers/i18n.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
// ファイル形式・Command・差分同期は実コードを使い、ブラウザ境界とエフェクト一覧だけを置き換える。
// 個々のエフェクトの実装には依存せず、型に従った素材の収集・参照の維持を検証する。
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export * from './src/nodes-effect-file-codec.ts';
		export { default as imageDefinition } from '@gs/subsystems_effect_native-effects/fx/image/_def_.ts';
		export * from './src/utility/nodes-effect-file.ts';
		export { ProjectContext } from './src/Project.ts';
		export { createProjectNodesEffect } from './src/utility/project-nodes-effect.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
	` },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { _VERSION_: '"2.0.0-alpha.1"' },
	plugins: [i18nPlugin, { name: 'nodes-effect-file-platform', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$|preferences\.ts$|(?:\/|\\)ui\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', resolveDir: directory,
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: /ui\.ts$/.test(path) ? 'export async function alert(options) { globalThis.nodesEffectAlerts.push(options); }'
					: "import image from '@gs/subsystems_effect_native-effects/fx/image/_def_.ts'; export const nativeEffectDefinitions = { image, resources: { ...image, paramDefs: { audio: { dataType: {kind:'audioSource'}, defaultValue:null }, amount: {dataType:{kind:'scalar'},defaultValue:0}, input: {dataType:{kind:'color'},canNode:true,defaultValue:[0,0,0,0]} } } };",
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'console', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, { ...console, log() {}, error() {} });
const { collectNodesEffectFile, encodeNodesEffectFile, decodeNodesEffectFile, prepareNodesEffectImport,
	imageDefinition, ProjectContext, RendererProjectSynchronizer, applyRendererProjectChanges, importNodesEffectFile, exportNodesEffectFile, createProjectNodesEffect } = loaded.exports;

const literal = value => ({ inputSource: 'literal', value });
const parameter = (dataType, value = null) => ({ dataType: typeof dataType === 'string' ? { kind: dataType } : dataType,
	ui: { label: typeof dataType === 'string' ? dataType : dataType.kind, control: {} }, defaultValue: value });
function asset(id, type = 'image/png') {
	return { id, name: id, width: 12, height: 8, fileDataType: type, fileData: new Blob([new Uint8Array([1, 2, 3, 4])], { type }),
		sourceFilePath: 'C:/private/' + id, hash: 'hash-' + id };
}
function fixture() {
	const setting = (assetType, label = assetType) => ({ dataType: { kind: 'assetReference', assetType }, ui: { label }, defaultValue: null });
	const definitions = { resources: { ...testNodesEffect(), staticSettingDefs: {
		image: setting('image'), video: setting('video'), nestedImage: setting('image'), font: setting('font'), templateImage: setting('image'), templateFont: setting('font'),
	}, paramDefs: { audio: parameter('audioSource'), amount: parameter('scalar', 1), input: { ...parameter('color', [0, 0, 0, 0]), canNode: true } } } };
	const nodesEffect = testNodesEffect({
		nodes: [
			{ id: 'effect', type: 'effect', effectSource: { type: 'nativeEffect', id: 'resources' }, isBypass: false, resolution: { mode: 'auto', scale: 1 },
				staticSettings: { image: 'default-image', video: 'video', nestedImage: 'nested-image', font: 'font', templateImage: 'template-image', templateFont: 'template-font' },
				params: { audio: literal(null), amount: { inputSource: 'expression', expression: 'TIME * 0.5' },
					input: { inputSource: 'nodesEffectPublicParameterReference', parameterId: 'input', sampling: { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' } } } },
			{ id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'effect', outputPort: 'output' } },
		],
		paramDefs: { amount: { ...parameter('scalar', 1), nameForReference: 'amount' },
			input: { ...parameter('color', [0, 0, 0, 0]), nameForReference: 'input', canNode: true },
			audio: { ...parameter('audioSource'), nameForReference: 'audio' } },
		outputSources: { output: { nodeId: 'relay', outputPort: 'output' } },
		primaryInputParameter: 'input', primaryAudioInputParameter: 'audio', resolutionInputParameters: ['input'],
		functionCurves: [{ id: 'curve-animation', nameForReference: 'curve-animation', type: 'bezier', isXNormalized: true, isYNormalized: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
	});
	const assets = [asset('video', 'video/mp4'), asset('nested-image'), asset('font', 'font/ttf'), asset('default-image'), asset('template-image'), asset('template-font', 'font/otf'), asset('unused')];
	const input = { name: 'Source Nodes Effect', nodesEffects: [], customShaderEffects: [], nodeMetadata: { effect: { displayName: 'Resource Node', position: { x: 3, y: 4 } } }, gsVersion: '2.0.0-alpha.1', nodesEffect, assets };
	return { input, definitions, nodesEffect, file: () => collectNodesEffectFile(input, definitions) };
}
function ids(prefix) { let index = 0; return () => `${prefix}-${++index}`; }

// 【カスタムの式・加工式・直接参照はNodes Effect単体ファイルでも維持する】
// プロジェクト保存だけでなく.gsneの明示的なフィールド抽出でも定義と値を落とさず、
// 過去の公開パラメータ移行処理が新しい内部参照を書き換えないことを確認する。
test('round trips custom parameter definitions, values and references without exposing arguments', async () => {
	const f = fixture();
	f.nodesEffect.customParameterDefs = { 'custom-speed': { ...parameter('scalar', 0.5), nameForReference: 'amount', canNode: false } };
	f.nodesEffect.customParameterValues = { 'custom-speed': { inputSource: 'expression', expression: 'PUBLIC("amount") * 2', expressionModifier: { enabled: true, code: 'VALUE + TIME' } } };
	f.nodesEffect.nodes[0].params.amount = { inputSource: 'nodesEffectCustomParameterValueReference', parameterId: 'custom-speed' };
	const decoded = decodeNodesEffectFile(await encodeNodesEffectFile(f.file()), f.input.gsVersion);
	const imported = prepareNodesEffectImport(decoded, f.definitions, ids('custom'));
	assert.deepEqual(imported.nodesEffect.definition.customParameterDefs, f.nodesEffect.customParameterDefs);
	assert.deepEqual(imported.nodesEffect.definition.customParameterValues, f.nodesEffect.customParameterValues);
	assert.deepEqual(imported.nodesEffect.definition.nodes[0].params.amount, f.nodesEffect.nodes[0].params.amount);
	assert.equal(Object.hasOwn(imported.nodesEffect.definition.paramDefs, 'custom-speed'), false);
});

// 【LUTの直接参照と公開パラメータの既定値を同梱し、読み込み時にIDを書き換える】
// .gsprojだけ動いてもNodes Effect単体の配布でLUTが欠落すると見た目を再現できない。
// 同じLUTを複数箇所で使っていても、一つの原本と新しい共通IDにまとめる。
test('packages LUT references and remaps them on Nodes Effect import', async () => {
	const f = fixture();
	f.definitions.resources.staticSettingDefs.lut = { dataType: { kind: 'assetReference', assetType: 'lut' }, ui: { label: 'LUT' }, defaultValue: null };
	f.nodesEffect.nodes[0].staticSettings.lut = 'lut';
	f.input.assets.push(asset('lut', 'application/x-cube-lut'));
	const decoded = decodeNodesEffectFile(await encodeNodesEffectFile(f.file()), f.input.gsVersion);
	assert.equal(decoded.assets.filter(item => item.id === 'lut').length, 1);
	const imported = prepareNodesEffectImport(decoded, f.definitions, ids('lut-import'));
	const lut = imported.assets.find(item => item.fileDataType === 'application/x-cube-lut');
	assert.notEqual(lut.id, 'lut');
	assert.equal(imported.nodesEffect.definition.nodes[0].staticSettings.lut, lut.id);
	assert.deepEqual([...new Uint8Array(await lut.fileData.arrayBuffer())], [1, 2, 3, 4]);
});

// 【参照された原本と公開パラメータの既定値だけを持ち運べる】
// ノードが公開パラメータ経由で画像を読む場合や、空配列の要素追加用の初期値も見落としてはいけない。
// 同じ素材を複数のノードが参照しても一度だけ同梱し、無関係な素材や元PCのパスを含めない。
test('round trips referenced media and definition defaults without project paths or unused resources', async () => {
	const f = fixture();
	const file = f.file();
	assert.equal(file.nodesEffect.id, undefined);
	assert.equal(file.nodesEffect.name, undefined);
	assert.deepEqual(file.assets.map(item => item.id).sort(), ['video', 'nested-image', 'font', 'default-image', 'template-image', 'template-font'].sort());
	assert.ok(file.assets.every(item => !('sourceFilePath' in item)));
	f.input.nodeMetadata.effect.displayName = 'Edited after export';
	f.nodesEffect.paramDefs.amount.defaultValue = null;
	const decoded = decodeNodesEffectFile(await encodeNodesEffectFile(file), f.input.gsVersion);
	assert.deepEqual(decoded.nodesEffect, file.nodesEffect);
	for (const item of decoded.assets) {
		assert.equal(item.fileData.type, item.fileDataType);
		assert.deepEqual([...new Uint8Array(await item.fileData.arrayBuffer())], [1, 2, 3, 4]);
	}
	assert.equal(decoded.nodeMetadata.effect.displayName, 'Resource Node');
	assert.equal(decoded.nodesEffect.paramDefs.amount.defaultValue, 1);
});

// 【取り込みごとに共有リソースのIDを変え、内部の配線と既定値を維持する】
// 同じファイルを二度取り込んだり、元プロジェクトへ戻したりしても素材を共有してはいけない。
test('remaps project resources while preserving local wiring', () => {
	const f = fixture();
	const file = f.file();
	const first = prepareNodesEffectImport(file, f.definitions, ids('first'));
	const second = prepareNodesEffectImport(file, f.definitions, ids('second'));
	assert.notEqual(first.nodesEffect.id, second.nodesEffect.id);
	assert.ok(first.assets.every(item => item.sourceFilePath === null && !second.assets.some(other => other.id === item.id)));
	assert.deepEqual(first.nodesEffect.definition.nodes.map(node => node.id), file.nodesEffect.nodes.map(node => node.id));
	assert.deepEqual(first.nodesEffect.definition.nodes[0].params.input, file.nodesEffect.nodes[0].params.input);
	assert.deepEqual(first.nodesEffect.definition.nodes[1], file.nodesEffect.nodes[1]);
	assert.deepEqual(first.nodesEffect.definition.outputSources, file.nodesEffect.outputSources);
	assert.deepEqual(first.nodesEffect.definition.functionCurves, file.nodesEffect.functionCurves);
	const importedAsset = name => first.assets.find(item => item.name === name).id;
	const params = first.nodesEffect.definition.nodes[0].params;
	const settings = first.nodesEffect.definition.nodes[0].staticSettings;
	assert.equal(settings.video, importedAsset('video'));
	assert.equal(settings.nestedImage, importedAsset('nested-image'));
	assert.equal(settings.image, importedAsset('default-image'));
	assert.equal(settings.templateImage, importedAsset('template-image'));
	assert.equal(settings.templateFont, importedAsset('template-font'));
	assert.equal(file.nodesEffect.paramDefs.amount.defaultValue, 1);
});

// 【未知の参照や動的な素材選択は状態変更の前に失敗する】
// 式の文字列置換で無関係な文字を変えたり、素材を失った構成を正常な取り込みとして扱ったりしない。
// ネストした参照も同じ制約を適用し、数値用の式はそのまま持ち運べる。
test('rejects missing resources unknown effects and dynamic resource bindings', () => {
	const missingAsset = fixture();
	missingAsset.input.assets = missingAsset.input.assets.filter(item => item.id !== 'default-image');
	assert.throws(missingAsset.file, /Missing Asset/);
	const unknown = fixture();
	unknown.nodesEffect.nodes[0].effectSource.id = 'unknown';
	assert.throws(unknown.file, /Unknown Native Effect/);
	const dynamic = fixture();
	dynamic.nodesEffect.nodes[0].staticSettings.image = { inputSource: 'expression', expression: '"nested-image"' };
	assert.throws(dynamic.file, /Invalid static setting/);
});

// 【素材の加工式は無効化中や未選択の基準値でも転送しない】
// コード内のIDは取り込み時に再割り当てできず、無効な式も再有効化すると参照切れになる。
// 基準値だけの収集で成功扱いにしないよう、直接参照・ネスト・公開既定値と読み込み側も確認する。
test('rejects bindings and modifiers inside static settings on export and import', () => {
	for (const key of ['image', 'video', 'font']) {
		for (const enabled of [true, false]) {
			const f = fixture();
			const file = f.file();
			f.nodesEffect.nodes[0].staticSettings[key] = { inputSource: 'literal', value: null, expressionModifier: { enabled, code: '"unused"' } };
			assert.throws(f.file, /Invalid static setting/);
			file.nodesEffect = f.nodesEffect;
			assert.throws(() => prepareNodesEffectImport(file, f.definitions), /Invalid static setting/);
		}
	}
});

// 【素材参照以外の加工式と、加工式のない未選択値はそのまま転送できる】
// 素材を列挙できない場合だけ拒否し、通常の数値加工やnullによる未選択まで制限しない。
test('preserves non-resource modifiers and permits unmodified unselected resources', () => {
	const f = fixture();
	f.nodesEffect.nodes[0].params.amount.expressionModifier = { enabled: true, code: 'VALUE * 2' };
	f.nodesEffect.nodes[0].staticSettings.video = null;
	const imported = prepareNodesEffectImport(f.file(), f.definitions);
	assert.deepEqual(imported.nodesEffect.definition.nodes[0].params.amount, f.nodesEffect.nodes[0].params.amount);
	assert.equal(imported.nodesEffect.definition.nodes[0].staticSettings.video, null);
});

// 【専用形式以外と未来の形式は読み込みを拒否する】
// プロジェクトファイルや形式の異なるデータをNodes Effectとして誤って状態へ追加しない。
// 現行形式のみを扱い、旧形式のマイグレーションは行わない。
test('rejects other formats future versions and invalid media bytes', async () => {
	const f = fixture();
	for (const changes of [{ kind: 'project' }, { formatVersion: 3 }, { gsVersion: '3.0.0' }]) {
		const data = await encodeNodesEffectFile({ ...f.file(), ...changes });
		assert.throws(() => decodeNodesEffectFile(data, f.input.gsVersion), /Unsupported|newer version/);
	}
	assert.throws(() => decodeNodesEffectFile(new Uint8Array([0xc0]), f.input.gsVersion), /Unsupported/);
	const { encode } = await import('@msgpack/msgpack');
	assert.throws(() => decodeNodesEffectFile(encode({ ...f.file(), assets: [{ id: 'asset', fileData: [1, 2] }] }), f.input.gsVersion), /Invalid Asset data/);
});

// 【新規作成を一回のUndoで戻し、Redoでも同じ定義を登録する】
// Nodes Effectがまだないプロジェクトでも、既存の定義がある場合でも作成できる必要がある。
// 初期名には作成後の個数を使い、空なら「Nodes Effect 1」、既存が一つなら「Nodes Effect 2」にする。
// 既存の定義を残しつつ、追加・削除をWorkerへ通知し、Redo時に内部ポートのIDも維持する。
test('creates a Nodes Effect with synchronized undo and redo in empty and populated projects', async t => {
	for (const populated of [false, true]) {
		const manager = new ProjectContext(createTestProject()).stateManager;
		const existing = populated ? [createProjectNodesEffect(0)] : [];
		manager.state.nodesEffects.value = structuredClone(existing);
		let replica = { customShaderEffects: [], nodesEffects: structuredClone(existing), timelineScenes: [] };
		const sync = new RendererProjectSynchronizer(manager, {
			apply: async changes => { replica = applyRendererProjectChanges(replica, changes); },
			replace: async () => assert.fail('No recovery snapshot should be necessary'), onUpdated() {}, onError: error => assert.fail(error),
		});
		t.after(() => sync.dispose());
		const target = manager.commit('createNodesEffect', {});
		const nodesEffect = manager.state.nodesEffects.value.find(candidate => candidate.id === target.nodesEffectId);
		await sync.flush();
		assert.equal(manager.undoStack.value.length, 1);
		assert.equal(nodesEffect.name, populated ? 'Nodes Effect 2' : 'Nodes Effect 1');
		assert.deepEqual(replica.nodesEffects, [...existing, nodesEffect]);
		assert.equal(nodesEffect.definition.nodes.length, 0);
		assert.equal(nodesEffect.definition.paramDefs[nodesEffect.definition.primaryInputParameter].dataType.kind, 'color');
		assert.equal(nodesEffect.definition.outputDefs[nodesEffect.definition.primaryOutput].dataType.kind, 'color');
		assert.deepEqual(nodesEffect.definition.outputSources, {});
		manager.undo();
		await sync.flush();
		assert.deepEqual(manager.state.nodesEffects.value, existing);
		assert.deepEqual(replica.nodesEffects, existing);
		manager.redo();
		await sync.flush();
		assert.deepEqual(manager.state.nodesEffects.value, [...existing, nodesEffect]);
		assert.deepEqual(replica.nodesEffects, [...existing, nodesEffect]);
	}
});

// 【連続作成したNodes EffectはIDと内部状態を共有しない】
// 同じ名前のNodes Effectを作成しても、片方の編集が別の定義へ混入してはいけない。
// IDが衝突した場合も、既存の定義や履歴を壊さず追加を拒否する。
test('keeps newly created Nodes Effects independent and rejects duplicate registration', () => {
	const manager = new ProjectContext(createTestProject()).stateManager;
	const firstTarget = manager.commit('createNodesEffect', { name: 'Same' });
	const secondTarget = manager.commit('createNodesEffect', { name: 'Same' });
	const first = manager.state.nodesEffects.value.find(candidate => candidate.id === firstTarget.nodesEffectId);
	const second = manager.state.nodesEffects.value.find(candidate => candidate.id === secondTarget.nodesEffectId);
	assert.deepEqual(first.definition.customParameterDefs, {});
	assert.deepEqual(first.definition.customParameterValues, {});
	assert.notEqual(first.definition.customParameterDefs, second.definition.customParameterDefs);
	assert.notEqual(first.definition.customParameterValues, second.definition.customParameterValues);
	const collectIds = nodesEffect => [nodesEffect.id, ...nodesEffect.definition.nodes.map(node => node.id), ...Object.keys(nodesEffect.definition.paramDefs), ...Object.keys(nodesEffect.definition.outputDefs)];
	const ids = [...collectIds(first), ...collectIds(second)];
	assert.equal(new Set(ids).size, ids.length);
	first.definition.paramDefs[first.definition.primaryInputParameter].defaultValue[0] = 1;
	assert.deepEqual(second.definition.paramDefs[second.definition.primaryInputParameter].defaultValue, [0, 0, 0, 0]);
	assert.throws(() => manager.commit('importNodesEffect', { nodesEffect: first, assets: [] }), /already exists/);
	assert.equal(manager.undoStack.value.length, 2);
	assert.deepEqual(manager.state.nodesEffects.value, [first, second]);
});

// 【取り込み全体を一回のUndoで戻し、Redoでも同じIDで同期する】
// ノードと素材を別々の履歴へ分けると、不完全な構成が残ってしまう。
// Workerの登録・削除も差分で反映し、復旧用の全量置換が必要になる不具合を検出する。
test('imports assets and a Nodes Effect with one synchronized undo and redo', async t => {
	const f = fixture();
	const prepared = prepareNodesEffectImport(f.file(), f.definitions, ids('import'));
	const manager = new ProjectContext(createTestProject()).stateManager;
	const existingAsset = asset('existing');
	manager.state.assets.value = [existingAsset];
	let replica = { customShaderEffects: [], nodesEffects: [], timelineScenes: [] };
	const batches = [], errors = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); replica = applyRendererProjectChanges(replica, changes); },
		replace: async () => assert.fail('No recovery snapshot should be necessary'), onUpdated() {}, onError: error => errors.push(error),
	});
	t.after(() => sync.dispose());
	manager.commit('importNodesEffect', prepared);
	await sync.flush();
	assert.equal(manager.undoStack.value.length, 1);
	assert.equal(manager.state.assets.value.length, prepared.assets.length + 1);
	assert.deepEqual(replica.nodesEffects, [prepared.nodesEffect]);
	manager.undo();
	await sync.flush();
	assert.deepEqual(manager.state.assets.value.map(item => item.id), ['existing']);
	assert.equal(replica.nodesEffects.length, 0);
	assert.equal(batches.at(-1)[0].nodesEffect, null);
	manager.redo();
	await sync.flush();
	assert.deepEqual(replica.nodesEffects, [prepared.nodesEffect]);
	assert.deepEqual(manager.state.assets.value.map(item => item.id), ['existing', ...prepared.assets.map(item => item.id)]);
	assert.deepEqual(errors, []);
});

// 【同じターンの取り込み・編集・取消しは登録の最終状態だけを送る】
// Undoで既に存在しないノードを同期処理が検索してエラーにしない。
// 取り込み直後に変更したノードも、登録データへまとめて反映する。
test('coalesces registration edits and removal before synchronization', async t => {
	const f = fixture();
	const prepared = prepareNodesEffectImport(f.file(), f.definitions);
	const manager = new ProjectContext(createTestProject()).stateManager;
	const batches = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); }, replace: async () => assert.fail(), onUpdated() {}, onError: error => assert.fail(error),
	});
	t.after(() => sync.dispose());
	manager.commit('importNodesEffect', prepared);
	manager.commit('setNodesEffectNodeBypass', { target: { nodesEffect: { nodesEffectId: prepared.nodesEffect.id }, nodeId: 'effect' }, bypass: true });
	await sync.flush();
	assert.equal(batches[0].length, 1);
	assert.equal(batches[0][0].nodesEffect.definition.nodes[0].isBypass, true);
	manager.undo();
	manager.undo();
	await sync.flush();
	assert.deepEqual(batches[1], [{ type: 'nodesEffectRegistration', nodesEffectId: prepared.nodesEffect.id, nodesEffect: null }]);
});

// 【ID衝突で取り込みに失敗しても素材と履歴を増やさない】
// 正常なUIでは新しいIDを生成するが、Commandの境界でも途中まで追加する状態を防ぐ。
test('keeps project state and history unchanged when import IDs collide', () => {
	const f = fixture();
	const prepared = prepareNodesEffectImport(f.file(), f.definitions);
	const manager = new ProjectContext(createTestProject()).stateManager;
	manager.state.assets.value.push(prepared.assets[0]);
	assert.throws(() => manager.commit('importNodesEffect', prepared), /already exists/);
	assert.equal(manager.state.nodesEffects.value.length, 0);
	assert.equal(manager.undoStack.value.length, 0);
});

function platform(t, selectedFile) {
	const originalWindow = globalThis.window;
	globalThis.nodesEffectAlerts = [];
	const links = [];
	globalThis.window = { document: { createElement: type => {
		if (type === 'a') { const link = { click() { links.push(this); } }; return link; }
		const listeners = {};
		return { files: selectedFile ? [selectedFile] : [], addEventListener(event, listener) { listeners[event] = listener; },
			click() { listeners[selectedFile ? 'change' : 'cancel'](); } };
	} }, setTimeout(callback) { callback(); } };
	t.after(() => { globalThis.window = originalWindow; delete globalThis.nodesEffectAlerts; });
	return { links, alerts: globalThis.nodesEffectAlerts, selectFile(file) { selectedFile = file; } };
}

// 【ファイル選択の取消しやプロジェクト終了では取り込まない】
// ファイル読み出しの完了が遅れても、終了したProjectContextへ履歴を追加しない。
test('cancels file selection and rejects an import after the project closes', async t => {
	const browser = platform(t, null);
	const context = new ProjectContext(createTestProject());
	assert.equal(await importNodesEffectFile(context), null);
	assert.equal(context.stateManager.undoStack.value.length, 0);
	const file = { kind: 'glitch-studio-nodes-effect', formatVersion: 2, nodesEffects: [], customShaderEffects: [], gsVersion: '2.0.0-alpha.1', name: 'Empty',
		nodesEffect: testNodesEffect(), assets: [] };
	const data = await encodeNodesEffectFile(file);
	const reading = Promise.withResolvers();
	browser.selectFile({ arrayBuffer: () => reading.promise });
	const importing = importNodesEffectFile(context);
	await Promise.resolve();
	context.dispose();
	reading.resolve(new Uint8Array(data).buffer);
	assert.equal(await importing, null);
	assert.equal(context.stateManager.state.nodesEffects.value.length, 0);
	assert.equal(browser.alerts.length, 0);
});

// 【選択したファイルから登録し、読めないファイルでは既存の状態を保つ】
// codecとCommandを個別に検証するだけでは、ファイル読み出しを繋ぐUI側の失敗を見落とす。
// 実際のFileからの取り込みを通して新しい登録IDと表示名を確認し、失敗時には履歴を増やさない。
test('imports a selected file and preserves existing state when the next file cannot be decoded', async t => {
	const context = new ProjectContext(createTestProject());
	const file = { kind: 'glitch-studio-nodes-effect', formatVersion: 2, nodesEffects: [], customShaderEffects: [], gsVersion: '2.0.0-alpha.1', name: 'Imported Nodes Effect',
		nodesEffect: testNodesEffect(), assets: [] };
	const data = await encodeNodesEffectFile(file);
	const browser = platform(t, new File([new Uint8Array(data)], 'import.gsne'));
	const id = await importNodesEffectFile(context);
	assert.equal(typeof id, 'string');
	assert.equal(context.stateManager.state.nodesEffects.value[0].id, id);
	assert.equal(context.stateManager.state.nodesEffects.value[0].name, file.name);
	assert.equal(context.stateManager.undoStack.value.length, 1);
	assert.equal(browser.alerts.length, 0);
	browser.selectFile(new File([new Uint8Array([0xc0])], 'invalid.gsne'));
	assert.equal(await importNodesEffectFile(context), null);
	assert.equal(context.stateManager.state.nodesEffects.value.length, 1);
	assert.equal(context.stateManager.undoStack.value.length, 1);
	assert.equal(browser.alerts.length, 1);
});

// 【原本の読み出しに失敗したときはダウンロードを始めない】
// エンコードが完了してからダウンロードを作り、素材の欠落したファイルを成功扱いにしない。
test('reports asset read errors before creating a download', async t => {
	const { links, alerts } = platform(t, null);
	const context = new ProjectContext(createTestProject());
	const broken = asset('broken');
	broken.fileData = new class extends Blob { async arrayBuffer() { throw new Error('Unreadable'); } }();
	context.stateManager.state.assets.value = [broken];
	await exportNodesEffectFile(context, testNodesEffect({ nodes: [{ id: 'image', type: 'effect', effectSource: { type: 'nativeEffect', id: 'image' }, staticSettings: { image: 'broken' }, params: { fit: literal('contain') } }] }), 'Broken');
	assert.equal(links.length, 0);
	assert.equal(alerts.length, 1);
});
