import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { build } from 'esbuild';
import { nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const require = createRequire(import.meta.url);

function evaluate(bundle) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
	const api = module.exports;
	// 回帰テストの取得先だけをまとめ、本番には単一セッションのexportを残さない。
	return api.projectSessions == null ? api : { ...api, get projectSession() { return api.projectSessions.activeSession.value; } };
}

// セッション単体の読み込み・保存テストは、アプリの初期状態と切り離して明示的に生成する。
// マネージャーの初期状態や新規作成を検証するテストはevaluate(appBundle)を使う。
function createStandaloneSession(app, initialProject = project(), options = {}) {
	return new app.ProjectSessionContext(new app.ProjectContext(initialProject), options);
}

function evaluateSession(initialProject = project(), options = {}) {
	const app = evaluate(appBundle);
	return { ...app, projectSession: createStandaloneSession(app, initialProject, options) };
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
		export { ProjectContext } from './src/Project.ts';
		export { getAssetMenu } from './src/utility/asset-menu.ts';
		export { recentProjects } from './src/recent-projects.ts';
		export { ProjectSessionContext, TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS } from './src/ProjectSessionContext.ts';
		export { createVisualModuleAssetNode } from './src/utility/visual-module-asset-node.ts';
		export { createProjectCustomShaderEffect } from './src/utility/custom-shader-effect.ts';
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
					disposed = false; dispose() { this.disposed = true; return Promise.resolve(); }
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
						const settings = reactive({ forceTypeSafety: false, enable32bitDataTextures: false, animatedBgInPreview: false, effectRenderTiling: { mode: 'auto' },
							renderingStatsEnabled: false, analysisMonitorsEnabled: true, timelineFrameCacheMaxGiB: 2, timelineFrameCachePrecision: 'original', previewDisplayMode: 'gpu', timelinePreviewFramesAhead: 1,
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
						isReady = ref(false); errorMessage = ref(null); canvasRevision = ref(0);
						frameCacheUsageRatio = ref(null);
						updates = []; renders = []; lifecycle = [];
						highResolutionAnalysisRequests = [];
						analysisRefreshes = 0;
						staticUpdates = [];
						patches = []; snapshots = [];
						options = {};
						generation = 0;
						async initialize(snapshot) {
							this.canvasRevision.value++;
							this.staticOptions = deepClone(snapshot.staticOptions);
							this.staticUpdates.push(deepClone(snapshot.staticOptions));
							this.initialStaticOptions = deepClone(snapshot.staticOptions);
							this.initialDynamicOptions = deepClone(snapshot.dynamicOptions);
							this.options = { ...deepClone(snapshot.dynamicOptions), ...deepClone(snapshot.resources) };
							this.snapshots.push(deepClone(snapshot.dynamicOptions));
							this.initialResolution = this.options.resolution;
							this.initialResolutionScale = this.options.resolutionScale;
							this.lifecycle.push('initialize'); this.isReady.value = true;
						}
						async updateDynamicOptions(options) {
							this.updates.push(options);
							Object.assign(this.options, options);
						}
						async applyProjectChanges(changes) {
							const patch = deepClone(this.timeline ? changes : changes.filter(change => change.type === 'customShaderEffects' || change.type === 'automationGraphs' || change.type === 'visualModuleRegistration'
								|| (change.type === 'node' || change.type === 'visualModule') && 'visualModuleId' in change.target));
							if (!patch.length) return;
							this.patches.push(patch);
							const next = applyRendererProjectChanges({ automationGraphs: this.options.automationGraphs, visualModules: this.options.visualModules, timelineScenes: this.options.timelineScenes ?? [] }, patch);
							Object.assign(this.options, this.timeline ? next : { automationGraphs: next.automationGraphs, visualModules: next.visualModules });
							const shaders = patch.findLast(change => change.type === 'customShaderEffects');
							if (shaders != null) this.options.customShaderEffects = shaders.customShaderEffects;
						}
						startVisualModuleLivePreviewRenderLoopFor() { this.lifecycle.push('start'); }
						stopRenderLoop() { this.lifecycle.push('stop'); }
						renderTimelineAt(time) { this.renders.push(time); }
						async setHighResolutionImageAnalysis(enabled, settings) {
							this.highResolutionAnalysisRequests.push(deepClone({ enabled, settings }));
							return this.isReady.value;
						}
						async setImageAnalysisDisplay(settings, refresh) {
							this.options.analysisWaveformCanvasSizes = deepClone(settings.waveformCanvasSizes);
							this.options.analysisWaveformViewports = deepClone(settings.waveformViewports);
							this.options.analysisHistogramViewport = deepClone(settings.histogramViewport);
							if (refresh) { this.analysisRefreshes++; await this.waveformDisplayDelay?.(); }
						}
						cancelSeek() {}
						disposeManager() { this.generation++; this.lifecycle.push('dispose'); this.isReady.value = false; }
					}
					export class TimelineRendererManagerController extends VisualModuleRendererManagerController { timeline = true; }
					` : args.path.endsWith('.vue') ? `export default { name: '${args.path.split('/').at(-1)}' };` : `
					export async function alert(options) { globalThis.projectAlerts.push(options.text); await window.acknowledgeProjectAlert?.(); }
					export async function confirm(options) { window.projectConfirmations?.push(options); return { canceled: window.cancelProjectReplacement === true }; }
					export function progress() { return { setProgress() {}, setSubProgress() {}, setText() {}, done() {} }; }
					export function waiting() { window.waitingCount = (window.waitingCount ?? 0) + 1; return { setText() {}, done() { window.waitingCount--; } }; }
						export function disposeProjectSessionPopups() {}
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
	const context = await app.projectSessions.open(project());
	const settings = window.testPreferences;
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
	await app.projectSessions.select(context);
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
	const context = await app.projectSessions.open(project());
	const settings = window.testPreferences;
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
	await app.projectSessions.select(context);
	assert.equal(settings.analysisMonitorsEnabled, false);
	assert.equal(context.audioOutput.preview.analysisEnabled, false);
	settings.analysisMonitorsEnabled = true;
	await setImmediate();
	assert.equal(context.audioOutput.preview.analysisEnabled, true);
	assert.ok(controllers.every(controller => controller.staticOptions.enableWaveformAndHistogram === true));
});

// 【High-resは開始元の画像を保持し、設定変更ではシーンを再描画せず、解除時に最新の通常設定へ戻す】
// プレビューの表示先を切り替えても別Workerの画像へ置き換えず、両Workerの通常解析を休止する。
// Worker再生成時は失われた保持画像を新しいフレームへ黙って差し替えない。
test('integrates held analysis with preview switching settings and worker recreation', async t => {
	setup(t);
	const { projectSession } = evaluateSession(project({ visualModules: [{ id: 'visual-module', name: 'Visual Module', nodes: [], paramDefs: [], customParameterDefs: [], customParameterValues: {} }] }));
	await projectSession.start();
	projectSession.previewPlayback.showTimeline();
	const timeline = projectSession.timelineRendererManagerController;
	const visualModule = projectSession.visualModuleRendererManagerController;
	const highResolution = projectSession.highResolutionImageAnalysis;
	await projectSession.toggleHighResolutionImageAnalysis();
	assert.equal(highResolution.active.value, true);
	assert.equal(projectSession.imageAnalysisRenderer.value, timeline);
	assert.deepEqual([timeline.options.analysisPaused, visualModule.options.analysisPaused], [true, true]);
	const renders = timeline.renders.length;
	projectSession.analysisTarget.value = 'vectorLength';
	projectSession.analysisRangePreset.value = 'minusHalfToHalf';
	assert.equal(projectSession.analysisValueScale.value, 'linear');
	assert.equal(projectSession.displayedImageAnalysisSettings.value.target, 'rgb');
	highResolution.flush();
	await setImmediate();
	assert.equal(timeline.renders.length, renders);
	assert.equal(timeline.highResolutionAnalysisRequests.length, 2);
	assert.equal(visualModule.highResolutionAnalysisRequests.length, 0);
	assert.deepEqual(projectSession.displayedImageAnalysisSettings.value, { target: 'vectorLength', imageSource: 'original', imageAdjustments: { exposure: 0, srgbProof: false, gamutCompression: { mode: 'none', customAmount: 0.5 } }, valueScale: 'linear', valueRange: { minimum: -0.5, maximum: 0.5 }, waveformCanvasSizes: null, waveformViewports: null, histogramViewport: null });
	projectSession.previewPlayback.startVisualModuleLivePreview('visual-module');
	await setImmediate();
	assert.equal(projectSession.activePreviewRenderer.value, visualModule);
	assert.equal(projectSession.imageAnalysisRenderer.value, timeline);
	await projectSession.toggleHighResolutionImageAnalysis();
	assert.equal(timeline.highResolutionAnalysisRequests.at(-1).enabled, false);
	assert.equal(projectSession.imageAnalysisRenderer.value, visualModule);
	for (const controller of [timeline, visualModule]) {
		assert.equal(controller.options.analysisPaused, false);
		assert.equal(controller.options.analysisTarget, 'vectorLength');
		assert.deepEqual(controller.options.analysisValueRange, { minimum: -0.5, maximum: 0.5 });
	}
	await projectSession.toggleHighResolutionImageAnalysis();
	assert.equal(highResolution.source.value, visualModule);
	projectSession.renderEngine.requestRestart();
	await projectSession.renderEngine.retry();
	assert.equal(highResolution.active.value, false);
	assert.equal(highResolution.source.value, null);
	assert.ok([timeline, visualModule].every(controller => controller.initialDynamicOptions.analysisPaused !== true));
});

// 【ヒストグラムと両波形の解析画像を共通に切り替え、保持画像には現在の表示調整だけを再適用する】
// 警告の判定対象とは独立させ、Alpha・ベクトルは元画像の数値を使う。
// 背景や警告表示の変更では保持解析をやり直さず、作品の保存内容とUndo履歴も変えない。
test('shares the analysis image source and reanalyzes held RGB only for display adjustments', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	projectSession.previewPlayback.showTimeline();
	const controllers = [projectSession.timelineRendererManagerController, projectSession.visualModuleRendererManagerController];
	const timeline = controllers[0];
	const highResolution = projectSession.highResolutionImageAnalysis;
	const before = projectSession.projectContext.snapshot();
	const historyLength = projectSession.projectContext.stateManager.undoStack.value.length;
	assert.ok(controllers.every(controller => controller.initialDynamicOptions.analysisImageSource === 'original'));
	projectSession.analysisImageSource.value = 'previewAdjusted';
	await setImmediate();
	assert.ok(controllers.every(controller => controller.options.analysisImageSource === 'previewAdjusted'));
	assert.equal(projectSession.previewWarningImageSource.value, 'original');
	for (const target of ['alpha', 'vectorX', 'vectorY', 'vectorLength', 'rgb']) {
		projectSession.analysisTarget.value = target;
		await setImmediate();
		assert.equal(projectSession.displayedImageAnalysisSettings.value.imageSource, target === 'rgb' ? 'previewAdjusted' : 'original');
		assert.equal(projectSession.analysisImageSource.value, 'previewAdjusted');
	}
	await projectSession.toggleHighResolutionImageAnalysis();
	assert.equal(timeline.highResolutionAnalysisRequests.length, 1);
	projectSession.previewExposure.value = 2;
	projectSession.previewGamutCompression.value = { mode: 'custom', customAmount: 0.75 };
	projectSession.previewSrgbProof.value = true;
	await setImmediate();
	highResolution.flush();
	await setImmediate();
	assert.equal(timeline.highResolutionAnalysisRequests.length, 2);
	assert.deepEqual(timeline.highResolutionAnalysisRequests.at(-1).settings.imageAdjustments, {
		exposure: 2, srgbProof: true, gamutCompression: { mode: 'custom', customAmount: 0.75 },
	});
	window.testPreferences.animatedBgInPreview = !window.testPreferences.animatedBgInPreview;
	projectSession.highlightClipping.value = true;
	projectSession.previewWarningImageSource.value = 'previewAdjusted';
	projectSession.previewGamutWarning.value = { enabled: true, referenceGamut: 'acescg', bounds: 'nonNegative' };
	await setImmediate();
	highResolution.flush();
	await setImmediate();
	assert.equal(timeline.highResolutionAnalysisRequests.length, 2);
	projectSession.analysisImageSource.value = 'original';
	highResolution.flush();
	await setImmediate();
	assert.equal(timeline.highResolutionAnalysisRequests.length, 3);
	projectSession.previewExposure.value = -3;
	await setImmediate();
	highResolution.flush();
	await setImmediate();
	assert.equal(timeline.highResolutionAnalysisRequests.length, 3);
	assert.equal(projectSession.projectContext.stateManager.undoStack.value.length, historyLength);
	assert.deepEqual(projectSession.projectContext.snapshot(), before);
	await projectSession.toggleHighResolutionImageAnalysis();
	assert.ok(controllers.every(controller => controller.options.analysisImageSource === 'original'));
});

// 【波形パネルの実寸変更は通常時も保持中も作品を再描画せず、最新の解析寸法を反映する】
// 通常時は最後の完成画像だけを描き直し、High-resでは同じ保持画像への要求へ集約する。
// High-res解除やWorker再生成後に以前の固定解像度へ戻ってしまうことも防ぐ。
test('resizes waveform analysis independently of scene rendering and retains sizes through HOLD and restart', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	const timeline = projectSession.timelineRendererManagerController;
	const visualModule = projectSession.visualModuleRendererManagerController;
	const renders = timeline.renders.length;
	projectSession.setWaveformCanvasSize('horizontal', { width: 900, height: 450 });
	projectSession.setWaveformCanvasSize('vertical', { width: 400, height: 800 });
	await setImmediate();
	assert.equal(timeline.renders.length, renders);
	assert.equal(timeline.analysisRefreshes, 2);
	assert.deepEqual(timeline.options.analysisWaveformCanvasSizes, { horizontal: { width: 900, height: 450 }, vertical: { width: 400, height: 800 } });
	assert.deepEqual(visualModule.options.analysisWaveformCanvasSizes, timeline.options.analysisWaveformCanvasSizes);
	await projectSession.toggleHighResolutionImageAnalysis();
	projectSession.setWaveformCanvasSize('horizontal', { width: 1200, height: 600 });
	projectSession.setWaveformCanvasSize('vertical', { width: 600, height: 1200 });
	projectSession.highResolutionImageAnalysis.flush();
	await setImmediate();
	assert.equal(timeline.renders.length, renders);
	assert.equal(timeline.analysisRefreshes, 2);
	assert.equal(timeline.highResolutionAnalysisRequests.length, 2);
	assert.deepEqual(timeline.highResolutionAnalysisRequests.at(-1).settings.waveformCanvasSizes, { horizontal: { width: 1200, height: 600 }, vertical: { width: 600, height: 1200 } });
	await projectSession.toggleHighResolutionImageAnalysis();
	projectSession.renderEngine.requestRestart();
	await projectSession.renderEngine.retry();
	assert.deepEqual(timeline.initialDynamicOptions.analysisWaveformCanvasSizes, { horizontal: { width: 1200, height: 600 }, vertical: { width: 600, height: 1200 } });
});

// 【ズーム・移動の再集計は直列化し、目盛りは完了した範囲と一致させる】
// 通常時に作品を再描画せず、処理中の操作は最新の一件へまとめる。
// High-resでは元の保持画像の設定更新にだけ送り、解除・Worker再生成後も表示範囲を維持する。
test('serializes waveform viewport updates and applies matching completed axes through HOLD and restart', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	const timeline = projectSession.timelineRendererManagerController;
	const visualModule = projectSession.visualModuleRendererManagerController;
	const renders = timeline.renders.length;
	const first = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
	const second = { x: 0.3, y: 0.4, width: 0.25, height: 0.25 };
	const delayed = Promise.withResolvers();
	timeline.waveformDisplayDelay = () => delayed.promise;
	projectSession.setWaveformViewport('horizontal', first);
	projectSession.flushImageAnalysisDisplay();
	await setImmediate();
	assert.equal(timeline.analysisRefreshes, 1);
	assert.equal(projectSession.displayedImageAnalysisSettings.value.waveformViewports, null);
	projectSession.setWaveformViewport('horizontal', second);
	projectSession.flushImageAnalysisDisplay();
	await setImmediate();
	assert.equal(timeline.analysisRefreshes, 1);
	delayed.resolve();
	await setImmediate();
	assert.equal(timeline.analysisRefreshes, 2);
	assert.equal(timeline.renders.length, renders);
	assert.deepEqual(projectSession.displayedImageAnalysisSettings.value.waveformViewports.horizontal, second);
	assert.deepEqual(visualModule.options.analysisWaveformViewports.horizontal, second);
	await projectSession.toggleHighResolutionImageAnalysis();
	projectSession.setWaveformViewport('horizontal', first);
	projectSession.flushImageAnalysisDisplay();
	assert.deepEqual(projectSession.displayedImageAnalysisSettings.value.waveformViewports.horizontal, second);
	await setImmediate();
	assert.deepEqual(projectSession.displayedImageAnalysisSettings.value.waveformViewports.horizontal, first);
	assert.equal(timeline.highResolutionAnalysisRequests.length, 2);
	assert.equal(timeline.renders.length, renders);
	await projectSession.toggleHighResolutionImageAnalysis();
	projectSession.renderEngine.requestRestart();
	await projectSession.renderEngine.retry();
	assert.deepEqual(timeline.initialDynamicOptions.analysisWaveformViewports.horizontal, first);
	assert.deepEqual(projectSession.displayedImageAnalysisSettings.value.waveformViewports.horizontal, first);
});

