import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { setImmediate } from 'node:timers/promises';
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
	define: { _VERSION_: '"2.0.0-alpha.2"' },
};
const { encodeProjectFile, decodeProjectFile, loadProjectFile, saveProjectFile, getProjectFileName, getProjectSaveFileHandle } = evaluate(await build({
	...buildOptions, entryPoints: ['./src/gsproj.ts'],
}));

// 実際のapp・状態管理・保存処理を組み合わせ、GPUとダイアログだけ置き換える。
const appBundle = await build({
	...buildOptions, entryPoints: ['./src/app.ts'],
	plugins: [{
		name: 'project-test-platform',
		setup(build) {
			// 音声Worker/WorkletもGPUと同じブラウザ境界。保存テストでは再生機器を起動しない。
			build.onResolve({ filter: /(?:timeline-audio-preview|audio-output)\.ts$/ }, () => ({ path: 'audio', namespace: 'audio-platform' }));
			build.onLoad({ filter: /.*/, namespace: 'audio-platform' }, () => ({ contents: `
				export class TimelineAudioPreview {
					error = { value: null }; buffering = { value: false }; time = 0;
					starts = [];
					start(time) { this.time = time; this.starts.push(time); } stop() {} currentTime() { return this.time; }
				}
				export class AudioOutput {}
			`, loader: 'ts' }));
			build.onResolve({ filter: /RendererManagerController\.ts$|\.vue$|^@\/ui\.ts$|effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'platform' }));
			build.onLoad({ filter: /.*/, namespace: 'platform' }, args => ({
				loader: 'ts', resolveDir: import.meta.dirname,
				contents: /effect-definitions\.[jt]s$/.test(args.path)
					? "import fill from '@gs/subsystems_effect_shared/fx/fill/_def_.ts'; export const effectDefinitions = { fill };"
					: args.path.endsWith('preferences.ts') ? `
						import { reactive, toRefs } from 'vue';
						const settings = reactive({ forceTypeSafety: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' });
						export const preferences = { s: settings, r: toRefs(settings) };
					`
					: args.path.endsWith('RendererManagerController.ts') ? `
					import { ref } from 'vue';
					import { deepClone } from '@gs/shared/utility/deep-clone.ts';
					import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
					export class VisualModuleRendererManagerController {
						isReady = ref(false); errorMessage = ref(null);
						updates = []; renders = []; lifecycle = [];
						staticUpdates = [];
						patches = []; snapshots = [];
						options = {};
						constructor(staticOptions) { this.staticOptions = deepClone(staticOptions); }
						async init(resolution, resolutionScale) {
							this.initialStaticOptions = deepClone(this.staticOptions);
							this.initialResolution = resolution;
							this.initialResolutionScale = resolutionScale;
							this.isReady.value = true;
						}
						async updateDynamicOptions(options) {
							this.updates.push(options);
							Object.assign(this.options, options);
							return { assetsCommitted: true };
						}
						async updateStaticOptions(options) {
							this.staticUpdates.push(deepClone(options));
							Object.assign(this.staticOptions, deepClone(options));
						}
						async updatePlayers() {}
						async replaceProjectState(state) {
							const snapshot = deepClone(state);
							this.snapshots.push(snapshot);
							Object.assign(this.options, this.timeline ? snapshot : { visualModules: snapshot.visualModules });
						}
						async applyProjectChanges(changes) {
							const patch = deepClone(this.timeline ? changes : changes.filter(change => (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target));
							if (!patch.length) return;
							this.patches.push(patch);
							const next = applyRendererProjectChanges({ visualModules: this.options.visualModules, timelineScenes: this.options.timelineScenes ?? [] }, patch);
							Object.assign(this.options, this.timeline ? next : { visualModules: next.visualModules });
						}
						startLiveRenderLoopFor() { this.lifecycle.push('start'); }
						stopRenderLoop() { this.lifecycle.push('stop'); }
						renderTimelineAt(time) { this.renders.push(time); }
						disposeManager() { this.lifecycle.push('dispose'); this.isReady.value = false; }
						async relaunchManager() { this.lifecycle.push('relaunch'); this.isReady.value = true; }
					}
					export class TimelineRendererManagerController extends VisualModuleRendererManagerController { timeline = true; }
					` : args.path.endsWith('.vue') ? `export default { name: '${args.path.split('/').at(-1)}' };` : `
					export async function alert(options) { globalThis.projectAlerts.push(options.text); }
						export function popup(component, props, events) {
							if (component.name === 'GsProjectSaveDialog.vue') {
								queueMicrotask(async () => {
									const handle = await window.selectProjectSaveFile(props.name);
									if (handle != null) events.selected(handle);
									events.closed();
								});
							}
							return { dispose() {} };
						}
				`,
			}));
		},
	}],
});

function project(overrides = {}) {
	return {
		timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		id: 'project-id', gsVersion: '2.0.0-alpha.2', name: 'Example', description: 'First line\n日本語の説明', author: 'Author',
		assets: [], players: [], visualModules: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }], resolution: { width: 640, height: 480 },
		...overrides,
	};
}

