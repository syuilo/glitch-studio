import type { CpuPreviewCanvasContext, CpuPreviewReadback } from './preview-canvas-context.ts';

/** 全出力のUI返却までを一つの表示枠として扱い、描画前に確保する。 */
export class CpuPreviewFrameReservation {
	private readonly remainingContexts: Set<CpuPreviewCanvasContext>;
	private readonly readbacks: CpuPreviewReadback[] = [];
	private prepared = false;
	private cancelled = false;
	private released = false;
	public get isCancelled() { return this.cancelled; }

	constructor(private readonly contexts: readonly CpuPreviewCanvasContext[], private readonly onReleased: () => void) {
		this.remainingContexts = new Set(contexts);
	}

	public prepareReadback(encoder: GPUCommandEncoder) {
		if (this.cancelled) return;
		if (this.prepared) throw new Error('CPU preview readback is already prepared');
		this.prepared = true;
		try {
			for (const context of this.contexts) {
				const readback = context.prepareReadback(encoder, () => {
					this.remainingContexts.delete(context);
					if (this.remainingContexts.size === 0) this.release();
				});
				if (readback != null) this.readbacks.push(readback);
				else this.remainingContexts.delete(context);
			}
			if (this.remainingContexts.size === 0) this.release();
		} catch (error) { this.cancel(); throw error; }
	}

	public async complete() {
		await Promise.all(this.readbacks.map(readback => readback.complete()));
	}

	public cancel() {
		this.cancelled = true;
		for (const readback of this.readbacks) readback.cancel();
		this.release();
	}

	private release() {
		if (this.released) return;
		this.released = true;
		this.onReleased();
	}
}

/** 読み戻し中とUI返却待ちを重複せず数え、上限をこの一か所で所有する。 */
export class CpuPreviewFrameQueue {
	private readonly frames = new Set<CpuPreviewFrameReservation>();
	private readonly waiters = new Set<() => void>();
	private destroyed = false;

	constructor(private readonly contexts: readonly CpuPreviewCanvasContext[]) {}

	public tryReserveFrame(contexts: readonly CpuPreviewCanvasContext[] = this.contexts): CpuPreviewFrameReservation | null {
		if (this.destroyed || this.frames.size >= 2) return null;
		// 背景だけの表示更新は主Canvasだけを読み戻す。通常描画と同じ上限を使いながら、
		// 変化していない解析画像の転送・返却まで待機枠を占有することを避ける。
		const frame = new CpuPreviewFrameReservation(contexts, () => {
			this.frames.delete(frame);
			this.notifyWaiters();
		});
		this.frames.add(frame);
		return frame;
	}

	public async reserveFrame(contexts: readonly CpuPreviewCanvasContext[] = this.contexts): Promise<CpuPreviewFrameReservation | null> {
		while (!this.destroyed) {
			const frame = this.tryReserveFrame(contexts);
			if (frame != null) return frame;
			await new Promise<void>(resolve => this.waiters.add(resolve));
		}
		return null;
	}

	public clear() {
		for (const frame of this.frames) frame.cancel();
		this.notifyWaiters();
	}

	public destroy() {
		this.destroyed = true;
		this.clear();
	}

	private notifyWaiters() {
		for (const resolve of this.waiters) resolve();
		this.waiters.clear();
	}
}