// 【起動時に保存済みの計測・解析設定を両プレビューの初期設定へ反映する】
// 起動直後だけ既定値でWorkerを生成すると、footerの表示と実際のGPU処理が食い違う。
test('initializes both previews from saved rendering preferences', async t => {
	const window = setup(t);
	window.initialTestPreferences = { renderingStatsEnabled: true, analysisMonitorsEnabled: false };
	const { projectSession } = evaluateSession();
	assert.equal(projectSession.audioOutput.preview.analysisEnabled, false);
	await projectSession.start();
	assert.equal(projectSession.audioOutput.preview.analysisEnabled, false);
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(controller.staticOptions.enableStats, true);
		assert.equal(controller.staticOptions.enableWaveformAndHistogram, false);
	}
});

// 【ブラーだけの変更とUndo/Redoでは停止中の精密位置を維持する】
// FPSとブラーの同期を同じwatchで行っても、精密モードを解除するのはFPSの変更時だけにする。
// プレビューサンプル数の変更も、画像の品質を変えるだけで確認中の時刻は動かさない。
test('preserves precise seek positions when changing motion blur without changing FPS', async t => {
	setup(t);
	const { projectSession } = evaluateSession(project({ timelineFps: 30 }));
	await projectSession.start();
	const playback = projectSession.previewPlayback;
	const timeline = projectSession.timelineRendererManagerController;
	const manager = projectSession.projectContext.stateManager;
	playback.seekTimeline(120, true, 'precise');
	timeline.updates.length = 0;
	projectSession.timelinePreviewMotionBlurSamples.value = 4;
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
	// 【キャッシュの容量・精度を静的設定で渡し、変更時は両プレビューを再生成する】
	// ブラウザー版・Electron版で同じ既定値と再生成経路を使う。0への無効化と再有効化、
	// 精度だけの変更も検出し、これらの環境設定をプロジェクトの保存内容やUndoへ含めない。
	test(`rebuilds previews with static frame cache settings on browser and desktop: ${desktop}`, async t => {
		const window = setup(t);
		if (desktop) window.desktop = {};
		const { projectSession } = evaluateSession();
		await projectSession.start();
		const timeline = projectSession.timelineRendererManagerController;
		const visualModule = projectSession.visualModuleRendererManagerController;
		assert.equal(timeline.initialStaticOptions.frameCacheMaxBytes, 2 * 1024 ** 3);
		assert.equal(timeline.initialStaticOptions.frameCachePrecision, 'original');
		assert.equal(Object.hasOwn(timeline.initialDynamicOptions, 'frameCacheMaxBytes'), false);
		const historyLength = projectSession.projectContext.stateManager.undoStack.value.length;
		const staticUpdates = timeline.staticUpdates.length;
		const visualModuleStaticUpdates = visualModule.staticUpdates.length;
		timeline.updates.length = 0;
		for (const [index, capacity] of [0, 1, 3].entries()) {
			window.testPreferences.timelineFrameCacheMaxGiB = capacity;
			await setImmediate();
			assert.equal(timeline.staticUpdates.length, staticUpdates + index + 1);
			assert.equal(visualModule.staticUpdates.length, visualModuleStaticUpdates + index + 1);
			assert.equal(timeline.initialStaticOptions.frameCacheMaxBytes, capacity * 1024 ** 3);
		}
		for (const [index, precision] of ['8bit', 'original'].entries()) {
			window.testPreferences.timelineFrameCachePrecision = precision;
			await setImmediate();
			assert.equal(timeline.staticUpdates.length, staticUpdates + 4 + index);
			assert.equal(visualModule.staticUpdates.length, visualModuleStaticUpdates + 4 + index);
			assert.equal(timeline.initialStaticOptions.frameCachePrecision, precision);
			assert.equal(timeline.initialStaticOptions.frameCacheMaxBytes, 3 * 1024 ** 3);
		}
		assert.equal(timeline.updates.some(options => Object.hasOwn(options, 'frameCacheMaxBytes') || Object.hasOwn(options, 'frameCachePrecision')), false);
		assert.equal(projectSession.projectContext.stateManager.undoStack.value.length, historyLength);
		assert.equal('timelineFrameCacheMaxGiB' in projectSession.projectContext.snapshot(), false);
		assert.equal('timelineFrameCachePrecision' in projectSession.projectContext.snapshot(), false);
	});
}

function project(overrides = {}) {
	return {
		customShaderEffects: [],
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

// 【カスタムシェーダーエフェクトの定義は未完成コードも含めて保存・復元し、新規プロジェクトで初期化する】
// 定義エディタだけの段階でも、ProjectContextのスナップショットと実際のファイル形式を経由して
// コード・固定ID・複数出力・主入出力の参照が欠けず、別プロジェクトへ漏れないことを確認する。
test('persists Custom Shader Effect definitions through project snapshots and files', async t => {
	setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const context = app.projectSession.projectContext;
	const manager = context.stateManager;
	assert.deepEqual(manager.state.customShaderEffects.value, []);
	const customShaderEffect = app.createProjectCustomShaderEffect([]);
	customShaderEffect.code = 'unfinished WGSL';
	customShaderEffect.outputDefs.push({ id: 'mask', nameForReference: 'mask', label: 'Mask', dataType: { kind: 'scalar' } });
	manager.commit('addCustomShaderEffect', { customShaderEffect });
	const snapshot = context.snapshot();
	const restored = decodeProjectFile(await encodeProjectFile(snapshot));
	assert.deepEqual(restored.customShaderEffects, [customShaderEffect]);
	const restoredSession = await app.projectSessions.open(restored);
	const restoredManager = restoredSession.projectContext.stateManager;
	assert.deepEqual(JSON.parse(JSON.stringify(restoredManager.state.customShaderEffects.value)), [customShaderEffect]);
	restoredManager.commit('removeCustomShaderEffect', { customShaderEffectId: customShaderEffect.id });
	restoredManager.undo();
	assert.deepEqual(restoredSession.projectContext.snapshot().customShaderEffects, [customShaderEffect]);
	assert.deepEqual(context.snapshot().customShaderEffects, [customShaderEffect]);
	assert.deepEqual(snapshot.customShaderEffects, [customShaderEffect]);
	await app.newProject();
	assert.deepEqual(app.projectSession.projectContext.stateManager.state.customShaderEffects.value, []);
	assert.deepEqual(context.snapshot().customShaderEffects, [customShaderEffect]);
});

// 【表示を切り替えると現在のプレビューだけがアイドル描画を行い、Workerは再生成しない】
// 背景スケジューラー単体が停止できても、UIから非表示のTimelineへ通知しなければ動き続ける。
// 初期化・表示切替・エンジン復帰を通し、再生状態が持つ現在の表示先へ同期することを確認する。
test('activates background presentation only for the selected preview without rebuilding workers', async t => {
	setup(t);
	const { projectSession } = evaluateSession(project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [] }] }));
	await projectSession.start();
	t.after(() => projectSession.previewPlayback.dispose());
	const visualModule = projectSession.visualModuleRendererManagerController;
	const timeline = projectSession.timelineRendererManagerController;
	const check = expectedVisualModule => {
		assert.equal(visualModule.options.previewActive, expectedVisualModule);
		assert.equal(timeline.options.previewActive, !expectedVisualModule);
	};
	await setImmediate();
	check(true);
	projectSession.previewPlayback.showTimeline();
	await setImmediate();
	check(false);
	projectSession.previewPlayback.startVisualModuleLivePreview('visualModule');
	await setImmediate();
	check(true);
	for (const controller of [visualModule, timeline]) assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 1);
	await projectSession.suspendPreview();
	projectSession.previewPlayback.showTimeline();
	await projectSession.resumePreview();
	await setImmediate();
	check(false);
});

for (const interruption of ['scene selection', 'session disposal']) {
	// 【Scene更新の待機中に再選択・終了した場合は古い処理からシークや再描画を行わない】
	// 非同期watchは次のScene選択と購読停止の両方で失効する必要がある。
	// 古いWorker応答の完了が、後から選んだSceneの再生位置や終了済みプレビューへ干渉するのを防ぐ。
	test(`ignores a delayed scene update after ${interruption}`, async t => {
		let projectSession = null;
		t.after(() => projectSession?.dispose());
		setup(t);
		({ projectSession } = evaluateSession(project({ timelineScenes: ['first', 'second', 'third'].map(id => ({
			id, name: id, resolution: { mode: 'project' }, layers: [],
		})) })));
		await projectSession.start();
		await setImmediate();
		const timeline = projectSession.timelineRendererManagerController;
		const entered = Promise.withResolvers();
		const release = Promise.withResolvers();
		const updateDynamicOptions = timeline.updateDynamicOptions.bind(timeline);
		t.mock.method(timeline, 'updateDynamicOptions', async options => {
			await updateDynamicOptions(options);
			if (options.sceneId === 'second') {
				entered.resolve();
				await release.promise;
			}
		});
		projectSession.activeSceneId.value = 'second';
		await entered.promise;
		if (interruption === 'scene selection') {
			projectSession.activeSceneId.value = 'third';
			await setImmediate();
			assert.equal(timeline.options.sceneId, 'third');
			projectSession.previewPlayback.seekTimeline(3000);
		} else {
			await projectSession.dispose();
		}
		const currentTime = projectSession.previewPlayback.currentTimelineTime.value;
		const renders = [...timeline.renders];
		const seek = t.mock.method(projectSession.previewPlayback, 'seekTimeline');
		const refresh = t.mock.method(projectSession.previewPlayback, 'refresh');
		release.resolve();
		await setImmediate();
		assert.equal(seek.mock.callCount(), 0);
		assert.equal(refresh.mock.callCount(), 0);
		assert.equal(projectSession.previewPlayback.currentTimelineTime.value, currentTime);
		assert.deepEqual(timeline.renders, renders);
	});
}

// 【ソロと通常の表示設定を独立して保存・復元する】
// 子のソロやグループの非表示を保存時に実効表示へ置き換えると、開き直した後に
// ソロを解除しても編集前の表示へ戻れなくなる。実際のバイナリ形式で往復させる。
test('round-trips nested solo flags independently of normal layer visibility', async () => {
	const original = project({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
		{ id: 'group', name: 'Group', layerType: 'group', isDisabled: true, isSolo: false, layers: [
			{ id: 'image', name: 'Image', layerType: 'image', isDisabled: true, isSolo: true, clips: [] },
		] },
		{ id: 'other', name: 'Other', layerType: 'image', isDisabled: false, isSolo: false, clips: [] },
	] }] });
	const restored = decodeProjectFile(await encodeProjectFile(original));
	assert.deepEqual(restored.timelineScenes, original.timelineScenes);
});

for (const [label, fileDataType, isExternalReference] of [
	['embedded image', 'image/png', false], ['external image', 'image/png', true], ['external video', 'video/mp4', true],
]) {
	// 【素材とノードを同じCommandで取り込んでも、素材準備前にノード差分を旧エンジンへ送らない】
	// ProjectSessionContext・Command・RendererProjectSynchronizerは実コードを通す。遅い素材参照解決の間にも
	// 編集を続け、最新の寸法・Player・ノード設定を両プレビューの再生成へ一緒に渡す必要がある。
	test(`rebuilds previews with matching assets and nodes after importing an ${label}`, async t => {
		const window = setup(t);
		const { projectSession, createVisualModuleAssetNode } = evaluateSession(project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [] }] }));
		await projectSession.start();
		t.after(() => projectSession.previewPlayback.dispose());
		const gate = Promise.withResolvers();
		const source = { url: 'app://external-assets/imported', size: 100, error: null };
		window.desktop = { resolveExternalAsset: () => gate.promise };
		const asset = { id: 'imported', name: 'Imported', width: 1920, height: 1080, fileDataType,
																		fileData: isExternalReference ? source : new Blob(['image'], { type: fileDataType }), sourceFilePath: 'C:/assets/imported', isExternalReference };
		const { node, player } = createVisualModuleAssetNode(asset, []);
		const players = player == null ? [] : [player];
		const manager = projectSession.projectContext.stateManager;
		const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
		for (const controller of controllers) {
			controller.lifecycle.length = 0;
			controller.patches.length = 0;
			const initialize = controller.initialize.bind(controller);
			controller.initialize = async snapshot => {
				const generation = controller.generation;
				// 遅いデコード中にも編集できる。破棄された試行は起動せず、次の最新スナップショットを使う。
				if (!isExternalReference) await gate.promise;
				if (generation !== controller.generation) return;
				const importedNode = snapshot.dynamicOptions.visualModules[0].nodes[0];
				const assetId = importedNode.effectId === 'image' ? importedNode.staticSettings.image
					: projectSession.projectContext.stateManager.state.players.value.find(player => player.id === importedNode.staticSettings.player).assetId;
				const referencedAsset = snapshot.resources.assets.find(asset => asset.id === assetId);
				assert.deepEqual([referencedAsset.width, referencedAsset.height], [1920, 1080]);
				assert.equal(importedNode.resolution.scale, 0.5);
				await initialize(snapshot);
			};
		}
		manager.commit('importAssets', { assets: [asset], players, visualModule: { target: { visualModuleId: 'visualModule' }, nodes: [node] } });
		assert.equal(projectSession.renderEngine.canRender.value, false);
		assert.ok(controllers.every(controller => controller.isReady.value === false));
		manager.commit('changeNodeResolution', { visualModuleId: 'visualModule', nodeId: node.id, resolution: { mode: 'auto', scale: 0.5 } });
		await projectSession.flushRendererProjectChanges();
		await setImmediate();
		assert.ok(controllers.every(controller => controller.patches.length === 0));
		assert.ok(controllers.every(controller => !controller.lifecycle.includes('initialize')));
		gate.resolve(source);
		await setImmediate();
		assert.equal(projectSession.renderEngine.errorMessage.value, null);
		for (const controller of controllers) {
			assert.equal(controller.isReady.value, true);
			assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 1);
		}
		manager.commit('renameAsset', { assetId: asset.id, name: 'Renamed' });
		await setImmediate();
		assert.ok(controllers.every(controller => controller.lifecycle.filter(event => event === 'initialize').length === 1));
	});
}

// 【初期化中の通常編集・動的設定・静的設定を最新スナップショットで両プレビューへ反映する】
// 初期化中の差分キューを削除しても、素材変更を伴わないノード編集を失ってはいけない。
// 表示名だけの変更では生成を破棄せず、起動後の通常編集では差分更新を維持する。
test('restarts both previews after content and settings change during initialization and keeps live edits incremental', async t => {
	const window = setup(t);
	const { projectSession } = evaluateSession(project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [] }] }));
	await projectSession.start();
	t.after(() => projectSession.previewPlayback.dispose());
	await projectSession.suspendPreview();
	const gate = Promise.withResolvers();
	const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
	const attempts = controllers.map(controller => {
		const snapshots = [];
		const initialize = controller.initialize.bind(controller);
		controller.initialize = async snapshot => {
			const generation = controller.generation;
			snapshots.push(snapshot);
			if (snapshots.length === 1) await gate.promise;
			if (generation === controller.generation) await initialize(snapshot);
		};
		controller.patches.length = 0;
		return snapshots;
	});
	const starting = projectSession.resumePreview();
	await setImmediate();
	assert.ok(attempts.every(snapshots => snapshots.length === 1));
	const generations = controllers.map(controller => controller.generation);
	const manager = projectSession.projectContext.stateManager;
	manager.commit('renameVisualModule', { visualModuleId: 'visualModule', name: 'Renamed' });
	assert.deepEqual(controllers.map(controller => controller.generation), generations);
	manager.commit('addEffectNode', { visualModuleId: 'visualModule', id: 'during-initialization', effectId: 'fill' });
	projectSession.highlightClipping.value = true;
	projectSession.previewExposure.value = 2;
	projectSession.previewWarningImageSource.value = 'previewAdjusted';
	projectSession.previewGamutWarning.value = { enabled: true, referenceGamut: 'acescg', bounds: 'nonNegative' };
	projectSession.previewSrgbProof.value = true;
	projectSession.previewGamutCompression.value = { mode: 'rec2020', customAmount: 0.37 };
	window.testPreferences.timelinePreviewFramesAhead = 0;
	window.testPreferences.timelineFrameCacheMaxGiB = 1;
	window.testPreferences.timelineFrameCachePrecision = '8bit';
	await projectSession.flushRendererProjectChanges();
	assert.equal(projectSession.renderEngine.canRender.value, false);
	assert.ok(controllers.every(controller => controller.patches.length === 0));
	gate.resolve();
	await starting;
	assert.ok(attempts.every(snapshots => snapshots.length === 2));
	assert.equal(controllers[1].initialStaticOptions.frameCacheMaxBytes, 1024 ** 3);
	assert.equal(controllers[1].initialStaticOptions.frameCachePrecision, '8bit');
	for (const controller of controllers) {
		assert.equal(controller.options.visualModules[0].nodes[0].id, 'during-initialization');
		assert.equal(controller.options.highlightClipping, true);
		assert.equal(controller.options.previewWarningImageSource, 'previewAdjusted');
		assert.deepEqual(controller.options.previewGamutWarning, { enabled: true, referenceGamut: 'acescg', bounds: 'nonNegative' });
		assert.equal(controller.options.previewExposure, 2);
		assert.equal(controller.options.previewSrgbProof, true);
		assert.deepEqual(controller.options.previewGamutCompression, { mode: 'rec2020', customAmount: 0.37 });
	}
	assert.equal(projectSession.timelineRendererManagerController.staticOptions.previewFramesAhead, 0);
	manager.commit('addEffectNode', { visualModuleId: 'visualModule', id: 'after-initialization', effectId: 'fill' });
	await projectSession.flushRendererProjectChanges();
	assert.ok(attempts.every(snapshots => snapshots.length === 2));
	assert.ok(controllers.every(controller => controller.patches.length > 0));
});