// 【描画設定を保存・復元し、Undo/Redoでもタイムラインだけへ同期する】
// プレビュー用の値だけが変わって保存から漏れたり、LIVE側のfps制限を書き換えたりしないことを保証する。
test('persists timeline render settings and synchronizes undo and redo without changing LIVE', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const manager = app.appStateManager;
	const notifications = [];
	manager.onChange(changes => notifications.push(changes));
	const settings = { timelineFps: 29.97, timelineMotionBlur: { enabled: true, shutterAngle: 270, samples: 32 } };
	const live = app.visualModuleRendererManagerController;
	const timeline = app.timelineRendererManagerController;
	live.updates.length = 0;
	live.staticUpdates.length = 0;
	timeline.staticUpdates.length = 0;
	timeline.updates.length = 0;
	manager.commit('changeTimelineRenderSettings', settings);
	await nextTick();
	const previewSettings = { ...settings, timelineMotionBlur: { ...settings.timelineMotionBlur, samples: app.timelinePreviewMotionBlurSamples.value } };
	assert.equal(timeline.staticOptions.timelineFps, 29.97);
	assert.deepEqual(timeline.staticOptions.timelineMotionBlur, previewSettings.timelineMotionBlur);
	assert.deepEqual(timeline.staticUpdates, [previewSettings]);
	assert.equal(timeline.updates.length, 0);
	assert.equal(live.updates.length, 0);
	assert.equal(live.staticUpdates.length, 0);
	manager.undo();
	await nextTick();
	assert.equal(timeline.staticOptions.timelineFps, 60);
	assert.equal(manager.state.timelineMotionBlur.value.enabled, false);
	manager.redo();
	await nextTick();
	assert.equal(timeline.staticOptions.timelineFps, 29.97);
	assert.equal(timeline.staticUpdates.length, 3);
	assert.deepEqual(notifications, Array.from({ length: 3 }, () => [{ type: 'timelineRenderSettings' }]));
	const handle = fileHandle('motion-blur.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await app.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.timelineFps, 29.97);
	assert.deepEqual(saved.timelineMotionBlur, settings.timelineMotionBlur);
	assert.equal('timelinePreviewFpsFactor' in saved, false);
	assert.equal('timelinePreviewMotionBlurSamples' in saved, false);
	assert.equal('previewSamples' in saved.timelineMotionBlur, false);
	await app.newProject();
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.deepEqual(manager.state.timelineMotionBlur.value, settings.timelineMotionBlur);
	assert.equal(manager.state.timelineFps.value, 29.97);
	assert.equal(timeline.staticOptions.timelineFps, 29.97);
	assert.equal('timelineFps' in timeline.options, false);
	assert.equal('timelineMotionBlur' in timeline.options, false);
	assert.throws(() => manager.commit('changeTimelineRenderSettings', { ...settings, timelineFps: 0 }));
	assert.equal(manager.state.timelineFps.value, 29.97);
});

// 【レイヤーの表示状態を保存・復元し、停止中のプレビューも履歴に合わせて描き直す】
// UIのボタンだけを更新して停止位置の映像が残ったり、再読込で非表示状態を失ったりしない。
// 新規プロジェクトのレイヤーは表示状態で始まり、切り替えても期間や再生時刻を変更しない。
test('persists disabled layers and refreshes the paused preview on visibility edits undo and redo', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const manager = app.appStateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.isDisabled, false);
	const original = JSON.parse(JSON.stringify(layer));
	const timeline = app.timelineRendererManagerController;
	app.previewPlayback.seekTimeline(500);
	timeline.renders.length = 0;
	manager.commit('setTimelineLayerDisabled', { sceneId: scene.id, layerId: layer.id, isDisabled: true });
	await nextTick();
	await setImmediate();
	assert.deepEqual(timeline.options.timelineScenes[0].layers[0], { ...original, isDisabled: true });
	assert.ok(timeline.renders.length > 0);
	const renders = timeline.renders.length;
	manager.undo();
	await nextTick();
	await setImmediate();
	assert.deepEqual(timeline.options.timelineScenes[0].layers[0], original);
	assert.ok(timeline.renders.length > renders);
	manager.redo();
	await nextTick();
	await setImmediate();
	assert.equal(timeline.options.timelineScenes[0].layers[0].isDisabled, true);
	assert.equal(app.previewPlayback.currentTimelineTime.value, 500);
	assert.equal(app.previewPlayback.isTimelinePlaying.value, false);
	const handle = fileHandle('disabled-layer.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await app.saveProject();
	assert.deepEqual(decodeProjectFile(handle.bytes).timelineScenes[0].layers[0], { ...original, isDisabled: true });
	await app.newProject();
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.equal(manager.state.timelineScenes.value[0].layers[0].isDisabled, true);
	assert.equal(timeline.options.timelineScenes[0].layers[0].isDisabled, true);
});

