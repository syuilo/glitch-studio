import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.ts';
import { effectImplementations } from '@glitch/shared/effect/effect-implementations.js';
import { createManager, VisualModuleRendererManager } from './visual-module-renderer-manager.ts';

let manager: VisualModuleRendererManager | null = null;
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
	if (manager == null) return;
	self.postMessage({ type: 'telemetry', stats: {
		fpsAverage: manager.fpsAverage.get(),
		gpuAverageFast: manager.gpuAverageFast.get(),
		gpuAverageMedium: manager.gpuAverageMedium.get(),
		gpuAverageSlow: manager.gpuAverageSlow.get(),
	} });
}, 100);

function reportGpuMemory() {
	if (manager == null) return;
	self.postMessage({ type: 'gpuMemory', usage: manager.gpuMemory.getUsage() });
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

				manager = await createManager({
					canvas,
					histogramCanvas,
					waveformHorizontalCanvas,
					waveformVerticalCanvas,
					staticOptions: event.data.staticOptions,
					dynamicOptions: event.data.dynamicOptions,
					effectDefinitions,
					effectImplementations,
					onEffectState: (source, nodeId, state) => self.postMessage({ type: 'effectState', source, nodeId, state }),
					onPreviewError: reportPreviewError,
				});

				self.postMessage({ type: 'inited' });
				reportGpuMemory();
			} catch (error) {
				manager?.destroy();
				manager = null;
				self.postMessage({ type: 'initError', message: error instanceof Error ? error.message : String(error) });
			}
			break;
		}
		case 'call': {
			try {
				if (manager == null) throw new Error('Renderer is not initialized');
				// Worker越しのメッセージは実行時に届くため、呼び出せるメソッドか確認する。
				const method = Reflect.get(manager, event.data.fn);
				if (typeof method !== 'function') throw new Error(`Unknown manager method: ${event.data.fn}`);
				// 戻り値不要の呼び出しもawaitし、非同期の失敗を未処理のrejectにしない。
				const res = await Reflect.apply(method, manager, event.data.args ?? []);
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