// 【取り込み準備中のUndoは素材とノードを両方除いた状態で再生成し、古い準備完了で戻さない】
// 素材削除を旧ノードへ先に反映すると静的解像度の計算が失敗する。
// 遅れて完了した参照解決の無視と、Redoでの再取り込みを同じ実際の履歴経路で確認する。
test('ignores obsolete asset preparation after undo and rebuilds the latest state on redo', async t => {
	const window = setup(t);
	const { projectSession, createVisualModuleAssetNode } = evaluateSession(project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'visualModule', name: 'Visual Module', nodes: [], paramDefs: [] }] }));
	await projectSession.start();
	t.after(() => projectSession.previewPlayback.dispose());
	const gate = Promise.withResolvers();
	const source = { url: 'app://external-assets/imported', size: 100, error: null };
	window.desktop = { resolveExternalAsset: () => gate.promise };
	const asset = { id: 'imported', name: 'Imported', width: 640, height: 480, fileDataType: 'image/png',
																	fileData: source, sourceFilePath: 'C:/assets/imported', isExternalReference: true };
	const { node } = createVisualModuleAssetNode(asset, []);
	const manager = projectSession.projectContext.stateManager;
	const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
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
	assert.equal(projectSession.renderEngine.errorMessage.value, null);
	for (const controller of controllers) {
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.options.assets[0].id, asset.id);
		assert.equal(controller.options.visualModules[0].nodes[0].staticSettings.image, asset.id);
		assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 1);
	}
	// 再生成済みの旧ノードが存在する場合も、素材だけを先に削除して参照切れを起こさない。
	manager.undo();
	assert.ok(controllers.every(controller => controller.isReady.value === false));
	await setImmediate();
	assert.equal(projectSession.renderEngine.errorMessage.value, null);
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
	await app.newProject();
	const { projectSession } = app;
	t.after(() => projectSession.previewPlayback.dispose());
	projectSession.previewPlayback.seekTimeline(0);
	await setImmediate();
	const timeline = projectSession.timelineRendererManagerController;
	const gate = Promise.withResolvers();
	let frameRequested = false;
	timeline.isFrameCacheEnabled = { value: true };
	timeline.renderTimelineAtAndWait = () => { frameRequested = true; return gate.promise; };
	timeline.cancelSeek = () => { if (frameRequested) gate.resolve(false); };
	const manager = projectSession.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const historyLength = manager.undoStack.value.length;
	const baking = projectSession.previewPlayback.toggleTimelineBake();
	assert.equal(projectSession.previewPlayback.isTimelineBaking.value, true);
	assert.equal(manager.undoStack.value.length, historyLength);
	manager.commit('renameTimelineLayer', { sceneId: scene.id, layerId: scene.layers[0].id, name: 'Renamed while baking' });
	assert.equal(projectSession.previewPlayback.isTimelineBaking.value, false);
	await baking;
	assert.equal(manager.undoStack.value.length, historyLength + 1);
});

// 【不正な設定も読み込んで編集でき、修正した最新状態から両エンジンを生成する】
// レンダラー側で更新を拒否するとUIとWorkerの状態が食い違い、循環を直す編集も失敗する。
test('keeps invalid projects editable and recreates both previews after correction', async t => {
	setup(t);
	const { projectSession } = evaluateSession(project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'invalid', paramDefs: [], nodes: [
		{ id: 'effect', type: 'effect', effectId: 'fill', resolution: { mode: 'invalid' }, params: { color: { inputSource: 'literal', value: [1, 0, 0, 1] } } },
	] }] }));
	await projectSession.start();
	assert.ok(projectSession.renderValidation.diagnostics.value.length > 0);
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) assert.equal(controller.isReady.value, false);
	projectSession.projectContext.stateManager.commit('removeNode', { visualModuleId: 'invalid', nodeId: 'effect' });
	assert.equal(projectSession.renderValidation.errorMessage.value, null);
	await setImmediate();
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(controller.isReady.value, true);
		assert.deepEqual(controller.options.visualModules[0].nodes, []);
	}
});

// 【Visual Module Live Preview引数だけの静的エラーは、Timelineへ切り替えると診断解除と再生成を行う】
// プレビュー対象の変更はProjectの編集通知を出さない。
// エラー表示だけが消えてWorkerを持たない状態のままにならないよう、両エンジンの復帰を確認する。
test('recreates previews after switching away from invalid visualModuleLivePreview inputs', async t => {
	setup(t);
	const { projectSession } = evaluateSession(project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'visualModule', nodes: [], paramDefs: [{
		id: 'audio', nameForReference: 'audio', dataType: { kind: 'audioSource' }, canNode: false,
		ui: { label: 'Audio', control: { controlType: 'audioSource' } }, defaultValue: { inputSource: 'literal', value: null },
	}] }] }));
	await projectSession.start();
	projectSession.previewPlayback.updateVisualModuleLivePreviewParamValues('visualModule', { audio: { inputSource: 'literal', value: { type: 'player', playerId: 'missing' } } });
	assert.ok(projectSession.renderValidation.diagnostics.value.length > 0);
	assert.equal(projectSession.timelineRendererManagerController.isReady.value, false);
	projectSession.previewPlayback.showTimeline();
	assert.equal(projectSession.renderValidation.errorMessage.value, null);
	await setImmediate();
	assert.equal(projectSession.renderEngine.errorMessage.value, null);
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(controller.isReady.value, true);
	}
	assert.equal(projectSession.previewPlayback.state.value.mode, 'timeline');
	assert.equal(projectSession.timelineRendererManagerController.renders.at(-1), 0);
});

// 【Custom Shader Effectの通常適用・Undoでは両プレビューを維持し、失敗後の修正では再生成する】
// ProjectSessionContextの購読・同期・復旧を通し、定義が最新になることとWorkerの生成回数を同時に確認する。
test('updates shader definitions in both existing previews and restarts only after failure', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const projectSession = createStandaloneSession(app);
	await projectSession.start();
	t.after(() => projectSession.previewPlayback.dispose());
	const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
	const initialLifecycles = controllers.map(controller => [...controller.lifecycle]);
	const manager = projectSession.projectContext.stateManager;
	const customShaderEffect = app.createProjectCustomShaderEffect([]);
	manager.commit('addCustomShaderEffect', { customShaderEffect });
	await setImmediate();
	for (const [index, controller] of controllers.entries()) {
		assert.equal(controller.options.customShaderEffects[0].code, customShaderEffect.code);
		assert.deepEqual(controller.patches.at(-1).map(change => change.type), ['customShaderEffects']);
		assert.deepEqual(controller.lifecycle, initialLifecycles[index]);
	}
	const updated = { ...customShaderEffect, code: 'unfinished WGSL is still saved' };
	manager.commit('updateCustomShaderEffect', { customShaderEffect: updated });
	await setImmediate();
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(controller.options.customShaderEffects[0].code, updated.code);
		assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 1);
	}
	manager.undo();
	await setImmediate();
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(controller.options.customShaderEffects[0].code, customShaderEffect.code);
		assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 1);
	}
	projectSession.renderEngine.fail(new Error('Shader compilation failed'));
	assert.ok(controllers.every(controller => controller.isReady.value === false));
	manager.commit('updateCustomShaderEffect', { customShaderEffect: { ...customShaderEffect, code: 'corrected shader' } });
	await setImmediate();
	assert.equal(projectSession.renderEngine.errorMessage.value, null);
	for (const controller of controllers) {
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.options.customShaderEffects[0].code, 'corrected shader');
		assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 2);
	}
});

// 【解析対象の切替は両プレビューへ同期し、数値データの軸と復旧時の設定も一致させる】
// UIだけを切り替えるとWorkerがRGBを集計し続けるため、実際のProjectSessionContextと同期処理を通す。
// 色用の軸からの切替・Linearの保持・不正な軸の指定・復旧時の再生成も確認する。
test('synchronizes analysis targets and valid value scales across both previews and recovery', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
	for (const target of ['alpha', 'vectorX', 'vectorY', 'vectorLength']) {
		projectSession.analysisTarget.value = target;
		await setImmediate();
		assert.equal(projectSession.analysisValueScale.value, 'linear');
		for (const controller of controllers) {
			assert.equal(controller.options.analysisTarget, target);
			assert.equal(controller.options.analysisValueScale, 'linear');
		}
	}
	projectSession.analysisRangePreset.value = 'minusOneToOne';
	projectSession.analysisTarget.value = 'vectorX';
	await setImmediate();
	assert.equal(projectSession.analysisValueScale.value, 'linear');
	assert.deepEqual(projectSession.analysisValueRange.value, { minimum: -1, maximum: 1 });
	projectSession.renderEngine.fail(new Error('draw failed'));
	projectSession.analysisTarget.value = 'vectorLength';
	await setImmediate();
	for (const controller of controllers) {
		assert.equal(controller.initialDynamicOptions.analysisTarget, 'vectorLength');
		assert.equal(controller.initialDynamicOptions.analysisValueScale, 'linear');
		assert.deepEqual(controller.initialDynamicOptions.analysisValueRange, { minimum: -1, maximum: 1 });
	}
	projectSession.analysisValueScale.value = 'ev';
	await setImmediate();
	assert.equal(projectSession.analysisValueScale.value, 'linear');
	projectSession.analysisTarget.value = 'rgb';
	projectSession.analysisValueScale.value = 'ev';
	await setImmediate();
	for (const controller of controllers) {
		assert.equal(controller.options.analysisTarget, 'rgb');
		assert.equal(controller.options.analysisValueScale, 'ev');
		assert.ok(controller.updates.every(options => options.analysisTarget == null || options.analysisTarget === 'rgb'
			|| !['srgb', 'ev'].includes(options.analysisValueScale)));
	}
});

// 【表示範囲を変換方式から独立して同期し、Customの反転・幅0も復旧後に保持する】
// Min・MaxはVueのオブジェクトなので、Workerへ渡せる通常のオブジェクトとして送る必要がある。
// 全プリセットとCustomが両プレビューへ反映され、sRGB・EVの切替でも範囲が変わらないことを確認する。
test('synchronizes independent preset and custom analysis ranges across scales and recovery', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
	for (const scale of ['srgb', 'linear', 'ev']) {
		projectSession.analysisValueScale.value = scale;
		for (const [preset, minimum, maximum] of [['zeroToOne', 0, 1], ['minusOneToOne', -1, 1], ['minusOneToFour', -1, 4], ['minusHalfToHalf', -0.5, 0.5], ['minusTenToTen', -10, 10], ['custom', 0, 1]]) {
			projectSession.analysisRangePreset.value = preset;
			await setImmediate();
			for (const controller of controllers) {
				assert.equal(controller.options.analysisValueScale, scale);
				assert.deepEqual(structuredClone(controller.options.analysisValueRange), { minimum, maximum });
			}
		}
	}
	for (const [minimum, maximum] of [[-0.01, 0.02], [2, -2], [0, 0]]) {
		projectSession.analysisCustomRange.value = { minimum, maximum };
		await setImmediate();
		for (const controller of controllers) assert.deepEqual(structuredClone(controller.options.analysisValueRange), { minimum, maximum });
	}
	projectSession.renderEngine.fail(new Error('draw failed'));
	projectSession.analysisCustomRange.value = { minimum: -10, maximum: 10 };
	await setImmediate();
	for (const controller of controllers) {
		assert.deepEqual(controller.initialDynamicOptions.analysisValueRange, { minimum: -10, maximum: 10 });
		assert.equal(controller.initialDynamicOptions.analysisValueScale, 'ev');
	}
});

// 【プレビュー固有設定の修正でも、実行時失敗後に最新設定から再生成する】
// これらの値はProjectのCommand通知を出さないため、編集通知だけに再試行を任せると復帰できない。
// 解像度・サンプル数・GPU設定を含む各経路が、正常な最新設定を持つ両エンジンへ反映されることを確認する。
for (const [setting, change, inspect] of [
	['resolution scale', projectSession => { projectSession.resolutionFactor.value = 0.5; }, projectSession => {
		assert.equal(projectSession.timelineRendererManagerController.initialResolutionScale, 0.5);
	}],
	['motion blur samples', projectSession => { projectSession.timelinePreviewMotionBlurSamples.value = 4; }, projectSession => {
		assert.equal(projectSession.timelineRendererManagerController.initialStaticOptions.timelineMotionBlur.samples, 4);
	}],
	['effect render tiling', () => { window.testPreferences.effectRenderTiling = { mode: 'manual', tileSize: 256 }; }, projectSession => {
		assert.deepEqual(projectSession.timelineRendererManagerController.initialStaticOptions.effectRenderTiling, { mode: 'manual', tileSize: 256 });
		assert.deepEqual(projectSession.visualModuleRendererManagerController.initialStaticOptions.effectRenderTiling, { mode: 'manual', tileSize: 256 });
	}],
	['GPU precision', () => { window.testPreferences.enable32bitDataTextures = true; }, projectSession => {
		assert.equal(projectSession.timelineRendererManagerController.initialStaticOptions.enable32bitDataTextures, true);
	}],
	['timeline preview fps', projectSession => { projectSession.timelinePreviewFpsFactor.value = 2; }],
	['visualModuleLivePreview fps limit', projectSession => { projectSession.visualModuleLivePreviewFpsLimit.value = 24; }],
	['visualModuleLivePreview time factor', projectSession => { projectSession.visualModuleLivePreviewTimeFactor.value = 0.5; }],
	['clipping display', projectSession => { projectSession.highlightClipping.value = true; }],
	['warning image source', projectSession => { projectSession.previewWarningImageSource.value = 'previewAdjusted'; }],
	['gamut warning', projectSession => { projectSession.previewGamutWarning.value = { enabled: true, referenceGamut: 'srgb', bounds: 'unit' }; }],
	['gamut warning bounds', projectSession => { projectSession.previewGamutWarning.value = { ...projectSession.previewGamutWarning.value, bounds: 'nonNegative' }; }],
	['preview exposure', projectSession => { projectSession.previewExposure.value = 2; }],
	['sRGB proof', projectSession => { projectSession.previewSrgbProof.value = true; }],
	['preview gamut compression', projectSession => { projectSession.previewGamutCompression.value = { mode: 'displayP3', customAmount: 0.5 }; }],
]) test(`retries runtime failures after changing ${setting}`, async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	projectSession.renderEngine.fail(new Error('draw failed'));
	change(projectSession);
	await setImmediate();
	assert.equal(projectSession.renderEngine.errorMessage.value, null);
	for (const controller of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(controller.isReady.value, true);
		assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, 2);
	}
	inspect?.(projectSession);
});

// 【再生開始時の生成音声をシーク中も固定し、次回再生にだけ新しい結果を採用する】
// 生成完了で音声Workerが再起動したり、描画用音声入力と再生音声が食い違うのを防ぐ。
// 発話の編集とUndoは再生を停止し、字幕と音声に別の本文が使われないことも確認する。
// 音声情報と入れ子のAudioQueryはVueでリアクティブになるため、Workerへ複製可能な状態で渡す。
test('freezes prepared speech during playback and stops for utterance edits and undo', async t => {
	const window = setup(t);
	window.requestAnimationFrame = () => 1;
	window.cancelAnimationFrame = () => {};
	const key = JSON.stringify([1, 1, 'Hello']);
	const speech = { key, sourceId: 'first', durationMs: 1000, fileData: new Blob(['first']), engineVersion: 'test', audioQuery: { accent_phrases: [{ moras: [{ text: 'ハ', vowel_length: 0.1 }] }] } };
	const layer = { id: 'speech', name: 'Speech', layerType: 'voicevox', isDisabled: false, automationGraphs: [],
																	voicevox: { speedScale: 1 }, utterances: [{ id: 'key', timeMs: 0, text: 'Hello', reading: null, styleId: 1, subtitleDuration: { mode: 'fill' } }],
																	clips: [{ id: 'clip', startMs: 0, durationMs: 2000, contentOffsetMs: 0 }],
																	subtitleParamValues: {}, compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const { projectSession } = evaluateSession(project({ generatedSpeech: [speech], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }] }));
	await projectSession.start();
	await nextTick();
	const manager = projectSession.projectContext.stateManager;
	const playback = projectSession.previewPlayback;
	const audio = projectSession.timelineAudioPreview;
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
		assert.deepEqual(projectSession.projectContext.snapshot().generatedSpeech, []);
		await nextTick();
		playback.playTimeline();
		manager.undo();
		assert.equal(playback.isTimelinePlaying.value, false);
		assert.equal(manager.state.generatedSpeech.value[0].sourceId, 'second');
		assert.equal(projectSession.projectContext.snapshot().generatedSpeech[0].sourceId, 'second');
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
// ProjectSessionContextの履歴購読まで実コードで通し、Redoでは意図せず自動再生しないことも確認する。
test('leaves Visual Module Live Preview when an imported Visual Module is undone and restores its registration on redo', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	const manager = projectSession.projectContext.stateManager;
	const visualModule = { customParameterDefs: [], customParameterValues: {}, id: 'imported', name: 'Imported Visual Module', nodes: [], paramDefs: [], outputDefs: [],
																								primaryInputId: null, primaryOutputId: null, automationGraphs: [] };
	manager.commit('importVisualModule', { visualModule, assets: [], players: [], unassignedPlayerNames: [] });
	await setImmediate();
	const visualModuleLivePreview = projectSession.visualModuleRendererManagerController;
	const timeline = projectSession.timelineRendererManagerController;
	assert.ok(visualModuleLivePreview.options.visualModules.some(entry => entry.id === 'imported'));
	assert.ok(timeline.options.visualModules.some(entry => entry.id === 'imported'));
	projectSession.previewPlayback.startVisualModuleLivePreview('imported');
	manager.undo();
	assert.equal(projectSession.previewPlayback.visualModuleLivePreviewVisualModuleId.value, null);
	assert.equal(projectSession.previewPlayback.state.value.mode, 'timeline');
	await setImmediate();
	assert.ok(!visualModuleLivePreview.options.visualModules.some(entry => entry.id === 'imported'));
	assert.ok(!timeline.options.visualModules.some(entry => entry.id === 'imported'));
	manager.redo();
	await setImmediate();
	assert.ok(visualModuleLivePreview.options.visualModules.some(entry => entry.id === 'imported'));
	assert.ok(timeline.options.visualModules.some(entry => entry.id === 'imported'));
	assert.equal(projectSession.previewPlayback.visualModuleLivePreviewVisualModuleId.value, null);
});