// 【初回生成からプロジェクトのfps・ブラー設定とプレビュー既定の0サンプルを使う】
// プレビューのブラーは既定でオフにし、保存された書き出し用サンプル数は維持する。
// 初期化後にwatchで設定を変えると、初回表示が遅れ、読込中の動的更新も中断される。
test('uses project render settings with motion blur sampling disabled for the initial preview', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const loaded = project({ timelineFps: 24, timelineMotionBlur: { enabled: true, shutterAngle: 90, samples: 32 } });
	await app.appReady(loaded);
	const timeline = app.timelineRendererManagerController;
	assert.equal(timeline.initialStaticOptions.timelineFps, 24);
	assert.deepEqual(timeline.initialStaticOptions.timelineMotionBlur, { ...loaded.timelineMotionBlur, samples: 0 });
	assert.ok(timeline.updates.every(options => !('timelineFps' in options) && !('timelineMotionBlur' in options)));
});

// 【プレビューのブラー品質はUIだけで保持し、プロジェクト・Undo履歴・LIVEには反映しない】
// プレビューをオフにしても書き出し用サンプル数を失わず、プロジェクトの有効設定は維持する。
// 読み込み時は保存された書き出し設定を復元し、プレビューは既定の0サンプルへ戻す。
test('keeps preview motion blur samples separate from project settings and saved files', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const manager = app.appStateManager;
	const settings = { timelineFps: 30, timelineMotionBlur: { enabled: true, shutterAngle: 270, samples: 32 } };
	manager.commit('changeTimelineRenderSettings', settings);
	await nextTick();
	const historyLength = manager.undoStack.value.length;
	const timeline = app.timelineRendererManagerController;
	const live = app.visualModuleRendererManagerController;
	live.staticUpdates.length = 0;
	assert.deepEqual([...app.TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS], [0, 2, 4, 8]);
	for (const samples of [2, 4, 8, 0]) {
		app.timelinePreviewMotionBlurSamples.value = samples;
		await nextTick();
		assert.deepEqual(timeline.staticOptions.timelineMotionBlur, { ...settings.timelineMotionBlur, samples });
		assert.deepEqual(manager.state.timelineMotionBlur.value, settings.timelineMotionBlur);
		assert.equal(manager.undoStack.value.length, historyLength);
	}
	assert.equal(live.staticUpdates.length, 0);
	manager.undo();
	await nextTick();
	assert.equal(app.timelinePreviewMotionBlurSamples.value, 0);
	assert.equal(timeline.staticOptions.timelineMotionBlur.enabled, false);
	manager.redo();
	await nextTick();
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 0);
	assert.equal(manager.state.timelineMotionBlur.value.samples, 32);
	const handle = fileHandle('preview-quality.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await app.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.deepEqual(saved.timelineMotionBlur, settings.timelineMotionBlur);
	assert.equal('previewSamples' in saved.timelineMotionBlur, false);
	assert.equal('timelinePreviewMotionBlurSamples' in saved, false);
	// 読み込み前にオンにしておき、単に直前のオフ状態を維持しているだけではないことを確認する。
	app.timelinePreviewMotionBlurSamples.value = 4;
	await nextTick();
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 4);
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.equal(app.timelinePreviewMotionBlurSamples.value, 0);
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 0);
	assert.equal(manager.state.timelineMotionBlur.value.samples, 32);
});

// 【倍率はタイムラインの描画頻度だけを変更し、LIVEのfps制限は干渉しない】
// appの実際の接続と再生スケジューラを使い、独立した設定が再び混線するのを防ぐ。
test('applies timeline preview factors independently of the LIVE fps limit', async t => {
	const window = setup(t);
	const callbacks = new Map();
	let nextId = 0;
	window.requestAnimationFrame = callback => { const id = ++nextId; callbacks.set(id, callback); return id; };
	window.cancelAnimationFrame = id => callbacks.delete(id);
	const app = evaluate(appBundle);
	await app.newProject();
	t.after(() => app.previewPlayback.dispose());
	app.timelineRendererManagerController.staticUpdates.length = 0;
	const measure = (factor, liveFpsLimit) => {
		app.previewPlayback.pauseTimeline();
		app.previewPlayback.seekTimeline(0);
		app.timelinePreviewFpsFactor.value = factor;
		app.liveFpsLimit.value = liveFpsLimit;
		app.previewPlayback.playTimeline();
		const timeline = app.timelineRendererManagerController;
		timeline.renders.length = 0;
		for (let time = 0; time <= 1000; time++) {
			app.timelineAudioPreview.time = time;
			const [id, callback] = callbacks.entries().next().value;
			callbacks.delete(id);
			callback(time);
		}
		const count = timeline.renders.length;
		assert.ok(app.previewPlayback.currentTimelineTime.value >= 1000 - 1000 / (60 * factor) - 1);
		app.previewPlayback.pauseTimeline();
		return count;
	};
	for (const factor of [0.5, 1, 2]) {
		const limited = measure(factor, 1);
		const unlimited = measure(factor, null);
		assert.equal(limited, unlimited);
		assert.ok(Math.abs(limited - 60 * factor) <= 1, `factor ${factor}: ${limited}`);
	}
	assert.equal(app.appStateManager.state.timelineFps.value, 60);
	await nextTick();
	assert.equal(app.timelineRendererManagerController.staticUpdates.length, 0);
});

