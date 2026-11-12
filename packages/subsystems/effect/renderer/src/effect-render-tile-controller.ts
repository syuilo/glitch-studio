import type { EffectRenderWorkloadHint } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';

export type EffectRenderTile = { x: number; y: number; width: number; height: number };

const INITIAL_TILE_PIXELS = 64 * 64;
const MINIMUM_TILE_SIZE = 64;
const TARGET_TILE_TIME_MS = 32;
const FAST_TILE_TIME_MS = TARGET_TILE_TIME_MS / 4;
const FAST_SAMPLES_TO_GROW = 4;
const SLOW_SAMPLES_TO_SHRINK = 3;
const LONG_TILE_TIME_MS = TARGET_TILE_TIME_MS * 4;
const RECOVERY_TILE_TIME_MS = TARGET_TILE_TIME_MS * 0.75;

function getMinimumTilePixels(width: number, height: number): number {
	// 小さな中間テクスチャや細長い描画先では、実在する辺の長さまでに留める。
	return Math.min(width, MINIMUM_TILE_SIZE) * Math.min(height, MINIMUM_TILE_SIZE);
}

type PassState = {
	pipelines: readonly unknown[];
	width: number;
	height: number;
	workloadKey: string | null;
	workPerPixel: number;
	maximumTilePixels: number;
	fastSamples: number;
	slowSamples: number;
	previousReduction: { pixels: number; timeMs: number } | null;
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
		const minimumTilePixels = getMinimumTilePixels(width, height);
		// ヒントなしでは入力内容の変化を判定できない。前回の軽い計測から巨大な
		// 最初のタイルを送らず、毎回の本描画の一部を使って確認する。
		if (hint == null || state == null || state.workloadKey !== hint.key || state.width !== width || state.height !== height
			|| state.pipelines.length !== pipelines.length || state.pipelines.some((pipeline, pipelineIndex) => pipeline !== pipelines[pipelineIndex])) {
			state = { pipelines: [...pipelines], width, height, workloadKey: hint?.key ?? null, workPerPixel,
				maximumTilePixels: Math.min(width * height, INITIAL_TILE_PIXELS), fastSamples: 0, slowSamples: 0,
				previousReduction: null, minimumTilePixels, canRenderUntiled: false };
			this.passes.set(index, state);
		} else {
			// 反復数などが急増したフレームも、前回と同じ面積を送る前に縮小する。
			// 負荷が減った場合の拡大は実測後だけにして、解除を慎重に行う。
			state.maximumTilePixels = Math.max(minimumTilePixels, Math.floor(state.maximumTilePixels * Math.min(1, state.workPerPixel / workPerPixel)));
			if (state.workPerPixel !== workPerPixel) {
				state.fastSamples = 0;
				state.slowSamples = 0;
				state.previousReduction = null;
				state.minimumTilePixels = minimumTilePixels;
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
	private recoveryFastSamples = 0;

	constructor(state: PassState) { this.state = state; }

	get maximumTilePixels(): number { return this.state.maximumTilePixels; }

	observe(pixels: number, timeMs: number) {
		if (!Number.isFinite(timeMs) || timeMs < 0) return;
		const state = this.state;
		this.maximumTimeMs = Math.max(this.maximumTimeMs, timeMs);
		this.largestTilePixels = Math.max(this.largestTilePixels, pixels);
		if (timeMs < RECOVERY_TILE_TIME_MS && pixels >= state.maximumTilePixels / 2) this.recoveryFastSamples++;
		else this.recoveryFastSamples = 0;
		if (timeMs > TARGET_TILE_TIME_MS) {
			state.fastSamples = 0;
			state.slowSamples++;
			// 完了通知の遅延はGPU実行時間とは限らない。散発的な32ms超の待機で
			// 毎回縮小すると、速いGPUでも1画素ずつの送信まで細分化してしまう。
			// 目標時間を少し超える程度なら連続した観測を要求し、大幅超過には即応する。
			if (timeMs < LONG_TILE_TIME_MS && state.slowSamples < SLOW_SAMPLES_TO_SHRINK) return;
			const previous = state.previousReduction;
			if (previous != null && timeMs > previous.timeMs * 2) state.minimumTilePixels = getMinimumTilePixels(state.width, state.height);
			// 面積を大幅に減らしても待機時間が変わらなければ、通知遅延などの固定費が
			// 支配している可能性がある。固定の64px下限より手前でも縮小を止め、待機回数を抑える。
			if (previous != null && pixels <= previous.pixels / 2 && timeMs >= previous.timeMs * 0.8) {
				state.minimumTilePixels = Math.max(state.minimumTilePixels, pixels);
			}
			state.maximumTilePixels = Math.max(state.minimumTilePixels, Math.min(state.maximumTilePixels,
				Math.floor(pixels * Math.max(0.125, Math.min(0.5, TARGET_TILE_TIME_MS / timeMs / 2)))));
			state.previousReduction = { pixels, timeMs };
			state.slowSamples = 0;
		} else {
			state.slowSamples = 0;
			if (timeMs < FAST_TILE_TIME_MS && pixels >= state.maximumTilePixels / 2) state.fastSamples++;
			else state.fastSamples = 0;
		}
		// ヒントで面積を大幅に縮小した後も、描画完了まで小さいままでは数千回の
		// submit・完了待ちになる。余裕が続く場合は、初回にも使用する保守的な上限まで
		// 同じパス内で回復する。その上限を超える拡大は、全領域の完了後だけに許す。
		const recoveryLimit = Math.min(INITIAL_TILE_PIXELS, state.width * state.height);
		if (this.recoveryFastSamples >= FAST_SAMPLES_TO_GROW && state.maximumTilePixels < recoveryLimit) {
			state.maximumTilePixels = Math.min(recoveryLimit, state.maximumTilePixels * 2);
			this.recoveryFastSamples = 0;
		}
	}

	finish() {
		const state = this.state;
		state.canRenderUntiled = this.largestTilePixels === state.width * state.height && this.maximumTimeMs < FAST_TILE_TIME_MS;
		// 初期の保守的な上限を超える拡大は、全領域の完了後にだけ行う。
		// 隅の速いタイルだけで判断せず、同じパス内の局所的な負荷差も判定に含める。
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
			// 面積上限だけでは、奇数寸法の64×65pxなども32px幅へ二分されてしまう。
			// 子の各辺を64px以上に保てる場合だけ分割し、下限を面積の目標より優先する。
			if (tile.width * tile.height > this.maximumTilePixels && Math.max(tile.width, tile.height) >= MINIMUM_TILE_SIZE * 2) {
				if (tile.width >= tile.height) {
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
