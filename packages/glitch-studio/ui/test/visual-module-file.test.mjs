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
		export * from './src/gsvm.ts';
		export * from './src/utility/visual-module-file.ts';
		export { ProjectContext } from './src/Project.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
	` },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { _VERSION_: '"2.0.0-alpha.1"' },
	plugins: [{ name: 'visual-module-file-platform', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$|(?:\/|\\)ui\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts',
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: /ui\.ts$/.test(path) ? 'export async function alert(options) { globalThis.visualModuleAlerts.push(options); }'
					: 'export const effectDefinitions = {};',
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', 'console', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports, { ...console, log() {}, error() {} });
const { collectVisualModuleFile, encodeVisualModuleFile, decodeVisualModuleFile, prepareVisualModuleImport,
	ProjectContext, RendererProjectSynchronizer, applyRendererProjectChanges, importVisualModuleFile, exportVisualModuleFile } = loaded.exports;

const literal = value => ({ inputSource: 'literal', value });
const parameter = (kind, value = null) => ({ dataType: { kind }, ui: { label: kind, control: {} }, defaultValue: literal(value) });
function asset(id, type = 'image/png') {
	return { id, name: id, width: 12, height: 8, fileDataType: type, fileData: new Blob([new Uint8Array([1, 2, 3, 4])], { type }),
		sourceFilePath: 'C:/private/' + id, hash: 'hash-' + id };
}
function fixture() {
	const nested = {
		dataType: { kind: 'array', elementType: { kind: 'struct', fields: { image: { kind: 'assetReference' }, font: { kind: 'fontAssetReference' } } } },
		ui: { label: 'Nested', control: { element: { fields: { image: { label: 'Image', control: {} }, font: { label: 'Font', control: {} } } } } },
		defaultValue: literal([]),
		element: { defaultValue: literal({ image: literal(null), font: literal(null) }),
			fields: { image: { defaultValue: literal(null) }, font: { defaultValue: literal(null) } } },
	};
	const definitions = { resources: { paramDefs: {
		image: parameter('assetReference'), video: parameter('videoAssetReference'), player: parameter('playerReference'),
		audio: parameter('audioSource'), nested, amount: parameter('scalar', 1), input: { ...parameter('color', [0, 0, 0, 0]), canNode: true },
	} } };
	const template = structuredClone(nested);
	template.id = 'template'; template.nameForReference = 'template'; template.canNode = false;
	template.element.defaultValue.value.image.value = 'template-image';
	template.element.fields.font.defaultValue.value = 'template-font';
	const visualModule = {
		id: 'source-visual-module', name: 'Source Visual Module',
		nodes: [
			{ id: 'in', type: 'globalIn' },
			{ id: 'effect', type: 'effect', effectId: 'resources', displayName: 'Resource Node', isBypass: false, resolution: { mode: 'auto' }, pos: { x: 3, y: 4 },
				params: { image: { inputSource: 'externalCustomParameterInput', parameterId: 'image' }, video: literal('video'), player: literal('file-player'),
					audio: literal({ type: 'player', playerId: 'microphone' }), amount: { inputSource: 'expression', expression: 'TIME * 0.5' },
					nested: literal([{ id: 'element', binding: literal({ image: literal('nested-image'), font: literal('font') }) }]),
					input: { inputSource: 'node', nodeId: 'in', outputPort: 'input', fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' } } },
			{ id: 'relay', type: 'relay', dataType: { kind: 'color' }, input: { nodeId: 'effect', outputPort: 'output' } },
			{ id: 'out', type: 'globalOut', inputs: { output: { nodeId: 'relay', outputPort: 'output' } } },
		],
		paramDefs: [{ ...parameter('assetReference', 'default-image'), id: 'image', nameForReference: 'image', canNode: false }, template,
			{ ...parameter('color', [0, 0, 0, 0]), id: 'input', nameForReference: 'input', canNode: true },
			{ ...parameter('audioSource'), id: 'audio', nameForReference: 'audio', canNode: false }],
		outputDefs: [{ id: 'output', name: 'output', label: 'Output', dataType: { kind: 'color' } }],
		primaryInputId: 'input', primaryAudioInputId: 'audio', primaryOutputId: 'output',
		automationGraphs: [{ id: 'graph', name: 'Graph', isNormalized: true, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
	};
	const assets = [asset('video', 'video/mp4'), asset('nested-image'), asset('font', 'font/ttf'), asset('default-image'), asset('template-image'), asset('template-font', 'font/otf'), asset('unused')];
	const players = [{ id: 'file-player', name: 'Movie', sourceType: 'asset', assetId: 'video' },
		{ id: 'microphone', name: 'Mic', sourceType: 'microphone' }, { id: 'unused-player', name: 'Unused', sourceType: 'webcam' }];
	const input = { name: visualModule.name, gsVersion: '2.0.0-alpha.1', visualModule, assets, players };
	return { input, definitions, visualModule, file: () => collectVisualModuleFile(input, definitions) };
}
function ids(prefix) { let index = 0; return () => `${prefix}-${++index}`; }

// 【参照された原本と公開パラメータの既定値だけを持ち運べる】
// ノードが公開パラメータ経由で画像を読む場合や、空配列の要素追加用の初期値も見落としてはいけない。
// 同じ動画をノードとPlayerが参照しても一度だけ同梱し、無関係な素材や元PCのパスを含めない。
test('round trips referenced media and definition defaults without project paths or unused resources', async () => {
	const f = fixture();
	const file = f.file();
	assert.equal(file.visualModule.id, undefined);
	assert.equal(file.visualModule.name, undefined);
	assert.deepEqual(file.assets.map(item => item.id).sort(), ['video', 'nested-image', 'font', 'default-image', 'template-image', 'template-font'].sort());
	assert.deepEqual(file.players.map(item => item.id), ['file-player', 'microphone']);
	assert.ok(file.assets.every(item => !('sourceFilePath' in item)));
	f.visualModule.nodes[1].displayName = 'Edited after export';
	f.visualModule.paramDefs[0].defaultValue.value = null;
	const decoded = decodeVisualModuleFile(await encodeVisualModuleFile(file), f.input.gsVersion);
	assert.deepEqual(decoded.visualModule, file.visualModule);
	assert.deepEqual(decoded.players, file.players);
	for (const item of decoded.assets) {
		assert.equal(item.fileData.type, item.fileDataType);
		assert.deepEqual([...new Uint8Array(await item.fileData.arrayBuffer())], [1, 2, 3, 4]);
	}
	assert.equal(decoded.visualModule.nodes[1].displayName, 'Resource Node');
	assert.equal(decoded.visualModule.paramDefs[0].defaultValue.value, 'default-image');
});

// 【取り込みごとに共有リソースのIDを変え、内部の配線と既定値を維持する】
// 同じファイルを二度取り込んだり、元プロジェクトへ戻したりしても素材やPlayerを共有してはいけない。
// マイクは未指定に戻すが、参照先のPlayer自体は残して入力だけを選び直せるようにする。
test('remaps project resources while preserving local wiring and resetting device players', () => {
	const f = fixture();
	const file = f.file();
	const first = prepareVisualModuleImport(file, f.definitions, ids('first'));
	const second = prepareVisualModuleImport(file, f.definitions, ids('second'));
	assert.notEqual(first.visualModule.id, second.visualModule.id);
	assert.ok(first.assets.every(item => item.sourceFilePath === null && !second.assets.some(other => other.id === item.id)));
	assert.deepEqual(first.visualModule.nodes.map(node => node.id), file.visualModule.nodes.map(node => node.id));
	assert.deepEqual(first.visualModule.nodes[1].params.input, file.visualModule.nodes[1].params.input);
	assert.deepEqual(first.visualModule.nodes[2], file.visualModule.nodes[2]);
	assert.deepEqual(first.visualModule.nodes[3], file.visualModule.nodes[3]);
	assert.deepEqual(first.visualModule.automationGraphs, file.visualModule.automationGraphs);
	const importedAsset = name => first.assets.find(item => item.name === name).id;
	const params = first.visualModule.nodes[1].params;
	assert.equal(params.video.value, importedAsset('video'));
	assert.equal(params.nested.value[0].binding.value.image.value, importedAsset('nested-image'));
	assert.equal(first.visualModule.paramDefs[0].defaultValue.value, importedAsset('default-image'));
	assert.equal(first.visualModule.paramDefs[1].element.defaultValue.value.image.value, importedAsset('template-image'));
	assert.equal(first.visualModule.paramDefs[1].element.fields.font.defaultValue.value, importedAsset('template-font'));
	assert.equal(first.players[0].assetId, importedAsset('video'));
	assert.equal(params.player.value, first.players[0].id);
	assert.deepEqual(params.audio.value, { type: 'player', playerId: first.players[1].id });
	assert.equal(first.players[1].sourceType, null);
	assert.deepEqual(first.unassignedPlayerNames, ['Mic']);
	assert.equal(file.visualModule.paramDefs[0].defaultValue.value, 'default-image');
});

// 【未知の参照や動的な素材選択は状態変更の前に失敗する】
// 式の文字列置換で無関係な文字を変えたり、素材を失った構成を正常な取り込みとして扱ったりしない。
// ネストした参照も同じ制約を適用し、数値用の式はそのまま持ち運べる。
test('rejects missing resources unknown effects and dynamic resource bindings', () => {
	const missingAsset = fixture();
	missingAsset.input.assets = missingAsset.input.assets.filter(item => item.id !== 'default-image');
	assert.throws(missingAsset.file, /Missing Asset/);
	const missingPlayer = fixture();
	missingPlayer.input.players = [];
	assert.throws(missingPlayer.file, /Missing Player/);
	const unknown = fixture();
	unknown.visualModule.nodes[1].effectId = 'unknown';
	assert.throws(unknown.file, /Unknown effect/);
	const dynamic = fixture();
	dynamic.visualModule.nodes[1].params.nested.value[0].binding.value.image = { inputSource: 'expression', expression: '"nested-image"' };
	assert.throws(dynamic.file, /fixed value or a Custom Parameter/);
	const missingPlayerAsset = fixture();
	missingPlayerAsset.input.players[0].assetId = 'absent';
	assert.throws(missingPlayerAsset.file, /Missing Asset/);
});

// 【専用形式以外と未来の形式は読み込みを拒否する】
// プロジェクトファイルや形式の異なるデータをVisual Moduleとして誤って状態へ追加しない。
// 現行形式のみを扱い、旧形式のマイグレーションは行わない。
test('rejects other formats future versions and invalid media bytes', async () => {
	const f = fixture();
	for (const changes of [{ kind: 'project' }, { formatVersion: 2 }, { gsVersion: '3.0.0' }]) {
		const data = await encodeVisualModuleFile({ ...f.file(), ...changes });
		assert.throws(() => decodeVisualModuleFile(data, f.input.gsVersion), /Unsupported|newer version/);
	}
	assert.throws(() => decodeVisualModuleFile(new Uint8Array([0xc0]), f.input.gsVersion), /Unsupported/);
	const { encode } = await import('@msgpack/msgpack');
	assert.throws(() => decodeVisualModuleFile(encode({ ...f.file(), assets: [{ id: 'asset', fileData: [1, 2] }] }), f.input.gsVersion), /Invalid Asset data/);
});

// 【取り込み全体を一回のUndoで戻し、Redoでも同じIDで同期する】
// ノード・素材・Playerを別々の履歴へ分けると、不完全な構成が残ってしまう。
// Workerの登録・削除も差分で反映し、復旧用の全量置換が必要になる不具合を検出する。
test('imports assets players and a Visual Module with one synchronized undo and redo', async t => {
	const f = fixture();
	const prepared = prepareVisualModuleImport(f.file(), f.definitions, ids('import'));
	const manager = new ProjectContext().stateManager;
	const existingAsset = asset('existing');
	manager.state.assets.value = [existingAsset];
	let replica = { visualModules: [], timelineScenes: [] };
	const batches = [], errors = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); replica = applyRendererProjectChanges(replica, changes); },
		replace: async () => assert.fail('No recovery snapshot should be necessary'), onUpdated() {}, onError: error => errors.push(error),
	});
	t.after(() => sync.dispose());
	manager.commit('importVisualModule', prepared);
	await sync.flush();
	assert.equal(manager.undoStack.value.length, 1);
	assert.equal(manager.state.assets.value.length, prepared.assets.length + 1);
	assert.equal(manager.state.players.value.length, prepared.players.length);
	assert.deepEqual(replica.visualModules, [prepared.visualModule]);
	manager.undo();
	await sync.flush();
	assert.deepEqual(manager.state.assets.value.map(item => item.id), ['existing']);
	assert.equal(manager.state.players.value.length, 0);
	assert.equal(replica.visualModules.length, 0);
	assert.equal(batches.at(-1)[0].visualModule, null);
	manager.redo();
	await sync.flush();
	assert.deepEqual(replica.visualModules, [prepared.visualModule]);
	assert.deepEqual(manager.state.assets.value.map(item => item.id), ['existing', ...prepared.assets.map(item => item.id)]);
	assert.deepEqual(errors, []);
});

// 【同じターンの取り込み・編集・取消しは登録の最終状態だけを送る】
// Undoで既に存在しないノードを同期処理が検索してエラーにしない。
// 取り込み直後に変更したノードも、登録データへまとめて反映する。
test('coalesces registration edits and removal before synchronization', async t => {
	const f = fixture();
	const prepared = prepareVisualModuleImport(f.file(), f.definitions);
	const manager = new ProjectContext().stateManager;
	const batches = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); }, replace: async () => assert.fail(), onUpdated() {}, onError: error => assert.fail(error),
	});
	t.after(() => sync.dispose());
	manager.commit('importVisualModule', prepared);
	manager.commit('changeNodeBypassState', { visualModuleId: prepared.visualModule.id, nodeId: 'effect', bypass: true });
	await sync.flush();
	assert.equal(batches[0].length, 1);
	assert.equal(batches[0][0].visualModule.nodes[1].isBypass, true);
	manager.undo();
	manager.undo();
	await sync.flush();
	assert.deepEqual(batches[1], [{ type: 'visualModuleRegistration', visualModuleId: prepared.visualModule.id, visualModule: null }]);
});

// 【ID衝突で取り込みに失敗しても素材と履歴を増やさない】
// 正常なUIでは新しいIDを生成するが、Commandの境界でも途中まで追加する状態を防ぐ。
test('keeps project state and history unchanged when import IDs collide', () => {
	const f = fixture();
	const prepared = prepareVisualModuleImport(f.file(), f.definitions);
	const manager = new ProjectContext().stateManager;
	manager.state.players.value = [{ id: prepared.players[1].id, name: 'Existing', sourceType: null }];
	assert.throws(() => manager.commit('importVisualModule', prepared), /already exists/);
	assert.equal(manager.state.assets.value.length, 0);
	assert.equal(manager.state.visualModules.value.length, 0);
	assert.equal(manager.state.players.value.length, 1);
	assert.equal(manager.undoStack.value.length, 0);
});

function platform(t, selectedFile) {
	const originalWindow = globalThis.window;
	globalThis.visualModuleAlerts = [];
	const links = [];
	globalThis.window = { document: { createElement: type => {
		if (type === 'a') { const link = { click() { links.push(this); } }; return link; }
		const listeners = {};
		return { files: selectedFile ? [selectedFile] : [], addEventListener(event, listener) { listeners[event] = listener; },
			click() { listeners[selectedFile ? 'change' : 'cancel'](); } };
	} }, setTimeout(callback) { callback(); } };
	t.after(() => { globalThis.window = originalWindow; delete globalThis.visualModuleAlerts; });
	return { links, alerts: globalThis.visualModuleAlerts, selectFile(file) { selectedFile = file; } };
}

// 【ファイル選択の取消しやプロジェクト再読込では取り込まない】
// ダイアログ・ファイル読み出しの待ち時間を跨いで、以前の操作を別のプロジェクトへ適用しない。
test('cancels file selection and rejects an import after the project generation changes', async t => {
	const browser = platform(t, null);
	const context = new ProjectContext();
	assert.equal(await importVisualModuleFile(context), null);
	assert.equal(context.stateManager.undoStack.value.length, 0);
	const file = { kind: 'glitch-studio-visual-module', formatVersion: 1, gsVersion: '2.0.0-alpha.1', name: 'Empty',
		visualModule: { nodes: [], paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] }, assets: [], players: [] };
	const data = await encodeVisualModuleFile(file);
	const reading = Promise.withResolvers();
	browser.selectFile({ arrayBuffer: () => reading.promise });
	const importing = importVisualModuleFile(context);
	await Promise.resolve();
	context.load({ id: 'replacement', name: 'Replacement', description: '', author: '', resolution: { width: 16, height: 16 },
		timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 1 }, assets: [], generatedSpeech: [], players: [], visualModules: [], timelineScenes: [] });
	reading.resolve(new Uint8Array(data).buffer);
	assert.equal(await importing, null);
	assert.equal(context.stateManager.state.visualModules.value.length, 0);
	assert.equal(browser.alerts.length, 0);
});

// 【選択したファイルから登録し、読めないファイルでは既存の状態を保つ】
// codecとCommandを個別に検証するだけでは、ファイル読み出しをつなぐUI側の失敗を見落とす。
// 実際のFileからの取り込みを通して新しい登録IDと表示名を確認し、失敗時には履歴を増やさない。
test('imports a selected file and preserves existing state when the next file cannot be decoded', async t => {
	const context = new ProjectContext();
	const file = { kind: 'glitch-studio-visual-module', formatVersion: 1, gsVersion: '2.0.0-alpha.1', name: 'Imported Visual Module',
		visualModule: { nodes: [], paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] }, assets: [], players: [] };
	const data = await encodeVisualModuleFile(file);
	const browser = platform(t, new File([new Uint8Array(data)], 'import.gsvm'));
	const id = await importVisualModuleFile(context);
	assert.equal(typeof id, 'string');
	assert.equal(context.stateManager.state.visualModules.value[0].id, id);
	assert.equal(context.stateManager.state.visualModules.value[0].name, file.name);
	assert.equal(context.stateManager.undoStack.value.length, 1);
	assert.equal(browser.alerts.length, 0);
	browser.selectFile(new File([new Uint8Array([0xc0])], 'invalid.gsvm'));
	assert.equal(await importVisualModuleFile(context), null);
	assert.equal(context.stateManager.state.visualModules.value.length, 1);
	assert.equal(context.stateManager.undoStack.value.length, 1);
	assert.equal(browser.alerts.length, 1);
	assert.match(browser.alerts[0].text, /Unsupported Visual Module file/);
});

// 【原本の読み出しに失敗したときはダウンロードを始めない】
// エンコードが完了してからダウンロードを作り、素材の欠落したファイルを成功扱いにしない。
test('reports asset read errors before creating a download', async t => {
	const { links, alerts } = platform(t, null);
	const context = new ProjectContext();
	const broken = asset('broken');
	broken.fileData = new class extends Blob { async arrayBuffer() { throw new Error('Unreadable'); } }();
	context.stateManager.state.assets.value = [broken];
	await exportVisualModuleFile(context, { nodes: [], paramDefs: [{ ...parameter('assetReference', 'broken'), id: 'image', nameForReference: 'image', canNode: false }],
		outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] }, 'Broken');
	assert.equal(links.length, 0);
	assert.equal(alerts.length, 1);
	assert.match(alerts[0].text, /Could not read Asset "broken"/);
});