// 【Scene参照と内容時刻を保存後も維持する】
// 保存・読込で配置のトリムを再計算すると、同じSceneを使った複数の演出がずれてしまう。
test('round-trips scene references without changing their source origins', async () => {
	const original = project({ timelineScenes: [
		{ id: 'root', name: 'Root', resolution: { mode: 'project' }, layers: [{ id: 'nested', layerType: 'scene',
			name: 'Layer', clips: [{ id: 'clip', startMs: 50, contentOffsetMs: 100, durationMs: 200, sceneId: 'child' }],
			compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 0.5 } }, automationGraphs: [] }] },
		{ id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [] },
	] });
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(original)), original);
});

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
			if (options.fail === 'create') throw new Error('create failed');
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
	// appのキーボード登録だけ受け取り、実際のDOMやイベントループは使わない。
	globalThis.window = {
		document: { title: '', addEventListener() {} },
		// 旧APIに戻すと、保存先選択だけで既存データが失われる。新経路では一切呼び出さない。
		showSaveFilePicker() { assert.fail('The destructive save picker must not be used'); },
	};
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

// 【Openで得たハンドルを使い、選択ダイアログなしで元ファイルへ上書きする】
// Fileだけを保持すると開いたファイルを上書きできず、Save asと同じ動作になってしまう。
test('retains the opened handle and overwrites it without a save picker', async t => {
	const window = setup(t);
	const handle = fileHandle('opened.gsproj', { bytes: await encodeProjectFile(project()) });
	window.showOpenFilePicker = async () => [handle];
	window.selectProjectSaveFile = () => assert.fail('Save must reuse the opened file');
	const loaded = await loadProjectFile();
	assert.equal(loaded.handle, handle);
	assert.equal(loaded.name, 'opened.gsproj');
	loaded.project.name = 'Edited';
	await saveProjectFile(await encodeProjectFile(loaded.project), loaded.handle);
	assert.equal(decodeProjectFile(handle.bytes).name, 'Edited');
	assert.deepEqual(handle.calls, [['create'], ['write'], ['close']]);
});

// 【保存名に拡張子を補い、フォルダ外を指すパスは受け付けない】
// フォルダ選択とファイル名入力を分けても、プロジェクト形式と保存先の範囲を維持する。
test('normalizes project file names and rejects paths', () => {
	assert.equal(getProjectFileName(' chosen '), 'chosen.gsproj');
	assert.equal(getProjectFileName('chosen.GSPROJ'), 'chosen.GSPROJ');
	for (const name of ['', '   ', '.', '..', '../chosen', 'child/chosen', 'child\\chosen']) {
		assert.throws(() => getProjectFileName(name), /file name/i);
	}
});

// 【Save asで既存ファイルの内容を保持したまま選択・書き込みする】
// showSaveFilePickerのモックだけでは、選択時にファイルが空になる不具合を検出できない。
// フォルダから既存ハンドルを取得し、closeが成功するまで元の内容を維持する経路を検証する。
test('selects an existing Save as target without clearing it and preserves it on write failures', async () => {
	const original = await encodeProjectFile(project({ name: 'Original' }));
	const updated = await encodeProjectFile(project({ name: 'Updated' }));
	for (const fail of [undefined, 'create', 'write', 'close']) {
		const handle = fileHandle('existing.gsproj', { bytes: original, fail });
		const directory = { async getFileHandle(name, options) {
			assert.equal(name, handle.name);
			assert.equal(options, undefined);
			return handle;
		} };
		let confirmations = 0;
		const selected = await getProjectSaveFileHandle(directory, 'existing', async name => {
			confirmations++;
			assert.equal(name, handle.name);
			assert.equal(handle.bytes, original);
			return true;
		});
		assert.equal(confirmations, 1);
		assert.equal(selected, handle);
		assert.equal(handle.bytes, original);
		if (fail) {
			await assert.rejects(saveProjectFile(updated, selected), new RegExp(`${fail} failed`));
			assert.equal(handle.bytes, original);
		} else {
			await saveProjectFile(updated, selected);
			assert.equal(decodeProjectFile(handle.bytes).name, 'Updated');
		}
	}
});

// 【上書き確認を取り消しても元ファイルを変更しない】
// 保存先の取得だけで書き込みストリームを開いたり、createで内容を置き換えたりしない。
test('leaves an existing target untouched when overwrite is declined', async () => {
	const handle = fileHandle('existing.gsproj');
	const original = handle.bytes;
	const selected = await getProjectSaveFileHandle({ async getFileHandle() { return handle; } }, handle.name, async () => false);
	assert.equal(selected, null);
	assert.equal(handle.bytes, original);
	assert.deepEqual(handle.calls, []);
});

