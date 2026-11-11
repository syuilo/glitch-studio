import { getTimelineScene, getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { TimelineRendererManager } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import { createSrgbCanvasOutputSettings } from '@gs/glitch-studio_renderer/canvas-output.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { effectImplementations } from '@gs/subsystems_effect_shared/effect-implementations.ts';
import { createMp4Writer } from './mp4-writer.ts';
import { adjustExportResolution, scaleExportResolution } from './export-settings.ts';
import { prepareStillWebp } from './still-webp.ts';
import { encodeStillOpenExr } from './still-openexr.ts';
import { renderExportFrames, validateExportSettings } from './timeline-export.ts';
import { getTimelineScenesWithProjectAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import { getExportAudioClips } from './audio-export-settings.ts';
import { TimelineAudioExport } from './timeline-audio-export.ts';
import type { ExportRequest, ExportResponse, ExportChunkAcknowledgement } from './types.ts';

function send(message: ExportResponse, transfer: Transferable[] = []) {
	self.postMessage(message, { transfer });
}

// 1ジョブにつき1Worker。Playerのライブ入力は接続せず、専用のGPUDeviceと履歴を持つ。
// キャンセル時は呼び出し元がWorkerを終了し、準備待ち・エンコード待ちも即座に中断する。
let pendingChunk: { sequence: number; resolve: () => void } | null = null;
let nextChunkSequence = 0;

function writeChunk(chunk: Uint8Array, totalBytes: number): Promise<void> {
	return new Promise(resolve => {
		const sequence = nextChunkSequence++;
		pendingChunk = { sequence, resolve };
		// WASMの借用view自体はtransferしない。保存完了を待つ一チャンクだけコピーする。
		const buffer = chunk.slice().buffer;
		send({ type: 'chunk', sequence, buffer, totalBytes }, [buffer]);
	});
}

self.onmessage = async (event: MessageEvent<ExportRequest | ExportChunkAcknowledgement>) => {
	if ('type' in event.data) {
		if (pendingChunk?.sequence === event.data.sequence) {
			const pending = pendingChunk;
			pendingChunk = null;
			pending.resolve();
		}
		return;
	}
	let renderer: TimelineRendererManager | null = null;
	let device: GPUDevice | null = null;
	let writer: Awaited<ReturnType<typeof createMp4Writer>> | null = null;
	let audio: TimelineAudioExport | null = null;
	const controller = new AbortController();
	let finished = false;
	let gpuReleased = false;
	try {
		const { settings: requestedSettings, project, resolutionScale, renderer: rendererSettings } = event.data;
		const { timelineFps, timelineMotionBlur, assets, customShaderEffects, ...dynamicProjectOptions } = project;
		// UI以外から呼ばれても、Canvasとエンコーダーに同じ調整済みサイズを使う。
		const scene = getTimelineScene(project.timelineScenes, project.sceneId);
		const settings = {
			...requestedSettings,
			...(resolutionScale == null
				? adjustExportResolution(requestedSettings, requestedSettings.format)
				: scaleExportResolution(getSceneBaseResolution(scene.resolution, project.resolution), resolutionScale, requestedSettings.format)),
		};
		if (getSceneDuration(scene) <= 0) throw new Error('Cannot export an empty scene.');
		const validationError = validateExportSettings(settings);
		if (validationError) throw new Error(validationError);
		send({ type: 'progress', progress: { phase: 'preparing', completedFrames: 0, totalFrames: 0 } });
		const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
		if (!adapter) throw new Error('WebGPU is unavailable.');
		// 画像やエンコーダーを確保する前に実GPUの上限を確認する。黙って縮小すると
		// 書き出し設定とファイルの寸法が食い違うため、上限超過は明示的に失敗させる。
		const gpuValidationError = validateExportSettings(settings, adapter.limits.maxTextureDimension2D);
		if (gpuValidationError != null) throw new Error(gpuValidationError);
		const canvas = new OffscreenCanvas(settings.width, settings.height);
		if (settings.format === 'mp4') {
			const audioClips = getExportAudioClips(getTimelineScenesWithProjectAutomationGraphs(project.timelineScenes, project.automationGraphs), project.sceneId, settings, project.generatedSpeech);
			writer = await createMp4Writer(canvas, settings, audioClips.length > 0);
			if (audioClips.length > 0) audio = new TimelineAudioExport(project.assets, audioClips, settings, project.generatedSpeech);
		}
		device = await adapter.requestDevice({
			requiredFeatures: rendererSettings.enable32bitDataTextures ? ['float32-filterable'] : [],
			// requiredLimitsを省略すると、対応GPUでも既定の8192pxに制限される。
			// 子Sceneや個別解像度のノードもあるため、最終出力寸法だけでなく対応上限を要求する。
			requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
		});
		const fail = (message: string) => {
			if (finished || gpuReleased) return;
			controller.abort(new Error(message));
			// GPU障害で待機Promiseが解決しなくても、UIへ通知してWorkerを終了できるようにする。
			send({ type: 'error', message });
		};
		device.addEventListener('uncapturederror', event => fail(event.error.message));
		void device.lost.then(info => fail(info.message || 'Export GPU device was lost.'));
		const context = canvas.getContext('webgpu');
		if (!(context instanceof GPUCanvasContext)) throw new Error('Could not create the export canvas.');
		renderer = await TimelineRendererManager.create({
			gpuDevice: device,
			gpuContext: context,
			// プレビューの広色域化とは独立して、SDRの書き出しをsRGBへ固定する。
			canvasOutput: createSrgbCanvasOutputSettings(),
			effectDefinitions,
			effectImplementations,
		}, {
			...rendererSettings,
			timelineFps,
			timelineMotionBlur,
			enableStats: false,
			enableWaveformAndHistogram: false,
		}, { assets, customShaderEffects }, controller.signal);
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
		renderer.updateDynamicOptions({
			...dynamicProjectOptions,
			// カスタム指定では出力Sceneだけの基準サイズを差し替える。別比率の出力も
			// 引き伸ばさずその画角で描画し、子Sceneやプロジェクトの基準サイズは保持する。
			timelineScenes: resolutionScale == null ? project.timelineScenes.map(entry => entry.id === scene.id
				? { ...entry, resolution: { mode: 'customAbsolute', width: settings.width, height: settings.height } }
				: entry) : project.timelineScenes,
			resolutionScale: resolutionScale ?? 1,
			outputResolution: { width: settings.width, height: settings.height },
			opaqueOutput: settings.format === 'mp4',
		});
		controller.signal.throwIfAborted();
		if (settings.format === 'exr') {
			send({ type: 'progress', progress: { phase: 'rendering', completedFrames: 0, totalFrames: 1 } });
			const image = await renderer.renderTimelineLinearFrame(settings.positionMs, controller.signal);
			try {
				const buffer = await encodeStillOpenExr(image, settings, controller.signal,
					progress => send({ type: 'progress', progress }));
				controller.signal.throwIfAborted();
				finished = true;
				send({ type: 'complete', buffer }, [buffer]);
			} finally { image.dispose(); }
			return;
		}
		if (settings.format === 'webp') {
			send({ type: 'progress', progress: { phase: 'rendering', completedFrames: 0, totalFrames: 1 } });
			const image = await renderer.renderTimelineSrgbFrame(settings.positionMs, controller.signal);
			let encoder: Awaited<ReturnType<typeof prepareStillWebp>>;
			try {
				encoder = await prepareStillWebp(image, settings, controller.signal);
			} finally { image.dispose(); }
			try {
				controller.signal.throwIfAborted();
				// 全画素の取り込み後はGPUを使わない。意図したdevice.destroy()のlost通知を
				// 失敗として扱わず、圧縮の作業領域と描画資源を重ねない。
				gpuReleased = true;
				renderer.destroy();
				renderer = null;
				device = null;
				context.unconfigure();
				canvas.width = 1;
				canvas.height = 1;
				send({ type: 'progress', progress: { phase: 'finalizing', completedFrames: 1, totalFrames: 1 } });
				await encoder.encode((chunk, _completedBytes, totalBytes) => writeChunk(chunk, totalBytes));
				controller.signal.throwIfAborted();
				finished = true;
				send({ type: 'complete', buffer: new ArrayBuffer(0) });
			} finally { encoder.dispose(); }
			return;
		}
		let lastProgressTime = 0;
		await renderExportFrames(settings, {
			signal: controller.signal,
			render: frame => renderer!.renderTimelineFrame(frame.timeMs, frame.timeDeltaMs, settings.fps),
			addFrame: frame => writer!.addFrame(frame.timestamp, frame.duration),
			addAudioUntil: audio ? time => audio!.renderUntil(time, (pcm, timestamp) => writer!.addAudio(pcm, timestamp), controller.signal) : null,
			finalize: () => writer!.finalize(),
			onProgress: progress => {
				const now = performance.now();
				if (progress.phase === 'finalizing' || now - lastProgressTime >= 100) {
					send({ type: 'progress', progress });
					lastProgressTime = now;
				}
			},
		});
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
