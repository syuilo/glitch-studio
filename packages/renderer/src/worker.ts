import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.ts';
import { effectImplementations } from '@glitch/shared/effect/effect-implementations.js';
import { MainRenderer } from './renderer.ts';

let renderer: MainRenderer | null = null;
let canvas: OffscreenCanvas | null = null;
let histogramCanvas: OffscreenCanvas | null = null;
let waveformHorizontalCanvas: OffscreenCanvas | null = null;
let waveformVerticalCanvas: OffscreenCanvas | null = null;
let previewError: string | null = null;

function reportPreviewError(message: string | null) {
	// 描画・操作の両方のエラーを扱い、成功した描画で解除する。
	// 同じグラフの失敗が続いても、毎フレームUIへ通知しない。
	if (previewError === message) return;
	previewError = message;
	self.postMessage({ type: 'previewError', message });
}

setInterval(() => {
	if (renderer == null) return;
	self.postMessage({ type: 'telemetry', stats: {
		fpsAverage: renderer.fpsAverage.get(),
		gpuAverageFast: renderer.gpuAverageFast.get(),
		gpuAverageMedium: renderer.gpuAverageMedium.get(),
		gpuAverageSlow: renderer.gpuAverageSlow.get(),
	} });
}, 100);

function reportGpuMemory() {
	if (renderer == null) return;
	self.postMessage({ type: 'gpuMemory', usage: renderer.gpuMemory.getUsage() });
}

setInterval(reportGpuMemory, 1000);

onmessage = async (event) => {
	//console.log('Worker received message:', event.data);

	switch (event.data?.type) {
		case 'init': {
			try {
				canvas = event.data.canvas as OffscreenCanvas;
				histogramCanvas = event.data.histogramCanvas as OffscreenCanvas;
				waveformHorizontalCanvas = event.data.waveformHorizontalCanvas as OffscreenCanvas;
				waveformVerticalCanvas = event.data.waveformVerticalCanvas as OffscreenCanvas;

				const adapter = await navigator.gpu?.requestAdapter({
					powerPreference: 'high-performance',
				});

				const device = await adapter?.requestDevice({
					requiredFeatures: [
						...(event.data.options.enable32bitDataTextures ? ['float32-filterable'] as const : []),
						...(event.data.options.enableStats ? ['timestamp-query'] as const : []),
					],
				});
				if (device == null) {
					//window.alert('need a browser that supports WebGPU');
					throw new Error('need a browser that supports WebGPU');
				}

				const context = canvas.getContext('webgpu');
				const histogramContext = histogramCanvas.getContext('webgpu');
				const waveformHorizontalContext = waveformHorizontalCanvas.getContext('webgpu');
				const waveformVerticalContext = waveformVerticalCanvas.getContext('webgpu');
				if (!(context instanceof GPUCanvasContext) || !(histogramContext instanceof GPUCanvasContext)
					|| !(waveformHorizontalContext instanceof GPUCanvasContext) || !(waveformVerticalContext instanceof GPUCanvasContext)) {
					//window.alert('cannot get webgpu context');
					throw new Error('cannot get webgpu context');
				}

				renderer = new MainRenderer({
					onEffectState: (source, nodeId, state) => self.postMessage({ type: 'effectState', source, nodeId, state }),
					onPreviewError: reportPreviewError,
					gpuDevice: device,
					gpuContext: context,
					resolution: event.data.options.resolution,
					enable32bitDataTextures: event.data.options.enable32bitDataTextures,
					intermediateTextureFormat: event.data.options.intermediateTextureFormat,
					enableStats: event.data.options.enableStats,
					highlightClipping: event.data.options.highlightClipping,
					liveTimeFactor: event.data.options.liveTimeFactor,
					fpsLimit: event.data.options.fpsLimit,
					visualModules: event.data.options.visualModules,
					timeline: event.data.options.timeline,
					histogramGpuContext: histogramContext,
					waveformHorizontalGpuContext: waveformHorizontalContext,
					waveformVerticalGpuContext: waveformVerticalContext,
					effectDefinitions: effectDefinitions,
					effectImplementations: effectImplementations,
				});

				//renderer.on('ev', ({ type, ctx }) => {
				//	self.postMessage({ type: 'ev', ev: { type, ctx } });
				//});

				await renderer.updateAssets(event.data.options.assets);
				self.postMessage({ type: 'inited' });
				reportGpuMemory();
			} catch (error) {
				renderer?.destroy();
				renderer = null;
				self.postMessage({ type: 'initError', message: error instanceof Error ? error.message : String(error) });
			}
			break;
		}
		case 'resize': {
			if (canvas == null) return;
			canvas.width = event.data.resolution.width;
			canvas.height = event.data.resolution.height;
			if (renderer != null) renderer.resize(event.data.resolution);
			break;
		}
		case 'videoFrame': {
			const { playerId, id, frame } = event.data;
			try {
				if (renderer) {
					renderer.updateVideoFrame(playerId, frame);
				} else {
					frame.close();
				}
			} finally {
				self.postMessage({ type: 'videoFrameReceived', playerId, id });
			}
			break;
		}
		case 'call': {
			try {
				if (renderer == null) throw new Error('Renderer is not initialized');
				// Worker越しのメッセージは実行時に届くため、呼び出せるメソッドか確認する。
				const method = Reflect.get(renderer, event.data.fn);
				if (typeof method !== 'function') throw new Error(`Unknown renderer method: ${event.data.fn}`);
				// 戻り値不要の呼び出しもawaitし、非同期の失敗を未処理のrejectにしない。
				const res = await Reflect.apply(method, renderer, event.data.args ?? []);
				if (event.data.needReturnValue) {
					self.postMessage({ type: 'return', id: event.data.id, success: true, value: res });
				}
			} catch (error) {
				if (!event.data.needReturnValue) {
					reportPreviewError(error instanceof Error ? error.message : String(error));
					break;
				}
				// 任意のthrow値には複製できないオブジェクトも含まれるため、エラー情報だけを返す。
				const reason = error instanceof Error ? error : new Error(String(error));
				self.postMessage({ type: 'return', id: event.data.id, success: false, error: {
					name: reason.name, message: reason.message, stack: reason.stack,
				} });
			}
			break;
		}
		default: {
			console.warn('Unrecognized message type:', event.data?.type);
		}
	}
};