// 【存在しない保存先だけを新規作成し、権限・種別のエラーはそのまま返す】
// 読取権限不足や同名フォルダを「ファイルがない」と誤認して作成・上書きしない。
test('creates only missing targets and propagates other lookup errors', async () => {
	const calls = [];
	const created = fileHandle('new.gsproj');
	const directory = { async getFileHandle(name, options) {
		calls.push([name, options]);
		if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
		return created;
	} };
	assert.equal(await getProjectSaveFileHandle(directory, 'new', () => assert.fail('New files need no overwrite confirmation')), created);
	assert.deepEqual(calls, [['new.gsproj', undefined], ['new.gsproj', { create: true }]]);
	for (const name of ['NotAllowedError', 'TypeMismatchError']) {
		const cause = new DOMException('Lookup failed', name);
		await assert.rejects(getProjectSaveFileHandle({ async getFileHandle(_name, options) {
			assert.equal(options, undefined);
			throw cause;
		} }, 'new', () => assert.fail('Failed lookups need no confirmation')), error => error === cause);
	}
});

// 【素材読込が失敗したら、保存先を選ぶ前に停止し、どの保存方法でも元ファイルを維持する】
// 元ファイル変更で読めないFileを含む場合や、準備中にストレージの読取が失敗する場合を扱う。
// エラーには素材名を含め、ユーザーがどの素材を差し替えればよいか特定できるようにする。
test('stops before selecting or writing a target when asset encoding fails', async t => {
	const window = setup(t);
	const cause = new DOMException('The requested file could not be read', 'NotReadableError');
	class UnreadableBlob extends Blob {
		async arrayBuffer() { throw cause; }
	}
	const handle = fileHandle('existing.gsproj', { bytes: await encodeProjectFile(project()) });
	const original = handle.bytes;
	const app = evaluate(appBundle);
	await app.appReady(project(), handle.name, handle);
	app.appStateManager.state.assets.value = [{ id: 'asset', name: 'missing.png', fileData: new UnreadableBlob() }];
	window.selectProjectSaveFile = () => assert.fail('No target should be selected after an encoding failure');
	await app.saveProject(true);
	assert.deepEqual(handle.calls, []);
	await app.saveProject();
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }]]);
	assert.equal(handle.bytes, original);
	assert.equal(globalThis.projectAlerts.length, 2);
	assert.ok(globalThis.projectAlerts.every(message => message.includes('missing.png')));
	await assert.rejects(encodeProjectFile(project({ assets: app.appStateManager.state.assets.value })), error => error.cause === cause);
});

// 【保存先選択前に準備を完了し、ダイアログ表示中の編集を保存内容へ混入させない】
// 非同期の素材読込とユーザー操作を挟んでも、保存開始時点の状態を一貫して書き出す。
test('prepares a complete snapshot before selecting a Save as target', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	let read = false;
	class TrackedBlob extends Blob {
		async arrayBuffer() { read = true; return super.arrayBuffer(); }
	}
	app.projectInfo.value.name = 'Snapshot';
	app.appStateManager.state.assets.value = [{ id: 'asset', name: 'snapshot.png', fileData: new TrackedBlob(['original']) }];
	const handle = fileHandle('snapshot.gsproj');
	window.selectProjectSaveFile = async name => {
		assert.equal(name, 'untitled.gsproj');
		assert.equal(read, true);
		app.projectInfo.value.name = 'Later edit';
		app.appStateManager.state.assets.value = [];
		return handle;
	};
	await app.saveProject(true);
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.name, 'Snapshot');
	assert.equal(await saved.assets[0].fileData.text(), 'original');
});

// 【読込用のファイル選択キャンセルとファイル破損を区別する】
// キャンセルと実際のファイル破損は呼び出し側で区別できる必要がある。
test('returns null for picker cancellation and rejects corrupt project files', async t => {
	const window = setup(t);
	window.showOpenFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
	assert.equal(await loadProjectFile(), null);
	await assert.rejects(loadProjectFile(new File([new Uint8Array([0xc1])], 'bad.gsproj')));
});

// 【書込権限が拒否されたファイルは開かず、元の内容を残す】
// Saveを押しただけで読込専用ファイルを壊したり、別の保存先へ勝手に切り替えたりしない。
test('does not write when permission is denied', async t => {
	setup(t);
	const handle = fileHandle('readonly.gsproj', { permission: 'denied', bytes: await encodeProjectFile(project()) });
	const original = handle.bytes;
	const app = evaluate(appBundle);
	await app.appReady(project(), handle.name, handle);
	await app.saveProject();
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }]]);
	assert.equal(handle.bytes, original);
	assert.match(globalThis.projectAlerts[0], /permission/i);
});

// 【書き込みまたは確定に失敗したストリームは破棄する】
// 不完全な保存を成功扱いせず、元ファイルを保持したままエラーを呼び出し側へ返す。
test('aborts failed writes and failed closes without replacing the original data', async t => {
	setup(t);
	for (const fail of ['write', 'close']) {
		const handle = fileHandle('failed.gsproj', { fail });
		await assert.rejects(saveProjectFile(await encodeProjectFile(project()), handle), new RegExp(`${fail} failed`));
		assert.deepEqual(handle.calls.at(-1), ['abort']);
		assert.deepEqual(handle.bytes, new Uint8Array([42]));
	}
});

