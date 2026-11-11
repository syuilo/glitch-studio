import type { EffectRenderWorkloadHint } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';

export type EffectRenderTile = { x: number; y: number; width: number; height: number };

const INITIAL_TILE_PIXELS = 64 * 64;
const TARGET_TILE_TIME_MS = 32;
const FAST_TILE_TIME_MS = TARGET_TILE_TIME_MS / 4;
const FAST_SAMPLES_TO_GROW = 4;

type PassState = {
	pipelines: readonly unknown[];
	width: number;
	height: number;
	workloadKey: string | null;
	workPerPixel: number;
	maximumTilePixels: number;
	fastSamples: number;
	previousSample: { pixels: number; timeMs: number } | null;
	minimumTilePixels: number;
	canRenderUntiled: boolean;
};

/**
 * GPU時間のQueryを追加せず、既に必要なタイル完了待ちの経過時間から制御する。
 * 学習はインスタンス内の同じパス・pipeline・入力条件に限定し、GPU間で流用しない。
 */
export class EffectRenderTileController {
	private passes = new Map<number, PassState>();

	beginPass(index: number, pipelines: readonly unknown[], width: number, height: number, hint: EffectRenderWorkloadHint | null): EffectRenderTilePlan {
		if (hint != null && (!Number.isFinite(hint.workPerPixel) || hint.workPerPixel <= 0)) {
			throw new Error('Effect render workload per pixel must be a finite positive number.');
		}
		let state = this.passes.get(index);
		const workPerPixel = hint?.workPerPixel ?? 1;
		// ヒントなしでは入力内容の変化を判定できない。前回の軽い計測から巨大な
		// 最初のタイルを送らず、毎回の本描画の一部を使って確認する。
		if (hint == null || state == null || state.workloadKey !== hint.key || state.width !== width || state.height !== height
			|| state.pipelines.length !== pipelines.length || state.pipelines.some((pipeline, pipelineIndex) => pipeline !== pipelines[pipelineIndex])) {
			state = { pipelines: [...pipelines], width, height, workloadKey: hint?.key ?? null, workPerPixel,
				maximumTilePixels: Math.min(width * height, INITIAL_TILE_PIXELS), fastSamples: 0, previousSample: null, minimumTilePixels: 1, canRenderUntiled: false };
			this.passes.set(index, state);
		} else {
			// 反復数などが急増したフレームも、前回と同じ面積を送る前に縮小する。
			// 負荷が減った場合の拡大は実測後だけにして、解除を慎重に行う。
			state.maximumTilePixels = Math.max(1, Math.floor(state.maximumTilePixels * Math.min(1, state.workPerPixel / workPerPixel)));
			if (state.workPerPixel !== workPerPixel) {
				state.fastSamples = 0;
				state.previousSample = null;
				state.minimumTilePixels = 1;
				state.canRenderUntiled = false;
			}
			state.workPerPixel = workPerPixel;
		}
		return new EffectRenderTilePlan(state);
	}

	canRenderUntiled(hint: EffectRenderWorkloadHint | null): boolean {
		return hint != null && this.passes.size > 0 && [...this.passes.values()].every(state =>
			state.canRenderUntiled && state.workloadKey === hint.key && state.workPerPixel === hint.workPerPixel);
	}

	reset() { this.passes.clear(); }
}

export class EffectRenderTilePlan {
	private readonly state: PassState;
	private maximumTimeMs = 0;
	private largestTilePixels = 0;

	constructor(state: PassState) { this.state = state; }

	get maximumTilePixels(): number { return this.state.maximumTilePixels; }

	observe(pixels: number, timeMs: number) {
		if (!Number.isFinite(timeMs) || timeMs < 0) return;
		const state = this.state;
		this.maximumTimeMs = Math.max(this.maximumTimeMs, timeMs);
		this.largestTilePixels = Math.max(this.largestTilePixels, pixels);
		if (timeMs > TARGET_TILE_TIME_MS) {
			state.fastSamples = 0;
			const previous = state.previousSample;
			if (previous != null && timeMs > previous.timeMs * 2) state.minimumTilePixels = 1;
			// 面積を大幅に減らしても待機時間が変わらなければ、通知遅延などの固定費が
			// 支配している可能性がある。1画素まで縮小し続けて逆に停止するのを防ぐ。
			if (previous != null && pixels <= previous.pixels / 2 && timeMs >= previous.timeMs * 0.8) {
				state.minimumTilePixels = Math.max(state.minimumTilePixels, pixels);
			}
			state.maximumTilePixels = Math.max(state.minimumTilePixels, Math.min(state.maximumTilePixels,
				Math.max(1, Math.floor(pixels * Math.max(0.125, Math.min(0.5, TARGET_TILE_TIME_MS / timeMs / 2))))));
		} else if (timeMs < FAST_TILE_TIME_MS && pixels >= state.maximumTilePixels / 2) {
			state.minimumTilePixels = 1;
			state.fastSamples++;
		} else {
			state.fastSamples = 0;
		}
		state.previousSample = { pixels, timeMs };
	}

	finish() {
		const state = this.state;
		state.canRenderUntiled = this.largestTilePixels === state.width * state.height && this.maximumTimeMs < FAST_TILE_TIME_MS;
		// 隅の速いタイルだけから未観測の中心を大きく描かない。全領域を完了してから
		// 次回だけ拡大することで、同じパス内の局所的な負荷差も判定に含める。
		if (this.maximumTimeMs < FAST_TILE_TIME_MS && state.fastSamples >= FAST_SAMPLES_TO_GROW) {
			state.maximumTilePixels = Math.min(state.width * state.height, state.maximumTilePixels * 2);
			state.fastSamples = 0;
		}
	}

	/** 未送信の長方形だけを分割する。途中で面積上限が変わっても重複・欠落を生じさせない。 */
	*tiles(): Generator<{ tile: EffectRenderTile; last: boolean }> {
		const pending: EffectRenderTile[] = [{ x: 0, y: 0, width: this.state.width, height: this.state.height }];
		while (pending.length > 0) {
			const tile = pending.pop()!;
			if (tile.width * tile.height > this.maximumTilePixels) {
				if (tile.width >= tile.height && tile.width > 1) {
					const firstWidth = Math.floor(tile.width / 2);
					pending.push({ ...tile, x: tile.x + firstWidth, width: tile.width - firstWidth }, { ...tile, width: firstWidth });
				} else {
					const firstHeight = Math.floor(tile.height / 2);
					pending.push({ ...tile, y: tile.y + firstHeight, height: tile.height - firstHeight }, { ...tile, height: firstHeight });
				}
				continue;
			}
			yield { tile, last: pending.length === 0 };
		}
	}
}
