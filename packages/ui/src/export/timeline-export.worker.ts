import { MainRenderer } from '@glitch/renderer/renderer.ts';
import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { effectImplementations } from '@glitch/shared/effect-implementations.js';
import { createMp4Writer } from './mp4-writer.ts';
import { adjustExportResolution } from './export-settings.ts';
import { encodeStillWebp } from './still-webp.ts';
import { renderExportFrames, validateExportSettings } from './timeline-export.ts';
import type { ExportRequest, ExportResponse } from './types.ts';

function send(message: ExportResponse, transfer: Transferable[] = []) {
	self.postMessage(message, { transfer });
}

// 1ジョブにつき1Worker。Playerのライブ入力は接続せず、専用のGPUDeviceと履歴を持つ。
// キャンセル時は呼び出し元がWorkerを終了し、準備待ち・エンコード待ちも即座に中断する。
self.onmessage = async (event: MessageEvent<ExportRequest>) => {
	let renderer: MainRenderer | undefined;
	let device: GPUDevice | undefined;
	let writer: Awaited<ReturnType<typeof createMp4Writer>> | undefined;
	const controller = new AbortController();
	let finished = false;
	try {
		const { settings: requestedSettings, project, renderer: rendererSettings } = event.data;
		// UI以外から呼ばれても、Canvasとエンコーダーに同じ調整済みサイズを使う。
		const settings = { ...requestedSettings, ...adjustExportResolution(requestedSettings, requestedSettings.format) };
		const validationError = validateExportSettings(settings);
		if (validationError) throw new Error(validationError);
		send({ type: 'progress', progress: { phase: 'preparing', completedFrames: 0, totalFrames: 0 } });
		const canvas = new OffscreenCanvas(settings.width, settings.height);
		if (settings.format === 'mp4') writer = await createMp4Writer(canvas, settings);
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
		renderer = new MainRenderer({
			gpuDevice: device,
			gpuContext: context,
			resolution: { width: settings.width, height: settings.height },
			...rendererSettings,
			...project,
			enableStats: false,
			opaqueOutput: settings.format === 'mp4',
			fpsLimit: null,
			effectDefinitions,
			effectImplementations,
			onEffectStatus: (_source, nodeId, status) => {
				if (status?.type === 'error') fail(`Node ${nodeId}: ${status.message}`);
			},
		});
		if (settings.format === 'webp') {
			await renderer.renderTimelineFrame(settings.startTimeMs, 0);
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
		await renderExportFrames(settings, {
			signal: controller.signal,
			render: frame => renderer!.renderTimelineFrame(frame.timeMs, frame.timeDeltaMs),
			addFrame: frame => writer!.addFrame(frame.timestamp, frame.duration),
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
		renderer?.destroy();
		device?.destroy();
	}
};