// 【空の保存データでは書き込みを開始しない】
// エンコード済みバイト列を受け取る境界でも、空データで元プロジェクトを消すことを防ぐ。
test('rejects empty save data without opening a writable', async () => {
	const handle = fileHandle('existing.gsproj');
	await assert.rejects(saveProjectFile(new Uint8Array(), handle), /no save data/);
	assert.deepEqual(handle.calls, []);
	assert.deepEqual(handle.bytes, new Uint8Array([42]));
});

// プロジェクト情報の編集を保存し、再読込時に復元する。Undo履歴には追加しない。
// メタデータ編集でRedoが消えたり、タイトルだけ変わって保存内容が古いままになることを防ぐ。
test('saves editable project information, updates the title and preserves undo history', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const manager = app.appStateManager;
	assert.deepEqual(app.projectInfo.value, { name: 'Untitled Project', description: '', author: '' });
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'added-node' });
	manager.undo();
	const undoCount = manager.undoStack.value.length;
	const redoCount = manager.redoStack.value.length;
	Object.assign(app.projectInfo.value, { name: 'Edited Project', description: 'Description\n説明', author: 'Alice' });
	await nextTick();
	assert.equal(window.document.title, 'Glitch Studio (Edited Project)');
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.equal(manager.redoStack.value.length, redoCount);
	manager.redo();
	assert.equal(app.projectInfo.value.name, 'Edited Project');
	const handle = fileHandle('saved.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await app.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.name, 'Edited Project');
	assert.equal(saved.description, 'Description\n説明');
	assert.equal(saved.author, 'Alice');
	await app.newProject();
	assert.equal(app.projectInfo.value.name, 'Untitled Project');
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.deepEqual(app.projectInfo.value, { name: saved.name, description: saved.description, author: saved.author });
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
	window.selectProjectSaveFile = async () => original;
	await app.saveProject();
	window.selectProjectSaveFile = async () => null;
	await app.saveProject(true);
	app.projectInfo.value.name = 'After cancellation';
	await app.saveProject();
	assert.equal(decodeProjectFile(original.bytes).name, 'After cancellation');
	const failed = fileHandle('failed.gsproj', { fail: 'write' });
	window.selectProjectSaveFile = async () => failed;
	await app.saveProject(true);
	app.projectInfo.value.name = 'After failure';
	await app.saveProject();
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
	assert.deepEqual(globalThis.projectAlerts, ['write failed']);
	window.selectProjectSaveFile = async () => copy;
	await app.saveProject(true);
	window.selectProjectSaveFile = () => assert.fail('Save should reuse the new target');
	app.projectInfo.value.name = 'After Save as';
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
	window.selectProjectSaveFile = async () => first;
	await app.saveProject();
	const savedBytes = first.bytes;
	await app.newProject();
	const second = fileHandle('second.gsproj');
	let pickerCalls = 0;
	window.selectProjectSaveFile = async () => { pickerCalls++; return second; };
	await app.saveProject();
	assert.equal(pickerCalls, 1);
	assert.equal(first.bytes, savedBytes);
	assert.notEqual(decodeProjectFile(first.bytes).id, decodeProjectFile(second.bytes).id);
});

// 同じバージョンと過去のバージョンは読み込み、プレリリースもsemverの順序で比較する。
// 文字列比較やメジャー番号だけの比較では、alpha.10や正式版との前後関係を誤って判定する。
test('accepts same and older versions and rejects newer semantic versions', async t => {
	setup(t);
	for (const gsVersion of ['1.99.0', '2.0.0-alpha.1', '2.0.0-alpha.2', '2.0.0-alpha.2+build.10']) {
		const file = new File([await encodeProjectFile(project({ gsVersion }))], 'supported.gsproj');
		assert.equal((await loadProjectFile(file)).project.gsVersion, gsVersion);
	}
	for (const gsVersion of ['2.0.0-alpha.10', '2.0.0', '2.0.1', '2.1.0', '10.0.0']) {
		const file = new File([await encodeProjectFile(project({ gsVersion }))], 'future.gsproj');
		await assert.rejects(loadProjectFile(file), /未来のバージョンのプロジェクトファイルの読み込みはサポートしていません/);
	}
});

