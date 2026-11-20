import TimingHelper from '@gs/shared/gpu/TimingHelper.ts';
import { EffectGpuCommandRecorder } from './tiling/effect-gpu-command-recorder.ts';
import { EffectRenderTileController } from './tiling/effect-render-tile-controller.ts';
import type { EffectRenderWorkloadHint, EffectRenderTiling, EffectRenderTilingProgressObserver } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { EffectFrameContext, EffectRenderOperation } from './effect-instance.ts';

export type CollectGpuTime = (result: number | null | Promise<number | null>) => void;

/** 通常の経路では呼び出し側のencoderに直接記録する。計測・分割する配置だけコマンドを記録し直す。 */
export function createEffectGpuExecution(device: GPUDevice, operation: EffectRenderOperation, tiling: EffectRenderTiling,
	longRunning: boolean, report?: (index: number, milliseconds: number | null) => void) {
	const controller = tiling.mode === 'auto' && longRunning ? new EffectRenderTileController() : null;
	let tiledTimer: TimingHelper | null = null;
	const timers = new Set<TimingHelper>();
	const freeTimers: TimingHelper[] = [];
	let disposed = false;
	let sampleAfter = 0;
	let sampledHint: EffectRenderWorkloadHint | null = null;
	let nextHint: EffectRenderWorkloadHint | null = null;
	return {
		shouldTile() {
			if (controller == null) return tiling.mode === 'manual';
			nextHint = operation.getRenderWorkloadHint?.() ?? null;
			if (!controller.canRenderUntiled(nextHint)) return true;
			if (sampleAfter-- > 0) return false;
			if (!device.features.has('timestamp-query')) return true;
			sampledHint = nextHint;
			sampleAfter = 30;
			return false;
		},
		record(frame: EffectFrameContext, commandEncoder: GPUCommandEncoder, collectGpuTime?: CollectGpuTime) {
			const observe = sampledHint == null ? null : controller!.createUntiledGpuTimeObserver(sampledHint);
			sampledHint = null;
			if (report == null && observe == null && collectGpuTime == null) { operation.render({ ...frame, commandEncoder }); return; }
			const recorder = new EffectGpuCommandRecorder();
			operation.render({ ...frame, commandEncoder: recorder.encoder });
			const timer = device.features.has('timestamp-query') ? freeTimers.pop() ?? new TimingHelper(device) : null;
			if (timer != null) timers.add(timer);
			try {
				recorder.replayUntiled(commandEncoder, timer, report == null && observe == null ? undefined : (index, pipelines, width, height, duration) => {
					observe?.(index, pipelines, width, height, duration);
					report?.(index, duration);
				});
				if (collectGpuTime != null && recorder.hasPasses) {
					collectGpuTime(timer == null ? null : new Promise(resolve => {
						timer.observeResult(duration => resolve(duration == null ? null : duration / 1_000_000));
					}));
				}
			} finally {
				timer?.observeResult(() => { if (!disposed) freeTimers.push(timer); });
				timer?.readResultAfterSubmission();
			}
		},
		async renderTiled(frame: EffectFrameContext, signal: AbortSignal, onProgress?: EffectRenderTilingProgressObserver, collectGpuTime?: CollectGpuTime) {
			const recorder = new EffectGpuCommandRecorder();
			operation.render({ ...frame, commandEncoder: recorder.encoder });
			let milliseconds: number | null = 0;
			const onPassTime = collectGpuTime == null ? report : (index: number, duration: number | null) => {
				report?.(index, duration);
				milliseconds = milliseconds == null || duration == null ? null : milliseconds + duration;
			};
			if ((onPassTime != null || controller != null) && device.features.has('timestamp-query')) tiledTimer ??= new TimingHelper(device);
			await recorder.execute(device, tiling, signal, {
				timingHelper: tiledTimer, collectStatistics: onPassTime != null, tileController: controller,
				workloadHint: nextHint, onProgress, onPassTime,
			});
			collectGpuTime?.(milliseconds);
			sampleAfter = 30;
		},
		reset() { controller?.reset(); sampledHint = null; sampleAfter = 0; },
		dispose() {
			disposed = true;
			tiledTimer?.dispose();
			for (const timer of timers) timer.dispose();
			timers.clear();
			freeTimers.length = 0;
		},
	};
}