// 【描画設定を保存・復元し、Undo/Redoでもタイムラインだけへ同期する】
// プレビュー用の値だけが変わって保存から漏れたり、Visual Module Live Preview側のfps制限を書き換えたりしないことを保証する。
test('persists timeline render settings and recreates both previews through undo and redo', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
	const notifications = [];
	manager.onChange(changes => notifications.push(changes));
	const settings = { timelineFps: 29.97, timelineMotionBlur: { enabled: true, shutterAngle: 270, samples: 32 } };
	const visualModuleLivePreview = projectSession.visualModuleRendererManagerController;
	const timeline = projectSession.timelineRendererManagerController;
	visualModuleLivePreview.updates.length = 0;
	visualModuleLivePreview.staticUpdates.length = 0;
	timeline.staticUpdates.length = 0;
	timeline.updates.length = 0;
	manager.commit('changeTimelineRenderSettings', settings);
	await nextTick();
	await projectSession.renderEngine.retry();
	const previewSettings = { ...settings, timelineMotionBlur: { ...settings.timelineMotionBlur, samples: projectSession.timelinePreviewMotionBlurSamples.value } };
	assert.equal(timeline.staticOptions.timelineFps, 29.97);
	assert.deepEqual(timeline.staticOptions.timelineMotionBlur, previewSettings.timelineMotionBlur);
	assert.deepEqual(timeline.staticUpdates.map(options => ({ timelineFps: options.timelineFps, timelineMotionBlur: options.timelineMotionBlur })), [previewSettings]);
	assert.deepEqual(timeline.updates, [{ previewFps: settings.timelineFps * projectSession.timelinePreviewFpsFactor.value }]);
	assert.equal(visualModuleLivePreview.updates.length, 0);
	assert.ok(visualModuleLivePreview.staticUpdates.length > 0);
	manager.undo();
	await nextTick();
	await projectSession.renderEngine.retry();
	assert.equal(timeline.staticOptions.timelineFps, 60);
	assert.equal(manager.state.timelineMotionBlur.value.enabled, false);
	manager.redo();
	await nextTick();
	await projectSession.renderEngine.retry();
	assert.equal(timeline.staticOptions.timelineFps, 29.97);
	assert.equal(timeline.staticUpdates.length, 3);
	assert.deepEqual(notifications, Array.from({ length: 3 }, () => [{ type: 'timelineRenderSettings' }]));
	const handle = fileHandle('motion-blur.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await projectSession.saveProject();
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
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.isDisabled, false);
	const original = JSON.parse(JSON.stringify(layer));
	const timeline = projectSession.timelineRendererManagerController;
	projectSession.previewPlayback.seekTimeline(500);
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
	assert.equal(projectSession.previewPlayback.currentTimelineTime.value, 500);
	assert.equal(projectSession.previewPlayback.isTimelinePlaying.value, false);
	const handle = fileHandle('disabled-layer.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await projectSession.saveProject();
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
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.mask, null);
	const timeline = projectSession.timelineRendererManagerController;
	projectSession.previewPlayback.seekTimeline(500);
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
	assert.equal(projectSession.previewPlayback.currentTimelineTime.value, 500);
	const handle = fileHandle('masked-layer.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await projectSession.saveProject();
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
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
	const scene = manager.state.timelineScenes.value[0];
	const layer = scene.layers[0];
	assert.equal(layer.forceDisableMotionBlur, false);
	const timeline = projectSession.timelineRendererManagerController;
	projectSession.previewPlayback.seekTimeline(500);
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
	await projectSession.saveProject();
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
	const { projectContext } = app.projectSession;
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
	const restoredSession = await app.projectSessions.open(restored);
	const restoredSettings = restoredSession.projectContext.stateManager.state.exportSettings.value;
	assert.deepEqual(restoredSettings, snapshot.exportSettings);
	restoredSettings.customResolution.width = 1000;
	assert.equal(restored.exportSettings.customResolution.width, 513);
	assert.equal(snapshot.exportSettings.customResolution.width, 513);
	await app.newProject();
	assert.equal(app.projectSession.projectContext.stateManager.state.exportSettings.value, null);
});

// 【初回生成からプロジェクトのfps・ブラー設定とプレビュー既定の0サンプルを使う】
// プレビューのブラーは既定でオフにし、保存された書き出し用サンプル数は維持する。
// 初期化後にwatchで設定を変えると、初回表示が遅れ、読込中の動的更新も中断される。
test('uses project render settings with motion blur sampling disabled for the initial preview', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const loaded = project({ timelineFps: 24, timelineMotionBlur: { enabled: true, shutterAngle: 90, samples: 32 } });
	const projectSession = createStandaloneSession(app, loaded);
	await projectSession.start();
	const timeline = projectSession.timelineRendererManagerController;
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
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
	const settings = { timelineFps: 30, timelineMotionBlur: { enabled: true, shutterAngle: 270, samples: 32 } };
	manager.commit('changeTimelineRenderSettings', settings);
	await nextTick();
	await projectSession.renderEngine.retry();
	const historyLength = manager.undoStack.value.length;
	const timeline = projectSession.timelineRendererManagerController;
	const visualModuleLivePreview = projectSession.visualModuleRendererManagerController;
	visualModuleLivePreview.staticUpdates.length = 0;
	assert.deepEqual([...app.TIMELINE_PREVIEW_MOTION_BLUR_SAMPLE_OPTIONS], [0, 2, 4, 8]);
	for (const samples of [2, 4, 8, 0]) {
		projectSession.timelinePreviewMotionBlurSamples.value = samples;
		await nextTick();
		await projectSession.renderEngine.retry();
		assert.deepEqual(timeline.staticOptions.timelineMotionBlur, { ...settings.timelineMotionBlur, samples });
		assert.deepEqual(manager.state.timelineMotionBlur.value, settings.timelineMotionBlur);
		assert.equal(manager.undoStack.value.length, historyLength);
	}
	assert.ok(visualModuleLivePreview.staticUpdates.length > 0);
	manager.undo();
	await nextTick();
	await projectSession.renderEngine.retry();
	assert.equal(projectSession.timelinePreviewMotionBlurSamples.value, 0);
	assert.equal(timeline.staticOptions.timelineMotionBlur.enabled, false);
	manager.redo();
	await nextTick();
	await projectSession.renderEngine.retry();
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 0);
	assert.equal(manager.state.timelineMotionBlur.value.samples, 32);
	const handle = fileHandle('preview-quality.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await projectSession.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.deepEqual(saved.timelineMotionBlur, settings.timelineMotionBlur);
	assert.equal('previewSamples' in saved.timelineMotionBlur, false);
	assert.equal('timelinePreviewMotionBlurSamples' in saved, false);
	// 閉じる前にオンにしておき、新しいセッションへプレビュー設定を持ち越さないことを確認する。
	projectSession.timelinePreviewMotionBlurSamples.value = 4;
	await nextTick();
	await projectSession.renderEngine.retry();
	assert.equal(timeline.staticOptions.timelineMotionBlur.samples, 4);
	await app.projectSessions.close(projectSession);
	const restoredSession = await app.projectSessions.open(decodeProjectFile(handle.bytes), handle.name, handle);
	assert.equal(restoredSession.timelinePreviewMotionBlurSamples.value, 0);
	assert.equal(restoredSession.timelineRendererManagerController.staticOptions.timelineMotionBlur.samples, 0);
	assert.equal(restoredSession.projectContext.stateManager.state.timelineMotionBlur.value.samples, 32);
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
	await app.newProject();
	const { projectSession } = app;
	t.after(() => projectSession.previewPlayback.dispose());
	projectSession.timelineRendererManagerController.staticUpdates.length = 0;
	const measure = (factor, visualModuleLivePreviewFpsLimit) => {
		projectSession.previewPlayback.pauseTimeline();
		projectSession.previewPlayback.seekTimeline(0);
		projectSession.timelinePreviewFpsFactor.value = factor;
		projectSession.visualModuleLivePreviewFpsLimit.value = visualModuleLivePreviewFpsLimit;
		projectSession.previewPlayback.playTimeline();
		const timeline = projectSession.timelineRendererManagerController;
		timeline.renders.length = 0;
		for (let time = 0; time <= 1000; time++) {
			projectSession.timelineAudioPreview.time = time;
			const [id, callback] = callbacks.entries().next().value;
			callbacks.delete(id);
			callback(time);
		}
		const count = timeline.renders.length;
		assert.ok(projectSession.previewPlayback.currentTimelineTime.value >= 1000 - 1000 / (60 * factor) - 1);
		projectSession.previewPlayback.pauseTimeline();
		return count;
	};
	for (const factor of [0.5, 1, 2]) {
		const limited = measure(factor, 1);
		const unlimited = measure(factor, null);
		assert.equal(limited, unlimited);
		assert.ok(Math.abs(limited - 60 * factor) <= 1, `factor ${factor}: ${limited}`);
	}
	assert.equal(projectSession.projectContext.stateManager.state.timelineFps.value, 60);
	await nextTick();
	assert.equal(projectSession.timelineRendererManagerController.staticUpdates.length, 0);
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
		async isSameEntry(other) { return other === this; },
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

// 【生成直後から保存状態を判定し、起動前の編集を保存済みにしない】
// 新規作成とFileだけで開いた状態は、どちらも保存先がなくても未保存判定が異なる。
// プレビューの起動時に比較基準を取り直すと、その前に行われた編集が保存済みになってしまう。
test('initializes save state at construction and preserves unsaved edits across startup', async t => {
	for (const source of ['new project', 'file only', 'file handle']) {
		await t.test(source, async t => {
			let projectSession = null;
			t.after(() => projectSession?.dispose());
			setup(t);
			const handle = source === 'file handle' ? fileHandle('opened.gsproj') : null;
			const fileName = source === 'new project' ? null : 'opened.gsproj';
			({ projectSession } = evaluateSession(project({ name: 'Initial content' }), { fileName, fileHandle: handle }));
			assert.equal(projectSession.projectFileName.value, fileName);
			assert.equal(projectSession.projectFileHandle.value, handle);
			assert.equal(projectSession.projectBackupAccess.value, handle == null ? 'unsaved' : 'folder-required');
			assert.equal(projectSession.hasUnsavedChanges.value, source === 'new project');
			const state = projectSession.projectContext.stateManager.state;
			state.name.value = 'Edited before startup';
			assert.equal(projectSession.hasUnsavedChanges.value, true);
			await projectSession.start();
			assert.equal(projectSession.hasUnsavedChanges.value, true);
			state.name.value = 'Initial content';
			assert.equal(projectSession.hasUnsavedChanges.value, source === 'new project');
		});
	}
});

// 【プレビューの起動前でも保存でき、起動によって確定済みの保存先を戻さない】
// ファイル名だけで読み込んだ場合は、その名前を初回保存の候補に使う。
// 保存管理を生成時に完成させ、起動時に保存先や保存済み状態を設定し直さないことを確認する。
test('saves before preview startup using the loaded file name and retains the committed target', async t => {
	let projectSession = null;
	t.after(() => projectSession?.dispose());
	const window = setup(t);
	const handle = fileHandle('chosen.gsproj');
	window.selectProjectSaveFile = async name => { assert.equal(name, 'loaded.gsproj'); return handle; };
	({ projectSession } = evaluateSession(project(), { fileName: 'loaded.gsproj' }));
	projectSession.projectContext.stateManager.state.name.value = 'Saved before startup';
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	await projectSession.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'Saved before startup');
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	await projectSession.start();
	assert.equal(projectSession.projectFileHandle.value, handle);
	assert.equal(projectSession.projectFileName.value, handle.name);
	assert.equal(projectSession.hasUnsavedChanges.value, false);
});

// 【起動前のバックアップを有効にし、起動せず終了した場合も予約と未保存表示を解除する】
// 保存先の設定時点からバックアップが動くため、プレビュー未起動のセッションも終了処理の対象になる。
// 未保存判定を一度読み取ってから終了し、編集状態の変更なしで表示が更新されることも確認する。
test('backs up before preview startup and clears timers and unsaved state on disposal', async t => {
	let projectSession = null;
	t.after(() => projectSession?.dispose());
	const window = setup(t);
	window.initialTestPreferences = { projectBackupAutoEnabled: true };
	const timers = new Set();
	let nextTimer = 0;
	window.setTimeout = () => { const timer = ++nextTimer; timers.add(timer); return timer; };
	window.clearTimeout = timer => { timers.delete(timer); };
	const backups = [];
	window.desktop = {
		async listProjectBackups() { return []; },
		async writeProjectBackup(id, _name, data) { backups.push({ id, project: decodeProjectFile(data) }); return true; },
	};
	let now = Date.now();
	t.mock.method(Date, 'now', () => now);
	const handle = desktopProjectFile({ id: 'backup-source', name: 'backup-source.gsproj' });
	({ projectSession } = evaluateSession(project(), { fileHandle: handle }));
	assert.equal(projectSession.projectFileName.value, handle.name);
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	assert.equal(projectSession.projectBackupAccess.value, 'ready');
	assert.equal(timers.size, 1);
	projectSession.projectContext.stateManager.state.name.value = 'Before startup';
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	now += 60001;
	await projectSession.projectBackupController.tick();
	assert.equal(backups.length, 1);
	assert.equal(backups[0].id, handle.id);
	assert.equal(backups[0].project.name, 'Before startup');
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	assert.equal(projectSession.visualModuleRendererManagerController.isReady.value, false);
	const closing = projectSession.dispose();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	assert.equal(timers.size, 0);
	await closing;
	window.testPreferences.projectBackupAutoIntervalMinutes = 2;
	await nextTick();
	now += 120001;
	await projectSession.projectBackupController.tick();
	assert.equal(timers.size, 0);
	assert.equal(backups.length, 1);
});

// 【Save as中に追加したSaveは、確定後の新しい保存先へ書き込む】
// 保存の呼出時に旧ハンドルを固定すると、待機中のSaveが元ファイルを上書きし、現在の保存先まで戻してしまう。
// 追加編集を含むSaveを失わず、新しい保存先とその後の保存先がともにBになることを確認する。
test('resolves queued Save against the destination committed by Save as', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const original = await encodeProjectFile(project({ name: 'Original A' }));
	const first = fileHandle('A.gsproj', { bytes: original });
	const projectSession = createStandaloneSession(app, project({ name: 'Save as snapshot' }), { fileName: first.name, fileHandle: first });
	const second = fileHandle('B.gsproj');
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = second.createWritable;
	second.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
	};
	await projectSession.start();
	window.selectProjectSaveFile = async () => second;
	const saveAs = projectSession.saveProject(true);
	await started.promise;
	projectSession.projectContext.stateManager.state.name.value = 'Queued Save snapshot';
	const save = projectSession.saveProject();
	finish.resolve();
	await Promise.all([saveAs, save]);
	assert.deepEqual(first.bytes, original);
	assert.equal(decodeProjectFile(second.bytes).name, 'Queued Save snapshot');
	const savedId = decodeProjectFile(second.bytes).id;
	assert.notEqual(savedId, 'project-id');
	assert.equal(projectSession.projectContext.snapshot().id, savedId);
	projectSession.projectContext.stateManager.state.name.value = 'Next Save';
	await projectSession.saveProject();
	assert.deepEqual(first.bytes, original);
	assert.equal(decodeProjectFile(second.bytes).name, 'Next Save');
	assert.equal(decodeProjectFile(second.bytes).id, savedId);
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【Save asがキャンセル・失敗した場合、待機中のSaveは以前の保存先を使う】
// キューに登録した時点で新しい保存先へ切り替えると、未確定のファイルへ後続の保存が流れる。
// セッションを閉じた場合は、選択待ち・キュー待ちの保存を実行せず後処理だけ完了させる。
test('keeps the committed destination after cancelled or failed Save as and discards saves after disposal', async t => {
	for (const outcome of ['cancel', 'failure', 'close']) {
		await t.test(outcome, async t => {
			const window = setup(t);
			const app = evaluate(appBundle);
			const first = fileHandle('A.gsproj');
			const projectSession = createStandaloneSession(app, project(), { fileName: first.name, fileHandle: first });
			const second = fileHandle('B.gsproj', { fail: 'write' });
			const started = Promise.withResolvers();
			const finish = Promise.withResolvers();
			window.selectProjectSaveFile = async () => { started.resolve(); await finish.promise; return outcome === 'cancel' ? null : second; };
			await projectSession.start();
			const original = first.bytes;
			const saveAs = projectSession.saveProject(true);
			await started.promise;
			projectSession.projectContext.stateManager.state.name.value = 'Queued edit';
			const save = projectSession.saveProject();
			const closing = outcome === 'close' ? projectSession.dispose() : Promise.resolve();
			finish.resolve();
			await Promise.all([saveAs, save, closing]);
			assert.deepEqual(second.bytes, new Uint8Array([42]));
			if (outcome === 'close') assert.equal(first.bytes, original);
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
			const first = fileHandle('A.gsproj', { permission: allowed ? 'denied' : 'granted' });
			const projectSession = createStandaloneSession(app, project({ name: 'Save as' }), { fileName: first.name, fileHandle: first });
			const second = fileHandle('B.gsproj', { permission: allowed ? 'granted' : 'denied' });
			const started = Promise.withResolvers();
			const finish = Promise.withResolvers();
			window.selectProjectSaveFile = async () => { started.resolve(); await finish.promise; return second; };
			await projectSession.start();
			const saveAs = projectSession.saveProject(true);
			await started.promise;
			projectSession.projectContext.stateManager.state.name.value = 'Queued Save';
			const save = projectSession.saveProject();
			finish.resolve();
			await Promise.all([saveAs, save]);
			assert.deepEqual(first.bytes, new Uint8Array([42]));
			assert.equal(decodeProjectFile(second.bytes).name, allowed ? 'Queued Save' : 'Save as');
			assert.equal(globalThis.projectAlerts.length, allowed ? 0 : 1);
		});
	}
});