// 未来のファイルを開こうとしても、現在の情報・編集履歴・保存先を維持する。
// 読み込みを途中まで反映すると編集中の作品が消えたり、次のSaveで別ファイルを上書きしたりする。
test('shows a future-version error without changing the current project or Save target', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	app.projectInfo.value.name = 'Current project';
	const currentHandle = fileHandle('current.gsproj');
	window.selectProjectSaveFile = async () => currentHandle;
	await app.saveProject();
	const manager = app.appStateManager;
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'keep-node' });
	const modules = manager.state.visualModules.value;
	const undoCount = manager.undoStack.value.length;
	const future = project({ gsVersion: '2.0.0', name: 'Future project' });
	const futureHandle = fileHandle('future.gsproj', { bytes: await encodeProjectFile(future) });
	window.showOpenFilePicker = async () => [futureHandle];
	assert.equal(await app.openProject(), false);
	assert.equal(app.projectInfo.value.name, 'Current project');
	assert.equal(manager.state.visualModules.value, modules);
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.equal(window.document.title, 'Glitch Studio (Current project)');
	assert.equal(globalThis.projectAlerts.length, 1);
	assert.match(globalThis.projectAlerts[0], /未来のバージョンのプロジェクトファイルの読み込みはサポートしていません/);
	assert.match(globalThis.projectAlerts[0], /ファイル: 2\.0\.0 \/ 現在: 2\.0\.0-alpha\.2/);
	window.selectProjectSaveFile = () => assert.fail('The existing Save target must be retained');
	await app.saveProject();
	assert.equal(decodeProjectFile(currentHandle.bytes).name, 'Current project');
	assert.equal(decodeProjectFile(futureHandle.bytes).name, 'Future project');
});

// 【プレビューには元の解像度と倍率を分けて渡し、小型プロジェクトでは倍率を戻す】
// Controllerへ縮小済みの寸法を渡すと、レンダラーで再び倍率が掛かってしまう。
// 初期化・プロジェクト切り替えの両方で同じ契約を守り、前の倍率も持ち越さないことを確認する。
test('passes unscaled project dimensions and resets the preview scale for smaller projects', async t => {
	setup(t);
	const app = evaluate(appBundle);
	for (const [width, height, factor] of [
		[12000, 8000, 0.25],
		[1500, 3001, 0.25],
		[3000, 1500, 0.5],
		[1000, 1501, 0.5],
		[1500, 1500, 1],
	]) {
		const resolution = { width, height };
		const file = new File([await encodeProjectFile(project({ resolution }))], 'resolution.gsproj');
		assert.equal(await app.openProject(file), true);
		assert.equal(app.resolutionFactor.value, factor);
		for (const controller of [app.visualModuleRendererManagerController, app.timelineRendererManagerController]) {
			assert.deepEqual(controller.options.resolution, resolution);
			assert.equal(controller.options.resolutionScale, factor);
		}
		assert.deepEqual(app.appStateManager.state.resolution.value, resolution);
	}
	for (const controller of [app.visualModuleRendererManagerController, app.timelineRendererManagerController]) {
		assert.deepEqual(controller.initialResolution, { width: 12000, height: 8000 });
		assert.equal(controller.initialResolutionScale, 0.25);
	}
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【両プレビューへ共通データを送り、タイムラインだけにレイヤーを渡す】
// 一方だけ更新すると、Canvasを切り替えた際に古いプロジェクトや編集前の状態が表示される。
test('synchronizes both previews and routes timeline-only edits', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const first = project({ visualModules: [{ id: 'first', nodes: [], paramDefs: [] }] });
	await app.appReady(first);
	const live = app.visualModuleRendererManagerController;
	const timeline = app.timelineRendererManagerController;
	assert.equal(app.activePreviewRenderer.value, live);
	assert.deepEqual(live.options.visualModules, first.visualModules);
	assert.deepEqual(timeline.options.visualModules, first.visualModules);
	assert.equal('timelineScenes' in live.options, false);
	app.previewPlayback.seekTimeline(500);
	assert.equal(app.activePreviewRenderer.value, timeline);
	timeline.renders.length = 0;
	app.appStateManager.commit('addTimelineLayer', { sceneId: 'scene', layer: { id: 'layer', layerType: 'visualModule', visualModuleId: 'first', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] } });
	await nextTick();
	await setImmediate();
	assert.equal('timelineScenes' in live.options, false);
	assert.equal(timeline.options.timelineScenes[0].layers[0].id, 'layer');
	assert.deepEqual(timeline.patches.at(-1).map(change => change.type), ['layer', 'layerOrder']);
	assert.equal(live.patches.length, 0);
	assert.deepEqual(timeline.renders, [500]);
	app.highlightClipping.value = true;
	await nextTick();
	await setImmediate();
	assert.equal(live.options.highlightClipping, true);
	assert.equal(timeline.options.highlightClipping, true);
	assert.equal(timeline.renders.at(-1), 500);
	await app.appReady(project());
	assert.deepEqual(live.options.visualModules, []);
	assert.deepEqual(timeline.options.visualModules, []);
	assert.deepEqual(timeline.options.timelineScenes[0].layers, []);
});

