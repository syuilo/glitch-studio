import { getTimelineScene, getSceneDuration, validateTimelineScenes } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { TimelineRendererManager } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { effectImplementations } from '@gs/subsystems_effect_shared/effect-implementations.ts';
import { createMp4Writer } from './mp4-writer.ts';
import { scaleExportResolution } from './export-settings.ts';
import { encodeStillWebp } from './still-webp.ts';
import { renderExportFrames, validateExportSettings } from './timeline-export.ts';
import { getExportAudioClips } from './audio-export-settings.ts';
import { TimelineAudioExport } from './timeline-audio-export.ts';
import type { ExportRequest, ExportResponse } from './types.ts';

function send(message: ExportResponse, transfer: Transferable[] = []) {
	self.postMessage(message, { transfer });
}

// 1ジョブにつき1Worker。Playerのライブ入力は接続せず、専用のGPUDeviceと履歴を持つ。
// キャンセル時は呼び出し元がWorkerを終了し、準備待ち・エンコード待ちも即座に中断する。
self.onmessage = async (event: MessageEvent<ExportRequest>) => {
	let renderer: TimelineRendererManager | undefined;
	let device: GPUDevice | undefined;
	let writer: Awaited<ReturnType<typeof createMp4Writer>> | undefined;
	let audio: TimelineAudioExport | undefined;
	const controller = new AbortController();
	let finished = false;
	try {
		const { settings: requestedSettings, project, resolutionScale, renderer: rendererSettings } = event.data;
		const { timelineFps, timelineMotionBlur, ...dynamicProjectOptions } = project;
		// UI以外から呼ばれても、Canvasとエンコーダーに同じ調整済みサイズを使う。
		validateTimelineScenes(project.timelineScenes);
		const scene = getTimelineScene(project.timelineScenes, project.sceneId);
		const settings = { ...requestedSettings, ...scaleExportResolution(getSceneBaseResolution(scene.resolution, project.resolution), resolutionScale, requestedSettings.format) };
		if (getSceneDuration(scene) <= 0) throw new Error('Cannot export an empty scene.');
		const validationError = validateExportSettings(settings);
		if (validationError) throw new Error(validationError);
		send({ type: 'progress', progress: { phase: 'preparing', completedFrames: 0, totalFrames: 0 } });
		const canvas = new OffscreenCanvas(settings.width, settings.height);
		if (settings.format === 'mp4') {
			const audioClips = getExportAudioClips(project.timelineScenes, project.sceneId, settings);
			writer = await createMp4Writer(canvas, settings, audioClips.length > 0);
			if (audioClips.length > 0) audio = new TimelineAudioExport(project.assets, audioClips, settings);
		}
		const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) throw new Error('WebGPU is unavailable.');
		device = await adapter.requestDevice({
			requiredFeatures: rendererSettings.enable32bitDataTextures ? ['float32-filterable'] : [],
		});
		const fail = (message: string) => {
			if (finished) return;
			controller.abort(new Error(message));
			// GPU障害で待機Promiseが解決しなくても、UIへ通知してWorkerを終了できるようにする。
			send({ type: 'error', message });
		};
		device.addEventListener('uncapturederror', event => fail(event.error.message));
		void device.lost.then(info => fail(info.message || 'Export GPU device was lost.'));
		const context = canvas.getContext('webgpu');
		if (!(context instanceof GPUCanvasContext)) throw new Error('Could not create the export canvas.');
		renderer = new TimelineRendererManager({
			gpuDevice: device,
			gpuContext: context,
			effectDefinitions,
			effectImplementations,
		}, { ...rendererSettings, timelineFps, timelineMotionBlur });
		renderer.on('ev', event => {
			if (event.type !== 'effectState' && event.type !== 'effectLayerState') return;
			const status = event.ctx.status?.status;
			if (status?.type === 'error') {
				const source = event.type === 'effectState' ? `Node ${event.ctx.nodeId}`
					: `Effect layer ${event.ctx.source.layerId} (clip ${event.ctx.source.clipId})`;
				fail(`${source}: ${status.message}`);
			}
		});
		// 基準サイズを上書きすると、customAbsoluteの子Sceneやノードに書き出し倍率が伝わらない。
		// 倍率は独立して渡し、MP4の偶数寸法補正は最終Canvasだけに適用する。
		await renderer.updateDynamicOptions({
			...dynamicProjectOptions,
			resolutionScale,
			outputResolution: { width: settings.width, height: settings.height },
			opaqueOutput: settings.format === 'mp4',
		});
		controller.signal.throwIfAborted();
		if (settings.format === 'webp') {
			await renderer.renderTimelineFrame(settings.positionMs, 0);
			controller.signal.throwIfAborted();
			// 呼び出し直後、最初のawaitより前にCanvasをコピーする。
			const encoded = encodeStillWebp(canvas, settings);
			send({ type: 'progress', progress: { phase: 'finalizing', completedFrames: 1, totalFrames: 1 } });
			const buffer = await encoded;
			controller.signal.throwIfAborted();
			finished = true;
			send({ type: 'complete', buffer }, [buffer]);
			return;
		}
		let lastProgressTime = 0;
		const stages = {
			render: { totalMs: 0, maxMs: 0, calls: 0 },
			video: { totalMs: 0, maxMs: 0, calls: 0 },
			audio: { totalMs: 0, maxMs: 0, calls: 0 },
			finalize: { totalMs: 0, maxMs: 0, calls: 0 },
		};
		let videoAddSynchronousMs = 0;
		let videoAddWaitMs = 0;
		const startedAt = performance.now();
		const measure = async (stage: keyof typeof stages, operation: () => Promise<void>) => {
			const start = performance.now();
			try {
				// operationは最初のawaitより前に呼ぶ。Canvasの取り込み前にタスクを
				// 切り替えず、計測のためにGPU完了待ちを追加することもしない。
				await operation();
			} finally {
				const elapsed = performance.now() - start;
				stages[stage].totalMs += elapsed;
				stages[stage].maxMs = Math.max(stages[stage].maxMs, elapsed);
				stages[stage].calls++;
			}
		};
		await renderExportFrames(settings, {
			signal: controller.signal,
			render: frame => measure('render', () => renderer!.renderTimelineFrame(frame.timeMs, frame.timeDeltaMs, settings.fps)),
			addFrame: frame => measure('video', async () => {
				const start = performance.now();
				const pending = writer!.addFrame(frame.timestamp, frame.duration);
				const submittedAt = performance.now();
				videoAddSynchronousMs += submittedAt - start;
				try { await pending; } finally { videoAddWaitMs += performance.now() - submittedAt; }
			}),
			addAudioUntil: audio ? time => measure('audio', () => audio!.renderUntil(time, (pcm, timestamp) => writer!.addAudio(pcm, timestamp), controller.signal)) : undefined,
			finalize: () => measure('finalize', () => writer!.finalize()),
			onProgress: progress => {
				const now = performance.now();
				if (progress.phase === 'finalizing' || now - lastProgressTime >= 100) {
					send({ type: 'progress', progress });
					lastProgressTime = now;
				}
			},
		});
		// renderはGPUへのsubmitまでの時間。GPUの実行・Canvasのコピー・色変換・
		// エンコードの待機はvideo側にも現れるため、GPU時間や純粋な圧縮時間とは呼ばない。
		// 毎フレームのログやGPU readbackを避け、書き出し完了時に1回だけ集計する。
		// 完了直後にWorkerが終了するので、DevToolsから後で読める文字列として残す。
		console.info('[Timeline export] performance', JSON.stringify({
			userAgent: navigator.userAgent,
			elapsedMs: performance.now() - startedAt,
			width: settings.width, height: settings.height, fps: settings.fps,
			frames: stages.render.calls,
			stages,
			// 同期部分にはCanvasの取得・受付処理、Promise待ちにはGPUの同期や
			// エンコーダー・muxerのbackpressureが含まれ得る。純粋なCPU/GPU時間ではない。
			videoAddSynchronousMs,
			videoAddWaitMs,
			videoEncoderConfig: writer!.getVideoEncoderConfig?.(),
		}, null, 2));
		const buffer = writer!.getBuffer();
		finished = true;
		send({ type: 'complete', buffer }, [buffer]);
	} catch (error) {
		finished = true;
		try { await writer?.cancel(); } catch { /* 元のエラーを優先する。 */ }
		send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
	} finally {
		finished = true;
		audio?.dispose();
		renderer?.destroy();
		device?.destroy();
	}
};
