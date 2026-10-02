import { getTimelineClipContentTime, isTimelineClipActive } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';

// 制御に必要なのはIDと期間だけ。レイヤー固有のデータは生成関数にそのまま渡す。
export type TimelineRenderEntry = { id: string; clips: readonly TimelineClip[] };

export type TimelineLayerContext<Output> = {
	isExport: boolean;
	/** レイヤー設定・キーは所属Scene上、素材・モジュールは内容時刻で評価する。 */
	sceneTimeMs: number;
	contentTimeMs: number;
	clipElapsedTimeMs: number;
	clipDurationMs: number;
	contentEndTimeMs: number;
	timeDelta: number;
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
	createLayer: (entry: Entry, clipId: string) => TimelineLayerRenderer<Output>;
	/** 定義の変更によって再生成が必要なときだけ変わる値。配置先の解釈は呼び出し側が行う。 */
	getLayerVersion?: (entry: Entry, clipId: string) => string | number;
	present?: (output: Output, gpuTime: number) => void;
	onClear?: () => void;
};

// レイヤーの順序と寿命、非同期シークを管理する。GPUやCanvasには依存しない。
export class TimelineRenderer<Output, Entry extends TimelineRenderEntry = TimelineRenderEntry> {
	private options: TimelineRendererOptions<Output, Entry>;
	private layers = new Map<string, { renderer: TimelineLayerRenderer<Output>; version: string | number | undefined }>();
	private controller: AbortController | null = null;

	constructor(options: TimelineRendererOptions<Output, Entry>) {
		this.options = options;
	}

	public cancelPendingRender() {
		this.controller?.abort();
		this.controller = null;
	}

	public clear() {
		this.cancelPendingRender();
		for (const layer of this.layers.values()) layer.renderer.destroy();
		this.layers.clear();
		this.options.onClear?.();
	}

	/** timeはミリ秒。編集は準備中のシークだけを中断し、変更のない配置を再利用する。 */
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
			const visibleEntries = timeline.flatMap(entry => {
				const clip = entry.clips.find(clip => isTimelineClipActive(clip, time));
				return clip ? [{ entry, clip, instanceKey: JSON.stringify([entry.id, clip.id]) }] : [];
			}).reverse();
			// 現時点では表示するレイヤーだけを評価する。事前評価を追加するときは、
			// 必要な下層も含む評価対象をここで決め、表示判定とは独立して寿命を管理する。
			const evaluationEntries = visibleEntries;
			this.releaseUnusedLayers(new Set(evaluationEntries.map(entry => entry.instanceKey)));
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
			layer.renderer.destroy();
			this.layers.delete(id);
		}
	}

	/** 表示範囲の判定やpresentは行わず、指定された対象を内容時刻で評価・合成する。 */
	private async evaluateLayers(time: number, entries: readonly { entry: Entry; clip: TimelineClip; instanceKey: string }[], timeDelta: number, isExport: boolean, signal: AbortSignal) {
		let output = this.options.fallbackOutput;
		let gpuTime = 0;
		for (const { entry, clip, instanceKey } of entries) {
			// IDはレイヤー内だけで一意。同じモジュール・子Sceneの隣接クリップも別の履歴を持つ。
			let layer = this.layers.get(instanceKey);
			const version = this.options.getLayerVersion?.(entry, clip.id);
			if (layer != null && layer.version !== version) {
				layer.renderer.destroy();
				this.layers.delete(instanceKey);
				layer = undefined;
			}
			const isNewLayer = layer == null;
			if (layer == null) {
				layer = { renderer: this.options.createLayer(entry, clip.id), version };
				this.layers.set(instanceKey, layer);
			}
			const context: TimelineLayerContext<Output> = {
				isExport,
				sceneTimeMs: time,
				contentTimeMs: getTimelineClipContentTime(clip, time),
				clipElapsedTimeMs: time - clip.startMs,
				clipDurationMs: clip.durationMs,
				// 新規レイヤーには履歴がない。途中からの書き出しでも過去のフレームは再現しない。
				timeDelta: isNewLayer ? 0 : timeDelta,
				// 終端は内容の座標系、進行率は表示区間で定義する。TIME / END_TIMEでは求められない。
				contentEndTimeMs: clip.contentOffsetMs + clip.durationMs,
				input: output,
			};
			const result = await layer.renderer.evaluate(context, signal);
			// 準備・描画・計測の待機中に別のシークが開始された場合は表示しない。
			if (signal.aborted) return;
			gpuTime += result.gpuTime;
			if (result.output != null) output = result.output;
		}
		return { output, gpuTime };
	}
}