function setup(t) {
	const previousWindow = globalThis.window;
	const previousAlerts = globalThis.projectAlerts;
	// appのキーボード登録だけ受け取り、実際のDOMやイベントループは使わない。
	globalThis.window = {
		waitingCount: 0,
		document: { title: '', addEventListener() {}, removeEventListener() {} },
		listeners: new Map(),
		addEventListener(type, handler) { const handlers = this.listeners.get(type) ?? new Set(); handlers.add(handler); this.listeners.set(type, handlers); },
		removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); },
		setTimeout() { return 1; }, clearTimeout() {},
		// 旧APIに戻すと、保存先選択だけで既存データが失われる。新経路では一切呼び出さない。
		showSaveFilePicker() { assert.fail('The destructive save picker must not be used'); },
	};
	globalThis.projectAlerts = [];
	t.after(() => { globalThis.window = previousWindow; globalThis.projectAlerts = previousAlerts; });
	return globalThis.window;
}

// 【開く・新規作成では未保存の作品を維持し、閉じるときだけ破棄を確認する】
// タブ追加に単一プロジェクト時代の置換確認を残すと、他の作品を開くだけで編集内容が失われる。
test('opens additional projects without discarding unsaved edits and confirms tab closing', async t => {
	const window = setup(t);
	window.projectConfirmations = [];
	const app = evaluate(appBundle);
	const first = await app.newProject();
	first.projectContext.stateManager.state.name.value = 'Keep this project';
	window.cancelProjectReplacement = true;
	await app.newProject();
	assert.equal(first.projectContext.snapshot().name, 'Keep this project');
	const file = new File([new Uint8Array(await encodeProjectFile(project()))], 'other.gsproj');
	assert.equal(await app.openProject(file), true);
	assert.equal(app.projectSessions.sessions.value.length, 3);
	assert.equal(window.projectConfirmations.length, 0);
	assert.equal(await app.projectSessions.close(first), false);
	assert.equal(first.isDisposed, false);
	window.cancelProjectReplacement = false;
	assert.equal(await app.projectSessions.close(first), true);
	assert.equal(first.isDisposed, true);
	assert.equal(app.projectSessions.sessions.value.length, 2);
	await app.disposeApplication();
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
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
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
	await projectSession.saveProject();
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
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
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
		await projectSession.saveProject();
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
	assert.equal(app.projectSession.projectContext.stateManager.state.assets.value[0].sourceFilePath, path);
	const handle = fileHandle('from-image.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await app.projectSession.saveProject();
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
	const manager = app.projectSession.projectContext.stateManager;
	assert.deepEqual({ ...manager.state.resolution.value }, { width: 640, height: 360 });
	assert.equal(manager.state.assets.value[0].sourceFilePath, filePath);
	assert.equal(manager.state.assets.value[0].fileDataType, 'image/png');
	assert.equal(manager.state.visualModules.value[0].nodes.find(node => node.type === 'effect').effectId, 'image');
	const handle = fileHandle('from-os-image.gsproj');
	let saveSelections = 0;
	window.selectProjectSaveFile = async () => { saveSelections++; return handle; };
	await app.projectSession.saveProject();
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
	const projectSession = createStandaloneSession(app, project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	projectSession.projectContext.stateManager.state.assets.value = [{ id: 'asset', name: 'missing.png', fileData: new UnreadableBlob() }];
	window.selectProjectSaveFile = () => assert.fail('No target should be selected after an encoding failure');
	await projectSession.saveProject(true);
	assert.deepEqual(handle.calls, []);
	await projectSession.saveProject();
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }]]);
	assert.equal(handle.bytes, original);
	assert.equal(globalThis.projectAlerts.length, 2);
	assert.ok(globalThis.projectAlerts.every(message => message.includes('missing.png')));
	await assert.rejects(encodeProjectFile(project({ assets: projectSession.projectContext.stateManager.state.assets.value })), error => error.cause === cause);
});

// 【保存先選択前に準備を完了し、ダイアログ表示中の編集を保存内容へ混入させない】
// 非同期の素材読込とユーザー操作を挟んでも、保存開始時点の状態を一貫して書き出す。
test('prepares a complete snapshot before selecting a Save as target', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const { projectSession } = app;
	let read = false;
	class TrackedBlob extends Blob {
		async arrayBuffer() { read = true; return super.arrayBuffer(); }
	}
	projectSession.projectContext.stateManager.state.name.value = 'Snapshot';
	projectSession.projectContext.stateManager.state.assets.value = [{ id: 'asset', name: 'snapshot.png', fileData: new TrackedBlob(['original']) }];
	const handle = fileHandle('snapshot.gsproj');
	window.selectProjectSaveFile = async name => {
		assert.equal(name, 'untitled.gsproj');
		assert.equal(read, true);
		projectSession.projectContext.stateManager.state.name.value = 'Later edit';
		projectSession.projectContext.stateManager.state.assets.value = [];
		return handle;
	};
	await projectSession.saveProject(true);
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
	const projectSession = createStandaloneSession(app, project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	await projectSession.saveProject();
	assert.deepEqual(handle.calls, [['permission', { mode: 'readwrite' }]]);
	assert.equal(handle.bytes, original);
	assert.equal(globalThis.projectAlerts.length, 1);
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
	const handle = fileHandle('saving.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
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
	assert.equal(projectSession.isProjectSaving.value, false);
	const firstSave = projectSession.saveProject();
	assert.equal(projectSession.isProjectSaving.value, true);
	permission.resolve('granted');
	await writes[0].started.promise;
	const secondSave = projectSession.saveProject();
	writes[0].finish.resolve();
	await firstSave;
	assert.equal(projectSession.isProjectSaving.value, true);
	await writes[1].started.promise;
	assert.equal(projectSession.isProjectSaving.value, true);
	writes[1].finish.resolve();
	await secondSave;
	assert.equal(projectSession.isProjectSaving.value, false);
});

// 【エンコード中の保存も保護し、セッション終了による失効で保存中状態を残さない】
// 大きな素材の読み出しは書き込み前にも待機する。セッションが終了した場合は
// 古い要求が書き込みを行わずに完了し、表示と終了防止を解除する必要がある。
test('tracks encoding and releases a save invalidated by session disposal', async t => {
	setup(t);
	const encodingStarted = Promise.withResolvers();
	const finishEncoding = Promise.withResolvers();
	class DelayedBlob extends Blob {
		async arrayBuffer() { encodingStarted.resolve(); await finishEncoding.promise; return super.arrayBuffer(); }
	}
	const handle = fileHandle('encoding.gsproj');
	const { projectSession } = evaluateSession(project({ assets: [{ id: 'asset', name: 'image.png', fileData: new DelayedBlob(['image']) }] }),
		{ fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	const saving = projectSession.saveProject();
	await encodingStarted.promise;
	assert.equal(projectSession.isProjectSaving.value, true);
	const closing = projectSession.dispose();
	assert.equal(projectSession.isProjectSaving.value, true);
	finishEncoding.resolve();
	await Promise.all([saving, closing]);
	assert.equal(projectSession.isProjectSaving.value, false);
	assert.equal(handle.calls.some(([action]) => action === 'create'), false);
});

// 【保存先のキャンセルと保存失敗で保存中状態を解除する】
// 早期returnや例外でカウンターが残ると、その後ずっと終了できなくなる。
// 失敗ダイアログの確認待ち中にも「保存中」と表示し続けないことを確認する。
test('releases manual saving after cancellation and before acknowledging a write failure', async t => {
	const window = setup(t);
	t.mock.method(console, 'error', () => {});
	const app = evaluate(appBundle);
	await app.newProject();
	const { projectSession } = app;
	const selectionStarted = Promise.withResolvers();
	const selection = Promise.withResolvers();
	window.selectProjectSaveFile = () => { selectionStarted.resolve(); return selection.promise; };
	const canceledSave = projectSession.saveProject();
	await selectionStarted.promise;
	assert.equal(projectSession.isProjectSaving.value, true);
	selection.resolve(null);
	await canceledSave;
	assert.equal(projectSession.isProjectSaving.value, false);
	const handle = fileHandle('failure.gsproj', { fail: 'write' });
	window.selectProjectSaveFile = async () => handle;
	const alertShown = Promise.withResolvers();
	const acknowledged = Promise.withResolvers();
	window.acknowledgeProjectAlert = () => { alertShown.resolve(); return acknowledged.promise; };
	const failedSave = projectSession.saveProject();
	await alertShown.promise;
	assert.deepEqual(globalThis.projectAlerts, ['write failed']);
	assert.equal(projectSession.isProjectSaving.value, false);
	acknowledged.resolve();
	await failedSave;
	assert.equal(projectSession.isProjectSaving.value, false);
});

// 【自動バックアップ単独では手動保存中とせず、そこに待機する手動保存は保護する】
// 共通キュー全体を保存中として扱うと、定期バックアップで突然終了できなくなる。
// 一方、バックアップの後ろで待つ手動保存は、受付時点から保護する必要がある。
test('distinguishes automatic backups from manual saves queued behind them', async t => {
	const window = setup(t);
	const handle = fileHandle('automatic.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	window.testPreferences.projectBackupAutoEnabled = true;
	await nextTick();
	const backupStarted = Promise.withResolvers();
	const finishBackup = Promise.withResolvers();
	projectSession.projectBackupController.setTarget({ name: handle.name, directory: {
		async hasPermission() { return true; },
		async list() { return []; },
		async create() { backupStarted.resolve(); await finishBackup.promise; return true; },
		async remove() {},
	} });
	const now = Date.now();
	t.mock.method(Date, 'now', () => now + 60001);
	const backingUp = projectSession.projectBackupController.tick();
	await backupStarted.promise;
	assert.equal(projectSession.isProjectSaving.value, false);
	const saving = projectSession.saveProject();
	assert.equal(projectSession.isProjectSaving.value, true);
	finishBackup.resolve();
	await Promise.all([backingUp, saving]);
	assert.equal(projectSession.isProjectSaving.value, false);
});

// 【手動保存した内容と比較し、履歴操作と履歴外の変更を反映する】
// 履歴数だけの判定では、保存時に戻るUndoや、履歴を増やさない連続編集・メタデータ編集を扱えない。
// 素材のBlobを変更検出のために読み出さず、プレビューの操作だけでは未保存にしないことも確認する。
test('tracks unsaved content across undo, redo, continuous edits and direct changes', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	assert.equal(app.projectSessions.hasUnsavedChanges.value, false);
	await app.newProject();
	const { projectSession } = app;
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	const handle = fileHandle('saved.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await projectSession.saveProject();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	const manager = projectSession.projectContext.stateManager;
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'unsaved-node' });
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	manager.undo();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	manager.redo();
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	await projectSession.saveProject();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	manager.undo();
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	manager.redo();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	const edit = manager.beginEdit('changeTimelineRenderSettings');
	edit.update({ timelineFps: 30, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 8 } });
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	edit.cancel();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	for (const key of ['name', 'description', 'author']) {
		const saved = manager.state[key].value;
		manager.state[key].value = 'Direct edit';
		assert.equal(projectSession.hasUnsavedChanges.value, true);
		manager.state[key].value = saved;
		assert.equal(projectSession.hasUnsavedChanges.value, false);
	}
	projectSession.resolutionFactor.value = 0.5;
	projectSession.timelinePreviewMotionBlurSamples.value = 4;
	await nextTick();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	class UnreadableBlob extends Blob {
		async arrayBuffer() { assert.fail('Change detection must not read asset bytes'); }
	}
	manager.state.assets.value.push({ id: 'new-asset', name: 'image.png', fileData: new UnreadableBlob(['image']) });
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	manager.state.assets.value.pop();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	const file = new File([handle.bytes], handle.name);
	await app.openProject(file);
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	assert.equal(projectSession.projectFileName.value, handle.name);
	await app.newProject();
	assert.equal(app.projectSession.hasUnsavedChanges.value, true);
});

// 【保存完了前の編集と、別セッションの変更を保存済みにしない】
// 本体のcloseを待つ間にも操作できるため、成功時の現在値ではなく実際に書いた内容を基準にする。
// 同じProject IDを持つ別セッションを作成しても、終了した側の保存結果を採用しない。
test('keeps edits during writes unsaved and isolates saves completed after session disposal', async t => {
	for (const closeSession of [false, true]) {
		await t.test(closeSession ? 'closed session' : 'open session', async t => {
			const window = setup(t);
			const app = evaluate(appBundle);
			const projectSession = await app.newProject();
			const handle = fileHandle('slow.gsproj');
			window.selectProjectSaveFile = async () => handle;
			const started = Promise.withResolvers();
			const finish = Promise.withResolvers();
			const createWritable = handle.createWritable;
			handle.createWritable = async () => {
				const stream = await createWritable();
				return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
			};
			const snapshot = projectSession.projectContext.snapshot();
			const save = projectSession.saveProject();
			await started.promise;
			const closing = closeSession ? projectSession.dispose() : Promise.resolve();
			let editingSession = projectSession;
			if (closeSession) {
				editingSession = createStandaloneSession(app, { ...snapshot, name: 'Reopened' }, { fileName: 'another.gsproj' });
				await editingSession.start();
			}
			editingSession.projectContext.stateManager.state.name.value = 'Edited while saving';
			finish.resolve();
			await Promise.all([save, closing]);
			assert.equal(editingSession.hasUnsavedChanges.value, true);
			assert.equal(decodeProjectFile(handle.bytes).name, snapshot.name);
			editingSession.projectContext.stateManager.state.name.value = closeSession ? 'Reopened' : snapshot.name;
			assert.equal(editingSession.hasUnsavedChanges.value, false);
			if (closeSession) {
				assert.equal(editingSession.projectFileName.value, 'another.gsproj');
				assert.equal(editingSession.projectFileHandle.value, null);
			}
			await editingSession.dispose();
			await app.disposeApplication();
		});
	}
});

// プロジェクト情報の編集を保存し、再読込時に復元する。Undo履歴には追加しない。
// メタデータ編集でRedoが消えたり、タイトルだけ変わって保存内容が古いままになることを防ぐ。
test('saves editable project information, updates the title and preserves undo history', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const { projectSession } = app;
	const manager = projectSession.projectContext.stateManager;
	assert.deepEqual([manager.state.name.value, manager.state.description.value, manager.state.author.value], ['Untitled Project', '', '']);
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'added-node' });
	manager.undo();
	const undoCount = manager.undoStack.value.length;
	const redoCount = manager.redoStack.value.length;
	manager.state.name.value = 'Edited Project';
	manager.state.description.value = 'Description\n説明';
	manager.state.author.value = 'Alice';
	await nextTick();
	assert.ok(window.document.title.includes('Edited Project'));
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.equal(manager.redoStack.value.length, redoCount);
	manager.redo();
	assert.equal(projectSession.projectContext.stateManager.state.name.value, 'Edited Project');
	const handle = fileHandle('saved.gsproj');
	window.selectProjectSaveFile = async () => handle;
	await projectSession.saveProject();
	const saved = decodeProjectFile(handle.bytes);
	assert.equal(saved.name, 'Edited Project');
	assert.equal(saved.description, 'Description\n説明');
	assert.equal(saved.author, 'Alice');
	await app.newProject();
	assert.equal(app.projectSession.projectContext.stateManager.state.name.value, 'Untitled Project');
	window.showOpenFilePicker = async () => [handle];
	assert.equal(await app.openProject(), true);
	assert.deepEqual([manager.state.name.value, manager.state.description.value, manager.state.author.value], [saved.name, saved.description, saved.author]);
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【Save asが成功したときだけ保存先とプロジェクトIDを切り替える】
// キャンセルやディスク書込失敗で保存先が変わると、以後意図しないファイルを上書きしてしまう。
// 次の保存候補名も確定した保存先に追従させ、キャンセル・失敗した名前を引き継がない。
test('changes the Save target only after a successful Save as', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	await app.newProject();
	const { projectSession } = app;
	const original = fileHandle('original.gsproj');
	const copy = fileHandle('copy.gsproj');
	window.selectProjectSaveFile = async name => { assert.equal(name, 'untitled.gsproj'); return original; };
	await projectSession.saveProject();
	const originalId = projectSession.projectContext.snapshot().id;
	window.selectProjectSaveFile = async name => { assert.equal(name, original.name); return null; };
	projectSession.projectContext.stateManager.state.name.value = 'Before cancellation';
	await projectSession.saveProject(true);
	assert.equal(projectSession.projectContext.snapshot().id, originalId);
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	projectSession.projectContext.stateManager.state.name.value = 'After cancellation';
	await projectSession.saveProject();
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	assert.equal(decodeProjectFile(original.bytes).name, 'After cancellation');
	const failed = fileHandle('failed.gsproj', { fail: 'write' });
	window.selectProjectSaveFile = async name => { assert.equal(name, original.name); return failed; };
	projectSession.projectContext.stateManager.state.name.value = 'Before failure';
	await projectSession.saveProject(true);
	assert.equal(projectSession.projectContext.snapshot().id, originalId);
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	projectSession.projectContext.stateManager.state.name.value = 'After failure';
	await projectSession.saveProject();
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
	assert.deepEqual(globalThis.projectAlerts, ['write failed']);
	window.selectProjectSaveFile = async name => { assert.equal(name, original.name); return copy; };
	await projectSession.saveProject(true);
	const copyId = projectSession.projectContext.snapshot().id;
	assert.notEqual(copyId, originalId);
	assert.equal(decodeProjectFile(copy.bytes).id, copyId);
	assert.equal(decodeProjectFile(original.bytes).id, originalId);
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	window.selectProjectSaveFile = () => assert.fail('Save should reuse the new target');
	projectSession.projectContext.stateManager.state.name.value = 'After Save as';
	await projectSession.saveProject();
	assert.equal(decodeProjectFile(copy.bytes).name, 'After Save as');
	assert.equal(decodeProjectFile(copy.bytes).id, copyId);
	assert.equal(decodeProjectFile(original.bytes).name, 'After failure');
	window.selectProjectSaveFile = async name => { assert.equal(name, copy.name); return null; };
	await projectSession.saveProject(true);
	assert.equal(projectSession.projectFileName.value, copy.name);
});

