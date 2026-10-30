import { i18nPlugin } from './helpers/i18n.mjs';
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
const { encodeProjectFile, decodeProjectFile, loadProjectFile, saveProjectFile, getProjectFileName, getProjectSaveFileHandle, desktopProjectFile } = evaluate(await build({
	...buildOptions, entryPoints: ['./src/gsproj.ts'],
}));

// 実際のapp・状態管理・保存処理を組み合わせ、GPUとダイアログだけ置き換える。
const appBundle = await build({
	...buildOptions,
	stdin: { resolveDir: buildOptions.absWorkingDir, loader: 'ts', contents: `
		export * from './src/app.ts';
		export { getAssetMenu } from './src/utility/asset-menu.ts';
		export { recentProjects } from './src/recent-projects.ts';
		export { TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS } from './src/AppContext.ts';
		export { createVisualModuleAssetNode } from './src/utility/visual-module-asset-node.ts';
	` },
	plugins: [i18nPlugin, {
		name: 'project-test-platform',
		setup(build) {
			// 音声Worker/WorkletもGPUと同じブラウザ境界。保存テストでは再生機器を起動しない。
			build.onResolve({ filter: /(?:timeline-audio-preview|audio-output)\.ts$/ }, () => ({ path: 'audio', namespace: 'audio-platform' }));
			build.onLoad({ filter: /.*/, namespace: 'audio-platform' }, () => ({ contents: `
				export class TimelineAudioPreview {
					error = { value: null }; buffering = { value: false }; time = 0;
					starts = []; projects = [];
					constructor(_getOutput, getProject) { this.getProject = getProject; }
					// postMessageと同じ複製を行い、VueのProxyを再生Workerへ渡す不具合も検出する。
					start(time) { this.time = time; this.starts.push(time); this.projects.push(structuredClone(this.getProject())); } stop() {} currentTime() { return this.time; }
				}
				export class AudioOutput {
					preview = { analysisEnabled: true, suspended: false, updates: [],
						async setAnalysisEnabled(value) { this.analysisEnabled = value; },
						async setRenderingSuspended(value) { this.suspended = value; this.updates.push(value); } };
				}
			`, loader: 'ts' }));
			// 相対パスとaliasからの参照でも、本番と同じ設定インスタンスを共有する。
			// 別々に生成すると、クラスへの分離でimport順が変わっただけでテスト側の設定変更が届かなくなる。
			build.onResolve({ filter: /RendererManagerController\.ts$|\.vue$|(?:^|\/)ui\.ts$|effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({
				path: /preferences\.ts$/.test(args.path) ? 'preferences.ts'
					: /effect-definitions\.[jt]s$/.test(args.path) ? 'effect-definitions.ts' : args.path,
				namespace: 'platform',
			}));
			build.onLoad({ filter: /.*/, namespace: 'platform' }, args => ({
				loader: 'ts', resolveDir: import.meta.dirname,
				contents: /effect-definitions\.[jt]s$/.test(args.path)
					? `import fill from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
						import image from '@gs/subsystems_effect_shared/fx/image/_def_.ts';
						import video from '@gs/subsystems_effect_shared/fx/video/_def_.ts';
						export const effectDefinitions = { fill, image, video };`
					: args.path.endsWith('preferences.ts') ? `
						import { reactive, toRefs } from 'vue';
						const settings = reactive({ forceTypeSafety: false, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm',
							renderingStatsEnabled: false, analysisMonitorsEnabled: true, timelineFrameCacheMaxGiB: 2,
							projectBackupAutoEnabled: false, projectBackupAutoIntervalMinutes: 1, projectBackupAutoRetentionDays: 1,
							projectBackupSaveEnabled: false, projectBackupSaveRetentionDays: 7,
							...window.initialTestPreferences });
						window.testPreferences = settings;
						export const preferences = { s: settings, r: toRefs(settings) };
					`
					: args.path.endsWith('RendererManagerController.ts') ? `
					import { ref } from 'vue';
					import { deepClone } from '@gs/shared/utility/deep-clone.ts';
					import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
					export class VisualModuleRendererManagerController {
						isReady = ref(false); errorMessage = ref(null);
						frameCacheUsageRatio = ref(null);
						updates = []; renders = []; lifecycle = [];
						staticUpdates = [];
						patches = []; snapshots = [];
						options = {};
						constructor(staticOptions, dynamicOptions = {}) {
							this.staticOptions = deepClone(staticOptions); this.initialDynamicOptions = deepClone(dynamicOptions);
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
						async updatePlayers(players) { this.options.players = deepClone(players); }
						async replaceProjectState(state) {
							const snapshot = deepClone(state);
							this.snapshots.push(snapshot);
							Object.assign(this.options, this.timeline ? snapshot : { automationGraphs: snapshot.automationGraphs, visualModules: snapshot.visualModules });
						}
						async applyProjectChanges(changes) {
							const patch = deepClone(this.timeline ? changes : changes.filter(change => change.type === 'automationGraphs' || change.type === 'visualModuleRegistration'
								|| (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target));
							if (!patch.length) return;
							this.patches.push(patch);
							const next = applyRendererProjectChanges({ automationGraphs: this.options.automationGraphs, visualModules: this.options.visualModules, timelineScenes: this.options.timelineScenes ?? [] }, patch);
							Object.assign(this.options, this.timeline ? next : { automationGraphs: next.automationGraphs, visualModules: next.visualModules });
						}
						startVisualModuleLivePreviewRenderLoopFor() { this.lifecycle.push('start'); }
						stopRenderLoop() { this.lifecycle.push('stop'); }
						renderTimelineAt(time) { this.renders.push(time); }
						cancelSeek() {}
						disposeManager() { this.lifecycle.push('dispose'); this.isReady.value = false; }
						async relaunchManager() {
							this.initialStaticOptions = deepClone(this.staticOptions);
							this.initialResolution = this.options.resolution;
							this.initialResolutionScale = this.options.resolutionScale;
							this.lifecycle.push('relaunch'); this.isReady.value = true;
						}
					}
					export class TimelineRendererManagerController extends VisualModuleRendererManagerController { timeline = true; }
					` : args.path.endsWith('.vue') ? `export default { name: '${args.path.split('/').at(-1)}' };` : `
					export async function alert(options) { globalThis.projectAlerts.push(options.text); await window.acknowledgeProjectAlert?.(); }
					export async function confirm(options) { window.projectConfirmations?.push(options); return { canceled: window.cancelProjectReplacement === true }; }
					export function progress() { return { setProgress() {}, setSubProgress() {}, setText() {}, done() {} }; }
					export function waiting() { return { setText() {}, done() {} }; }
						export function popup(component, props, events) {
							if (component.name === 'GsProjectSaveDialog.vue') {
								queueMicrotask(async () => {
									const handle = await window.selectProjectSaveFile(props.name);
									if (handle != null) events.selected(handle, window.selectedProjectDirectory);
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

// 【計測の環境設定は両プレビューへ反映し、プロジェクトの保存データやUndo履歴には入れない】
// 計測切替をプロジェクトの編集扱いにせず、新規作成でも環境設定の値を維持する。
test('applies rendering statistics preferences without changing project data or undo history', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const context = app.appContext;
	const settings = window.testPreferences;
	await context.ready(project());
	const controllers = [context.visualModuleRendererManagerController, context.timelineRendererManagerController];
	assert.equal(settings.renderingStatsEnabled, false);
	assert.ok(controllers.every(controller => controller.staticOptions.enableStats === false));
	const historyLength = context.projectContext.stateManager.undoStack.value.length;
	settings.renderingStatsEnabled = true;
	await setImmediate();
	assert.ok(controllers.every(controller => controller.staticOptions.enableStats === true));
	assert.equal(context.projectContext.stateManager.undoStack.value.length, historyLength);
	const restored = decodeProjectFile(await encodeProjectFile(context.projectContext.snapshot()));
	assert.equal('renderingStatsEnabled' in restored, false);
	assert.equal('enableStats' in restored, false);
	await app.newProject();
	assert.equal(settings.renderingStatsEnabled, true);
	settings.renderingStatsEnabled = false;
	await setImmediate();
	assert.ok(controllers.every(controller => controller.staticOptions.enableStats === false));
});

// 【映像と音声の解析モニター設定は計測と独立して反映し、プロジェクトへ保存しない】
// プロジェクトを切り替えても環境設定を維持し、負荷の切り分けで編集履歴を増やさない。
test('applies analysis monitor preferences without changing project data or undo history', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const context = app.appContext;
	const settings = window.testPreferences;
	await context.ready(project());
	const controllers = [context.visualModuleRendererManagerController, context.timelineRendererManagerController];
	assert.equal(settings.analysisMonitorsEnabled, true);
	assert.equal(context.audioOutput.preview.analysisEnabled, true);
	assert.ok(controllers.every(controller => controller.staticOptions.enableWaveformAndHistogram === true));
	const historyLength = context.projectContext.stateManager.undoStack.value.length;
	settings.analysisMonitorsEnabled = false;
	assert.equal(context.audioOutput.preview.analysisEnabled, false);
	await setImmediate();
	assert.ok(controllers.every(controller => controller.staticOptions.enableWaveformAndHistogram === false));
	assert.ok(controllers.every(controller => controller.staticOptions.enableStats === false));
	assert.equal(context.projectContext.stateManager.undoStack.value.length, historyLength);
	const restored = decodeProjectFile(await encodeProjectFile(context.projectContext.snapshot()));
	assert.equal('analysisMonitorsEnabled' in restored, false);
	assert.equal('enableWaveformAndHistogram' in restored, false);
	await app.newProject();
	assert.equal(settings.analysisMonitorsEnabled, false);
	assert.equal(context.audioOutput.preview.analysisEnabled, false);
	settings.analysisMonitorsEnabled = true;
	await setImmediate();
	assert.equal(context.audioOutput.preview.analysisEnabled, true);
	assert.ok(controllers.every(controller => controller.staticOptions.enableWaveformAndHistogram === true));
});

// 【起動時に保存済みの計測・解析設定を両プレビューの初期設定へ反映する】
// 起動直後だけ既定値でWorkerを生成すると、footerの表示と実際のGPU処理が食い違う。
test('initializes both previews from saved rendering preferences', async t => {
	const window = setup(t);
	window.initialTestPreferences = { renderingStatsEnabled: true, analysisMonitorsEnabled: false };
	const { appContext } = evaluate(appBundle);
	assert.equal(appContext.audioOutput.preview.analysisEnabled, false);
	await appContext.ready(project());
	assert.equal(appContext.audioOutput.preview.analysisEnabled, false);
	for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		assert.equal(controller.staticOptions.enableStats, true);
		assert.equal(controller.staticOptions.enableWaveformAndHistogram, false);
	}
});

// 【ブラーだけの変更とUndo/Redoでは停止中の精密位置を維持する】
// FPSとブラーの同期を同じwatchで行っても、精密モードを解除するのはFPSの変更時だけにする。
// プレビューサンプル数の変更も、画像の品質を変えるだけで確認中の時刻は動かさない。
test('preserves precise seek positions when changing motion blur without changing FPS', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	await appContext.ready(project({ timelineFps: 30 }));
	const playback = appContext.previewPlayback;
	const timeline = appContext.timelineRendererManagerController;
	const manager = appContext.projectContext.stateManager;
	playback.seekTimeline(120, true, 'precise');
	timeline.updates.length = 0;
	appContext.timelinePreviewMotionBlurSamples.value = 4;
	await setImmediate();
	assert.equal(playback.currentTimelineTime.value, 120);
	manager.commit('changeTimelineRenderSettings', { timelineFps: 30,
		timelineMotionBlur: { ...manager.state.timelineMotionBlur.value, enabled: true, shutterAngle: 90 } });
	await setImmediate();
	assert.equal(playback.currentTimelineTime.value, 120);
	manager.undo();
	await setImmediate();
	assert.equal(playback.currentTimelineTime.value, 120);
	manager.redo();
	await setImmediate();
	playback.refresh();
	assert.equal(timeline.renders.at(-1), 120);
	assert.equal(timeline.updates.some(options => Object.hasOwn(options, 'previewFps')), false);
	manager.commit('changeTimelineRenderSettings', { timelineFps: 60, timelineMotionBlur: manager.state.timelineMotionBlur.value });
	await setImmediate();
	assert.equal(playback.currentTimelineTime.value, 4 * 1000 / 30);
});

for (const desktop of [false, true]) {
	// 【フレームキャッシュはブラウザー版とElectron版で有効にし、容量の変更をプロジェクト編集に含めない】
	// どちらも同じ初期容量と設定変更の経路を使い、上限変更でWorkerを再起動して全消去したりしない。
	test(`applies the per-window frame cache capacity on browser and desktop: ${desktop}`, async t => {
		const window = setup(t);
		if (desktop) window.desktop = {};
		const { appContext } = evaluate(appBundle);
		await appContext.ready(project());
		const timeline = appContext.timelineRendererManagerController;
		assert.equal(timeline.initialDynamicOptions.frameCacheMaxBytes, 2 * 1024 ** 3);
		const historyLength = appContext.projectContext.stateManager.undoStack.value.length;
		const staticUpdates = timeline.staticUpdates.length;
		timeline.updates.length = 0;
		window.testPreferences.timelineFrameCacheMaxGiB = 0;
		await setImmediate();
		assert.deepEqual(timeline.updates, [{ frameCacheMaxBytes: 0 }]);
		assert.equal(timeline.staticUpdates.length, staticUpdates);
		assert.equal(appContext.projectContext.stateManager.undoStack.value.length, historyLength);
		assert.equal('timelineFrameCacheMaxGiB' in appContext.projectContext.snapshot(), false);
	});
}

function project(overrides = {}) {
	return {
		automationGraphs: [],
		exportSettings: null,
		timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		id: 'project-id', gsVersion: '2.0.0-alpha.2', name: 'Example', description: 'First line\n日本語の説明', author: 'Author',
		assets: [], generatedSpeech: [], players: [], visualModules: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }], resolution: { width: 640, height: 480 },
		...overrides,
		visualModules: (overrides.visualModules ?? []).map(visualModule => ({ outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [], ...visualModule })),
		assets: (overrides.assets ?? []).map(asset => ({ fileDataType: asset.fileData?.type || (asset.id === 'audio' ? 'audio/wav' : 'image/png'), ...asset })),
	};
}

for (const [label, fileDataType, isExternalReference] of [
	['embedded image', 'image/png', false], ['external image', 'image/png', true], ['external video', 'video/mp4', true],
]) {
	// 【素材とノードを同じCommandで取り込んでも、素材準備前にノード差分を旧エンジンへ送らない】
	// AppContext・Command・RendererProjectSynchronizerは実コードを通す。遅い素材参照解決の間にも
	// 編集を続け、最新の寸法・Player・ノード設定を両プレビューの再生成へ一緒に渡す必要がある。
	test(`rebuilds previews with matching assets and nodes after importing an ${label}`, async t => {
		const window = setup(t);
		const { appContext, createVisualModuleAssetNode } = evaluate(appBundle);
		await appContext.ready(project({ visualModules: [{ id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [] }] }));
		t.after(() => appContext.previewPlayback.dispose());
		const gate = Promise.withResolvers();
		const source = { url: 'app://external-assets/imported', size: 100, error: null };
		window.desktop = { resolveExternalAsset: () => gate.promise };
		const asset = { id: 'imported', name: 'Imported', width: 1920, height: 1080, fileDataType,
			fileData: isExternalReference ? source : new Blob(['image'], { type: fileDataType }), sourceFilePath: 'C:/assets/imported', isExternalReference };
		const { node, player } = createVisualModuleAssetNode(asset, []);
		const players = player == null ? [] : [player];
		const manager = appContext.projectContext.stateManager;
		const controllers = [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController];
		for (const controller of controllers) {
			controller.lifecycle.length = 0;
			controller.patches.length = 0;
			const relaunch = controller.relaunchManager.bind(controller);
			controller.relaunchManager = async () => {
				// 埋め込み画像でも、Worker初期化中のデコード・GPU転送待ちを再現する。
				if (!isExternalReference) await gate.promise;
				// 起動時に実際の参照先と寸法を読み取れ、Player参照も同じ世代で揃っていることを確認する。
				const importedNode = controller.options.visualModules[0].nodes[0];
				const assetId = importedNode.effectId === 'image' ? importedNode.staticSettings.image
					: appContext.visualModuleRendererManagerController.options.players.find(player => player.id === importedNode.staticSettings.player).assetId;
				const referencedAsset = controller.options.assets.find(asset => asset.id === assetId);
				assert.deepEqual([referencedAsset.width, referencedAsset.height], [1920, 1080]);
				assert.equal(importedNode.resolution.scale, 0.5);
				await relaunch();
			};
		}
		manager.commit('importAssets', { assets: [asset], players, visualModule: { target: { visualModuleId: 'visualModule' }, nodes: [node] } });
		assert.equal(appContext.renderEngine.canRender.value, false);
		assert.ok(controllers.every(controller => controller.isReady.value === false));
		manager.commit('changeNodeResolution', { visualModuleId: 'visualModule', nodeId: node.id, resolution: { mode: 'auto', scale: 0.5 } });
		await appContext.flushRendererProjectChanges();
		await setImmediate();
		assert.ok(controllers.every(controller => controller.patches.length === 0));
		assert.ok(controllers.every(controller => !controller.lifecycle.includes('relaunch')));
		gate.resolve(source);
		await setImmediate();
		assert.equal(appContext.renderEngine.errorMessage.value, null);
		for (const controller of controllers) {
			assert.equal(controller.isReady.value, true);
			assert.equal(controller.lifecycle.filter(event => event === 'relaunch').length, 1);
		}
		manager.commit('renameAsset', { assetId: asset.id, name: 'Renamed' });
		await setImmediate();
		assert.ok(controllers.every(controller => controller.lifecycle.filter(event => event === 'relaunch').length === 1));
	});
}

// 【取り込み準備中のUndoは素材とノードを両方除いた状態で再生成し、古い準備完了で戻さない】
// 素材削除を旧ノードへ先に反映すると静的解像度の計算が失敗する。
// 遅れて完了した参照解決の無視と、Redoでの再取り込みを同じ実際の履歴経路で確認する。
test('ignores obsolete asset preparation after undo and rebuilds the latest state on redo', async t => {
	const window = setup(t);
	const { appContext, createVisualModuleAssetNode } = evaluate(appBundle);
	await appContext.ready(project({ visualModules: [{ id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [] }] }));
	t.after(() => appContext.previewPlayback.dispose());
	const gate = Promise.withResolvers();
	const source = { url: 'app://external-assets/imported', size: 100, error: null };
	window.desktop = { resolveExternalAsset: () => gate.promise };
	const asset = { id: 'imported', name: 'Imported', width: 640, height: 480, fileDataType: 'image/png',
		fileData: source, sourceFilePath: 'C:/assets/imported', isExternalReference: true };
	const { node } = createVisualModuleAssetNode(asset, []);
	const manager = appContext.projectContext.stateManager;
	const controllers = [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController];
	manager.commit('importAssets', { assets: [asset], players: [], visualModule: { target: { visualModuleId: 'visualModule' }, nodes: [node] } });
	await setImmediate();
	manager.undo();
	await setImmediate();
	for (const controller of controllers) {
		assert.equal(controller.isReady.value, true);
		assert.deepEqual(controller.options.assets, []);
		assert.deepEqual(controller.options.visualModules[0].nodes, []);
		controller.lifecycle.length = 0;
	}
	gate.resolve(source);
	await setImmediate();
	assert.ok(controllers.every(controller => controller.lifecycle.length === 0));
	manager.redo();
	await setImmediate();
	assert.equal(appContext.renderEngine.errorMessage.value, null);
	for (const controller of controllers) {
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.options.assets[0].id, asset.id);
		assert.equal(controller.options.visualModules[0].nodes[0].staticSettings.image, asset.id);
		assert.equal(controller.lifecycle.filter(event => event === 'relaunch').length, 1);
	}
	// 再生成済みの旧ノードが存在する場合も、素材だけを先に削除して参照切れを起こさない。
	manager.undo();
	assert.ok(controllers.every(controller => controller.isReady.value === false));
	await setImmediate();
	assert.equal(appContext.renderEngine.errorMessage.value, null);
	for (const controller of controllers) {
		assert.equal(controller.isReady.value, true);
		assert.deepEqual(controller.options.assets, []);
		assert.deepEqual(controller.options.visualModules[0].nodes, []);
	}
});

// 【描画へ送らない表示名の編集でもBAKEをその場で中止する】
// レンダラー同期や次の描画通知に頼ると、名前変更などでは中止されない。
// 通常のCommand購読で止め、BAKE自体がUndo履歴を増やさないことも確認する。
test('cancels baking synchronously on metadata edits without adding bake history', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	t.after(() => appContext.previewPlayback.dispose());
	appContext.previewPlayback.seekTimeline(0);
	await setImmediate();
	const timeline = appContext.timelineRendererManagerController;
	const gate = Promise.withResolvers();
	let frameRequested = false;
	timeline.isFrameCacheEnabled = { value: true };
	timeline.renderTimelineAtAndWait = () => { frameRequested = true; return gate.promise; };
	timeline.cancelSeek = () => { if (frameRequested) gate.resolve(false); };
	const manager = appContext.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const historyLength = manager.undoStack.value.length;
	const baking = appContext.previewPlayback.toggleTimelineBake();
	assert.equal(appContext.previewPlayback.isTimelineBaking.value, true);
	assert.equal(manager.undoStack.value.length, historyLength);
	manager.commit('renameTimelineLayer', { sceneId: scene.id, layerId: scene.layers[0].id, name: 'Renamed while baking' });
	assert.equal(appContext.previewPlayback.isTimelineBaking.value, false);
	await baking;
	assert.equal(manager.undoStack.value.length, historyLength + 1);
});

// 【不正な設定も読み込んで編集でき、修正した最新状態から両エンジンを生成する】
// レンダラー側で更新を拒否するとUIとWorkerの状態が食い違い、循環を直す編集も失敗する。
test('keeps invalid projects editable and recreates both previews after correction', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	await appContext.ready(project({ visualModules: [{ id: 'invalid', paramDefs: [], nodes: [
		{ id: 'effect', type: 'effect', effectId: 'fill', resolution: { mode: 'invalid' }, params: { color: { inputSource: 'literal', value: [1, 0, 0, 1] } } },
	] }] }));
	assert.match(appContext.renderValidation.errorMessage.value, /Invalid effect resolution/);
	for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) assert.equal(controller.isReady.value, false);
	appContext.projectContext.stateManager.commit('removeNode', { visualModuleId: 'invalid', nodeId: 'effect' });
	assert.equal(appContext.renderValidation.errorMessage.value, null);
	await setImmediate();
	for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		assert.equal(controller.isReady.value, true);
		assert.deepEqual(controller.options.visualModules[0].nodes, []);
	}
});

// 【Visual Module Live Preview引数だけの静的エラーは、Timelineへ切り替えると診断解除と再生成を行う】
// プレビュー対象の変更はProjectの編集通知を出さない。
// エラー表示だけが消えてWorkerを持たない状態のままにならないよう、両エンジンの復帰を確認する。
test('recreates previews after switching away from invalid visualModuleLivePreview inputs', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	await appContext.ready(project({ visualModules: [{ id: 'visualModule', nodes: [], paramDefs: [{
		id: 'audio', nameForReference: 'audio', dataType: { kind: 'audioSource' }, canNode: false,
		ui: { label: 'Audio', control: { controlType: 'audioSource' } }, defaultValue: { inputSource: 'literal', value: null },
	}] }] }));
	appContext.previewPlayback.updateVisualModuleLivePreviewParamValues('visualModule', { audio: { inputSource: 'literal', value: { type: 'player', playerId: 'missing' } } });
	assert.match(appContext.renderValidation.errorMessage.value, /Player not found/);
	assert.equal(appContext.timelineRendererManagerController.isReady.value, false);
	appContext.previewPlayback.showTimeline();
	assert.equal(appContext.renderValidation.errorMessage.value, null);
	await setImmediate();
	assert.equal(appContext.renderEngine.errorMessage.value, null);
	for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		assert.equal(controller.isReady.value, true);
	}
	assert.equal(appContext.previewPlayback.state.value.mode, 'timeline');
	assert.equal(appContext.timelineRendererManagerController.renders.at(-1), 0);
});

// 【プレビュー固有設定の修正でも、実行時失敗後に最新設定から再生成する】
// これらの値はProjectのCommand通知を出さないため、編集通知だけに再試行を任せると復帰できない。
// 解像度・サンプル数・GPU設定を含む各経路が、正常な最新設定を持つ両エンジンへ反映されることを確認する。
for (const [setting, change, inspect] of [
	['resolution scale', appContext => { appContext.resolutionFactor.value = 0.5; }, appContext => {
		assert.equal(appContext.timelineRendererManagerController.initialResolutionScale, 0.5);
	}],
	['motion blur samples', appContext => { appContext.timelinePreviewMotionBlurSamples.value = 4; }, appContext => {
		assert.equal(appContext.timelineRendererManagerController.initialStaticOptions.timelineMotionBlur.samples, 4);
	}],
	['GPU precision', () => { window.testPreferences.enable32bitDataTextures = true; }, appContext => {
		assert.equal(appContext.timelineRendererManagerController.initialStaticOptions.enable32bitDataTextures, true);
	}],
	['timeline preview fps', appContext => { appContext.timelinePreviewFpsFactor.value = 2; }],
	['visualModuleLivePreview fps limit', appContext => { appContext.visualModuleLivePreviewFpsLimit.value = 24; }],
	['visualModuleLivePreview time factor', appContext => { appContext.visualModuleLivePreviewTimeFactor.value = 0.5; }],
	['clipping display', appContext => { appContext.highlightClipping.value = true; }],
]) test(`retries runtime failures after changing ${setting}`, async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	await appContext.ready(project());
	appContext.renderEngine.fail(new Error('draw failed'));
	change(appContext);
	await setImmediate();
	assert.equal(appContext.renderEngine.errorMessage.value, null);
	for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.lifecycle.filter(event => event === 'relaunch').length, 2);
	}
	inspect?.(appContext);
});

// 【再生開始時の生成音声をシーク中も固定し、次回再生にだけ新しい結果を採用する】
// 生成完了で音声Workerが再起動したり、描画用音声入力と再生音声が食い違うのを防ぐ。
// 発話の編集とUndoは再生を停止し、字幕と音声に別の本文が使われないことも確認する。
// 音声情報と入れ子のAudioQueryはVueでリアクティブになるため、Workerへ複製可能な状態で渡す。
test('freezes prepared speech during playback and stops for utterance edits and undo', async t => {
	const window = setup(t);
	window.requestAnimationFrame = () => 1;
	window.cancelAnimationFrame = () => {};
	const { appContext } = evaluate(appBundle);
	const key = JSON.stringify([1, 1, 'Hello']);
	const speech = { key, sourceId: 'first', durationMs: 1000, fileData: new Blob(['first']), engineVersion: 'test', audioQuery: { accent_phrases: [{ moras: [{ text: 'ハ', vowel_length: 0.1 }] }] } };
	const layer = { id: 'speech', name: 'Speech', layerType: 'voicevox', isDisabled: false, automationGraphs: [],
		voicevox: { speedScale: 1 }, utterances: [{ id: 'key', timeMs: 0, text: 'Hello', reading: null, styleId: 1, subtitleDuration: { mode: 'fill' } }],
		clips: [{ id: 'clip', startMs: 0, durationMs: 2000, contentOffsetMs: 0 }],
		subtitleParamValues: {}, compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	await appContext.ready(project({ generatedSpeech: [speech], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }] }));
	await nextTick();
	const manager = appContext.projectContext.stateManager;
	const playback = appContext.previewPlayback;
	const audio = appContext.timelineAudioPreview;
	playback.playTimeline();
	try {
		assert.equal(audio.projects.at(-1).generatedSpeech[0].sourceId, 'first');
		manager.state.generatedSpeech.value = [{ ...speech, sourceId: 'second', fileData: new Blob(['second']) }];
		await nextTick();
		assert.equal(audio.starts.length, 1);
		playback.seekTimeline(500);
		assert.equal(audio.projects.at(-1).generatedSpeech[0].sourceId, 'first');
		playback.pauseTimeline();
		await nextTick();
		playback.playTimeline();
		assert.equal(audio.projects.at(-1).generatedSpeech[0].sourceId, 'second');
		manager.commit('editVoicevoxLayer', { sceneId: 'scene', layerId: 'speech', voicevox: layer.voicevox,
			utterances: [{ id: 'key', timeMs: 0, text: 'Edited', reading: null, styleId: 1, subtitleDuration: { mode: 'fill' } }] });
		assert.equal(playback.isTimelinePlaying.value, false);
		// Webでも旧結果を保存対象から外し、同じ操作のUndoで即座に再利用できるようにする。
		assert.deepEqual(manager.state.generatedSpeech.value, []);
		assert.deepEqual(appContext.projectContext.snapshot().generatedSpeech, []);
		await nextTick();
		playback.playTimeline();
		manager.undo();
		assert.equal(playback.isTimelinePlaying.value, false);
		assert.equal(manager.state.generatedSpeech.value[0].sourceId, 'second');
		assert.equal(appContext.projectContext.snapshot().generatedSpeech[0].sourceId, 'second');
		await nextTick();
		playback.playTimeline();
		manager.commit('editVoicevoxLayer', { sceneId: 'scene', layerId: 'speech', voicevox: layer.voicevox,
			utterances: [{ id: 'key', timeMs: 0, text: 'Hello', reading: null, styleId: 7, subtitleDuration: { mode: 'fill' } }] });
		assert.equal(playback.isTimelinePlaying.value, false);
		await nextTick();
		playback.playTimeline();
		manager.undo();
		assert.equal(playback.isTimelinePlaying.value, false);
	} finally { playback.dispose(); }
});

// 【取り込んだVisual ModuleのUndoではVisual Module Live Preview対象と両レンダラーの定義を解除する】
// Workerだけを停止するとプレビューのモードがVisual Module Live Previewのまま残り、再起動時に削除済みの対象を再開してしまう。
// AppContextの履歴購読まで実コードで通し、Redoでは意図せず自動再生しないことも確認する。
test('leaves Visual Module Live Preview when an imported Visual Module is undone and restores its registration on redo', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	await appContext.ready(project());
	const manager = appContext.projectContext.stateManager;
	const visualModule = { id: 'imported', name: 'Imported Visual Module', nodes: [], paramDefs: [], outputDefs: [],
		primaryInputId: null, primaryOutputId: null, automationGraphs: [] };
	manager.commit('importVisualModule', { visualModule, assets: [], players: [], unassignedPlayerNames: [] });
	await setImmediate();
	const visualModuleLivePreview = appContext.visualModuleRendererManagerController;
	const timeline = appContext.timelineRendererManagerController;
	assert.ok(visualModuleLivePreview.options.visualModules.some(entry => entry.id === 'imported'));
	assert.ok(timeline.options.visualModules.some(entry => entry.id === 'imported'));
	appContext.previewPlayback.startVisualModuleLivePreview('imported');
	manager.undo();
	assert.equal(appContext.previewPlayback.visualModuleLivePreviewVisualModuleId.value, null);
	assert.equal(appContext.previewPlayback.state.value.mode, 'timeline');
	await setImmediate();
	assert.ok(!visualModuleLivePreview.options.visualModules.some(entry => entry.id === 'imported'));
	assert.ok(!timeline.options.visualModules.some(entry => entry.id === 'imported'));
	manager.redo();
	await setImmediate();
	assert.ok(visualModuleLivePreview.options.visualModules.some(entry => entry.id === 'imported'));
	assert.ok(timeline.options.visualModules.some(entry => entry.id === 'imported'));
	assert.equal(appContext.previewPlayback.visualModuleLivePreviewVisualModuleId.value, null);
});

// 【描画設定を保存・復元し、Undo/Redoでもタイムラインだけへ同期する】
// プレビュー用の値だけが変わって保存から漏れたり、Visual Module Live Preview側のfps制限を書き換えたりしないことを保証する。
test('persists timeline render settings and synchronizes undo and redo without changing Visual Module Live Preview', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const notifications = [];
	manager.onChange(changes => notifications.push(changes));
	const settings = { timelineFps: 29.97, timelineMotionBlur: { enabled: true, shutterAngle: 270, samples: 32 } };
	const visualModuleLivePreview = appContext.visualModuleRendererManagerController;
	const timeline = appContext.timelineRendererManagerController;
	visualModuleLivePreview.updates.length = 0;
	visualModuleLivePreview.staticUpdates.length = 0;
	timeline.staticUpdates.length = 0;
	timeline.updates.length = 0;
	manager.commit('changeTimelineRenderSettings', settings);
	await nextTick();
	const previewSettings = { ...settings, timelineMotionBlur: { ...settings.timelineMotionBlur, samples: appContext.timelinePreviewMotionBlurSamples.value } };
	assert.equal(timeline.staticOptions.timelineFps, 29.97);
	assert.deepEqual(timeline.staticOptions.timelineMotionBlur, previewSettings.timelineMotionBlur);
	assert.deepEqual(timeline.staticUpdates, [previewSettings]);
	assert.deepEqual(timeline.updates, [{ previewFps: settings.timelineFps * appContext.timelinePreviewFpsFactor.value }]);
	assert.equal(visualModuleLivePreview.updates.length, 0);
	assert.equal(visualModuleLivePreview.staticUpdates.length, 0);
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
	await appContext.saveProject();
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
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.isDisabled, false);
	const original = JSON.parse(JSON.stringify(layer));
	const timeline = appContext.timelineRendererManagerController;
	appContext.previewPlayback.seekTimeline(500);
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
	assert.equal(appContext.previewPlayback.currentTimelineTime.value, 500);
	assert.equal(appContext.previewPlayback.isTimelinePlaying.value, false);
	const handle = fileHandle('disabled-layer.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	assert.deepEqual(decodeProjectFile(handle.bytes).timelineScenes[0].layers[0], { ...original, isDisabled: true });
	await app.newProject();
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.equal(manager.state.timelineScenes.value[0].layers[0].isDisabled, true);
	assert.equal(timeline.options.timelineScenes[0].layers[0].isDisabled, true);
});

// 【マスクを保存・再読込でき、設定変更とUndo/Redoを停止中のプレビューへ反映する】
// Inspectorの表示や一時的なGPU状態だけに設定を持つと、保存や再読込でマスクが失われる。
// 実際のプロジェクト・Command・同期・ファイル入出力を通して静的な設定の寿命を検証する。
test('persists timeline masks and refreshes paused previews through undo and redo', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.mask, null);
	const timeline = appContext.timelineRendererManagerController;
	appContext.previewPlayback.seekTimeline(500);
	timeline.renders.length = 0;
	const mask = { channel: 'luminance', inverted: true };
	manager.commit('setTimelineLayerMask', { sceneId: scene.id, layerId: layer.id, mask });
	await nextTick();
	await setImmediate();
	assert.deepEqual(timeline.options.timelineScenes[0].layers[0].mask, mask);
	assert.ok(timeline.renders.length > 0);
	manager.undo();
	await nextTick();
	await setImmediate();
	assert.equal(timeline.options.timelineScenes[0].layers[0].mask, null);
	manager.redo();
	await nextTick();
	await setImmediate();
	assert.deepEqual(timeline.options.timelineScenes[0].layers[0].mask, mask);
	assert.equal(appContext.previewPlayback.currentTimelineTime.value, 500);
	const handle = fileHandle('masked-layer.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	assert.deepEqual(decodeProjectFile(handle.bytes).timelineScenes[0].layers[0].mask, mask);
	await app.newProject();
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.deepEqual(manager.state.timelineScenes.value[0].layers[0].mask, mask);
	assert.deepEqual(timeline.options.timelineScenes[0].layers[0].mask, mask);
});

// 【ブラーの強制無効を保存・復元し、停止中のプレビューにも即時反映する】
// プロジェクト全体のブラーとは別のレイヤー設定として保持し、Undo・Redoや保存し直しで
// 消えないことを確認する。初期値falseはプロジェクト設定へ従うことを表す。
test('persists layer motion blur overrides and refreshes paused previews through undo and redo', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.forceDisableMotionBlur, false);
	const timeline = appContext.timelineRendererManagerController;
	appContext.previewPlayback.seekTimeline(500);
	timeline.renders.length = 0;
	manager.commit('setTimelineLayerMotionBlurDisabled', { sceneId: scene.id, layerId: layer.id, forceDisableMotionBlur: true });
	await nextTick();
	await setImmediate();
	assert.equal(timeline.options.timelineScenes[0].layers[0].forceDisableMotionBlur, true);
	assert.ok(timeline.renders.length > 0);
	manager.undo();
	await nextTick();
	await setImmediate();
	assert.equal(timeline.options.timelineScenes[0].layers[0].forceDisableMotionBlur, false);
	manager.redo();
	await nextTick();
	await setImmediate();
	assert.equal(timeline.options.timelineScenes[0].layers[0].forceDisableMotionBlur, true);
	const handle = fileHandle('motion-blur-layer.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).timelineScenes[0].layers[0].forceDisableMotionBlur, true);
	await app.newProject();
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.equal(manager.state.timelineScenes.value[0].layers[0].forceDisableMotionBlur, true);
	assert.equal(timeline.options.timelineScenes[0].layers[0].forceDisableMotionBlur, true);
});

// 【エクスポート設定を保存・読込し、別プロジェクトには引き継がない】
// 出力値だけでは倍率指定や未選択のカスタム入力を復元できないため、ダイアログ設定全体を保存する。
// 保存状態はダイアログの作業コピーと切り離し、Undo/Redoと新規プロジェクトでも正しい値を保つ。
test('round trips export dialog settings through project state and files', async t => {
	setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const { projectContext } = app.appContext;
	const manager = projectContext.stateManager;
	assert.equal(manager.state.exportSettings.value, null);
	const settings = {
		sceneId: manager.state.timelineScenes.value[0].id, mode: 'still', videoFormat: 'mp4', stillFormat: 'webp',
		videoQuality: 'very-high', stillQuality: 'lossless', resolutionScale: 'custom', customResolution: { width: 513, height: 777 },
		fpsScale: 0.5, customFps: 23.976, startTime: '00:00:01.250', endTime: '00:00:08.750',
	};
	manager.commit('changeExportSettings', settings);
	settings.customResolution.width = 999;
	assert.equal(manager.state.exportSettings.value.customResolution.width, 513);
	manager.undo();
	assert.equal(manager.state.exportSettings.value, null);
	manager.redo();
	const snapshot = projectContext.snapshot();
	const restored = decodeProjectFile(await encodeProjectFile(snapshot));
	assert.deepEqual(restored.exportSettings, snapshot.exportSettings);
	await app.appContext.ready(restored);
	assert.deepEqual(manager.state.exportSettings.value, snapshot.exportSettings);
	manager.state.exportSettings.value.customResolution.width = 1000;
	assert.equal(restored.exportSettings.customResolution.width, 513);
	assert.equal(snapshot.exportSettings.customResolution.width, 513);
	await app.newProject();
	assert.equal(manager.state.exportSettings.value, null);
});

// 【初回生成からプロジェクトのfps・ブラー設定とプレビュー既定の0サンプルを使う】
// プレビューのブラーは既定でオフにし、保存された書き出し用サンプル数は維持する。
// 初期化後にwatchで設定を変えると、初回表示が遅れ、読込中の動的更新も中断される。
test('uses project render settings with motion blur sampling disabled for the initial preview', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	const loaded = project({ timelineFps: 24, timelineMotionBlur: { enabled: true, shutterAngle: 90, samples: 32 } });
	await appContext.ready(loaded);
	const timeline = appContext.timelineRendererManagerController;
	assert.equal(timeline.initialStaticOptions.timelineFps, 24);
	assert.deepEqual(timeline.initialStaticOptions.timelineMotionBlur, { ...loaded.timelineMotionBlur, samples: 0 });
	assert.ok(timeline.updates.every(options => !('timelineFps' in options) && !('timelineMotionBlur' in options)));
});

// 【プレビューのブラー品質はUIだけで保持し、プロジェクト・Undo履歴・Visual Module Live Previewには反映しない】
// プレビューをオフにしても書き出し用サンプル数を失わず、プロジェクトの有効設定は維持する。
// 読み込み時は保存された書き出し設定を復元し、プレビューは既定の0サンプルへ戻す。
test('keeps preview motion blur samples separate from project settings and saved files', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const settings = { timelineFps: 30, timelineMotionBlur: { enabled: true, shutterAngle: 270, samples: 32 } };
	manager.commit('changeTimelineRenderSettings', settings);
	await nextTick();
	const historyLength = manager.undoStack.value.length;
	const timeline = appContext.timelineRendererManagerController;
	const visualModuleLivePreview = appContext.visualModuleRendererManagerController;
	visualModuleLivePreview.staticUpdates.length = 0;
	assert.deepEqual([...app.TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS], [0, 2, 4, 8]);
	for (const samples of [2, 4, 8, 0]) {
		appContext.timelinePreviewMotionBlurSamples.value = samples;
		await nextTick();
		assert.deepEqual(timeline.staticOptions.timelineMotionBlur, { ...settings.timelineMotionBlur, samples });
		assert.deepEqual(manager.state.timelineMotionBlur.value, settings.timelineMotionBlur);
		assert.equal(manager.undoStack.value.length, historyLength);
	}
	assert.equal(visualModuleLivePreview.staticUpdates.length, 0);
	manager.undo();
	await nextTick();
	assert.equal(appContext.timelinePreviewMotionBlurSamples.value, 0);
	assert.equal(timeline.staticOptions.timelineMotionBlur.enabled, false);
	manager.redo();
	await nextTick();
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 0);
	assert.equal(manager.state.timelineMotionBlur.value.samples, 32);
	const handle = fileHandle('preview-quality.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.deepEqual(saved.timelineMotionBlur, settings.timelineMotionBlur);
	assert.equal('previewSamples' in saved.timelineMotionBlur, false);
	assert.equal('timelinePreviewMotionBlurSamples' in saved, false);
	// 読み込み前にオンにしておき、単に直前のオフ状態を維持しているだけではないことを確認する。
	appContext.timelinePreviewMotionBlurSamples.value = 4;
	await nextTick();
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 4);
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.equal(appContext.timelinePreviewMotionBlurSamples.value, 0);
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 0);
	assert.equal(manager.state.timelineMotionBlur.value.samples, 32);
});

// 【倍率はタイムラインの描画頻度だけを変更し、Visual Module Live Previewのfps制限は干渉しない】
// appの実際の接続と再生スケジューラを使い、独立した設定が再び混線するのを防ぐ。
test('applies timeline preview factors independently of the Visual Module Live Preview fps limit', async t => {
	const window = setup(t);
	const callbacks = new Map();
	let nextId = 0;
	window.requestAnimationFrame = callback => { const id = ++nextId; callbacks.set(id, callback); return id; };
	window.cancelAnimationFrame = id => callbacks.delete(id);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	t.after(() => appContext.previewPlayback.dispose());
	appContext.timelineRendererManagerController.staticUpdates.length = 0;
	const measure = (factor, visualModuleLivePreviewFpsLimit) => {
		appContext.previewPlayback.pauseTimeline();
		appContext.previewPlayback.seekTimeline(0);
		appContext.timelinePreviewFpsFactor.value = factor;
		appContext.visualModuleLivePreviewFpsLimit.value = visualModuleLivePreviewFpsLimit;
		appContext.previewPlayback.playTimeline();
		const timeline = appContext.timelineRendererManagerController;
		timeline.renders.length = 0;
		for (let time = 0; time <= 1000; time++) {
			appContext.timelineAudioPreview.time = time;
			const [id, callback] = callbacks.entries().next().value;
			callbacks.delete(id);
			callback(time);
		}
		const count = timeline.renders.length;
		assert.ok(appContext.previewPlayback.currentTimelineTime.value >= 1000 - 1000 / (60 * factor) - 1);
		appContext.previewPlayback.pauseTimeline();
		return count;
	};
	for (const factor of [0.5, 1, 2]) {
		const limited = measure(factor, 1);
		const unlimited = measure(factor, null);
		assert.equal(limited, unlimited);
		assert.ok(Math.abs(limited - 60 * factor) <= 1, `factor ${factor}: ${limited}`);
	}
	assert.equal(appContext.projectContext.stateManager.state.timelineFps.value, 60);
	await nextTick();
	assert.equal(appContext.timelineRendererManagerController.staticUpdates.length, 0);
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
		async queryPermission() { return options.permission ?? 'granted'; },
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

// 【Save as中に追加したSaveは、確定後の新しい保存先へ書き込む】
// 保存の呼出時に旧ハンドルを固定すると、待機中のSaveが元ファイルを上書きし、現在の保存先まで戻してしまう。
// 追加編集を含むSaveを失わず、新しい保存先とその後の保存先がともにBになることを確認する。
test('resolves queued Save against the destination committed by Save as', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	const original = await encodeProjectFile(project({ name: 'Original A' }));
	const first = fileHandle('A.gsproj', { bytes: original });
	const second = fileHandle('B.gsproj');
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = second.createWritable;
	second.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
	};
	await appContext.ready(project({ name: 'Save as snapshot' }), first.name, first);
	window.selectProjectSaveFile = async () => second;
	const saveAs = appContext.saveProject(true);
	await started.promise;
	appContext.projectContext.stateManager.state.name.value = 'Queued Save snapshot';
	const save = appContext.saveProject();
	finish.resolve();
	await Promise.all([saveAs, save]);
	assert.deepEqual(first.bytes, original);
	assert.equal(decodeProjectFile(second.bytes).name, 'Queued Save snapshot');
	const savedId = decodeProjectFile(second.bytes).id;
	assert.notEqual(savedId, 'project-id');
	assert.equal(appContext.projectContext.snapshot().id, savedId);
	appContext.projectContext.stateManager.state.name.value = 'Next Save';
	await appContext.saveProject();
	assert.deepEqual(first.bytes, original);
	assert.equal(decodeProjectFile(second.bytes).name, 'Next Save');
	assert.equal(decodeProjectFile(second.bytes).id, savedId);
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【Save asがキャンセル・失敗した場合、待機中のSaveは以前の保存先を使う】
// キューに登録した時点で新しい保存先へ切り替えると、未確定のファイルへ後続の保存が流れる。
// 元のプロジェクトと同じIDを開き直した場合も、古いセッションの保存を実行させない。
test('keeps the committed destination after cancelled or failed Save as and discards old project saves', async t => {
	for (const outcome of ['cancel', 'failure', 'reopen']) {
		await t.test(outcome, async t => {
			const window = setup(t);
			const app = evaluate(appBundle);
			const { appContext } = app;
			const first = fileHandle('A.gsproj');
			const second = fileHandle('B.gsproj', { fail: 'write' });
			const started = Promise.withResolvers();
			const finish = Promise.withResolvers();
			window.selectProjectSaveFile = async () => { started.resolve(); await finish.promise; return outcome === 'cancel' ? null : second; };
			await appContext.ready(project(), first.name, first);
			const original = first.bytes;
			const saveAs = appContext.saveProject(true);
			await started.promise;
			appContext.projectContext.stateManager.state.name.value = 'Queued edit';
			const save = appContext.saveProject();
			if (outcome === 'reopen') await appContext.ready(project(), first.name, first);
			finish.resolve();
			await Promise.all([saveAs, save]);
			assert.deepEqual(second.bytes, new Uint8Array([42]));
			if (outcome === 'reopen') assert.equal(first.bytes, original);
			else assert.equal(decodeProjectFile(first.bytes).name, 'Queued edit');
			assert.deepEqual(globalThis.projectAlerts, outcome === 'failure' ? ['write failed'] : []);
		});
	}
});

// 【待機中に保存先が変わった場合、実際の保存先の権限を確認する】
// 旧ファイルの許可を新しい宛先へ流用したり、旧ファイルの拒否で許可済みの新しい宛先への保存を止めない。
test('checks the new destination permission instead of reusing the queued permission result', async t => {
	for (const allowed of [true, false]) {
		await t.test(allowed ? 'new destination granted' : 'new destination denied', async t => {
			const window = setup(t);
			const app = evaluate(appBundle);
			const { appContext } = app;
			const first = fileHandle('A.gsproj', { permission: allowed ? 'denied' : 'granted' });
			const second = fileHandle('B.gsproj', { permission: allowed ? 'granted' : 'denied' });
			const started = Promise.withResolvers();
			const finish = Promise.withResolvers();
			window.selectProjectSaveFile = async () => { started.resolve(); await finish.promise; return second; };
			await appContext.ready(project({ name: 'Save as' }), first.name, first);
			const saveAs = appContext.saveProject(true);
			await started.promise;
			appContext.projectContext.stateManager.state.name.value = 'Queued Save';
			const save = appContext.saveProject();
			finish.resolve();
			await Promise.all([saveAs, save]);
			assert.deepEqual(first.bytes, new Uint8Array([42]));
			assert.equal(decodeProjectFile(second.bytes).name, allowed ? 'Queued Save' : 'Save as');
			assert.equal(globalThis.projectAlerts.length, allowed ? 0 : 1);
			if (!allowed) assert.match(globalThis.projectAlerts[0], /Write permission/);
		});
	}
});

function setup(t) {
	const previousWindow = globalThis.window;
	const previousAlerts = globalThis.projectAlerts;
	// appのキーボード登録だけ受け取り、実際のDOMやイベントループは使わない。
	globalThis.window = {
		document: { title: '', addEventListener() {} },
		setTimeout() { return 1; }, clearTimeout() {},
		// 旧APIに戻すと、保存先選択だけで既存データが失われる。新経路では一切呼び出さない。
		showSaveFilePicker() { assert.fail('The destructive save picker must not be used'); },
	};
	globalThis.projectAlerts = [];
	t.after(() => { globalThis.window = previousWindow; globalThis.projectAlerts = previousAlerts; });
	return globalThis.window;
}

// 【別作品を開く・新規作成するときに、現在の未保存変更を破棄するか確認する】
// キャンセルした作品の内容やUndo履歴を変更せず、保存済みファイルの読込にも同じ保護を適用する。
test('preserves the current project when replacement of unsaved changes is canceled', async t => {
	const window = setup(t);
	window.projectConfirmations = [];
	const app = evaluate(appBundle);
	await app.newProject();
	app.appContext.projectContext.stateManager.state.name.value = 'Keep this project';
	window.cancelProjectReplacement = true;
	await app.newProject();
	assert.equal(app.appContext.projectContext.snapshot().name, 'Keep this project');
	const file = new File([new Uint8Array(await encodeProjectFile(project()))], 'other.gsproj');
	assert.equal(await app.openProject(file), false);
	assert.equal(app.appContext.projectContext.snapshot().name, 'Keep this project');
	assert.equal(window.projectConfirmations.length, 2);
	window.cancelProjectReplacement = false;
	assert.equal(await app.openProject(file), true);
	assert.equal(app.appContext.projectContext.snapshot().name, 'Example');
});

// 【名前・説明・作者と素材の原本を一緒に保存・復元する】
// 表示用の情報だけが保存対象から漏れたり、改行や日本語が失われたりすることを防ぐ。
test('round trips project information and original assets', async () => {
	const original = project({ assets: [{ id: 'asset', name: 'font.ttf', width: 0, height: 0,
		fileDataType: 'font/ttf', fileData: new Blob([new Uint8Array([0, 42, 255])], { type: 'font/ttf' }) }] });
	const restored = decodeProjectFile(await encodeProjectFile(original));
	assert.deepEqual({ ...restored, assets: [] }, { ...original, assets: [] });
	assert.deepEqual(new Uint8Array(await restored.assets[0].fileData.arrayBuffer()), new Uint8Array([0, 42, 255]));
	assert.equal(restored.assets[0].fileData.type, 'font/ttf');
});

// 【素材の原本パスは編集履歴とプロジェクトの保存・再読込を通して保持する】
// 取り込みAPIにだけパスがあっても、Commandが捨ててしまうと保存できない。
// 表示名は原本の場所とは別なので、改名や追加・削除のUndo/Redoでもパスを変えない。
// Electronで保存したパスは、パス取得APIがないブラウザで開いても記録として保持する。
test('preserves asset source paths through commands and project save and reload', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const path = 'C:\\素材 フォルダ\\original.png';
	manager.commit('addAsset', { id: 'asset', name: 'original.png', width: 4, height: 2,
		fileDataType: 'image/png', fileData: new Blob(['original image'], { type: 'image/png' }), sourceFilePath: path });
	assert.equal(manager.state.assets.value[0].sourceFilePath, path);
	manager.undo();
	assert.equal(manager.state.assets.value.length, 0);
	manager.redo();
	assert.equal(manager.state.assets.value[0].sourceFilePath, path);
	manager.commit('renameAsset', { assetId: 'asset', name: 'Renamed image' });
	assert.equal(manager.state.assets.value[0].sourceFilePath, path);
	manager.commit('removeAsset', { assetId: 'asset' });
	assert.equal(manager.state.assets.value.length, 0);
	manager.undo();
	assert.equal(manager.state.assets.value[0].sourceFilePath, path);
	const handle = fileHandle('paths.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).assets[0].sourceFilePath, path);
	await app.newProject();
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	const restored = manager.state.assets.value[0];
	assert.equal(restored.sourceFilePath, path);
	assert.equal(restored.name, 'Renamed image');
	assert.equal(await restored.fileData.text(), 'original image');
});

// 【素材の差し替えは原本パスを更新し、取得できないときは旧パスを消す】
// 差し替え前の場所が残ると、現在の素材の原本と誤認してしまう。
// パスの有無を両方向で切り替え、保存結果と実際の素材の内容が対応することを確認する。
test('updates or clears source paths when replacing assets', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	const asset = { id: 'asset', name: 'Display name', width: 4, height: 2, fileDataType: 'image/png',
		fileData: new Blob(['original']), sourceFilePath: 'C:\\original.png' };
	manager.commit('addAsset', asset);
	const handle = fileHandle('replacement.gsproj');
	window.selectProjectSaveFile = async () => handle;
	for (const path of ['D:\\new source.png', null, '/home/artist/another.png']) {
		const content = `replacement from ${path}`;
		manager.commit('replaceAsset', { ...asset, assetId: asset.id, name: 'Replacement file',
			fileData: new Blob([content]), sourceFilePath: path });
		assert.equal(manager.state.assets.value[0].sourceFilePath, path);
		assert.equal(manager.state.assets.value[0].name, asset.name);
		await appContext.saveProject();
		const saved = decodeProjectFile(handle.bytes).assets[0];
		assert.equal(saved.sourceFilePath, path);
		assert.equal(await saved.fileData.text(), content);
	}
});

// 【画像から新規プロジェクトを作る経路でも取り込み元のパスを保存する】
// この経路はaddAsset Commandを経由せずに初期状態を作るため、独立して転記漏れを検出する。
test('retains the source path when creating a project from an image', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	const file = new File(['encoded image'], 'source.png', { type: 'image/png' });
	const path = 'C:\\素材\\source.png';
	window.document.createElement = () => new EventTarget();
	window.desktop = { getPathForFile(source) { assert.equal(source, file); return path; } };
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
	globalThis.createImageBitmap = async () => ({ width: 4, height: 2, close() {} });
	t.after(() => {
		if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
		else delete globalThis.createImageBitmap;
	});
	assert.equal(await app.newProjectFromImageOrVideo(file), true);
	assert.equal(appContext.projectContext.stateManager.state.assets.value[0].sourceFilePath, path);
	const handle = fileHandle('from-image.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	const saved = decodeProjectFile(handle.bytes).assets[0];
	assert.equal(saved.sourceFilePath, path);
	assert.equal(await saved.fileData.text(), 'encoded image');
});

// 【OSから開いた画像は新規プロジェクトになり、保存時に素材原本を上書きしない】
// プロジェクトを開く経路と素材を開く経路を混同すると、原本の画像がgsprojの内容で置き換わる。
// ダイアログなしで寸法・画像ノードを初期化し、保存先は新しく選ぶことを確認する。
test('creates a new project from a media path and chooses a separate project save target', async t => {
	const window = setup(t);
	const filePath = 'C:/素材 フォルダ/画像.PNG';
	window.desktop = {
		resolveExternalAsset: async received => {
			assert.equal(received, filePath);
			return { url: 'app://external-assets/image', size: 13, error: null };
		},
		getPathForFile: () => assert.fail('The media path is already known'),
		registerProjectFile: () => assert.fail('A media file must not become a project save target'),
	};
	t.mock.method(globalThis, 'fetch', async () => new Response('encoded image'));
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
	globalThis.createImageBitmap = async () => ({ width: 640, height: 360, close() {} });
	t.after(() => {
		if (previous != null) Object.defineProperty(globalThis, 'createImageBitmap', previous);
		else delete globalThis.createImageBitmap;
	});
	const app = evaluate(appBundle);
	assert.equal(await app.newProjectFromMediaPath(filePath, 'image/png'), true);
	const manager = app.appContext.projectContext.stateManager;
	assert.deepEqual({ ...manager.state.resolution.value }, { width: 640, height: 360 });
	assert.equal(manager.state.assets.value[0].sourceFilePath, filePath);
	assert.equal(manager.state.assets.value[0].fileDataType, 'image/png');
	assert.equal(manager.state.visualModules.value[0].nodes.find(node => node.type === 'effect').effectId, 'image');
	const handle = fileHandle('from-os-image.gsproj');
	let saveSelections = 0;
	window.selectProjectSaveFile = async () => { saveSelections++; return handle; };
	await app.appContext.saveProject();
	assert.equal(saveSelections, 1);
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.assets[0].sourceFilePath, filePath);
	assert.equal(await saved.assets[0].fileData.text(), 'encoded image');
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
	const { appContext } = app;
	await appContext.ready(project(), handle.name, handle);
	appContext.projectContext.stateManager.state.assets.value = [{ id: 'asset', name: 'missing.png', fileData: new UnreadableBlob() }];
	window.selectProjectSaveFile = () => assert.fail('No target should be selected after an encoding failure');
	await appContext.saveProject(true);
	assert.deepEqual(handle.calls, []);
	await appContext.saveProject();
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }]]);
	assert.equal(handle.bytes, original);
	assert.equal(globalThis.projectAlerts.length, 2);
	assert.ok(globalThis.projectAlerts.every(message => message.includes('missing.png')));
	await assert.rejects(encodeProjectFile(project({ assets: appContext.projectContext.stateManager.state.assets.value })), error => error.cause === cause);
});

// 【保存先選択前に準備を完了し、ダイアログ表示中の編集を保存内容へ混入させない】
// 非同期の素材読込とユーザー操作を挟んでも、保存開始時点の状態を一貫して書き出す。
test('prepares a complete snapshot before selecting a Save as target', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	let read = false;
	class TrackedBlob extends Blob {
		async arrayBuffer() { read = true; return super.arrayBuffer(); }
	}
	appContext.projectContext.stateManager.state.name.value = 'Snapshot';
	appContext.projectContext.stateManager.state.assets.value = [{ id: 'asset', name: 'snapshot.png', fileData: new TrackedBlob(['original']) }];
	const handle = fileHandle('snapshot.gsproj');
	window.selectProjectSaveFile = async name => {
		assert.equal(name, 'untitled.gsproj');
		assert.equal(read, true);
		appContext.projectContext.stateManager.state.name.value = 'Later edit';
		appContext.projectContext.stateManager.state.assets.value = [];
		return handle;
	};
	await appContext.saveProject(true);
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
	const { appContext } = app;
	await appContext.ready(project(), handle.name, handle);
	await appContext.saveProject();
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

// 【権限確認の開始から後続の手動保存の完了まで保存中を維持する】
// 書き込み中だけのフラグや単純なbooleanでは、権限待ち・キュー待ちの保存を見落とし、
// 先行保存が終わった瞬間にウィンドウを閉じられてしまう。closeの完了まで保護する。
test('tracks manual saves from permission requests until every queued write has committed', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	const handle = fileHandle('saving.gsproj');
	await appContext.ready(project(), handle.name, handle);
	const permission = Promise.withResolvers();
	handle.requestPermission = () => permission.promise;
	const writes = [0, 1].map(() => ({ started: Promise.withResolvers(), finish: Promise.withResolvers() }));
	const createWritable = handle.createWritable;
	let writeIndex = 0;
	handle.createWritable = async () => {
		const stream = await createWritable();
		const write = writes[writeIndex++];
		return { ...stream, async close() { write.started.resolve(); await write.finish.promise; await stream.close(); } };
	};
	assert.equal(appContext.isProjectSaving.value, false);
	const firstSave = appContext.saveProject();
	assert.equal(appContext.isProjectSaving.value, true);
	permission.resolve('granted');
	await writes[0].started.promise;
	const secondSave = appContext.saveProject();
	writes[0].finish.resolve();
	await firstSave;
	assert.equal(appContext.isProjectSaving.value, true);
	await writes[1].started.promise;
	assert.equal(appContext.isProjectSaving.value, true);
	writes[1].finish.resolve();
	await secondSave;
	assert.equal(appContext.isProjectSaving.value, false);
});

// 【エンコード中の保存も保護し、プロジェクト切替による失効で保存中状態を残さない】
// 大きな素材の読み出しは書き込み前にも待機する。読み込み世代が変わった場合は
// 古い要求が書き込みを行わずに完了し、表示と終了防止を解除する必要がある。
test('tracks encoding and releases a save invalidated by a project reload', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	const encodingStarted = Promise.withResolvers();
	const finishEncoding = Promise.withResolvers();
	class DelayedBlob extends Blob {
		async arrayBuffer() { encodingStarted.resolve(); await finishEncoding.promise; return super.arrayBuffer(); }
	}
	const handle = fileHandle('encoding.gsproj');
	await appContext.ready(project({ assets: [{ id: 'asset', name: 'image.png', fileData: new DelayedBlob(['image']) }] }), handle.name, handle);
	const saving = appContext.saveProject();
	await encodingStarted.promise;
	assert.equal(appContext.isProjectSaving.value, true);
	await appContext.ready(project({ name: 'Another project' }));
	assert.equal(appContext.isProjectSaving.value, true);
	finishEncoding.resolve();
	await saving;
	assert.equal(appContext.isProjectSaving.value, false);
	assert.equal(handle.calls.some(([action]) => action === 'create'), false);
});

// 【保存先のキャンセルと保存失敗で保存中状態を解除する】
// 早期returnや例外でカウンターが残ると、その後ずっと終了できなくなる。
// 失敗ダイアログの確認待ち中にも「保存中」と表示し続けないことを確認する。
test('releases manual saving after cancellation and before acknowledging a write failure', async t => {
	const window = setup(t);
	t.mock.method(console, 'error', () => {});
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const selectionStarted = Promise.withResolvers();
	const selection = Promise.withResolvers();
	window.selectProjectSaveFile = () => { selectionStarted.resolve(); return selection.promise; };
	const canceledSave = appContext.saveProject();
	await selectionStarted.promise;
	assert.equal(appContext.isProjectSaving.value, true);
	selection.resolve(null);
	await canceledSave;
	assert.equal(appContext.isProjectSaving.value, false);
	const handle = fileHandle('failure.gsproj', { fail: 'write' });
	window.selectProjectSaveFile = async () => handle;
	const alertShown = Promise.withResolvers();
	const acknowledged = Promise.withResolvers();
	window.acknowledgeProjectAlert = () => { alertShown.resolve(); return acknowledged.promise; };
	const failedSave = appContext.saveProject();
	await alertShown.promise;
	assert.deepEqual(globalThis.projectAlerts, ['write failed']);
	assert.equal(appContext.isProjectSaving.value, false);
	acknowledged.resolve();
	await failedSave;
	assert.equal(appContext.isProjectSaving.value, false);
});

// 【自動バックアップ単独では手動保存中とせず、そこに待機する手動保存は保護する】
// 共通キュー全体を保存中として扱うと、定期バックアップで突然終了できなくなる。
// 一方、バックアップの後ろで待つ手動保存は、受付時点から保護する必要がある。
test('distinguishes automatic backups from manual saves queued behind them', async t => {
	const window = setup(t);
	const { appContext } = evaluate(appBundle);
	const handle = fileHandle('automatic.gsproj');
	await appContext.ready(project(), handle.name, handle);
	window.testPreferences.projectBackupAutoEnabled = true;
	await nextTick();
	const backupStarted = Promise.withResolvers();
	const finishBackup = Promise.withResolvers();
	appContext.projectBackupController.setTarget({ name: handle.name, directory: {
		async hasPermission() { return true; },
		async list() { return []; },
		async create() { backupStarted.resolve(); await finishBackup.promise; return true; },
		async remove() {},
	} });
	const now = Date.now();
	t.mock.method(Date, 'now', () => now + 60001);
	const backingUp = appContext.projectBackupController.tick();
	await backupStarted.promise;
	assert.equal(appContext.isProjectSaving.value, false);
	const saving = appContext.saveProject();
	assert.equal(appContext.isProjectSaving.value, true);
	finishBackup.resolve();
	await Promise.all([backingUp, saving]);
	assert.equal(appContext.isProjectSaving.value, false);
});

// 【手動保存した内容と比較し、履歴操作と履歴外の変更を反映する】
// 履歴数だけの判定では、保存時に戻るUndoや、履歴を増やさない連続編集・メタデータ編集を扱えない。
// 素材のBlobを変更検出のために読み出さず、プレビューの操作だけでは未保存にしないことも確認する。
test('tracks unsaved content across undo, redo, continuous edits and direct changes', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	assert.equal(appContext.hasUnsavedChanges.value, false);
	await app.newProject();
	assert.equal(appContext.hasUnsavedChanges.value, true);
	const handle = fileHandle('saved.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	const manager = appContext.projectContext.stateManager;
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'unsaved-node' });
	assert.equal(appContext.hasUnsavedChanges.value, true);
	manager.undo();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	manager.redo();
	assert.equal(appContext.hasUnsavedChanges.value, true);
	await appContext.saveProject();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	manager.undo();
	assert.equal(appContext.hasUnsavedChanges.value, true);
	manager.redo();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	const edit = manager.beginEdit('changeTimelineRenderSettings');
	edit.update({ timelineFps: 30, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 8 } });
	assert.equal(appContext.hasUnsavedChanges.value, true);
	edit.cancel();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	for (const key of ['name', 'description', 'author']) {
		const saved = manager.state[key].value;
		manager.state[key].value = 'Direct edit';
		assert.equal(appContext.hasUnsavedChanges.value, true);
		manager.state[key].value = saved;
		assert.equal(appContext.hasUnsavedChanges.value, false);
	}
	appContext.resolutionFactor.value = 0.5;
	appContext.timelinePreviewMotionBlurSamples.value = 4;
	await nextTick();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	class UnreadableBlob extends Blob {
		async arrayBuffer() { assert.fail('Change detection must not read asset bytes'); }
	}
	manager.state.assets.value.push({ id: 'new-asset', name: 'image.png', fileData: new UnreadableBlob(['image']) });
	assert.equal(appContext.hasUnsavedChanges.value, true);
	manager.state.assets.value.pop();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	const file = new File([handle.bytes], handle.name);
	await app.openProject(file);
	assert.equal(appContext.hasUnsavedChanges.value, false);
	assert.equal(appContext.projectFileName.value, handle.name);
	await app.newProject();
	assert.equal(appContext.hasUnsavedChanges.value, true);
});

// 【保存完了前の編集と、別プロジェクトの変更を保存済みにしない】
// 本体のcloseを待つ間にも操作できるため、成功時の現在値ではなく実際に書いた内容を基準にする。
// 同じIDを開き直した後に古い保存が完了しても、新しいプロジェクトの未保存状態を消してはならない。
test('keeps edits during writes unsaved and ignores saves completed after a reload', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const handle = fileHandle('slow.gsproj');
	window.selectProjectSaveFile = async () => handle;
	for (const reload of [false, true]) {
		const started = Promise.withResolvers();
		const finish = Promise.withResolvers();
		const createWritable = handle.createWritable;
		handle.createWritable = async () => {
			const stream = await createWritable();
			return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
		};
		const snapshot = appContext.projectContext.snapshot();
		const save = appContext.saveProject();
		await started.promise;
		if (reload) await appContext.ready({ ...snapshot, name: 'Reloaded' }, handle.name, handle);
		appContext.projectContext.stateManager.state.name.value = 'Edited while saving';
		finish.resolve();
		await save;
		assert.equal(appContext.hasUnsavedChanges.value, true);
		assert.equal(decodeProjectFile(handle.bytes).name, snapshot.name);
		appContext.projectContext.stateManager.state.name.value = reload ? 'Reloaded' : snapshot.name;
		assert.equal(appContext.hasUnsavedChanges.value, false);
		handle.createWritable = createWritable;
	}
});

// プロジェクト情報の編集を保存し、再読込時に復元する。Undo履歴には追加しない。
// メタデータ編集でRedoが消えたり、タイトルだけ変わって保存内容が古いままになることを防ぐ。
test('saves editable project information, updates the title and preserves undo history', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const manager = appContext.projectContext.stateManager;
	assert.deepEqual([manager.state.name.value, manager.state.description.value, manager.state.author.value], ['Untitled Project', '', '']);
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'added-node' });
	manager.undo();
	const undoCount = manager.undoStack.value.length;
	const redoCount = manager.redoStack.value.length;
	manager.state.name.value = 'Edited Project';
	manager.state.description.value = 'Description\n説明';
	manager.state.author.value = 'Alice';
	await nextTick();
	assert.equal(window.document.title, 'Glitch Studio (Edited Project)');
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.equal(manager.redoStack.value.length, redoCount);
	manager.redo();
	assert.equal(appContext.projectContext.stateManager.state.name.value, 'Edited Project');
	const handle = fileHandle('saved.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await appContext.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.name, 'Edited Project');
	assert.equal(saved.description, 'Description\n説明');
	assert.equal(saved.author, 'Alice');
	await app.newProject();
	assert.equal(appContext.projectContext.stateManager.state.name.value, 'Untitled Project');
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.deepEqual([manager.state.name.value, manager.state.description.value, manager.state.author.value], [saved.name, saved.description, saved.author]);
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【Save asが成功したときだけ保存先とプロジェクトIDを切り替える】
// キャンセルやディスク書込失敗で保存先が変わると、以後意図しないファイルを上書きしてしまう。
test('changes the Save target only after a successful Save as', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const original = fileHandle('original.gsproj');
	const copy = fileHandle('copy.gsproj');
	window.selectProjectSaveFile = async () => original;
	await appContext.saveProject();
	const originalId = appContext.projectContext.snapshot().id;
	window.selectProjectSaveFile = async () => null;
	appContext.projectContext.stateManager.state.name.value = 'Before cancellation';
	await appContext.saveProject(true);
	assert.equal(appContext.projectContext.snapshot().id, originalId);
	assert.equal(appContext.hasUnsavedChanges.value, true);
	appContext.projectContext.stateManager.state.name.value = 'After cancellation';
	await appContext.saveProject();
	assert.equal(appContext.hasUnsavedChanges.value, false);
	assert.equal(decodeProjectFile(original.bytes).name, 'After cancellation');
	const failed = fileHandle('failed.gsproj', { fail: 'write' });
	window.selectProjectSaveFile = async () => failed;
	appContext.projectContext.stateManager.state.name.value = 'Before failure';
	await appContext.saveProject(true);
	assert.equal(appContext.projectContext.snapshot().id, originalId);
	assert.equal(appContext.hasUnsavedChanges.value, true);
	appContext.projectContext.stateManager.state.name.value = 'After failure';
	await appContext.saveProject();
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
	assert.deepEqual(globalThis.projectAlerts, ['write failed']);
	window.selectProjectSaveFile = async () => copy;
	await appContext.saveProject(true);
	const copyId = appContext.projectContext.snapshot().id;
	assert.notEqual(copyId, originalId);
	assert.equal(decodeProjectFile(copy.bytes).id, copyId);
	assert.equal(decodeProjectFile(original.bytes).id, originalId);
	assert.equal(appContext.hasUnsavedChanges.value, false);
	window.selectProjectSaveFile = () => assert.fail('Save should reuse the new target');
	appContext.projectContext.stateManager.state.name.value = 'After Save as';
	await appContext.saveProject();
	assert.equal(decodeProjectFile(copy.bytes).name, 'After Save as');
	assert.equal(decodeProjectFile(copy.bytes).id, copyId);
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
});

// 【別名保存中の編集を残し、Undo/RedoでプロジェクトIDを巻き戻さない】
// 保存成功時に再読込すると保存中の編集と履歴が消える。新IDだけを採用し、
// 保存したスナップショットと異なる編集は未保存として残ることを確認する。
test('adopts the saved identity while preserving concurrent edits and undo history', async t => {
	const window = setup(t);
	const { appContext } = evaluate(appBundle);
	const original = fileHandle('original.gsproj');
	const copy = fileHandle('copy.gsproj');
	await appContext.ready(project(), original.name, original);
	const manager = appContext.projectContext.stateManager;
	manager.commit('changeProjectResolution', { width: 800, height: 600 });
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = copy.createWritable;
	copy.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
	};
	window.selectProjectSaveFile = async () => copy;
	const saveAs = appContext.saveProject(true);
	await started.promise;
	manager.commit('changeProjectResolution', { width: 1024, height: 768 });
	finish.resolve();
	await saveAs;
	const savedId = decodeProjectFile(copy.bytes).id;
	assert.notEqual(savedId, 'project-id');
	assert.equal(appContext.projectContext.snapshot().id, savedId);
	assert.deepEqual(manager.state.resolution.value, { width: 1024, height: 768 });
	assert.deepEqual(decodeProjectFile(copy.bytes).resolution, { width: 800, height: 600 });
	assert.equal(appContext.hasUnsavedChanges.value, true);
	manager.undo();
	assert.deepEqual(manager.state.resolution.value, { width: 800, height: 600 });
	assert.equal(appContext.hasUnsavedChanges.value, false);
	manager.undo();
	assert.equal(appContext.projectContext.snapshot().id, savedId);
	manager.redo();
	manager.redo();
	assert.deepEqual(manager.state.resolution.value, { width: 1024, height: 768 });
	assert.equal(appContext.projectContext.snapshot().id, savedId);
});

// 【成功したOpen/Saveだけを履歴へ記録し、履歴保存の失敗で本体の結果を変えない】
// 新規作成・読込失敗・書込失敗は利用実績にしない。永続化の容量不足などが起きても、
// 実際に読み込めた作品や書き込めたファイルを失敗扱いにして再操作を誘発しない。
test('records only successful file operations and isolates recent project storage failures', async t => {
	const window = setup(t);
	let bytes = await encodeProjectFile(project());
	const recorded = [];
	let failHistory = false;
	let failWrite = false;
	window.desktop = {
		async chooseProjectFile() { return { id: 'native', name: 'native.gsproj' }; },
		async chooseProjectSaveFile() { return { id: 'native', name: 'native.gsproj' }; },
		async registerProjectFile() { return null; },
		async readProjectFile() { return bytes; },
		async writeProjectFile(_id, data) { if (failWrite) throw new Error('Write failed'); bytes = data; },
		async listRecentProjects() { return []; },
		async rememberRecentProject(id, name) {
			if (failHistory) throw new Error('History storage full');
			recorded.push({ id, name });
		},
	};
	const app = evaluate(appBundle);
	await app.newProject();
	await app.recentProjects.refresh();
	assert.deepEqual(recorded, []);
	assert.equal(await app.openProject(), true);
	assert.deepEqual(recorded, [{ id: 'native', name: 'Example' }]);
	await app.appContext.saveProject();
	await app.recentProjects.refresh();
	assert.equal(recorded.length, 2);
	failWrite = true;
	await app.appContext.saveProject();
	await app.recentProjects.refresh();
	assert.equal(recorded.length, 2);
	failWrite = false;
	failHistory = true;
	assert.equal(await app.openProject(), true);
	assert.equal(app.recentProjects.error.value, 'History storage full');
	app.appContext.projectContext.stateManager.state.name.value = 'Saved despite history failure';
	await app.appContext.saveProject();
	await setImmediate();
	assert.equal(app.appContext.hasUnsavedChanges.value, false);
	assert.equal(decodeProjectFile(bytes).name, 'Saved despite history failure');
	assert.equal(app.recentProjects.error.value, 'History storage full');
	assert.deepEqual(globalThis.projectAlerts, ['Write failed']);
	const beforeFailure = recorded.length;
	bytes = new Uint8Array([0xc1]);
	assert.equal(await app.openProject(), false);
	assert.equal(recorded.length, beforeFailure);
});

// 新規作成後は以前のファイルハンドルを使わない。
// 前のプロジェクトの保存先が残ると、新規プロジェクトの初回Saveで元の作品を上書きしてしまう。
test('asks for a fresh Save target after creating another project', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await app.newProject();
	const first = fileHandle('first.gsproj');
	window.selectProjectSaveFile = async () => first;
	await appContext.saveProject();
	const savedBytes = first.bytes;
	await app.newProject();
	const second = fileHandle('second.gsproj');
	let pickerCalls = 0;
	window.selectProjectSaveFile = async () => { pickerCalls++; return second; };
	await appContext.saveProject();
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
	const { appContext } = app;
	await app.newProject();
	appContext.projectContext.stateManager.state.name.value = 'Current project';
	const currentHandle = fileHandle('current.gsproj');
	window.selectProjectSaveFile = async () => currentHandle;
	await appContext.saveProject();
	const manager = appContext.projectContext.stateManager;
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'keep-node' });
	const modules = manager.state.visualModules.value;
	const undoCount = manager.undoStack.value.length;
	const future = project({ gsVersion: '2.0.0', name: 'Future project' });
	const futureHandle = fileHandle('future.gsproj', { bytes: await encodeProjectFile(future) });
	window.showOpenFilePicker = async () => [futureHandle];
	assert.equal(await app.openProject(), false);
	assert.equal(appContext.projectContext.stateManager.state.name.value, 'Current project');
	assert.equal(manager.state.visualModules.value, modules);
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.equal(window.document.title, 'Glitch Studio (Current project)');
	assert.equal(globalThis.projectAlerts.length, 1);
	assert.match(globalThis.projectAlerts[0], /未来のバージョンのプロジェクトファイルの読み込みはサポートしていません/);
	assert.match(globalThis.projectAlerts[0], /ファイル: 2\.0\.0 \/ 現在: 2\.0\.0-alpha\.2/);
	window.selectProjectSaveFile = () => assert.fail('The existing Save target must be retained');
	await appContext.saveProject();
	assert.equal(decodeProjectFile(currentHandle.bytes).name, 'Current project');
	assert.equal(decodeProjectFile(futureHandle.bytes).name, 'Future project');
});

// 【プレビューには元の解像度と倍率を分けて渡し、小型プロジェクトでは倍率を戻す】
// Controllerへ縮小済みの寸法を渡すと、レンダラーで再び倍率が掛かってしまう。
// 初期化・プロジェクト切り替えの両方で同じ契約を守り、前の倍率も持ち越さないことを確認する。
test('passes unscaled project dimensions and resets the preview scale for smaller projects', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
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
		assert.equal(appContext.resolutionFactor.value, factor);
		for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
			assert.deepEqual(controller.options.resolution, resolution);
			assert.equal(controller.options.resolutionScale, factor);
		}
		assert.deepEqual(appContext.projectContext.stateManager.state.resolution.value, resolution);
	}
	for (const controller of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		// プロジェクト切り替えでもエンジンを作り直し、最新の基準寸法から初期化する。
		assert.deepEqual(controller.initialResolution, { width: 1500, height: 1500 });
		assert.equal(controller.initialResolutionScale, 1);
	}
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【両プレビューへ共通データを送り、タイムラインだけにレイヤーを渡す】
// 一方だけ更新すると、Canvasを切り替えた際に古いプロジェクトや編集前の状態が表示される。
test('synchronizes both previews and routes timeline-only edits', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	const first = project({ visualModules: [{ id: 'first', nodes: [], paramDefs: [] }] });
	await appContext.ready(first);
	const visualModuleLivePreview = appContext.visualModuleRendererManagerController;
	const timeline = appContext.timelineRendererManagerController;
	assert.equal(appContext.activePreviewRenderer.value, visualModuleLivePreview);
	assert.deepEqual(visualModuleLivePreview.options.visualModules, first.visualModules);
	assert.deepEqual(timeline.options.visualModules, first.visualModules);
	assert.equal('timelineScenes' in visualModuleLivePreview.options, false);
	appContext.previewPlayback.seekTimeline(500);
	assert.equal(appContext.activePreviewRenderer.value, timeline);
	timeline.renders.length = 0;
	appContext.projectContext.stateManager.commit('addTimelineLayer', { sceneId: 'scene', layer: { id: 'layer', layerType: 'visualModule', visualModuleId: 'first', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] } });
	await nextTick();
	await setImmediate();
	assert.equal('timelineScenes' in visualModuleLivePreview.options, false);
	assert.equal(timeline.options.timelineScenes[0].layers[0].id, 'layer');
	assert.deepEqual(timeline.patches.at(-1).map(change => change.type), ['layer', 'layerOrder']);
	assert.equal(visualModuleLivePreview.patches.length, 0);
	assert.deepEqual(timeline.renders, [500]);
	appContext.highlightClipping.value = true;
	await nextTick();
	await setImmediate();
	assert.equal(visualModuleLivePreview.options.highlightClipping, true);
	assert.equal(timeline.options.highlightClipping, true);
	assert.equal(timeline.renders.at(-1), 500);
	await appContext.ready(project());
	assert.deepEqual(visualModuleLivePreview.options.visualModules, []);
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
	const { appContext } = app;
	await appContext.ready(project({
		visualModules: [{ id: 'module', nodes: [], paramDefs: [] }],
		assets: [{ id: 'audio', name: 'sound.wav', fileData: new Blob(['audio']) }, { id: 'image', fileData: new Blob(['image']) }],
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
			{ id: 'visual', isDisabled: false, layerType: 'visualModule', visualModuleId: 'module', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 10000 }], visualModuleParamValues: {}, compositingParamValues: { opacity: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
			{ id: 'audio', isDisabled: false, layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 0, sourceInMs: 0, sourceOutMs: 5000, playbackRate: 1, loop: false, durationMs: 5000, assetId: 'audio' }], audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
		] }],
	}));
	const manager = appContext.projectContext.stateManager;
	const starts = appContext.timelineAudioPreview.starts;
	appContext.previewPlayback.playTimeline();
	try {
		assert.equal(starts.length, 1);
		manager.commit('editTimelineLayerParam', { sceneId: 'scene', layerId: 'visual', target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.5 } });
		await nextTick();
		manager.undo();
		await nextTick();
		manager.redo();
		await nextTick();
		manager.state.assets.value[0].name = 'Renamed.wav';
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
		// 原本の変更では両映像プレビューも再生成するため、その再開まで待つ。
		await setImmediate();
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
	} finally { appContext.previewPlayback.dispose(); }
});

// 【両Workerの復帰完了後にだけプレビューを再開する】
// timeline側だけ先にreadyになっても、再描画や次のエクスポート開始を許可してはいけない。
test('waits for both preview workers before restoring the paused timeline', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await appContext.ready(project());
	// 精密シークの位置もWorker再生成をまたいで丸めず復元する。
	appContext.previewPlayback.seekTimeline(123, true, 'precise');
	const visualModuleLivePreview = appContext.visualModuleRendererManagerController;
	const timeline = appContext.timelineRendererManagerController;
	await appContext.suspendPreview();
	assert.equal(visualModuleLivePreview.isReady.value, false);
	assert.equal(timeline.isReady.value, false);
	assert.equal(appContext.renderEngine.isSuspended.value, true);
	assert.equal(appContext.audioOutput.preview.suspended, true);
	timeline.renders.length = 0;
	const gate = Promise.withResolvers();
	visualModuleLivePreview.relaunchManager = async () => { await gate.promise; visualModuleLivePreview.isReady.value = true; };
	const restarting = appContext.resumePreview();
	await setImmediate();
	assert.equal(timeline.isReady.value, true);
	assert.equal(appContext.audioOutput.preview.suspended, true);
	assert.deepEqual(timeline.renders, []);
	gate.resolve();
	await restarting;
	assert.deepEqual(timeline.renders, [123]);
	assert.equal(appContext.previewPlayback.isTimelinePlaying.value, false);
	assert.equal(appContext.audioOutput.preview.suspended, false);
});

// 【復帰待ちの途中に新しく休止した場合は音声モニターも停止状態を維持する】
// 先行する再初期化が遅れて完了し、次の書き出し中に音声モニターだけを再開してしまうのを防ぐ。
test('does not resume audio monitor rendering after a newer preview suspension', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	await appContext.ready(project());
	await appContext.suspendPreview();
	const gate = Promise.withResolvers();
	appContext.visualModuleRendererManagerController.relaunchManager = async () => { await gate.promise; };
	const restarting = appContext.resumePreview();
	await setImmediate();
	await appContext.suspendPreview();
	gate.resolve();
	await restarting;
	assert.equal(appContext.renderEngine.isSuspended.value, true);
	assert.equal(appContext.audioOutput.preview.suspended, true);
});

// 【復帰に失敗してももう一方の初期化を待ち、描画は再開しない】
// 一方の失敗だけでダイアログを操作可能にすると、次の書き出しで残りの初期化を中断してしまう。
test('keeps playback suspended and waits for the other worker after a restart failure', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const { appContext } = app;
	await appContext.ready(project());
	await appContext.suspendPreview();
	const timeline = appContext.timelineRendererManagerController;
	timeline.renders.length = 0;
	appContext.visualModuleRendererManagerController.relaunchManager = async () => { throw new Error('GPU unavailable'); };
	const gate = Promise.withResolvers();
	timeline.relaunchManager = async () => { await gate.promise; timeline.isReady.value = true; };
	let settled = false;
	const restarting = appContext.resumePreview();
	const completed = restarting.then(() => { settled = true; });
	await setImmediate();
	assert.equal(settled, false);
	gate.resolve();
	await completed;
	assert.equal(appContext.renderEngine.errorMessage.value, 'GPU unavailable');
	await nextTick();
	appContext.previewPlayback.refresh();
	assert.deepEqual(timeline.renders, []);
});

// 【OSから指定されたプロジェクトを選択ダイアログなしで開き、元のファイルへ保存する】
// 起動時にFileSystemFileHandleがなくても、デスクトップの参照を保存・バックアップへ引き継ぐ。
test('opens a startup project handle without a picker and saves back to that file', async t => {
	const window = setup(t);
	let bytes = await encodeProjectFile(project({ name: 'From Explorer' }));
	window.desktop = {
		async chooseProjectFile() { assert.fail('Startup must not open a picker'); },
		async registerProjectFile() { assert.fail('The startup file is already registered'); },
		async readProjectFile(id) { assert.equal(id, 'startup'); return bytes; },
		async writeProjectFile(id, data) { assert.equal(id, 'startup'); bytes = data; },
	};
	const app = evaluate(appBundle);
	const { appContext } = app;
	assert.equal(await app.openProject(undefined, desktopProjectFile({ id: 'startup', name: '作品.gsproj' })), true);
	assert.equal(appContext.projectContext.stateManager.state.name.value, 'From Explorer');
	assert.equal(appContext.projectBackupAccess.value, 'ready');
	appContext.projectContext.stateManager.state.name.value = 'Edited';
	await appContext.saveProject();
	assert.equal(decodeProjectFile(bytes).name, 'Edited');
	assert.deepEqual(globalThis.projectAlerts, []);
	appContext.projectBackupController.setTarget(null);
});

// 【起動時のファイルが存在しない・壊れている場合は失敗をUIへ返す】
// 読込失敗後にダッシュボードを表示できるよう、未処理の例外や成功扱いにしない。
test('reports missing and corrupt startup projects without opening a picker', async t => {
	const window = setup(t);
	let bytes = null;
	window.desktop = {
		async chooseProjectFile() { assert.fail('Startup must not open a picker'); },
		async readProjectFile() { return bytes; },
	};
	const app = evaluate(appBundle);
	const handle = desktopProjectFile({ id: 'startup', name: 'missing.gsproj' });
	assert.equal(await app.openProject(undefined, handle), false);
	assert.deepEqual(globalThis.projectAlerts, ['Project file not found: missing.gsproj']);
	bytes = new Uint8Array([0xc1]);
	assert.equal(await app.openProject(undefined, handle), false);
	assert.equal(globalThis.projectAlerts.length, 2);
});

// 【Electronで開いたファイルの上書き前データを残し、フォルダ選択を要求しない】
// ネイティブAPIから保存先を得た後は、現在の編集内容ではなくディスクの旧内容を保護する。
// バックアップに失敗した場合は本体書込みを開始しないことも同じ保存経路で検証する。
test('uses Electron backup access without a folder picker and stops overwrite on backup failure', async t => {
	const window = setup(t);
	const files = new Map();
	let fail = false;
	window.desktop = {
		async chooseProjectFile() { return { id: 'native.gsproj', name: 'native.gsproj' }; },
		async readProjectFile() { return handle.bytes; },
		async writeProjectFile(_id, data) { await saveProjectFile(data, handle); },
		async listProjectBackups() { return [...files.keys()]; },
		async copyProjectBackup(id, name) {
			assert.equal(id, 'native.gsproj');
			if (fail) throw new Error('Backup disk full');
			if (files.has(name)) return 'exists';
			files.set(name, new Uint8Array(handle.bytes));
			return 'created';
		},
		async removeProjectBackup(_id, name) { files.delete(name); },
	};
	window.showDirectoryPicker = () => assert.fail('Electron must not ask for a folder');
	const original = await encodeProjectFile(project({ name: 'On disk' }));
	const handle = fileHandle('native.gsproj', { bytes: original });
	window.showOpenFilePicker = async () => [handle];
	const app = evaluate(appBundle);
	const { appContext } = app;
	window.testPreferences.projectBackupSaveEnabled = true;
	assert.equal(await app.openProject(), true);
	assert.equal(appContext.projectBackupAccess.value, 'ready');
	window.desktop.readProjectFile = () => assert.fail('Save backup must not read the old file into the renderer');
	appContext.projectContext.stateManager.state.name.value = 'Edited';
	await appContext.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'Edited');
	assert.equal(decodeProjectFile([...files.values()][0]).name, 'On disk');
	assert.equal(appContext.projectBackupStatus.value.lastSaveBackup != null, true);
	const persisted = handle.bytes;
	const previousWrites = handle.calls.filter(call => call[0] === 'create').length;
	fail = true;
	appContext.projectContext.stateManager.state.name.value = 'More edits';
	await appContext.saveProject();
	assert.equal(handle.bytes, persisted);
	assert.equal(handle.calls.filter(call => call[0] === 'create').length, previousWrites);
	assert.deepEqual(globalThis.projectAlerts, ['Backup disk full']);
	appContext.projectBackupController.setTarget(null);
});

// 【Save asの既存宛先をバックアップし、成功後だけ自動バックアップの対象を切り替える】
// 元の編集中ファイルを複製しても、実際に置き換える別ファイルを復元できない。
// 自動バックアップは保存先やUndo履歴を変えず、設定値の間隔で現在の編集を保存する。
test('backs up the Save as destination and keeps automatic backups separate from the Save target', async t => {
	const window = setup(t);
	const backups = new Map();
	window.desktop = {
		async chooseProjectSaveFile() { return { id: destination.name, name: destination.name }; },
		async readProjectFile() { assert.fail('Save backup must stay in the main process'); },
		async writeProjectFile(id, data) { await saveProjectFile(data, id === original.name ? original : destination); },
		async listProjectBackups(id) { return [...(backups.get(id)?.keys() ?? [])]; },
		async copyProjectBackup(id, name) {
			const data = id === original.name ? original.bytes : destination.bytes;
			return await this.writeProjectBackup(id, name, data) ? 'created' : 'exists';
		},
		async writeProjectBackup(id, name, data) {
			if (!backups.has(id)) backups.set(id, new Map());
			if (backups.get(id).has(name)) return false;
			backups.get(id).set(name, new Uint8Array(data)); return true;
		},
		async removeProjectBackup(id, name) { backups.get(id).delete(name); },
	};
	const original = fileHandle('first.gsproj', { bytes: await encodeProjectFile(project({ name: 'First file' })) });
	const destination = fileHandle('second.gsproj', { bytes: await encodeProjectFile(project({ name: 'Destination before overwrite' })) });
	const app = evaluate(appBundle);
	const { appContext } = app;
	Object.assign(window.testPreferences, { projectBackupAutoEnabled: true, projectBackupAutoIntervalMinutes: 3,
		projectBackupAutoRetentionDays: 1, projectBackupSaveEnabled: true, projectBackupSaveRetentionDays: 7 });
	await appContext.ready(project(), original.name, desktopProjectFile({ id: original.name, name: original.name }));
	appContext.projectContext.stateManager.state.name.value = 'Saving as second';
	window.selectProjectSaveFile = async () => destination;
	await appContext.saveProject(true);
	assert.equal(decodeProjectFile([...backups.get(destination.name).values()][0]).name, 'Destination before overwrite');
	assert.equal(backups.has(original.name), false);
	let now = Date.now();
	t.mock.method(Date, 'now', () => now);
	appContext.projectContext.stateManager.state.description.value = 'Unsaved description';
	assert.equal(appContext.hasUnsavedChanges.value, true);
	const historyLength = appContext.projectContext.stateManager.undoStack.value.length;
	now += 180001;
	await appContext.projectBackupController.tick();
	assert.equal(appContext.hasUnsavedChanges.value, true);
	const automatic = [...backups.get(destination.name)].filter(([name]) => name.includes('.auto-backup-'));
	assert.equal(automatic.length, 1);
	assert.equal(decodeProjectFile(automatic[0][1]).description, 'Unsaved description');
	assert.equal(appContext.projectContext.stateManager.undoStack.value.length, historyLength);
	assert.notEqual(decodeProjectFile(destination.bytes).description, 'Unsaved description');
	await appContext.saveProject();
	assert.equal(decodeProjectFile(destination.bytes).description, 'Unsaved description');
	assert.equal(appContext.hasUnsavedChanges.value, false);
	assert.equal(decodeProjectFile(original.bytes).name, 'First file');
	appContext.projectBackupController.setTarget(null);
});

// 【Chromeの初回保存で選んだフォルダを保持し、その後の自動・保存時バックアップに使う】
// 初回保存前には書き出さず、保存ダイアログを閉じた後にフォルダ権限が捨てられないことを確認する。
// 自動バックアップで本体を変更せず、次のSaveでは本体の旧内容を別ファイルに残す。
test('retains the Chrome save folder and starts backups only after the first save', { timeout: 5000 }, async t => {
	const window = setup(t);
	t.mock.method(navigator.locks, 'request', async (_name, callback) => callback());
	const handles = new Map();
	const handle = fileHandle('browser.gsproj', { bytes: new Uint8Array() });
	handles.set(handle.name, handle);
	window.selectedProjectDirectory = {
		async queryPermission() { return 'granted'; },
		async *entries() { yield* handles; },
		async getFileHandle(name, options) {
			if (!handles.has(name)) {
				if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
				handles.set(name, fileHandle(name, { bytes: new Uint8Array() }));
			}
			return handles.get(name);
		},
		async removeEntry(name) { handles.delete(name); },
	};
	window.selectProjectSaveFile = async () => handle;
	window.showDirectoryPicker = () => assert.fail('The chosen save folder should be retained');
	const app = evaluate(appBundle);
	const { appContext } = app;
	Object.assign(window.testPreferences, { projectBackupAutoEnabled: true, projectBackupAutoIntervalMinutes: 2,
		projectBackupAutoRetentionDays: 1, projectBackupSaveEnabled: true, projectBackupSaveRetentionDays: 7 });
	await app.newProject();
	await appContext.projectBackupController.tick();
	assert.equal(appContext.projectBackupAccess.value, 'unsaved');
	assert.equal(handles.size, 1);
	await appContext.saveProject();
	assert.equal(appContext.projectBackupAccess.value, 'ready');
	assert.equal(handles.size, 1);
	const saved = handle.bytes;
	let now = Date.now();
	t.mock.method(Date, 'now', () => now);
	appContext.projectContext.stateManager.state.name.value = 'Unsaved editing';
	now += 120001;
	await appContext.projectBackupController.tick();
	const automatic = [...handles].filter(([name]) => name.includes('.auto-backup-'));
	assert.equal(automatic.length, 1);
	assert.equal(decodeProjectFile(automatic[0][1].bytes).name, 'Unsaved editing');
	assert.equal(handle.bytes, saved);
	await appContext.saveProject();
	const beforeSave = [...handles].filter(([name]) => name.includes('.save-backup-'));
	assert.equal(beforeSave.length, 1);
	assert.deepEqual(beforeSave[0][1].bytes, saved);
	assert.equal(decodeProjectFile(handle.bytes).name, 'Unsaved editing');
	await app.newProject();
	assert.equal(appContext.projectBackupAccess.value, 'unsaved');
});

// 【更新準備は受付済みの保存を完了させ、新規保存・バックアップは復帰するまで受け付けない】
// 未保存の変更の破棄に同意していても、書込み途中のファイルを残して終了してはならない。
// 既に待機中のSaveも完了させ、更新失敗後には現在の内容を再び保存できることを確認する。
test('drains queued saves before preparing an update and resumes saving afterwards', async t => {
	const window = setup(t);
	const { appContext } = evaluate(appBundle);
	const handle = fileHandle('update.gsproj');
	await appContext.ready(project({ name: 'first' }), handle.name, handle);
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = handle.createWritable;
	handle.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
	};
	const firstSave = appContext.saveProject();
	await started.promise;
	appContext.projectContext.stateManager.state.name.value = 'second';
	const queuedSave = appContext.saveProject();
	let readyToUpdate = false;
	const preparing = appContext.pauseForDesktopUpdate().then(resume => { readyToUpdate = true; return resume; });
	appContext.projectContext.stateManager.state.name.value = 'third';
	await appContext.saveProject();
	await appContext.projectBackupController.tick();
	assert.equal(readyToUpdate, false);
	finish.resolve();
	await Promise.all([firstSave, queuedSave]);
	const resume = await preparing;
	assert.equal(decodeProjectFile(handle.bytes).name, 'second');
	assert.equal(handle.calls.filter(([action]) => action === 'write').length, 2);
	await resume();
	await appContext.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'third');
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【更新待ちの保存が失敗した場合は、背後のダイアログ待ちにならず更新を中止する】
// 保存失敗を握りつぶして再起動したり、閉じられない更新画面の背後で確認を待つ状態を防ぐ。
test('rejects update preparation after an in-flight save fails and restores save acceptance', async t => {
	setup(t);
	t.mock.method(console, 'error', () => {});
	const { appContext } = evaluate(appBundle);
	const handle = fileHandle('failed-update.gsproj');
	await appContext.ready(project(), handle.name, handle);
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = handle.createWritable;
	handle.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; throw new Error('write failed'); } };
	};
	const saving = appContext.saveProject();
	await started.promise;
	const preparing = appContext.pauseForDesktopUpdate();
	const rejected = assert.rejects(preparing, /write failed/);
	finish.resolve();
	await Promise.all([saving, rejected]);
	assert.deepEqual(globalThis.projectAlerts, []);
	handle.createWritable = createWritable;
	await appContext.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'Example');
});

// 【更新準備では、書込み後の保存先予約の解放まで完了を待つ】
// 保存キューだけが先に完了すると、画面を閉じた後に保存の後処理が残る。
// 保存管理側の待機だけで、インストーラーへの引き継ぎより先に後処理を終える必要がある。
test('waits for save reservation cleanup before preparing an update', async t => {
	const window = setup(t);
	const cleanupStarted = Promise.withResolvers();
	const finishCleanup = Promise.withResolvers();
	window.desktop = { async releaseProjectReservations() { cleanupStarted.resolve(); await finishCleanup.promise; } };
	const { appContext } = evaluate(appBundle);
	const handle = fileHandle('update-cleanup.gsproj');
	await appContext.ready(project(), handle.name, handle);
	const saving = appContext.saveProject();
	await cleanupStarted.promise;
	let prepared = false;
	const preparing = appContext.pauseForDesktopUpdate().then(resume => { prepared = true; return resume; });
	await setImmediate();
	assert.equal(prepared, false);
	assert.equal(appContext.isProjectSaving.value, true);
	finishCleanup.resolve();
	const resume = await preparing;
	await saving;
	assert.equal(appContext.isProjectSaving.value, false);
	assert.equal(appContext.hasUnsavedChanges.value, false);
	await resume();
	await appContext.saveProject();
	assert.equal(handle.calls.filter(([action]) => action === 'write').length, 2);
});

// 【保存の後処理中に更新準備が始まっても、それ以前の書込み失敗を見落とさない】
// 保存開始・終了時の失敗フラグをUIへ公開しなくても、停止要求元へエラーを返す。
// 背後のエラーダイアログを待たず更新を中止し、その後の保存を受け付ける必要がある。
test('rejects update preparation after a save fails during reservation cleanup and resumes saving', async t => {
	const window = setup(t);
	t.mock.method(console, 'error', () => {});
	const cleanupStarted = Promise.withResolvers();
	const finishCleanup = Promise.withResolvers();
	window.desktop = { async releaseProjectReservations() { cleanupStarted.resolve(); await finishCleanup.promise; } };
	const { appContext } = evaluate(appBundle);
	const handle = fileHandle('failed-update-cleanup.gsproj');
	await appContext.ready(project(), handle.name, handle);
	const createWritable = handle.createWritable;
	handle.createWritable = async () => { throw new Error('write failed'); };
	const saving = appContext.saveProject();
	await cleanupStarted.promise;
	const rejected = assert.rejects(appContext.pauseForDesktopUpdate(), /write failed/);
	finishCleanup.resolve();
	await Promise.all([saving, rejected]);
	assert.deepEqual(globalThis.projectAlerts, []);
	handle.createWritable = createWritable;
	await appContext.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'Example');
});

// 【カメラとグループの奥行きモードをプロジェクトへ保存する】
// 画面上では動いてもファイルの取り出し・読み込みで設定が落ちると、書き出しや
// 再開後の画面が変わる。式Bindingを含むScene全体を実際のMessagePack経由で確認する。
test('round-trips camera layers and group compositing modes', async () => {
	const original = project({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' },
		layers: [{ id: 'camera', name: 'Camera', layerType: 'camera', isDisabled: false, forceDisableMotionBlur: false, automationGraphs: [],
			clips: [{ id: 'view', startMs: 0, durationMs: 5000, contentOffsetMs: 0 }], cameraParamValues: { z: { inputSource: 'expression', expression: '3 + TIME' }, position: { inputSource: 'literal', value: [0.2, 0.4] } } }, { id: 'group', name: 'Group', layerType: 'group', compositingMode: 'preserveDepth', layers: [], isDisabled: false,
			forceDisableMotionBlur: false, coordinateSpace: 'world', automationGraphs: [], compositingParamValues: { depth: { inputSource: 'literal', value: 0.5 }, clipToFrame: { inputSource: 'literal', value: true } }, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } }],
	}] });
	const decoded = decodeProjectFile(await encodeProjectFile(original));
	assert.deepEqual(decoded.timelineScenes, original.timelineScenes);
});

// 【リロードを履歴に追加せず、再リンクとモード変換だけをUndo/Redoできる】
// Undoで外部原本の古い内容へ戻さず、埋め込み側の原本とアセットID・表示名は維持する。
test('reloads without undo and preserves modes paths and embedded bytes through conversion undo and redo', async t => {
	const window = setup(t);
	let version = 1;
	let chosenDefault = null;
	window.desktop = {
		chooseAssetFile: async previous => { chosenDefault = previous; return 'C:/assets/selected.bin'; },
		resolveExternalAsset: async path => ({ url: `app://external-assets/${version}/${encodeURIComponent(path)}`, size: 3, error: null }),
	};
	t.mock.method(globalThis, 'fetch', async () => new Response('new'));
	const app = evaluate(appBundle);
	const { appContext, getAssetMenu } = app;
	await appContext.ready(project({ assets: [{ id: 'asset', name: 'Original display name', width: 0, height: 0,
		fileDataType: 'application/octet-stream', isExternalReference: false, sourceFilePath: 'C:/original/source.bin', fileData: new Blob(['old']), thumbnailSequence: null }] }));
	const manager = appContext.projectContext.stateManager;
	const current = () => manager.state.assets.value[0];
	// 翻訳や省略記号の変更で操作の検証が壊れないよう、表示文言ではなくIDで選ぶ。
	const action = id => {
		const menuItem = getAssetMenu(current()).find(item => item.id === id);
		assert.ok(menuItem != null, `Asset menu action not found: ${id}`);
		return menuItem.action();
	};
	await action('convertToExternalReference');
	await setImmediate();
	assert.equal(chosenDefault, 'C:/original/source.bin');
	assert.equal(current().isExternalReference, true);
	assert.equal(current().sourceFilePath, 'C:/assets/selected.bin');
	assert.equal(current().id, 'asset');
	assert.equal(current().name, 'Original display name');
	const historyLength = manager.undoStack.value.length;
	version = 2;
	await action('reload');
	await setImmediate();
	assert.equal(manager.undoStack.value.length, historyLength);
	assert.match(current().fileData.url, /external-assets\/2\//);
	assert.equal('assetId' in current(), false);
	manager.undo();
	await setImmediate();
	assert.equal(current().isExternalReference, false);
	assert.equal(await current().fileData.text(), 'old');
	manager.redo();
	await setImmediate();
	assert.equal(current().isExternalReference, true);
	assert.match(current().fileData.url, /external-assets\/2\//);
	await action('embed');
	await setImmediate();
	assert.equal(current().isExternalReference, false);
	assert.equal(await current().fileData.text(), 'new');
	manager.undo();
	await setImmediate();
	assert.equal(current().isExternalReference, true);
	manager.redo();
	await setImmediate();
	assert.equal(await current().fileData.text(), 'new');
});

// 【プロジェクト共通の定義は読み込み・保存・両プレビューの初期状態で一致する】
// 編集差分だけを同期しても、読み込み直後やWorker再生成後の一覧を渡し忘れると参照が失われる。
// 実際のProjectContextとAppContextを通し、スナップショットが曲線を保持することを確認する。
test('loads snapshots and synchronizes project Automation Graph definitions to both previews', async t => {
	setup(t);
	const { appContext } = evaluate(appBundle);
	const automationGraph = { id: 'shared', nameForReference: 'Curve', isNormalized: false, points: [
		{ id: 'point', x: 0, y: 0.5, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
	] };
	await appContext.ready(project({ automationGraphs: [automationGraph] }));
	const context = appContext.projectContext;
	assert.deepEqual(context.snapshot().automationGraphs, [automationGraph]);
	for (const renderer of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		assert.deepEqual(renderer.options.automationGraphs, [automationGraph]);
	}
	context.stateManager.commit('updateProjectAutomationGraph', { automationGraph: { ...automationGraph, nameForReference: 'Renamed' } });
	await nextTick();
	await setImmediate();
	for (const renderer of [appContext.visualModuleRendererManagerController, appContext.timelineRendererManagerController]) {
		assert.equal(renderer.options.automationGraphs[0].nameForReference, 'Renamed');
	}
	assert.equal(context.snapshot().automationGraphs[0].id, automationGraph.id);
});
