import { getTimelineLayerContentTime, getTimelineLayerVisibleTime, isTimelineLayerVisible } from '@glitch/shared/timeline/timing.ts';
import type { TimelineLayerTiming } from '@glitch/shared/timeline/timing.ts';

// 制御に必要なのはIDと期間だけ。レイヤー固有のデータは生成関数にそのまま渡す。
export type TimelineRenderEntry = TimelineLayerTiming & { id: string };

export type TimelineLayerContext<Output> = {
	isExport: boolean;
	/** 内容のローカル時刻。トリム後の表示開始からの経過時間ではない。 */
	time: number;
	visibleTimeMs: number;
	timeDelta: number;
	endTime: number;
	input: Output;
};

export type TimelineLayerRenderer<Output> = {
	// 準備・描画・GPUコマンドの送信・計測を含む。非同期待機後はsignalを確認し、
	// 中断されていれば次の描画へ進まない。送信済みのGPU処理は取り消せない。
	evaluate: (context: TimelineLayerContext<Output>, signal: AbortSignal) => Promise<{ output?: Output; gpuTime: number }>;
	destroy: () => void;
};

type TimelineRendererOptions<Output, Entry extends TimelineRenderEntry> = {
	fallbackOutput: Output;
	createLayer: (entry: Entry) => TimelineLayerRenderer<Output>;
	present?: (output: Output, gpuTime: number) => void;
	onClear?: () => void;
};

// レイヤーの順序と寿命、非同期シークを管理する。GPUやCanvasには依存しない。
export class TimelineRenderer<Output, Entry extends TimelineRenderEntry = TimelineRenderEntry> {
	private options: TimelineRendererOptions<Output, Entry>;
	private layers = new Map<string, TimelineLayerRenderer<Output>>();
	private controller: AbortController | null = null;

	constructor(options: TimelineRendererOptions<Output, Entry>) {
		this.options = options;
	}

	public clear() {
		this.controller?.abort();
		this.controller = null;
		for (const layer of this.layers.values()) layer.destroy();
		this.layers.clear();
		this.options.onClear?.();
	}

	/** timeはミリ秒。編集・リサイズ・破棄時はclearで準備中のシークも中断する。 */
	public async renderAt(time: number, timeline: readonly Entry[], timeDelta = 0, isExport = false): Promise<void> {
		const pending = this.evaluateAt(time, timeline, timeDelta, isExport);
		const controller = this.controller;
		const result = await pending;
		// 評価結果のPromiseを受け取るまでの間に始まったシークでも、古い表示を採用しない。
		if (result == null || controller?.signal.aborted) return;
		try {
			this.options.present?.(result.output, result.gpuTime);
		} catch (error) {
			this.clear();
			throw error;
		}
	}

	/** 子Sceneも同じ評価を使い、Canvasへの表示は最上位だけで行う。 */
	public async evaluateAt(time: number, timeline: readonly Entry[], timeDelta = 0, isExport = false, parentSignal?: AbortSignal): Promise<{ output: Output; gpuTime: number } | undefined> {
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		const abort = () => controller.abort();
		parentSignal?.addEventListener('abort', abort, { once: true });
		if (parentSignal?.aborted) abort();
		const isCancelled = () => controller.signal.aborted;
		try {
			if (isCancelled()) return;
			// 配列は先頭が最上層の表示順。下層の合成結果を上層へ渡すため、描画は逆順に行う。
			// 終端を含めず、隣接するレイヤーを境界で重ねない。
			const visibleEntries = timeline.filter(entry => isTimelineLayerVisible(entry, time)).reverse();
			// 現時点では表示するレイヤーだけを評価する。事前評価を追加するときは、
			// 必要な下層も含む評価対象をここで決め、表示判定とは独立して寿命を管理する。
			const evaluationEntries = visibleEntries;
			this.releaseUnusedLayers(new Set(evaluationEntries.map(entry => entry.id)));
			const result = await this.evaluateLayers(time, evaluationEntries, timeDelta, isExport, controller.signal);
			if (result == null || isCancelled()) return;
			// レイヤーがない場合も透明な出力を表示し、前回の表示を残さない。
			return result;
		} catch (error) {
			if (isCancelled()) return;
			this.clear();
			throw error;
		} finally {
			parentSignal?.removeEventListener('abort', abort);
		}
	}

	private releaseUnusedLayers(retainedIds: ReadonlySet<string>) {
		for (const [id, layer] of this.layers) {
			if (retainedIds.has(id)) continue;
			layer.destroy();
			this.layers.delete(id);
		}
	}

	/** 表示範囲の判定やpresentは行わず、指定された対象を内容時刻で評価・合成する。 */
	private async evaluateLayers(time: number, entries: readonly Entry[], timeDelta: number, isExport: boolean, signal: AbortSignal) {
		let output = this.options.fallbackOutput;
		let gpuTime = 0;
		for (const entry of entries) {
			let layer = this.layers.get(entry.id);
			const isNewLayer = layer == null;
			if (layer == null) {
				layer = this.options.createLayer(entry);
				this.layers.set(entry.id, layer);
			}
			const context: TimelineLayerContext<Output> = {
				isExport,
				time: getTimelineLayerContentTime(entry, time),
				visibleTimeMs: getTimelineLayerVisibleTime(entry, time),
				// 新規レイヤーには履歴がない。途中からの書き出しでも過去のフレームは再現しない。
				timeDelta: isNewLayer ? 0 : timeDelta,
				// Visual Moduleの右端は内容の終了位置。左トリムで両値が逆方向へ動いても
				// END_TIMEは不変で、右端を伸縮したときだけ評価基準の長さが変わる。
				endTime: entry.trimStartMs + entry.trimmedDurationMs,
				input: output,
			};
			const result = await layer.evaluate(context, signal);
			// 準備・描画・計測の待機中に別のシークが開始された場合は表示しない。
			if (signal.aborted) return;
			gpuTime += result.gpuTime;
			if (result.output != null) output = result.output;
		}
		return { output, gpuTime };
	}
}
