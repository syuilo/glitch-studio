import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { nextTick } from 'vue';

const require = createRequire(import.meta.url);
function evaluate(bundle) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
	return module.exports;
}

const buildOptions = {
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
};
const { encodeProjectFile, decodeProjectFile, loadProjectFile, saveProjectFile } = evaluate(await build({
	...buildOptions, entryPoints: ['./src/gsproj.ts'],
}));

// 実際のapp・状態管理・保存処理を組み合わせ、GPUとダイアログだけ置き換える。
const appBundle = await build({
	...buildOptions, entryPoints: ['./src/app.ts'], define: { _VERSION_: '"test-version"' },
	plugins: [{
		name: 'project-test-platform',
		setup(build) {
			build.onResolve({ filter: /RendererController\.ts$|\.vue$|^@\/ui\.ts$|effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
			build.onLoad({ filter: /.*/, namespace: 'platform' }, args => ({
				loader: 'ts', resolveDir: import.meta.dirname,
				contents: /effect-definitions\.[jt]s$/.test(args.path)
					? "import fill from '@glitch/shared/effect/fx/fill/_def_.ts'; export const effectDefinitions = { fill };"
					: args.path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
					: args.path.endsWith('RendererController.ts') ? `
					import { ref } from 'vue';
					export class RendererController {
						isReady = ref(false);
						async init() { this.isReady.value = true; }
						resize() {} updateAssets() {} updatePlayers() {} updateVisualModules() {} updateTimeline() {}
						startLiveRenderLoopFor() {} stopRenderLoop() {} renderTimelineAt() {}
						setHighlightClipping() {} changeLiveModeFpsLimit() {} setLiveTimeFactor() {}
					}
				` : args.path.endsWith('.vue') ? 'export default {};' : `
					export async function alert(options) { globalThis.projectAlerts.push(options.text); }
					export function popup() { return { dispose() {} }; }
				`,
			}));
		},
	}],
});

function project(overrides = {}) {
	return {
		id: 'project-id', gsVersion: 'test-version', name: 'Example', description: 'First line\n日本語の説明', author: 'Author',
		assets: [], players: [], visualModules: [], timeline: [], resolution: { width: 640, height: 480 },
		...overrides,
	};
}

function fileHandle(name, options = {}) {
	let bytes = options.bytes ?? new Uint8Array([42]);
	const calls = [];
	return {
		name, kind: 'file', calls,
		get bytes() { return bytes; },
		async getFile() { return new File([bytes], name); },
		async requestPermission(mode) { calls.push(['permission', mode]); return options.permission ?? 'granted'; },
		async createWritable() {
			calls.push(['create']);
			let pending;
			return {
				async write(data) {
					calls.push(['write']);
					if (options.fail === 'write') throw new Error('write failed');
					pending = data;
				},
				async close() {
					calls.push(['close']);
					if (options.fail === 'close') throw new Error('close failed');
					bytes = pending;
				},
				async abort() { calls.push(['abort']); },
			};
		},
	};
}

function setup(t) {
	const previousWindow = globalThis.window;
	const previousAlerts = globalThis.projectAlerts;
	globalThis.window = { document: { title: '' } };
	globalThis.projectAlerts = [];
	t.after(() => { globalThis.window = previousWindow; globalThis.projectAlerts = previousAlerts; });
	return globalThis.window;
}

// 名前・説明・作者と素材の原本を一緒に保存・復元する。
// 表示用の情報だけが保存対象から漏れたり、改行や日本語が失われたりすることを防ぐ。
test('round trips project information and original assets', async () => {
	const original = project({ assets: [{ id: 'asset', name: 'font.ttf', width: 0, height: 0,
		fileDataType: 'font/ttf', fileData: new Blob([new Uint8Array([0, 42, 255])], { type: 'font/ttf' }) }] });
	const restored = decodeProjectFile(await encodeProjectFile(original));
	assert.deepEqual({ ...restored, assets: [] }, { ...original, assets: [] });
	assert.deepEqual(new Uint8Array(await restored.assets[0].fileData.arrayBuffer()), new Uint8Array([0, 42, 255]));
	assert.equal(restored.assets[0].fileData.type, 'font/ttf');
});

// Openで得たハンドルを使い、選択ダイアログなしで元ファイルへ上書きする。
// Fileだけを保持すると開いたファイルを上書きできず、Save asと同じ動作になってしまう。
test('retains the opened handle and overwrites it without a save picker', async t => {
	const window = setup(t);
	const handle = fileHandle('opened.gsproj', { bytes: await encodeProjectFile(project()) });
	window.showOpenFilePicker = async () => [handle];
	window.showSaveFilePicker = () => assert.fail('Save must reuse the opened file');
	const loaded = await loadProjectFile();
	assert.equal(loaded.handle, handle);
	assert.equal(loaded.name, 'opened.gsproj');
	loaded.project.name = 'Edited';
	assert.equal(await saveProjectFile(loaded.project, loaded.name, loaded.handle), handle);
	assert.equal(decodeProjectFile(handle.bytes).name, 'Edited');
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }], ['create'], ['write'], ['close']]);
});

// 初回保存は素材を読む前に保存先を選ぶ。
// 大きな素材のエンコード後では、ファイル選択に必要なユーザー操作の権限が失効し得る。
test('opens the save picker before encoding assets and supplies the project extension', async t => {
	const window = setup(t);
	const handle = fileHandle('chosen.gsproj');
	let picked = false;
	window.showSaveFilePicker = async options => {
		assert.equal(options.suggestedName, 'chosen.gsproj');
		assert.deepEqual(options.types[0].accept, { 'application/octet-stream': ['.gsproj'] });
		picked = true;
		return handle;
	};
	const source = project({ assets: [{ fileData: { async arrayBuffer() {
		assert.equal(picked, true);
		return new ArrayBuffer(0);
	} } }] });
	assert.equal(await saveProjectFile(source, 'chosen'), handle);
	assert.deepEqual(handle.calls, [['create'], ['write'], ['close']]);
});