// 【別名保存中の編集を残し、Undo/RedoでプロジェクトIDを巻き戻さない】
// 保存成功時に再読込すると保存中の編集と履歴が消える。新IDだけを採用し、
// 保存したスナップショットと異なる編集は未保存として残ることを確認する。
test('adopts the saved identity while preserving concurrent edits and undo history', async t => {
	const window = setup(t);
	const original = fileHandle('original.gsproj');
	const copy = fileHandle('copy.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: original.name, fileHandle: original });
	await projectSession.start();
	const manager = projectSession.projectContext.stateManager;
	manager.commit('changeProjectResolution', { width: 800, height: 600 });
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = copy.createWritable;
	copy.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
	};
	window.selectProjectSaveFile = async () => copy;
	const saveAs = projectSession.saveProject(true);
	await started.promise;
	manager.commit('changeProjectResolution', { width: 1024, height: 768 });
	finish.resolve();
	await saveAs;
	const savedId = decodeProjectFile(copy.bytes).id;
	assert.notEqual(savedId, 'project-id');
	assert.equal(projectSession.projectContext.snapshot().id, savedId);
	assert.deepEqual(manager.state.resolution.value, { width: 1024, height: 768 });
	assert.deepEqual(decodeProjectFile(copy.bytes).resolution, { width: 800, height: 600 });
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	manager.undo();
	assert.deepEqual(manager.state.resolution.value, { width: 800, height: 600 });
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	manager.undo();
	assert.equal(projectSession.projectContext.snapshot().id, savedId);
	manager.redo();
	manager.redo();
	assert.deepEqual(manager.state.resolution.value, { width: 1024, height: 768 });
	assert.equal(projectSession.projectContext.snapshot().id, savedId);
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
	await app.projectSession.saveProject();
	await app.recentProjects.refresh();
	assert.equal(recorded.length, 2);
	failWrite = true;
	await app.projectSession.saveProject();
	await app.recentProjects.refresh();
	assert.equal(recorded.length, 2);
	failWrite = false;
	failHistory = true;
	assert.equal(await app.openProject(), true);
	assert.equal(app.recentProjects.error.value, 'History storage full');
	app.projectSession.projectContext.stateManager.state.name.value = 'Saved despite history failure';
	await app.projectSession.saveProject();
	await setImmediate();
	assert.equal(app.projectSession.hasUnsavedChanges.value, false);
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
	await app.newProject();
	const { projectSession } = app;
	const first = fileHandle('first.gsproj');
	window.selectProjectSaveFile = async () => first;
	await projectSession.saveProject();
	const savedBytes = first.bytes;
	await app.newProject();
	const second = fileHandle('second.gsproj');
	let pickerCalls = 0;
	window.selectProjectSaveFile = async () => { pickerCalls++; return second; };
	await app.projectSession.saveProject();
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
	const { projectSession } = app;
	projectSession.projectContext.stateManager.state.name.value = 'Current project';
	const currentHandle = fileHandle('current.gsproj');
	window.selectProjectSaveFile = async () => currentHandle;
	await projectSession.saveProject();
	const manager = projectSession.projectContext.stateManager;
	manager.commit('addEffectNode', { visualModuleId: manager.state.visualModules.value[0].id, effectId: 'fill', id: 'keep-node' });
	const modules = manager.state.visualModules.value;
	const undoCount = manager.undoStack.value.length;
	const future = project({ gsVersion: '2.0.0', name: 'Future project' });
	const futureHandle = fileHandle('future.gsproj', { bytes: await encodeProjectFile(future) });
	window.showOpenFilePicker = async () => [futureHandle];
	assert.equal(await app.openProject(), false);
	assert.equal(projectSession.projectContext.stateManager.state.name.value, 'Current project');
	assert.equal(manager.state.visualModules.value, modules);
	assert.equal(manager.undoStack.value.length, undoCount);
	assert.ok(window.document.title.includes('Current project'));
	assert.equal(globalThis.projectAlerts.length, 1);
	window.selectProjectSaveFile = () => assert.fail('The existing Save target must be retained');
	await projectSession.saveProject();
	assert.equal(decodeProjectFile(currentHandle.bytes).name, 'Current project');
	assert.equal(decodeProjectFile(futureHandle.bytes).name, 'Future project');
});

// 【プレビューには元の解像度と倍率を分けて渡し、小型プロジェクトでは倍率を戻す】
// Controllerへ縮小済みの寸法を渡すと、レンダラーで再び倍率が掛かってしまう。
// プロジェクトごとに新しいセッションを初期化し、前のセッションの倍率を持ち越さないことを確認する。
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
		assert.equal(app.projectSession.resolutionFactor.value, factor);
		for (const controller of [app.projectSession.visualModuleRendererManagerController, app.projectSession.timelineRendererManagerController]) {
			assert.deepEqual(controller.options.resolution, resolution);
			assert.equal(controller.options.resolutionScale, factor);
		}
		assert.deepEqual(app.projectSession.projectContext.stateManager.state.resolution.value, resolution);
	}
	for (const controller of [app.projectSession.visualModuleRendererManagerController, app.projectSession.timelineRendererManagerController]) {
		// 別セッションでも、そのプロジェクトの基準寸法からエンジンを初期化する。
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
	const first = project({ visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'first', nodes: [], paramDefs: [] }] });
	const projectSession = createStandaloneSession(app, first);
	await projectSession.start();
	const visualModuleLivePreview = projectSession.visualModuleRendererManagerController;
	const timeline = projectSession.timelineRendererManagerController;
	assert.equal(projectSession.activePreviewRenderer.value, visualModuleLivePreview);
	assert.deepEqual(visualModuleLivePreview.options.visualModules, first.visualModules);
	assert.deepEqual(timeline.options.visualModules, first.visualModules);
	assert.equal('timelineScenes' in visualModuleLivePreview.options, false);
	projectSession.previewPlayback.seekTimeline(500);
	assert.equal(projectSession.activePreviewRenderer.value, timeline);
	timeline.renders.length = 0;
	projectSession.projectContext.stateManager.commit('addTimelineLayer', { sceneId: 'scene', layer: { id: 'layer', layerType: 'visualModule', visualModuleId: 'first', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] } });
	await nextTick();
	await setImmediate();
	assert.equal('timelineScenes' in visualModuleLivePreview.options, false);
	assert.equal(timeline.options.timelineScenes[0].layers[0].id, 'layer');
	assert.deepEqual(timeline.patches.at(-1).map(change => change.type), ['layer', 'layerOrder']);
	assert.equal(visualModuleLivePreview.patches.length, 0);
	assert.deepEqual(timeline.renders, [500]);
	projectSession.highlightClipping.value = true;
	await nextTick();
	await setImmediate();
	assert.equal(visualModuleLivePreview.options.highlightClipping, true);
	assert.equal(timeline.options.highlightClipping, true);
	assert.equal(timeline.renders.at(-1), 500);
	const snapshotBeforeExposure = projectSession.projectContext.snapshot();
	const initializationsBeforeExposure = [visualModuleLivePreview, timeline].map(controller => controller.lifecycle.filter(event => event === 'initialize').length);
	// 判定対象だけの変更も両Workerへ同期し、停止中の表示・作品・既存の描画資源を保つ。
	for (const imageSource of ['previewAdjusted', 'original']) {
		projectSession.previewWarningImageSource.value = imageSource;
		await nextTick();
		await setImmediate();
		for (const [index, controller] of [visualModuleLivePreview, timeline].entries()) {
			assert.equal(controller.options.previewWarningImageSource, imageSource);
			assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, initializationsBeforeExposure[index]);
		}
		assert.equal(timeline.renders.at(-1), 500);
		assert.deepEqual(projectSession.projectContext.snapshot(), snapshotBeforeExposure);
	}
	// 色域と範囲を独立して同期し、範囲だけの変更でも作品やWorkerを作り直さない。
	for (const referenceGamut of ['srgb', 'displayP3', 'rec2020', 'adobeRgb', 'acescg']) {
		for (const enabled of [true, false]) {
			for (const bounds of ['unit', 'nonNegative']) {
				projectSession.previewGamutWarning.value = { enabled, referenceGamut, bounds };
				await nextTick();
				await setImmediate();
				for (const [index, controller] of [visualModuleLivePreview, timeline].entries()) {
					assert.deepEqual(controller.options.previewGamutWarning, { enabled, referenceGamut, bounds });
					assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, initializationsBeforeExposure[index]);
				}
				assert.equal(timeline.renders.at(-1), 500);
				assert.deepEqual(projectSession.projectContext.snapshot(), snapshotBeforeExposure);
			}
		}
	}
	projectSession.previewExposure.value = -2;
	await nextTick();
	await setImmediate();
	for (const [index, controller] of [visualModuleLivePreview, timeline].entries()) {
		assert.equal(controller.options.previewExposure, -2);
		assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, initializationsBeforeExposure[index]);
	}
	assert.equal(timeline.renders.at(-1), 500);
	assert.deepEqual(projectSession.projectContext.snapshot(), snapshotBeforeExposure);
	// 色域圧縮も表示だけの変更であり、両Workerへ同期しても作品や描画資源を変更しない。
	for (const mode of ['displayP3', 'rec2020', 'adobeRgb', 'acescg', 'custom', 'none']) {
		projectSession.previewGamutCompression.value = { mode, customAmount: 0.37 };
		await nextTick();
		await setImmediate();
		for (const [index, controller] of [visualModuleLivePreview, timeline].entries()) {
			assert.deepEqual(controller.options.previewGamutCompression, { mode, customAmount: 0.37 });
			assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, initializationsBeforeExposure[index]);
		}
		assert.deepEqual(projectSession.projectContext.snapshot(), snapshotBeforeExposure);
	}
	// sRGB確認は両Workerへ同期し、圧縮設定・作品・初期化回数を保持したまま元へ戻せる。
	const compressionBeforeProof = { ...projectSession.previewGamutCompression.value };
	for (const enabled of [true, false]) {
		projectSession.previewSrgbProof.value = enabled;
		await nextTick();
		await setImmediate();
		for (const [index, controller] of [visualModuleLivePreview, timeline].entries()) {
			assert.equal(controller.options.previewSrgbProof, enabled);
			assert.deepEqual(controller.options.previewGamutCompression, compressionBeforeProof);
			assert.equal(controller.lifecycle.filter(event => event === 'initialize').length, initializationsBeforeExposure[index]);
		}
		assert.equal(timeline.renders.at(-1), 500);
		assert.deepEqual(projectSession.projectContext.snapshot(), snapshotBeforeExposure);
	}
	await projectSession.dispose();
	const nextSession = createStandaloneSession(app);
	await nextSession.start();
	assert.deepEqual(nextSession.visualModuleRendererManagerController.options.visualModules, []);
	assert.deepEqual(nextSession.timelineRendererManagerController.options.visualModules, []);
	assert.deepEqual(nextSession.timelineRendererManagerController.options.timelineScenes[0].layers, []);
	await nextSession.dispose();
});

// 【音声に影響しない編集とUndo/Redoでは再生を中断しない】
// 映像のスライダー操作や素材名の変更で先読みPCMを破棄せず、音量・参照素材・
// ループ長が変わったときだけ音声を再生成する。実際のappの監視とコマンドを組み合わせる。
// 表示切り替えも音声レイヤーだけが音声計画を変更し、映像だけの無効化では再生を中断しない。
// 素材原本はプレビュー再生成で更新し、同値のURL入力の再代入では音声も再起動しない。
test('refreshes audio only for audio content, source files or loop duration changes', async t => {
	const window = setup(t);
	window.requestAnimationFrame = () => 1;
	window.cancelAnimationFrame = () => {};
	const app = evaluate(appBundle);
	const projectSession = createStandaloneSession(app, project({
		visualModules: [{ customParameterDefs: [], customParameterValues: {}, id: 'module', nodes: [], paramDefs: [] }],
		assets: [{ id: 'audio', name: 'sound.wav', fileData: new Blob(['audio']) }, { id: 'image', fileData: new Blob(['image']) }],
		timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
			{ id: 'visual', isDisabled: false, layerType: 'visualModule', visualModuleId: 'module', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 10000 }], visualModuleParamValues: {}, compositingParamValues: { opacity: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
			{ id: 'audio', isDisabled: false, layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 0, sourceInMs: 0, sourceOutMs: 5000, playbackRate: 1, loop: false, durationMs: 5000, assetId: 'audio' }], audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] },
		] }],
	}));
	await projectSession.start();
	const manager = projectSession.projectContext.stateManager;
	const starts = projectSession.timelineAudioPreview.starts;
	projectSession.previewPlayback.playTimeline();
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
		const source = { url: 'app://external-assets/audio', size: 100, error: null };
		manager.state.assets.value[0].fileData = source;
		await setImmediate();
		assert.equal(starts.length, 13);
		assert.equal(projectSession.timelineAudioPreview.projects.at(-1).assets.find(asset => asset.id === 'audio').fileData.url, source.url);
		manager.state.assets.value[0].fileData = { ...source };
		await setImmediate();
		assert.equal(starts.length, 13);
	} finally { projectSession.previewPlayback.dispose(); }
});

// 【両Workerの復帰完了後にだけプレビューを再開する】
// timeline側だけ先にreadyになっても、再描画や次のエクスポート開始を許可してはいけない。
test('waits for both preview workers before restoring the paused timeline', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const projectSession = createStandaloneSession(app);
	await projectSession.start();
	// 精密シークの位置もWorker再生成をまたいで丸めず復元する。
	projectSession.previewPlayback.seekTimeline(123, true, 'precise');
	const visualModuleLivePreview = projectSession.visualModuleRendererManagerController;
	const timeline = projectSession.timelineRendererManagerController;
	await projectSession.suspendPreview();
	assert.equal(visualModuleLivePreview.isReady.value, false);
	assert.equal(timeline.isReady.value, false);
	assert.equal(projectSession.renderEngine.isSuspended.value, true);
	assert.equal(projectSession.audioOutput.preview.suspended, true);
	timeline.renders.length = 0;
	const gate = Promise.withResolvers();
	visualModuleLivePreview.initialize = async () => { await gate.promise; visualModuleLivePreview.isReady.value = true; };
	const restarting = projectSession.resumePreview();
	await setImmediate();
	assert.equal(timeline.isReady.value, true);
	assert.equal(projectSession.audioOutput.preview.suspended, true);
	assert.deepEqual(timeline.renders, []);
	gate.resolve();
	await restarting;
	assert.deepEqual(timeline.renders, [123]);
	assert.equal(projectSession.previewPlayback.isTimelinePlaying.value, false);
	assert.equal(projectSession.audioOutput.preview.suspended, false);
});

// 【復帰待ちの途中に新しく休止した場合は音声モニターも停止状態を維持する】
// 先行する再初期化が遅れて完了し、次の書き出し中に音声モニターだけを再開してしまうのを防ぐ。
test('does not resume audio monitor rendering after a newer preview suspension', async t => {
	setup(t);
	const { projectSession } = evaluateSession();
	await projectSession.start();
	await projectSession.suspendPreview();
	const gate = Promise.withResolvers();
	projectSession.visualModuleRendererManagerController.initialize = async () => { await gate.promise; };
	const restarting = projectSession.resumePreview();
	await setImmediate();
	await projectSession.suspendPreview();
	gate.resolve();
	await restarting;
	assert.equal(projectSession.renderEngine.isSuspended.value, true);
	assert.equal(projectSession.audioOutput.preview.suspended, true);
});

