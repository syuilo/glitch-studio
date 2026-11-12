import type { EffectRenderWorkloadHint } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';

export type EffectRenderTile = { x: number; y: number; width: number; height: number };

const MINIMUM_TILE_SIZE = 128;
const INITIAL_TILE_PIXELS = MINIMUM_TILE_SIZE * MINIMUM_TILE_SIZE;
const GPU_PASS_BUDGET_MS = 500;
const GPU_GROWTH_HEADROOM = 0.5;
const GPU_FULL_PASS_HEADROOM = 0.75;
const GPU_SAMPLES_TO_GROW = 2;
const GPU_SAMPLE_INTERVAL = 8;
const GPU_PROBE_MAXIMUM_GROWTH = 16;
const GPU_PROBE_POSITIONS = [[0, 0], [1, 1], [1, 0], [0, 1], [0.5, 0.5]] as const;
// Timestamp Queryを利用できない場合だけ使う、通知遅延も含めた保守的な制御。
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

function splitEffectRenderTile(tile: EffectRenderTile, maximumTilePixels: number): [EffectRenderTile, EffectRenderTile] | null {
	// 計数と実際の分割で同じ条件を使い、端数寸法でも進捗の総数を一致させる。
	// 下限を面積目標より優先し、128×129pxなどを64px幅へ二分しない。
	if (tile.width * tile.height <= maximumTilePixels || Math.max(tile.width, tile.height) < MINIMUM_TILE_SIZE * 2) return null;
	if (tile.width >= tile.height) {
		const firstWidth = Math.floor(tile.width / 2);
		return [{ ...tile, width: firstWidth }, { ...tile, x: tile.x + firstWidth, width: tile.width - firstWidth }];
	}
	const firstHeight = Math.floor(tile.height / 2);
	return [{ ...tile, height: firstHeight }, { ...tile, y: tile.y + firstHeight, height: tile.height - firstHeight }];
}

type PassState = {
	pipelines: readonly unknown[];
	width: number;
	height: number;
	workloadKey: string | null;
	workPerPixel: number;
	usesGpuTiming: boolean;
	maximumTilePixels: number;
	fastSamples: number;
	slowSamples: number;
	previousReduction: { pixels: number; timeMs: number } | null;
	minimumTilePixels: number;
	canRenderUntiled: boolean;
	hasValidatedGpuPlan: boolean;
};

/**
 * GPUパス時間を500msの予算へ収め、通知遅延を処理負荷として学習しない。
 * Timestamp Queryが使えない場合は、タイル完了待ちの経過時間へフォールバックする。
 * 学習はインスタンス内の同じパス・pipeline・入力条件に限定し、GPU間で流用しない。
 */
export class EffectRenderTileController {
	private passes = new Map<number, PassState>();

