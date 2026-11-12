const GPU_QUEUED_WORK_BUDGET_MS = 375;
const INITIAL_GPU_SAMPLES = 5;
const GPU_SAMPLE_INTERVAL = 8;

/**
 * タイルの寸法は変更せず、実測済みの仕事をいくつ先行投入できるかだけを決める。
 * 自動分割と手動分割で共有し、既に有効なTimestamp Query以外の計測は要求しない。
 */
export class EffectRenderTileSubmissionBudget {
	private sampleCount = 0;
	private maximumGpuTimePerPixel = 0;
	private tilesSinceGpuSample = 0;
	private lastMeasuredPixels: number | null = null;
	private requiresMeasurement = true;

	maximumInFlightTiles(maximumTilePixels: number): number {
		// キュー全体にも余裕を持たせる。予算は一枚につき375msではなく、二枚の合計。
		return !this.requiresMeasurement && this.sampleCount >= INITIAL_GPU_SAMPLES && this.maximumGpuTimePerPixel > 0
			&& maximumTilePixels * 2 * this.maximumGpuTimePerPixel <= GPU_QUEUED_WORK_BUDGET_MS ? 2 : 1;
	}

	shouldMeasureGpuTime(pixels: number): boolean {
		return this.requiresMeasurement || this.sampleCount < INITIAL_GPU_SAMPLES || this.lastMeasuredPixels !== pixels
			|| this.tilesSinceGpuSample >= GPU_SAMPLE_INTERVAL - 1;
	}

	observe(pixels: number, gpuTimeMs: number | null, measured: boolean) {
		this.tilesSinceGpuSample++;
		if (!measured) return;
		if (gpuTimeMs == null || !Number.isFinite(gpuTimeMs) || gpuTimeMs <= 0) {
			this.requiresMeasurement = true;
			this.sampleCount = 0;
			return;
		}
		this.requiresMeasurement = false;
		this.sampleCount++;
		this.lastMeasuredPixels = pixels;
		this.tilesSinceGpuSample = 0;
		this.maximumGpuTimePerPixel = Math.max(this.maximumGpuTimePerPixel, gpuTimeMs / pixels);
	}
}