// 【音声に影響しない編集とUndo/Redoでは再生を中断しない】
// 映像のスライダー操作や素材名の変更で先読みPCMを破棄せず、音量・参照素材・
// ループ長が変わったときだけ音声を再生成する。実際のappの監視とコマンドを組み合わせる。
// 表示切り替えも音声レイヤーだけが音声計画を変更し、映像だけの無効化では再生を中断しない。
test('refreshes audio only for audio content, source files or loop duration changes', async t => {
	const window = setup(t);
	window.requestAnimationFrame = () => 1;
	window.cancelAnimationFrame = () => {};
	const app = evaluate(appBundle);
	await app.appReady(project({
		assets: [{ id: 'audio', name: 'sound.wav', fileData: new Blob(['audio']) }, { id: 'image', fileData: new Blob(['image']) }],
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
			{ id: 'visual', isDisabled: false, layerType: 'visualModule', visualModuleId: 'module', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 10000 }], visualModuleParamValues: {}, compositingParamValues: { opacity: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
			{ id: 'audio', isDisabled: false, layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 5000, assetId: 'audio' }], audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
		] }],
	}));
	const manager = app.appStateManager;
	const starts = app.timelineAudioPreview.starts;
	app.previewPlayback.playTimeline();
	try {
		assert.equal(starts.length, 1);
		manager.commit('editTimelineLayerParam', { sceneId: 'scene', layerId: 'visual', target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.5 } });
		await nextTick();
		manager.undo();
		await nextTick();
		manager.redo();
		await nextTick();
		manager.state.assets.value[0].name = 'Renamed.wav';
		manager.state.assets.value[1].fileData = new Blob(['new image']);
		manager.state.assets.value.push({ id: 'unused', fileData: new Blob(['unused']) });
		await nextTick();
		assert.equal(starts.length, 1);
		manager.commit('editTimelineLayerParam', { sceneId: 'scene', layerId: 'audio', target: 'audio', paramPath: ['volume'], edit: { kind: 'literal', value: 0.3 } });
		await nextTick();
		assert.equal(starts.length, 2);
		manager.undo();
		await nextTick();
		assert.equal(starts.length, 3);
		manager.redo();
		await nextTick();
		assert.equal(starts.length, 4);
		manager.state.assets.value[0].fileData = new Blob(['new audio']);
		await nextTick();
		assert.equal(starts.length, 5);
		manager.state.timelineScenes.value[0].layers[0].clips[0].durationMs = 20000;
		await nextTick();
		assert.equal(starts.length, 6);
		manager.commit('removeTimelineLayer', { sceneId: 'scene', layerId: 'audio' });
		await nextTick();
		assert.equal(starts.length, 7);
		manager.undo();
		await nextTick();
		assert.equal(starts.length, 8);
		manager.commit('setTimelineLayerDisabled', { sceneId: 'scene', layerId: 'visual', isDisabled: true });
		await nextTick();
		assert.equal(starts.length, 8);
		manager.commit('setTimelineLayerDisabled', { sceneId: 'scene', layerId: 'audio', isDisabled: true });
		await nextTick();
		assert.equal(starts.length, 9);
		manager.undo();
		await nextTick();
		assert.equal(starts.length, 10);
		manager.redo();
		await nextTick();
		assert.equal(starts.length, 11);
		manager.commit('setTimelineLayerDisabled', { sceneId: 'scene', layerId: 'audio', isDisabled: false });
		await nextTick();
		assert.equal(starts.length, 12);
	} finally { app.previewPlayback.dispose(); }
});

// 【両Workerの復帰完了後にだけプレビューを再開する】
// timeline側だけ先にreadyになっても、再描画や次のエクスポート開始を許可してはいけない。
test('waits for both preview workers before restoring the paused timeline', async t => {
	setup(t);
	const app = evaluate(appBundle);
	await app.appReady(project());
	app.previewPlayback.seekTimeline(123);
	const live = app.visualModuleRendererManagerController;
	const timeline = app.timelineRendererManagerController;
	app.suspendPreview();
	assert.equal(live.isReady.value, false);
	assert.equal(timeline.isReady.value, false);
	timeline.renders.length = 0;
	const gate = Promise.withResolvers();
	live.relaunchManager = async () => { await gate.promise; live.isReady.value = true; };
	const restarting = app.resumePreview();
	await nextTick();
	assert.equal(timeline.isReady.value, true);
	assert.deepEqual(timeline.renders, []);
	gate.resolve();
	await restarting;
	assert.deepEqual(timeline.renders, [123]);
	assert.equal(app.previewPlayback.isTimelinePlaying.value, false);
});

// 【復帰に失敗してももう一方の初期化を待ち、描画は再開しない】
// 一方の失敗だけでダイアログを操作可能にすると、次の書き出しで残りの初期化を中断してしまう。
test('keeps playback suspended and waits for the other worker after a restart failure', async t => {
	setup(t);
	const app = evaluate(appBundle);
	await app.appReady(project());
	app.suspendPreview();
	const timeline = app.timelineRendererManagerController;
	timeline.renders.length = 0;
	app.visualModuleRendererManagerController.relaunchManager = async () => { throw new Error('GPU unavailable'); };
	const gate = Promise.withResolvers();
	timeline.relaunchManager = async () => { await gate.promise; timeline.isReady.value = true; };
	let settled = false;
	const restarting = app.resumePreview();
	const rejected = assert.rejects(restarting, /GPU unavailable/).then(() => { settled = true; });
	await setImmediate();
	assert.equal(settled, false);
	gate.resolve();
	await rejected;
	await nextTick();
	app.previewPlayback.refresh();
	assert.deepEqual(timeline.renders, []);
});