	beginPass(index: number, pipelines: readonly unknown[], width: number, height: number, hint: EffectRenderWorkloadHint | null,
		usesGpuTiming = false): EffectRenderTilePlan {
		if (hint != null && (!Number.isFinite(hint.workPerPixel) || hint.workPerPixel <= 0)) {
			throw new Error('Effect render workload per pixel must be a finite positive number.');
		}
		let state = this.passes.get(index);
		const workPerPixel = hint?.workPerPixel ?? 1;
		const minimumTilePixels = getMinimumTilePixels(width, height);
		// ヒントなしでは入力内容の変化を判定できない。前回の軽い計測から巨大な
		// 最初のタイルを送らず、毎回の本描画の一部を使って確認する。
		if (hint == null || state == null || state.workloadKey !== hint.key || state.width !== width || state.height !== height || state.usesGpuTiming !== usesGpuTiming
			|| state.pipelines.length !== pipelines.length || state.pipelines.some((pipeline, pipelineIndex) => pipeline !== pipelines[pipelineIndex])) {
			state = { pipelines: [...pipelines], width, height, workloadKey: hint?.key ?? null, workPerPixel, usesGpuTiming,
				maximumTilePixels: Math.min(width * height, INITIAL_TILE_PIXELS), fastSamples: 0, slowSamples: 0,
				previousReduction: null, minimumTilePixels, canRenderUntiled: false, hasValidatedGpuPlan: false };
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
				state.hasValidatedGpuPlan = false;
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
	private readonly pendingTiles: EffectRenderTile[];
	private countedMaximumTilePixels: number | null = null;
	private remainingTileCountValue = 0;
	private gpuProbeIndex = 0;
	private renderedPixels = 0;
	private gpuSampleCount = 0;
	private fastGpuSamples = 0;
	private maximumGpuTimePerPixel = 0;
	private totalGpuTimeMs = 0;
	private allTilesHaveGpuTime = true;
	private largestGpuMeasuredTilePixels = 0;
	private maximumGpuTimeMs = 0;
	private tilesSinceGpuSample = 0;
	private lastGpuSamplePixels: number | null = null;
	private lastGpuSampleLimit: number | null = null;
	private forceGpuMeasurement = true;
	private usesSeparateGpuProbes = false;
	private probeMaximumGpuTimeMs = 0;
	private probeMinimumGpuTimeMs = Infinity;
	private probeSampleCount = 0;
	private probeSamplesValid = true;

	constructor(state: PassState) {
		this.state = state;
		this.pendingTiles = [{ x: 0, y: 0, width: state.width, height: state.height }];
	}

	get maximumTilePixels(): number { return this.state.maximumTilePixels; }

	/**
	 * 本描画の領域を切り取らず、再実行しても結果が変わらないパスだけで使う事前計測。
	 * 小タイルを本描画へ混ぜると、四隅・中央に開けた穴のため未送信領域が細分化したまま
	 * 残る。計測後もpendingTilesを全画面のまま保ち、最初の静止画でも少数のタイルで描く。
	 */
	*gpuProbes(): Generator<EffectRenderTile> {
		const state = this.state;
		if (!state.usesGpuTiming || state.hasValidatedGpuPlan) return;
		this.usesSeparateGpuProbes = true;
		const fullPixels = state.width * state.height;
		let previous: { pixels: number; minimumTimeMs: number; maximumTimeMs: number } | null = null;
		while (this.maximumTilePixels < fullPixels) {
			let sample = { x: 0, y: 0, width: state.width, height: state.height };
			let split = splitEffectRenderTile(sample, this.maximumTilePixels);
			while (split != null) {
				sample = split[0];
				split = splitEffectRenderTile(sample, this.maximumTilePixels);
			}
			const pixels = sample.width * sample.height;
			if (pixels === fullPixels) return;
			this.probeMaximumGpuTimeMs = 0;
			this.probeMinimumGpuTimeMs = Infinity;
			this.probeSampleCount = 0;
			this.probeSamplesValid = true;
			for (const [x, y] of GPU_PROBE_POSITIONS) {
				yield { ...sample, x: Math.round(x * (state.width - sample.width)), y: Math.round(y * (state.height - sample.height)) };
				if (!this.probeSamplesValid || this.probeMaximumGpuTimeMs > GPU_PASS_BUDGET_MS) break;
			}
			if (!this.probeSamplesValid || this.probeSampleCount === 0) return;
			// 大きい領域の四隅・中央を実測できた段階で、その面積の最悪値へ更新する。
			// 小タイルの固定費やGPUの低い並列度を全画面へ外挿し続けない。
			this.maximumGpuTimePerPixel = this.probeMaximumGpuTimeMs / pixels;
			let timePerPixel = this.maximumGpuTimePerPixel;
			let fixedTimeMs = 0;
			if (previous != null && pixels > previous.pixels) {
				// 2種類の面積から固定費と画素依存の費用を分ける。領域差を楽観視しないよう、
				// 大きい領域の最悪値と、小さい領域の最良値との差で画素単価を見積もる。
				timePerPixel = Math.max(0, (this.probeMaximumGpuTimeMs - previous.minimumTimeMs) / (pixels - previous.pixels));
				fixedTimeMs = Math.max(0, previous.maximumTimeMs - timePerPixel * previous.pixels,
					this.probeMaximumGpuTimeMs - timePerPixel * pixels);
			}
			const availableTimeMs = GPU_PASS_BUDGET_MS * GPU_GROWTH_HEADROOM - fixedTimeMs;
			const predictedPixels = availableTimeMs <= 0 ? getMinimumTilePixels(state.width, state.height)
				: timePerPixel === 0 ? fullPixels : Math.floor(availableTimeMs / timePerPixel);
			const nextPixels = Math.max(getMinimumTilePixels(state.width, state.height), Math.min(fullPixels,
				pixels * GPU_PROBE_MAXIMUM_GROWTH, predictedPixels));
			state.maximumTilePixels = nextPixels;
			if (this.probeSampleCount < GPU_PROBE_POSITIONS.length || nextPixels < pixels * 2) return;
			previous = { pixels, minimumTimeMs: this.probeMinimumGpuTimeMs, maximumTimeMs: this.probeMaximumGpuTimeMs };
		}
	}

	observeGpuProbe(gpuTimeMs: number | null) {
		this.probeSampleCount++;
		if (gpuTimeMs == null || !Number.isFinite(gpuTimeMs) || gpuTimeMs <= 0) this.probeSamplesValid = false;
		else {
			this.probeMaximumGpuTimeMs = Math.max(this.probeMaximumGpuTimeMs, gpuTimeMs);
			this.probeMinimumGpuTimeMs = Math.min(this.probeMinimumGpuTimeMs, gpuTimeMs);
		}
	}

	shouldMeasureGpuTime(pixels: number): boolean {
		return this.state.usesGpuTiming && (this.forceGpuMeasurement || this.gpuSampleCount < GPU_PROBE_POSITIONS.length
			|| this.lastGpuSamplePixels !== pixels || this.lastGpuSampleLimit !== this.maximumTilePixels
			|| this.canGrowFromGpuSamples() || this.tilesSinceGpuSample >= GPU_SAMPLE_INTERVAL - 1);
	}

	private canGrowFromGpuSamples(): boolean {
		const nextPixels = Math.min(this.state.width * this.state.height, this.maximumTilePixels * 2);
		return this.maximumGpuTimePerPixel > 0 && nextPixels > this.maximumTilePixels
			&& this.maximumGpuTimePerPixel * nextPixels <= GPU_PASS_BUDGET_MS * GPU_GROWTH_HEADROOM;
	}

	get remainingTileCount(): number {
		if (this.countedMaximumTilePixels !== this.maximumTilePixels) {
			// 全タイルを毎回列挙すると進捗表示自体が重くなる。同じ寸法の二分結果を
			// 再利用し、上限が変わったときだけ未送信の長方形から総数を数え直す。
			const counts = new Map<string, number>();
			const count = (tile: EffectRenderTile): number => {
				const key = `${tile.width},${tile.height}`;
				const cached = counts.get(key);
				if (cached != null) return cached;
				const split = splitEffectRenderTile(tile, this.maximumTilePixels);
				const result = split == null ? 1 : count(split[0]) + count(split[1]);
				counts.set(key, result);
				return result;
			};
			this.remainingTileCountValue = this.pendingTiles.reduce((total, tile) => total + count(tile), 0);
			this.countedMaximumTilePixels = this.maximumTilePixels;
		}
		return this.remainingTileCountValue;
	}

	observe(pixels: number, timeMs: number, gpuTimeMs: number | null = null) {
		this.renderedPixels += pixels;
		if (this.state.usesGpuTiming) {
			this.observeGpuTime(pixels, timeMs, gpuTimeMs);
			return;
		}
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
			// 支配している可能性がある。固定の128px下限より手前でも縮小を止め、待機回数を抑える。
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

	private observeGpuTime(pixels: number, elapsedMs: number, gpuTimeMs: number | null) {
		this.tilesSinceGpuSample++;
		if (gpuTimeMs == null || !Number.isFinite(gpuTimeMs) || gpuTimeMs <= 0) {
			this.allTilesHaveGpuTime = false;
			this.fastGpuSamples = 0;
			// 計測を間引いたタイルでは拡大しない。大きな待機や不正なtimestampが
			// あれば次のタイルを実測するが、通知待ちをGPU負荷として縮小もしない。
			if (gpuTimeMs != null || elapsedMs > GPU_PASS_BUDGET_MS) this.forceGpuMeasurement = true;
			return;
		}
		this.forceGpuMeasurement = false;
		this.tilesSinceGpuSample = 0;
		this.lastGpuSamplePixels = pixels;
		this.lastGpuSampleLimit = this.maximumTilePixels;
		this.gpuSampleCount++;
		this.totalGpuTimeMs += gpuTimeMs;
		this.maximumGpuTimeMs = Math.max(this.maximumGpuTimeMs, gpuTimeMs);
		this.largestGpuMeasuredTilePixels = Math.max(this.largestGpuMeasuredTilePixels, pixels);
		// 先に軽い領域だけを通った場合の過大な拡大を避け、今回のパスで観測した
		// 最悪側の画素単価を保持する。ヒントが変われば別のPlanで学習し直す。
		this.maximumGpuTimePerPixel = Math.max(this.maximumGpuTimePerPixel, gpuTimeMs / pixels);
		if (gpuTimeMs > GPU_PASS_BUDGET_MS) {
			this.fastGpuSamples = 0;
			this.state.maximumTilePixels = Math.max(getMinimumTilePixels(this.state.width, this.state.height),
				Math.min(this.maximumTilePixels, Math.floor(pixels * GPU_PASS_BUDGET_MS / gpuTimeMs * GPU_GROWTH_HEADROOM)));
			this.forceGpuMeasurement = true;
			return;
		}
		if (pixels >= this.maximumTilePixels / 2 && this.canGrowFromGpuSamples()) this.fastGpuSamples++;
		else this.fastGpuSamples = 0;
		if (this.gpuSampleCount >= GPU_PROBE_POSITIONS.length && this.fastGpuSamples >= GPU_SAMPLES_TO_GROW) {
			this.state.maximumTilePixels = Math.min(this.state.width * this.state.height, this.maximumTilePixels * 2);
			this.fastGpuSamples = 0;
			this.forceGpuMeasurement = true;
		}
	}

	finish() {
		const state = this.state;
		if (state.usesGpuTiming) {
			const fullPixels = state.width * state.height;
			state.hasValidatedGpuPlan = this.gpuSampleCount > 0;
			state.canRenderUntiled = this.largestGpuMeasuredTilePixels === fullPixels
				&& this.maximumGpuTimeMs <= GPU_PASS_BUDGET_MS * GPU_FULL_PASS_HEADROOM;
			// 全画素を実測済みでGPU時間の合計にも余裕があれば、小タイル特有の固定費を
			// 全画面へ外挿し続けない。次回は全画面を一度実測し、その成功後だけ通常描画へ戻す。
			if (this.renderedPixels === fullPixels && this.pendingTiles.length === 0 && this.allTilesHaveGpuTime
				&& this.totalGpuTimeMs > 0 && this.totalGpuTimeMs <= GPU_PASS_BUDGET_MS * GPU_FULL_PASS_HEADROOM) state.maximumTilePixels = fullPixels;
			return;
		}
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
		while (this.pendingTiles.length > 0) {
			const probe = this.state.usesGpuTiming && !this.usesSeparateGpuProbes ? GPU_PROBE_POSITIONS[this.gpuProbeIndex] : null;
			const probeX = probe == null ? 0 : Math.floor(probe[0] * (this.state.width - 1));
			const probeY = probe == null ? 0 : Math.floor(probe[1] * (this.state.height - 1));
			const probeIndex = probe == null ? -1 : this.pendingTiles.findIndex(tile => probeX >= tile.x && probeX < tile.x + tile.width
				&& probeY >= tile.y && probeY < tile.y + tile.height);
			// GPU計測の最初の数タイルを四隅と中央へ分散させる。未送信領域から取り出す
			// 順序だけを変え、追加の試し描き・画素の重複・完成画像の変更は行わない。
			const tile = probeIndex < 0 ? this.pendingTiles.pop()! : this.pendingTiles.splice(probeIndex, 1)[0];
			const split = splitEffectRenderTile(tile, this.maximumTilePixels);
			if (split != null) {
				this.pendingTiles.push(split[1], split[0]);
				continue;
			}
			if (this.countedMaximumTilePixels === this.maximumTilePixels) this.remainingTileCountValue--;
			else this.countedMaximumTilePixels = null;
			this.gpuProbeIndex++;
			yield { tile, last: this.pendingTiles.length === 0 };
		}
	}
}