// ファイル選択キャンセルは失敗として表示せず、書き込みやエンコードを始めない。
// キャンセルと実際のファイル破損は呼び出し側で区別できる必要がある。
test('returns null for picker cancellation and rejects corrupt project files', async t => {
	const window = setup(t);
	window.showSaveFilePicker = window.showOpenFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
	assert.equal(await saveProjectFile(project({ assets: null }), 'cancelled'), null);
	assert.equal(await loadProjectFile(), null);
	await assert.rejects(loadProjectFile(new File([new Uint8Array([0xc1])], 'bad.gsproj')));
});

// 書込権限が拒否されたファイルは開かず、元の内容を残す。
// Saveを押しただけで読込専用ファイルを壊したり、別の保存先へ勝手に切り替えたりしない。
test('does not write when permission is denied', async t => {
	setup(t);
	const handle = fileHandle('readonly.gsproj', { permission: 'denied' });
	await assert.rejects(saveProjectFile(project(), handle.name, handle), /permission/i);
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }]]);
	assert.deepEqual(handle.bytes, new Uint8Array([42]));
});

// 書き込みまたは確定に失敗したストリームは破棄する。
// 不完全な保存を成功扱いせず、元ファイルを保持したままエラーを呼び出し側へ返す。
test('aborts failed writes and failed closes without replacing the original data', async t => {
	setup(t);
	for (const fail of ['write', 'close']) {
		const handle = fileHandle('failed.gsproj', { fail });
		await assert.rejects(saveProjectFile(project(), handle.name, handle), new RegExp(`${fail} failed`));
		assert.deepEqual(handle.calls.at(-1), ['abort']);
		assert.deepEqual(handle.bytes, new Uint8Array([42]));
	}
});

// プロジェクト情報の編集を保存し、再読込時に復元する。Undo履歴には追加しない。
// メタデータ編集でRedoが消えたり、タイトルだけ変わって保存内容が古いままになることを防ぐ。
test('saves editable project information, updates the title and preserves undo history', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const manager = app.appStateManager;
	assert.deepEqual(manager.projectInfo.value, { name: 'Untitled Project', description: '', author: '' });
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'added-node' });
	manager.undo();
	const undoCount = manager.undoStack.value.length;
	const redoCount = manager.redoStack.value.length;
	Object.assign(manager.projectInfo.value, { name: 'Edited Project', description: 'Description\n説明', author: 'Alice' });
	await nextTick();
	assert.equal(window.document.title, 'Glitch Studio (Edited Project)');
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.equal(manager.redoStack.value.length, redoCount);
	manager.redo();
	assert.equal(manager.projectInfo.value.name, 'Edited Project');
	const handle = fileHandle('saved.gsproj');
	window.showSaveFilePicker = async () => handle;
	await app.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.name, 'Edited Project');
	assert.equal(saved.description, 'Description\n説明');
	assert.equal(saved.author, 'Alice');
	await app.newProject();
	assert.equal(manager.projectInfo.value.name, 'Untitled Project');
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.deepEqual(manager.projectInfo.value, { name: saved.name, description: saved.description, author: saved.author });
	assert.deepEqual(globalThis.projectAlerts, []);
});

// Save asが成功したときだけ次のSave先を切り替える。
// キャンセルやディスク書込失敗で保存先が変わると、以後意図しないファイルを上書きしてしまう。
test('changes the Save target only after a successful Save as', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const original = fileHandle('original.gsproj');
	const copy = fileHandle('copy.gsproj');
	window.showSaveFilePicker = async () => original;
	await app.saveProject();
	window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
	await app.saveProject(true);
	app.appStateManager.projectInfo.value.name = 'After cancellation';
	await app.saveProject();
	assert.equal(decodeProjectFile(original.bytes).name, 'After cancellation');
	const failed = fileHandle('failed.gsproj', { fail: 'write' });
	window.showSaveFilePicker = async () => failed;
	await app.saveProject(true);
	app.appStateManager.projectInfo.value.name = 'After failure';
	await app.saveProject();
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
	assert.deepEqual(globalThis.projectAlerts, ['write failed']);
	window.showSaveFilePicker = async () => copy;
	await app.saveProject(true);
	window.showSaveFilePicker = () => assert.fail('Save should reuse the new target');
	app.appStateManager.projectInfo.value.name = 'After Save as';
	await app.saveProject();
	assert.equal(decodeProjectFile(copy.bytes).name, 'After Save as');
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
});

// 新規作成後は以前のファイルハンドルを使わない。
// 前のプロジェクトの保存先が残ると、新規プロジェクトの初回Saveで元の作品を上書きしてしまう。
test('asks for a fresh Save target after creating another project', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const first = fileHandle('first.gsproj');
	window.showSaveFilePicker = async () => first;
	await app.saveProject();
	const savedBytes = first.bytes;
	await app.newProject();
	const second = fileHandle('second.gsproj');
	let pickerCalls = 0;
	window.showSaveFilePicker = async () => { pickerCalls++; return second; };
	await app.saveProject();
	assert.equal(pickerCalls, 1);
	assert.equal(first.bytes, savedBytes);
	assert.notEqual(decodeProjectFile(first.bytes).id, decodeProjectFile(second.bytes).id);
});