// 【復帰に失敗してももう一方の初期化を待ち、描画は再開しない】
// 一方の失敗だけでダイアログを操作可能にすると、次の書き出しで残りの初期化を中断してしまう。
test('keeps playback suspended and waits for the other worker after a restart failure', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const projectSession = createStandaloneSession(app);
	await projectSession.start();
	await projectSession.suspendPreview();
	const timeline = projectSession.timelineRendererManagerController;
	timeline.renders.length = 0;
	projectSession.visualModuleRendererManagerController.initialize = async () => { throw new Error('GPU unavailable'); };
	const gate = Promise.withResolvers();
	timeline.initialize = async () => { await gate.promise; timeline.isReady.value = true; };
	let settled = false;
	const restarting = projectSession.resumePreview();
	const completed = restarting.then(() => { settled = true; });
	await setImmediate();
	assert.equal(settled, false);
	gate.resolve();
	await completed;
	assert.equal(projectSession.renderEngine.errorMessage.value, 'GPU unavailable');
	await nextTick();
	projectSession.previewPlayback.refresh();
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
	assert.equal(await app.openProject(undefined, desktopProjectFile({ id: 'startup', name: '作品.gsproj' })), true);
	assert.equal(app.projectSession.projectContext.stateManager.state.name.value, 'From Explorer');
	assert.equal(app.projectSession.projectBackupAccess.value, 'ready');
	app.projectSession.projectContext.stateManager.state.name.value = 'Edited';
	await app.projectSession.saveProject();
	assert.equal(decodeProjectFile(bytes).name, 'Edited');
	assert.deepEqual(globalThis.projectAlerts, []);
	app.projectSession.projectBackupController.setTarget(null);
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
	window.testPreferences.projectBackupSaveEnabled = true;
	assert.equal(await app.openProject(), true);
	assert.equal(app.projectSession.projectBackupAccess.value, 'ready');
	window.desktop.readProjectFile = () => assert.fail('Save backup must not read the old file into the renderer');
	app.projectSession.projectContext.stateManager.state.name.value = 'Edited';
	await app.projectSession.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'Edited');
	assert.equal(decodeProjectFile([...files.values()][0]).name, 'On disk');
	assert.equal(app.projectSession.projectBackupStatus.value.lastSaveBackup != null, true);
	const persisted = handle.bytes;
	const previousWrites = handle.calls.filter(call => call[0] === 'create').length;
	fail = true;
	app.projectSession.projectContext.stateManager.state.name.value = 'More edits';
	await app.projectSession.saveProject();
	assert.equal(handle.bytes, persisted);
	assert.equal(handle.calls.filter(call => call[0] === 'create').length, previousWrites);
	assert.deepEqual(globalThis.projectAlerts, ['Backup disk full']);
	app.projectSession.projectBackupController.setTarget(null);
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
	Object.assign(window.testPreferences, { projectBackupAutoEnabled: true, projectBackupAutoIntervalMinutes: 3,
																																									projectBackupAutoRetentionDays: 1, projectBackupSaveEnabled: true, projectBackupSaveRetentionDays: 7 });
	const projectSession = createStandaloneSession(app, project(),
		{ fileName: original.name, fileHandle: desktopProjectFile({ id: original.name, name: original.name }) });
	await projectSession.start();
	projectSession.projectContext.stateManager.state.name.value = 'Saving as second';
	window.selectProjectSaveFile = async () => destination;
	await projectSession.saveProject(true);
	assert.equal(decodeProjectFile([...backups.get(destination.name).values()][0]).name, 'Destination before overwrite');
	assert.equal(backups.has(original.name), false);
	let now = Date.now();
	t.mock.method(Date, 'now', () => now);
	projectSession.projectContext.stateManager.state.description.value = 'Unsaved description';
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	const historyLength = projectSession.projectContext.stateManager.undoStack.value.length;
	now += 180001;
	await projectSession.projectBackupController.tick();
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	const automatic = [...backups.get(destination.name)].filter(([name]) => name.includes('.auto-backup-'));
	assert.equal(automatic.length, 1);
	assert.equal(decodeProjectFile(automatic[0][1]).description, 'Unsaved description');
	assert.equal(projectSession.projectContext.stateManager.undoStack.value.length, historyLength);
	assert.notEqual(decodeProjectFile(destination.bytes).description, 'Unsaved description');
	await projectSession.saveProject();
	assert.equal(decodeProjectFile(destination.bytes).description, 'Unsaved description');
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	assert.equal(decodeProjectFile(original.bytes).name, 'First file');
	projectSession.projectBackupController.setTarget(null);
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
	Object.assign(window.testPreferences, { projectBackupAutoEnabled: true, projectBackupAutoIntervalMinutes: 2,
																																									projectBackupAutoRetentionDays: 1, projectBackupSaveEnabled: true, projectBackupSaveRetentionDays: 7 });
	await app.newProject();
	const { projectSession } = app;
	await projectSession.projectBackupController.tick();
	assert.equal(projectSession.projectBackupAccess.value, 'unsaved');
	assert.equal(handles.size, 1);
	await projectSession.saveProject();
	assert.equal(projectSession.projectBackupAccess.value, 'ready');
	assert.equal(handles.size, 1);
	const saved = handle.bytes;
	let now = Date.now();
	t.mock.method(Date, 'now', () => now);
	projectSession.projectContext.stateManager.state.name.value = 'Unsaved editing';
	now += 120001;
	await projectSession.projectBackupController.tick();
	const automatic = [...handles].filter(([name]) => name.includes('.auto-backup-'));
	assert.equal(automatic.length, 1);
	assert.equal(decodeProjectFile(automatic[0][1].bytes).name, 'Unsaved editing');
	assert.equal(handle.bytes, saved);
	await projectSession.saveProject();
	const beforeSave = [...handles].filter(([name]) => name.includes('.save-backup-'));
	assert.equal(beforeSave.length, 1);
	assert.deepEqual(beforeSave[0][1].bytes, saved);
	assert.equal(decodeProjectFile(handle.bytes).name, 'Unsaved editing');
	await app.newProject();
	assert.equal(app.projectSession.projectBackupAccess.value, 'unsaved');
	assert.equal(projectSession.projectBackupAccess.value, 'ready');
});

