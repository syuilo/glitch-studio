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
	const recordingTimers = new WeakMap<GPUCommandEncoder, TimingHelper>();
	let sampleAfter = 0;
	let sampledHint: EffectRenderWorkloadHint | null = null;
	let nextHint: EffectRenderWorkloadHint | null = null;
	function disposeTimer(timer: TimingHelper) {
		timers.delete(timer);
		timer.dispose();
	}
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
			if (timer != null) {
				timers.add(timer);
				recordingTimers.set(commandEncoder, timer);
			}
			try {
				// 定期計測と統計で同じQueryを使い、同じパスの時間を重ねて計測するのを避ける。
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
				// submit後にreadbackを進め、描画ループを止めずに結果が返ったタイマーだけを再利用する。
				timer?.observeResult(() => {
					recordingTimers.delete(commandEncoder);
					if (timers.has(timer)) freeTimers.push(timer);
				});
				timer?.readResultAfterSubmission();
			}
		},
		async renderTiled(frame: EffectFrameContext, signal: AbortSignal, onProgress?: EffectRenderTilingProgressObserver, collectGpuTime?: CollectGpuTime) {
			const recorder = new EffectGpuCommandRecorder();
			// CPU側のカウンターや履歴がタイル数に応じて進まないよう、renderは一度だけ呼び、記録したコマンドを分割して再生する。
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
		reset(unsubmittedEncoder?: GPUCommandEncoder | null) {
			controller?.reset(); sampledHint = null; sampleAfter = 0;
			// 破棄したencoderの統計は送信後の通知が来ない。先に送信済みの読み戻しは継続する。
			const timer = unsubmittedEncoder == null ? null : recordingTimers.get(unsubmittedEncoder);
			if (timer != null) disposeTimer(timer);
		},
		dispose() {
			tiledTimer?.dispose();
			for (const timer of timers) disposeTimer(timer);
			freeTimers.length = 0;
		},
	};
}
