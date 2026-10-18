import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	stdin: { contents: "export { ProjectContext } from './src/Project.ts';", loader: 'ts', resolveDir: directory },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	define: { _VERSION_: '"2.0.0-alpha"' },
	plugins: [{ name: 'asset-history-dependencies', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts',
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: 'export const effectDefinitions = {};',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'console', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, { ...console, log() {} });
const { ProjectContext } = module.exports;

const externalAsset = (id, sourceFilePath = `C:/assets/${id}.mp4`) => ({
	id, name: id, isExternalReference: true, sourceFilePath, width: 640, height: 360,
	fileDataType: 'video/mp4', fileData: { url: `app://external-assets/${id}`, size: 100, error: null },
	thumbnailSequence: null,
});
const project = assets => ({
	id: 'project', gsVersion: '2.0.0-alpha', name: 'Project', description: '', author: '', exportSettings: null,
	timelineFps: 30, timelineMotionBlur: { enabled: false, shutterAngle: 360, samples: 32 }, resolution: { width: 1920, height: 1080 },
	assets, players: [], generatedSpeech: [], visualModules: [], timelineScenes: [],
});
const thumbnails = width => ({ width, height: 90, frames: [{ timestampSeconds: 0, fileData: new Blob([String(width)]) }] });

function fixture(assets) {
	const context = new ProjectContext();
	context.load(project(assets.map(asset => ({ ...asset }))));
	const manager = context.stateManager;
	const findAsset = id => manager.state.assets.value.find(asset => asset.id === id);
	function reload(id, update) {
		const asset = findAsset(id);
		context.externalAssetMetadata.record({ ...asset, ...update });
		Object.assign(asset, update);
	}
	return { context, manager, findAsset, reload };
}

// 【別アセットの削除をUndoしても、リロードしたアセットの情報と同一性を維持する】
// アセット配列全体の復元は、Undo対象外のリロードを巻き戻し、既存Playerにも影響する。
// 削除対象だけが元の順序に戻り、最新情報が保存スナップショットにも残ることを確認する。
test('undoes asset removal without replacing or reverting other reloaded assets', () => {
	const { context, manager, findAsset, reload } = fixture([externalAsset('first'), externalAsset('second'), externalAsset('third')]);
	const first = findAsset('first');
	manager.commit('removeAsset', { assetId: 'second' });
	reload('first', { width: 1280, thumbnailSequence: thumbnails(320) });
	manager.undo();
	assert.deepEqual(manager.state.assets.value.map(asset => asset.id), ['first', 'second', 'third']);
	assert.equal(findAsset('first'), first);
	assert.equal(first.width, 1280);
	assert.equal(first.thumbnailSequence.width, 320);
	assert.equal(context.snapshot().assets[0].width, 1280);
	manager.redo();
	assert.equal(findAsset('first'), first);
	assert.equal(first.width, 1280);
});

// 【再リンクと取り込みのUndo/Redoでは、参照先ごとの最新リロード情報を同期前に復元する】
// replaceAssetやimportAssetsのpayloadは過去の寸法を保持するが、外部原本の過去は復元しない。
// 元のパスと再リンク先を混同せず、後続の変更購読側にも最新の情報を渡す必要がある。
test('keeps the latest metadata per path across relink and import history', () => {
	const { context, manager, findAsset, reload } = fixture([]);
	const asset = externalAsset('asset');
	manager.commit('importAssets', { assets: [asset], players: [] });
	reload(asset.id, { width: 800, thumbnailSequence: thumbnails(200) });
	const replacement = { ...asset, sourceFilePath: 'C:/assets/relinked.mp4', width: 1000 };
	context.externalAssetMetadata.record(replacement);
	manager.commit('replaceAsset', { ...replacement, assetId: asset.id });
	reload(asset.id, { width: 1600, thumbnailSequence: thumbnails(300), hash: 'latest' });
	const observed = [];
	manager.onChange(() => { observed.push(findAsset(asset.id)?.width ?? null); });
	manager.undo();
	assert.equal(findAsset(asset.id).sourceFilePath, asset.sourceFilePath);
	assert.equal(findAsset(asset.id).width, 800);
	manager.redo();
	assert.equal(findAsset(asset.id).sourceFilePath, replacement.sourceFilePath);
	assert.equal(findAsset(asset.id).width, 1600);
	assert.equal(findAsset(asset.id).thumbnailSequence.width, 300);
	assert.equal(findAsset(asset.id).hash, 'latest');
	manager.undo();
	manager.undo();
	assert.equal(findAsset(asset.id), undefined);
	manager.redo();
	assert.equal(findAsset(asset.id).width, 800);
	assert.equal(findAsset(asset.id).thumbnailSequence.width, 200);
	assert.deepEqual(observed, [800, 1600, 800, null, 800]);
});

// 【埋め込みへ戻す履歴はBlobと対応する寸法を復元し、外部参照の最新情報で上書きしない】
// 外部参照のモードやパスだけをUndoする仕様と、埋め込み原本のスナップショットを区別する。
// 同じ参照先を再選択した場合の取り込み結果も、過去のキャッシュより優先させる。
test('preserves embedded snapshots while restoring the latest external metadata', () => {
	const embedded = { ...externalAsset('asset'), isExternalReference: false, fileData: new Blob(['embedded']), width: 320 };
	const { context, manager, findAsset, reload } = fixture([embedded]);
	const external = externalAsset(embedded.id);
	context.externalAssetMetadata.record(external);
	manager.commit('replaceAsset', { ...external, assetId: embedded.id });
	reload(embedded.id, { width: 1280 });
	manager.undo();
	assert.equal(findAsset(embedded.id).fileData, embedded.fileData);
	assert.equal(findAsset(embedded.id).width, 320);
	manager.redo();
	assert.equal(findAsset(embedded.id).width, 1280);
	const reselected = { ...external, width: 1920 };
	context.externalAssetMetadata.record(reselected);
	manager.commit('replaceAsset', { ...reselected, assetId: embedded.id });
	assert.equal(findAsset(embedded.id).width, 1920);
	manager.undo();
	assert.equal(findAsset(embedded.id).width, 1920);
	manager.commit('replaceAsset', { ...embedded, assetId: embedded.id });
	manager.undo();
	reload(embedded.id, { width: 2560 });
	manager.redo();
	assert.equal(findAsset(embedded.id).width, 320);
	assert.equal(findAsset(embedded.id).fileData, embedded.fileData);
	manager.undo();
	assert.equal(findAsset(embedded.id).width, 2560);
	assert.equal(findAsset(embedded.id).isExternalReference, true);
});

// 【同じ原本を参照する別アセットや、次に読み込んだプロジェクトにリロード結果を流用しない】
// リロードは選んだアセットだけへの操作であり、履歴用の情報はプロジェクトの寿命に限る。
// IDとパスが再利用されても、別プロジェクトの保存済みメタデータを上書きしない。
test('isolates metadata between assets and clears it when loading a project', () => {
	const first = externalAsset('first');
	const second = externalAsset('second', first.sourceFilePath);
	const { context, manager, findAsset, reload } = fixture([first, second]);
	reload(first.id, { width: 1920 });
	manager.commit('removeAsset', { assetId: second.id });
	manager.undo();
	assert.equal(findAsset(first.id).width, 1920);
	assert.equal(findAsset(second.id).width, 640);
	context.load(project([{ ...first, width: 400 }]));
	manager.commit('renameAsset', { assetId: first.id, name: 'Renamed' });
	assert.equal(findAsset(first.id).width, 400);
	assert.equal(findAsset(first.id).name, 'Renamed');
	assert.equal(context.snapshot().assets[0].width, 400);
});