// 【更新準備は受付済みの保存を完了させ、新規保存・バックアップは復帰するまで受け付けない】
// 未保存の変更の破棄に同意していても、書込み途中のファイルを残して終了してはならない。
// 既に待機中のSaveも完了させ、更新失敗後には現在の内容を再び保存できることを確認する。
test('drains queued saves before preparing an update and resumes saving afterwards', async t => {
	const window = setup(t);
	const handle = fileHandle('update.gsproj');
	const { projectSession } = evaluateSession(project({ name: 'first' }), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = handle.createWritable;
	handle.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; await stream.close(); } };
	};
	const firstSave = projectSession.saveProject();
	await started.promise;
	projectSession.projectContext.stateManager.state.name.value = 'second';
	const queuedSave = projectSession.saveProject();
	let readyToUpdate = false;
	const preparing = projectSession.pauseForDesktopUpdate().then(resume => { readyToUpdate = true; return resume; });
	projectSession.projectContext.stateManager.state.name.value = 'third';
	await projectSession.saveProject();
	await projectSession.projectBackupController.tick();
	assert.equal(readyToUpdate, false);
	finish.resolve();
	await Promise.all([firstSave, queuedSave]);
	const resume = await preparing;
	assert.equal(decodeProjectFile(handle.bytes).name, 'second');
	assert.equal(handle.calls.filter(([action]) => action === 'write').length, 2);
	await resume();
	await projectSession.saveProject();
	assert.equal(decodeProjectFile(handle.bytes).name, 'third');
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【更新待ちの保存が失敗した場合は、背後のダイアログ待ちにならず更新を中止する】
// 保存失敗を握りつぶして再起動したり、閉じられない更新画面の背後で確認を待つ状態を防ぐ。
test('rejects update preparation after an in-flight save fails and restores save acceptance', async t => {
	setup(t);
	t.mock.method(console, 'error', () => {});
	const handle = fileHandle('failed-update.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	const started = Promise.withResolvers();
	const finish = Promise.withResolvers();
	const createWritable = handle.createWritable;
	handle.createWritable = async () => {
		const stream = await createWritable();
		return { ...stream, async close() { started.resolve(); await finish.promise; throw new Error('write failed'); } };
	};
	const saving = projectSession.saveProject();
	await started.promise;
	const preparing = projectSession.pauseForDesktopUpdate();
	const rejected = assert.rejects(preparing, /write failed/);
	finish.resolve();
	await Promise.all([saving, rejected]);
	assert.deepEqual(globalThis.projectAlerts, []);
	handle.createWritable = createWritable;
	await projectSession.saveProject();
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
	const handle = fileHandle('update-cleanup.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	const saving = projectSession.saveProject();
	await cleanupStarted.promise;
	let prepared = false;
	const preparing = projectSession.pauseForDesktopUpdate().then(resume => { prepared = true; return resume; });
	await setImmediate();
	assert.equal(prepared, false);
	assert.equal(projectSession.isProjectSaving.value, true);
	finishCleanup.resolve();
	const resume = await preparing;
	await saving;
	assert.equal(projectSession.isProjectSaving.value, false);
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	await resume();
	await projectSession.saveProject();
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
	const handle = fileHandle('failed-update-cleanup.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	const createWritable = handle.createWritable;
	handle.createWritable = async () => { throw new Error('write failed'); };
	const saving = projectSession.saveProject();
	await cleanupStarted.promise;
	const rejected = assert.rejects(projectSession.pauseForDesktopUpdate(), /write failed/);
	finishCleanup.resolve();
	await Promise.all([saving, rejected]);
	assert.deepEqual(globalThis.projectAlerts, []);
	handle.createWritable = createWritable;
	await projectSession.saveProject();
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
	const { getAssetMenu } = app;
	const projectSession = createStandaloneSession(app, project({ assets: [{ id: 'asset', name: 'Original display name', width: 0, height: 0,
																																													fileDataType: 'application/octet-stream', isExternalReference: false, sourceFilePath: 'C:/original/source.bin', fileData: new Blob(['old']), thumbnailSequence: null }] }));
	await projectSession.start();
	const manager = projectSession.projectContext.stateManager;
	const current = () => manager.state.assets.value[0];
	// 翻訳や省略記号の変更で操作の検証が壊れないよう、表示文言ではなくIDで選ぶ。
	const action = id => {
		const menuItem = getAssetMenu(projectSession.projectContext, current()).find(item => item.id === id);
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

// 【素材の再リンク待ちに終了しても、遅れた選択結果で素材や履歴を変更しない】
// プロジェクト世代を使わなくても、ファイル選択後の終了状態を確認して取り込みを中止する必要がある。
test('ignores an asset relink selected after its project closes', async t => {
	const window = setup(t);
	const selection = Promise.withResolvers();
	window.desktop = { chooseAssetFile: () => selection.promise };
	const { ProjectContext, getAssetMenu } = evaluate(appBundle);
	const context = new ProjectContext(project({ assets: [{ id: 'asset', name: 'Original', width: 0, height: 0,
		fileDataType: 'application/octet-stream', isExternalReference: true, sourceFilePath: 'C:/original.bin',
		fileData: { url: 'app://external-assets/original', size: 3, error: null }, thumbnailSequence: null }] }));
	t.after(() => context.dispose());
	const manager = context.stateManager;
	const asset = manager.state.assets.value[0];
	const pending = getAssetMenu(context, asset).find(item => item.id === 'relink').action();
	context.dispose();
	selection.resolve('C:/changed.bin');
	await pending;
	assert.equal(asset.sourceFilePath, 'C:/original.bin');
	assert.equal(manager.undoStack.value.length, 0);
	assert.deepEqual(globalThis.projectAlerts, []);
});

// 【プロジェクト共通の定義は読み込み・保存・両プレビューの初期状態で一致する】
// 編集差分だけを同期しても、読み込み直後やWorker再生成後の一覧を渡し忘れると参照が失われる。
// 実際のProjectContextとProjectSessionContextを通し、スナップショットが曲線を保持することを確認する。
test('loads snapshots and synchronizes project Automation Graph definitions to both previews', async t => {
	setup(t);
	const automationGraph = { id: 'shared', nameForReference: 'Curve', isNormalized: false, points: [
		{ id: 'point', x: 0, y: 0.5, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
	] };
	const { projectSession } = evaluateSession(project({ automationGraphs: [automationGraph] }));
	await projectSession.start();
	const context = projectSession.projectContext;
	assert.deepEqual(context.snapshot().automationGraphs, [automationGraph]);
	for (const renderer of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.deepEqual(renderer.options.automationGraphs, [automationGraph]);
	}
	context.stateManager.commit('updateProjectAutomationGraph', { automationGraph: { ...automationGraph, nameForReference: 'Renamed' } });
	await nextTick();
	await setImmediate();
	for (const renderer of [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController]) {
		assert.equal(renderer.options.automationGraphs[0].nameForReference, 'Renamed');
	}
	assert.equal(context.snapshot().automationGraphs[0].id, automationGraph.id);
});

// 【終了したセッションの購読と資源を解放し、別セッションは動作を続ける】
// プロジェクトのデータ変更・環境設定・遅れて届いた再開要求が、終了済みのWorkerを作り直してはいけない。
// 同じ環境設定を使う別セッションと比較し、購読を全体で解除していないことも確認する。
test('disposes one session without restarting its renderers or stopping another session', async t => {
	const window = setup(t);
	const { projectSession, ProjectSessionContext, ProjectContext } = evaluateSession();
	const other = new ProjectSessionContext(new ProjectContext(project({ id: 'other-project' })));
	await projectSession.start();
	await other.start();
	const renderer = projectSession.visualModuleRendererManagerController;
	const initializations = renderer.snapshots.length;
	const otherInitializations = other.visualModuleRendererManagerController.snapshots.length;
	assert.equal(projectSession.projectContext.isDisposed, false);
	const disposal = projectSession.dispose();
	assert.equal(projectSession.dispose(), disposal);
	await disposal;
	assert.equal(projectSession.audioOutput.disposed, true);
	assert.equal(projectSession.projectContext.isDisposed, true);
	assert.equal(projectSession.projectContext.snapshot(), null);
	assert.equal(window.listeners.get('focus').size, 1);
	window.testPreferences.renderingStatsEnabled = !window.testPreferences.renderingStatsEnabled;
	projectSession.projectContext.stateManager.state.resolution.value = { width: 512, height: 512 };
	await projectSession.resumePreview();
	await projectSession.renderEngine.enable();
	await projectSession.renderEngine.resume();
	await projectSession.start();
	await setImmediate();
	assert.equal(renderer.snapshots.length, initializations);
	assert.equal(renderer.isReady.value, false);
	assert.ok(other.visualModuleRendererManagerController.snapshots.length > otherInitializations);
	await other.dispose();
	assert.equal(window.listeners.get('focus').size, 0);
});

// 【生成直後からSceneと編集状態を監視し、起動時にはその状態を初回描画へ引き継ぐ】
// 起動前にも購読が揃っていないと、Sceneごとの時刻復元や編集差分の受付が起動前後で異なる。
// 初回描画のために0秒へ戻さず、起動後も購読の二重登録によって差分を重複送信しない。
test('observes edits and scene selection before startup and synchronizes once after startup', async t => {
	let projectSession = null;
	t.after(() => projectSession?.dispose());
	setup(t);
	({ projectSession } = evaluateSession(project({ timelineScenes: ['first', 'second'].map(id => ({
		id, name: id, resolution: { mode: 'project' }, layers: [],
	})) })));
	const playback = projectSession.previewPlayback;
	const controllers = [projectSession.visualModuleRendererManagerController, projectSession.timelineRendererManagerController];
	const manager = projectSession.projectContext.stateManager;
	const automationGraph = { id: 'curve', nameForReference: 'Curve', isNormalized: false, points: [
		{ id: 'point', x: 0, y: 0.5, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] },
	] };
	manager.commit('addProjectAutomationGraph', { automationGraph });
	await projectSession.flushRendererProjectChanges();
	playback.seekTimeline(1000);
	projectSession.activeSceneId.value = 'second';
	await setImmediate();
	assert.equal(playback.currentTimelineTime.value, 0);
	playback.seekTimeline(2000);
	projectSession.activeSceneId.value = 'first';
	await setImmediate();
	assert.equal(playback.currentTimelineTime.value, 1000);
	for (const controller of controllers) {
		assert.equal(controller.snapshots.length, 0);
		assert.equal(controller.patches.length, 0);
	}
	await projectSession.start();
	assert.equal(playback.currentTimelineTime.value, 1000);
	assert.equal(projectSession.timelineRendererManagerController.renders[0], 1000);
	assert.equal(projectSession.timelineRendererManagerController.options.sceneId, 'first');
	for (const controller of controllers) {
		assert.equal(controller.snapshots.length, 1);
		assert.deepEqual(controller.options.automationGraphs, [automationGraph]);
	}
	manager.commit('updateProjectAutomationGraph', { automationGraph: { ...automationGraph, nameForReference: 'Renamed' } });
	await projectSession.flushRendererProjectChanges();
	for (const controller of controllers) {
		assert.equal(controller.patches.length, 1);
		assert.equal(controller.options.automationGraphs[0].nameForReference, 'Renamed');
	}
});

// 【読み込みの途中で終了しても、完了後に購読・レンダラー・待機画面を残さない】
// Desktopへの保存先登録などのawaitをまたぐ間に終了できるため、初期化の続行を明示的に失効させる。
// 生成時に登録した購読も終了し、音声の自動生成は登録の完了前や終了後に始めない。
test('does not initialize renderers after a session closes during project loading', async t => {
	const window = setup(t);
	const registered = Promise.withResolvers();
	const completeRegistration = Promise.withResolvers();
	window.desktop = { async setSessionProjectFile(_sessionId, ) { registered.resolve(); await completeRegistration.promise; } };
	const { projectSession } = evaluateSession();
	const schedule = t.mock.method(projectSession.voicevoxGeneration, 'schedule', () => {});
	const loading = projectSession.start();
	await registered.promise;
	assert.equal(schedule.mock.callCount(), 0);
	await projectSession.dispose();
	projectSession.projectContext.stateManager.commit('addProjectAutomationGraph', { automationGraph: {
		id: 'after-close', nameForReference: 'AfterClose', isNormalized: false, points: [],
	} });
	await projectSession.flushRendererProjectChanges();
	completeRegistration.resolve();
	await loading;
	assert.equal(schedule.mock.callCount(), 0);
	assert.equal(projectSession.visualModuleRendererManagerController.patches.length, 0);
	assert.equal(projectSession.timelineRendererManagerController.patches.length, 0);
	assert.equal(projectSession.visualModuleRendererManagerController.snapshots.length, 0);
	assert.equal(projectSession.timelineRendererManagerController.snapshots.length, 0);
	assert.equal(window.waitingCount, 0);
	assert.equal(window.listeners.get('focus').size, 0);
});

// 【Context生成直後から完全な状態を持ち、別名保存のID変更でも編集中の値と履歴を維持する】
// 二段階の初期化を廃止しても、スナップショットの項目やUndo/Redoを失わないようにする。
// IDは常に存在するが別名保存では変更でき、終了後の保存結果では更新されない。
test('constructs complete project state and preserves edits and history when adopting a saved ID', t => {
	setup(t);
	const { ProjectContext } = evaluate(appBundle);
	const initialProject = project({ id: 'constructed-project', name: 'Constructed', timelineFps: 24,
		resolution: { width: 1920, height: 1080 }, timelineMotionBlur: { enabled: true, shutterAngle: 90, samples: 32 } });
	const context = new ProjectContext(initialProject);
	t.after(() => context.dispose());
	assert.equal(context.id, initialProject.id);
	assert.deepEqual(context.snapshot(), initialProject);
	const manager = context.stateManager;
	assert.equal(manager.undoStack.value.length, 0);
	assert.equal(manager.redoStack.value.length, 0);
	const settings = timelineFps => ({ timelineFps, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 8 } });
	manager.commit('changeTimelineRenderSettings', settings(24));
	manager.commit('changeTimelineRenderSettings', settings(30));
	manager.undo();
	const edit = manager.beginEdit('changeTimelineRenderSettings');
	edit.update(settings(48));
	const before = context.snapshot();
	const undo = [...manager.undoStack.value];
	const redo = [...manager.redoStack.value];
	context.adoptSavedProjectId('saved-as-project');
	assert.deepEqual(context.snapshot(), { ...before, id: 'saved-as-project' });
	assert.deepEqual(manager.undoStack.value, undo);
	assert.deepEqual(manager.redoStack.value, redo);
	edit.update(settings(50));
	assert.equal(manager.state.timelineFps.value, 50);
	context.dispose();
	context.adoptSavedProjectId('after-close');
	assert.equal(context.snapshot(), null);
	assert.equal(context.id, 'saved-as-project');
});

// 【セッションの起動は待機中も完了後も一度だけ受け付ける】
// データは生成時から存在するため、起動の重複で購読を増やしたり編集中の状態を変更したりしない。
test('rejects repeated startup while pending and after completion without changing the project', async t => {
	let projectSession = null;
	t.after(() => projectSession?.dispose());
	const window = setup(t);
	const registered = Promise.withResolvers();
	const completeRegistration = Promise.withResolvers();
	window.desktop = { async setSessionProjectFile() { registered.resolve(); await completeRegistration.promise; } };
	({ projectSession } = evaluateSession(project({ name: 'Original' })));
	const startup = projectSession.start();
	await registered.promise;
	await assert.rejects(projectSession.start(), /already started/);
	completeRegistration.resolve();
	await startup;
	const renderer = projectSession.visualModuleRendererManagerController;
	const initializationCount = renderer.snapshots.length;
	projectSession.projectContext.stateManager.state.name.value = 'Edited';
	await assert.rejects(projectSession.start(), /already started/);
	assert.equal(projectSession.projectContext.snapshot().name, 'Edited');
	assert.equal(renderer.snapshots.length, initializationCount);
	assert.equal(window.listeners.get('focus').size, 1);
	assert.equal(window.waitingCount, 0);
});

for (const closeDuringPreparation of [false, true]) {
	// 【外部素材の準備が終わるまでセッションを作らず、終了後には遅れて追加しない】
	// 空のContextへ後から値を入れず、初回の保存状態とWorkerへ同じ準備済みデータを渡す。
	// 準備中にウィンドウが閉じた場合は、購読・音声・Workerを生成せず待機画面を片付ける。
	test(`prepares external assets before constructing a session${closeDuringPreparation ? ' and discards preparation after closing' : ''}`, async t => {
		let app = null;
		t.after(() => app?.disposeApplication());
		const window = setup(t);
		const entered = Promise.withResolvers();
		const source = Promise.withResolvers();
		const registrations = [];
		window.desktop = {
			resolveExternalAsset: async path => { assert.equal(path, 'C:/prepared.png'); entered.resolve(); return source.promise; },
			setSessionProjectFile: async id => { registrations.push(id); },
		};
		app = evaluate(appBundle);
		const initialProject = project({ name: 'Prepared', resolution: { width: 4096, height: 2160 }, timelineFps: 24,
			timelineScenes: [{ id: 'initial-scene', name: 'Initial Scene', resolution: { mode: 'project' }, layers: [] }],
			assets: [{ id: 'external', name: 'prepared.png', fileDataType: 'image/png', width: 4096, height: 2160,
				isExternalReference: true, sourceFilePath: 'C:/prepared.png', thumbnailSequence: null,
				fileData: { url: null, size: 0, error: 'Unresolved' } }],
		});
		const opening = app.projectSessions.open(initialProject, 'prepared.gsproj');
		await entered.promise;
		assert.equal(app.projectSessions.sessions.value.length, 0);
		assert.equal(app.projectSession, null);
		assert.equal(window.listeners.get('focus')?.size ?? 0, 0);
		assert.equal(window.waitingCount, 1);
		if (closeDuringPreparation) await app.disposeApplication();
		const resolvedSource = { url: 'app://external-assets/prepared', size: 123, error: null };
		source.resolve(resolvedSource);
		const session = await opening;
		assert.equal(window.waitingCount, 0);
		if (closeDuringPreparation) {
			assert.equal(session, null);
			assert.equal(app.projectSessions.sessions.value.length, 0);
			assert.equal(window.listeners.get('focus')?.size ?? 0, 0);
			assert.deepEqual(registrations, []);
			return;
		}
		assert.equal(app.projectSession, session);
		assert.equal(session.activeSceneId.value, 'initial-scene');
		assert.equal(session.resolutionFactor.value, 0.25);
		assert.equal(session.hasUnsavedChanges.value, false);
		assert.equal(session.projectContext.stateManager.undoStack.value.length, 0);
		assert.deepEqual(session.projectContext.snapshot().assets[0].fileData, resolvedSource);
		assert.deepEqual(registrations, [session.id]);
		for (const renderer of [session.visualModuleRendererManagerController, session.timelineRendererManagerController]) {
			assert.equal(renderer.snapshots.length, 1);
			assert.deepEqual(renderer.options.assets[0].fileData, resolvedSource);
			assert.deepEqual(renderer.initialResolution, { width: 4096, height: 2160 });
			assert.equal(renderer.initialResolutionScale, 0.25);
			assert.equal(renderer.patches.length, 0);
		}
		assert.equal(session.timelineRendererManagerController.options.sceneId, 'initial-scene');
		assert.equal(session.timelineRendererManagerController.options.previewFps, 12);
	});
}

// 【初期化失敗時は未公開のセッションを終了し、次の作成は新しいセッションで行う】
// 中途半端なセッションを再利用せず、購読・保存先の所有権・待機表示・バックアップの予約を残さない。
test('disposes a failed initialization and allows opening a fresh session', async t => {
	let app = null;
	t.after(() => app?.disposeApplication());
	const window = setup(t);
	const closedIds = [];
	window.initialTestPreferences = { projectBackupAutoEnabled: true };
	let backupScheduled = false;
	window.setTimeout = () => { backupScheduled = true; return 1; };
	window.clearTimeout = () => { backupScheduled = false; };
	window.desktop = {
		async setSessionProjectFile() { assert.equal(backupScheduled, true); throw new Error('Registration failed'); },
		async closeProjectSession(id) { closedIds.push(id); },
	};
	app = evaluate(appBundle);
	const handle = desktopProjectFile({ id: 'failed-startup', name: 'failed-startup.gsproj' });
	await assert.rejects(app.projectSessions.open(project(), handle.name, handle), /Registration failed/);
	assert.deepEqual(app.projectSessions.sessions.value, []);
	assert.equal(app.projectSessions.activeSession.value, null);
	assert.equal(window.waitingCount, 0);
	assert.equal(window.listeners.get('focus').size, 0);
	assert.equal(closedIds.length, 1);
	assert.equal(backupScheduled, false);
	window.desktop.setSessionProjectFile = async () => {};
	const session = await app.projectSessions.open(project());
	assert.notEqual(session.id, closedIds[0]);
	assert.equal(app.projectSessions.activeSession.value, session);
	assert.equal(session.visualModuleRendererManagerController.isReady.value, true);
});

// 【保存開始後の終了は後処理を待ち、新たな保存とバックアップは受け付けない】
// ファイル書き込みの途中で所有権を解放すると他のプロジェクトが同じ保存先へ書き込めるため、
// 終了のPromiseは予約解放まで完了しない。画面と音声の停止はその待機より先に行う。
test('waits for save cleanup while stopping session activity immediately', async t => {
	const window = setup(t);
	const cleanupStarted = Promise.withResolvers();
	const finishCleanup = Promise.withResolvers();
	window.desktop = { async releaseProjectReservations() { cleanupStarted.resolve(); await finishCleanup.promise; } };
	const handle = fileHandle('closing.gsproj');
	const { projectSession } = evaluateSession(project(), { fileName: handle.name, fileHandle: handle });
	await projectSession.start();
	const saving = projectSession.saveProject();
	await cleanupStarted.promise;
	projectSession.projectContext.stateManager.state.name.value = 'Edited during cleanup';
	assert.equal(projectSession.hasUnsavedChanges.value, true);
	let closed = false;
	const closing = projectSession.dispose().then(() => { closed = true; });
	assert.equal(projectSession.hasUnsavedChanges.value, false);
	assert.equal(projectSession.audioOutput.disposed, true);
	assert.equal(projectSession.visualModuleRendererManagerController.isReady.value, false);
	await projectSession.saveProject();
	await setImmediate();
	assert.equal(closed, false);
	finishCleanup.resolve();
	await Promise.all([saving, closing]);
	assert.equal(handle.calls.filter(([action]) => action === 'write').length, 1);
	assert.equal(projectSession.isProjectSaving.value, false);
});

// 【タブ切替は作品・Undo・再生位置を維持し、非選択の描画を停止する】
// 切替を読み込み扱いにすると選択・履歴・プレビュー設定が初期化される。
// 非選択化と書き出し休止を独立させ、遅い再開処理が裏のタブを動かさないことも確認する。
test('preserves per-session history and playback while independently suspending inactive previews', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const first = await app.newProject();
	const initialFps = first.projectContext.stateManager.state.timelineFps.value;
	first.projectContext.stateManager.commit('changeTimelineRenderSettings', { timelineFps: 24, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 } });
	first.previewPlayback.showTimeline();
	first.previewPlayback.seekTimeline(250);
	first.resolutionFactor.value = 0.5;
	first.timelineClipboard.value = { kind: 'layer', layer: { id: 'copied-layer' } };
	const second = await app.newProject();
	assert.equal(first.renderEngine.isSuspended.value, true);
	assert.equal(first.visualModuleRendererManagerController.isReady.value, false);
	assert.equal(first.audioOutput.preview.suspended, true);
	assert.equal(second.timelineClipboard.value, null);
	await first.suspendPreview();
	await app.projectSessions.select(first);
	assert.equal(first.renderEngine.isSuspended.value, true);
	assert.equal(second.renderEngine.isSuspended.value, true);
	await first.resumePreview();
	assert.equal(first.renderEngine.canRender.value, true);
	assert.equal(first.previewPlayback.currentTimelineTime.value, 250);
	assert.equal(first.resolutionFactor.value, 0.5);
	first.projectContext.stateManager.undo();
	assert.equal(first.projectContext.stateManager.state.timelineFps.value, initialFps);
	assert.equal(second.projectContext.stateManager.canUndo.value, false);
	await app.projectSessions.select(second);
	await first.resumePreview();
	assert.equal(first.renderEngine.isSuspended.value, true);
	await Promise.all([app.projectSessions.select(first), app.projectSessions.select(second), app.projectSessions.select(first)]);
	assert.equal(app.projectSessions.activeSession.value, first);
	assert.equal(first.renderEngine.canRender.value, true);
	assert.equal(second.renderEngine.isSuspended.value, true);
	await app.disposeApplication();
});

// 【同じ保存先は既存タブへ移動し、同じProject IDを持つ別ファイルは別タブにする】
// ファイルをコピーした作品やSave asを誤って同一タブへまとめず、再オープンでは未保存変更を失わない。
test('selects an already open file without reloading edits and distinguishes copied project files', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const bytes = await encodeProjectFile(project());
	const firstFile = fileHandle('first.gsproj', { bytes });
	const secondFile = fileHandle('copy.gsproj', { bytes });
	const reopenedHandle = { ...firstFile };
	firstFile.isSameEntry = async other => other === reopenedHandle;
	assert.equal(await app.openProject(null, firstFile), true);
	const first = app.projectSession;
	first.projectContext.stateManager.state.name.value = 'Unsaved first';
	await app.openProject(null, secondFile);
	const second = app.projectSession;
	await app.openProject(null, reopenedHandle);
	assert.equal(app.projectSession, first);
	assert.equal(first.projectContext.snapshot().name, 'Unsaved first');
	assert.equal(second.projectContext.snapshot().name, 'Example');
	assert.equal(app.projectSessions.sessions.value.length, 2);
	await app.disposeApplication();
});

// 【別タブの保存先は上書きせず、保存中のタブも閉じない】
// 同じウィンドウの権限を共有していても、作品単位の保存先と未完了の書込みを保護する。
test('rejects another tabs save destination and blocks closing until save cleanup completes', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	const target = fileHandle('owned.gsproj', { bytes: await encodeProjectFile(project()) });
	await app.openProject(null, target);
	const first = app.projectSession;
	const second = await app.newProject();
	window.selectProjectSaveFile = async () => target;
	const original = target.bytes;
	await second.saveProject();
	assert.equal(target.bytes, original);
	assert.equal(second.hasUnsavedChanges.value, true);
	assert.equal(second.projectFileHandle.value, null);
	assert.equal(globalThis.projectAlerts.length, 1);
	const cleanup = Promise.withResolvers();
	const started = Promise.withResolvers();
	window.desktop = { async releaseProjectReservations() { started.resolve(); await cleanup.promise; } };
	const save = first.saveProject();
	await started.promise;
	assert.equal(app.projectSessions.isProjectSaving.value, true);
	assert.equal(await app.projectSessions.close(first), false);
	cleanup.resolve();
	await save;
	assert.equal(await app.projectSessions.close(first), true);
	assert.equal(app.projectSession, second);
	await app.disposeApplication();
});

// 【最後のタブを閉じたらセッション0件へ戻し、アプリ終了ですべてのセッションを破棄する】
// 閉じた作品の保存先・Workerを残さず、次の新規作成で空タブが余分に増えないことを保証する。
test('returns to zero sessions after the final close and disposes every remaining session', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const first = await app.newProject();
	assert.equal(await app.projectSessions.close(first), true);
	assert.equal(first.isDisposed, true);
	assert.equal(app.projectSession, null);
	assert.equal(app.projectSessions.sessions.value.length, 0);
	assert.equal(app.projectSessions.hasUnsavedChanges.value, false);
	await nextTick();
	assert.equal(window.document.title, 'Glitch Studio');
	const second = await app.newProject();
	const third = await app.newProject();
	assert.equal(app.projectSessions.sessions.value.length, 2);
	assert.equal(app.projectSessions.hasUnsavedChanges.value, true);
	await app.disposeApplication();
	assert.equal(second.isDisposed, true);
	assert.equal(third.isDisposed, true);
	assert.equal(await app.newProject(), null);
});

// 【保存先の非同期照合中にアプリを閉じても、後からセッションを生成しない】
// FileSystemHandle.isSameEntryは非同期なので、受付時の寿命チェックだけでは終了後に購読が残る。
test('does not create a session after disposal during asynchronous file identity checking', async t => {
	setup(t);
	const app = evaluate(appBundle);
	const firstFile = fileHandle('first.gsproj', { bytes: await encodeProjectFile(project()) });
	await app.openProject(null, firstFile);
	const first = app.projectSession;
	const started = Promise.withResolvers();
	const checked = Promise.withResolvers();
	firstFile.isSameEntry = async () => { started.resolve(); return checked.promise; };
	const opening = app.projectSessions.open(project(), 'second.gsproj', fileHandle('second.gsproj'));
	await started.promise;
	await app.disposeApplication();
	checked.resolve(false);
	assert.equal(await opening, null);
	assert.equal(first.isDisposed, true);
	assert.deepEqual(app.projectSessions.sessions.value, [first]);
});

// 【起動直後とファイル選択取消しではセッションを生成しない】
// Dashboardだけを開いている段階で編集環境・プレビュー・終了確認を持たせない。
// 作成操作を行った時点で一つ目のセッションが追加されることを確認する。
test('starts with no sessions and creates one only after an explicit project action', async t => {
	const window = setup(t);
	const app = evaluate(appBundle);
	assert.deepEqual(app.projectSessions.sessions.value, []);
	assert.equal(app.projectSession, null);
	assert.equal(app.projectSessions.hasUnsavedChanges.value, false);
	assert.equal(app.projectSessions.isProjectSaving.value, false);
	assert.equal(window.document.title, 'Glitch Studio');
	window.showOpenFilePicker = async () => { throw new DOMException('Canceled', 'AbortError'); };
	assert.equal(await app.openProject(), false);
	assert.deepEqual(globalThis.projectAlerts, []);
	assert.equal(app.projectSession, null);
	assert.equal(app.projectSessions.sessions.value.length, 0);
	const session = await app.newProject();
	assert.equal(app.projectSession, session);
	assert.deepEqual(app.projectSessions.sessions.value, [session]);
	await app.disposeApplication();
});
