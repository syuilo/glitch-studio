import type { TimelineLayerCustomParameterContext } from '@gs/subsystems_timeline_shared/custom-parameters.ts';
import { getTimelineClipContentTime, isTimelineClipActive } from '@gs/subsystems_timeline_shared/timing.ts';
import { getTimelineMediaSourceTime } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { TimelineEvaluationSession } from './timeline-evaluation.ts';
import type { TimelineEvaluation, TimelineEvaluationResult } from './timeline-evaluation.ts';
import type { TimelineLayerOutputStage } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { TimelineRenderSpace } from '@gs/subsystems_timeline_shared/spatial.ts';

// 制御に必要なID・期間・有効状態だけを要求し、レイヤー固有のデータは生成関数にそのまま渡す。
// clipsの省略は同じ時計を使うコンテナ。空配列はクリップのない通常レイヤーを表す。
export type TimelineRenderEntry = { id: string; clips?: readonly TimelineClip[]; isDisabled: boolean; forceDisableMotionBlur?: boolean; isIncludedInComposite?: boolean };

/** 露光が境界で短縮されても、フレーム本来の時刻と経過時間を保持する。 */
export type TimelineFrameReferenceTime = { timeMs: number; timeDelta: number };

export type TimelineLayerContext<Output> = {
	customParameters?: TimelineLayerCustomParameterContext | null;
	renderSpace?: TimelineRenderSpace;
	isExport: boolean;
	/** レイヤー設定・キーは所属Scene上、素材・モジュールは内容時刻で評価する。 */
	sceneTimeMs: number;
	contentTimeMs: number;
	/** 子Sceneでは内容時刻へ変換して渡す。サンプル時刻を新しい基準時刻にしない。 */
	referenceTime?: { sceneTimeMs: number; contentTimeMs: number; timeDelta: number };
	clipElapsedTimeMs: number;
	clipDurationMs: number;
	contentEndTimeMs: number;
	timeDelta: number;
	/** 素材評価中は必要な場合だけ下層を要求し、独立した上層素材への参照を可能にする。 */
	getInput: () => Promise<Output>;
	getLayerOutput: (layerId: string | null, stage: TimelineLayerOutputStage) => Promise<Output>;
	/** コンテナではcreateChildrenの戻り値を素材評価前に設定する。 */
	childEvaluation?: TimelineEvaluation<Output>;
};

export type TimelineLayerEvaluation<Output> = {
	output?: Output | null;
	source?: Output | null;
	rendered?: (signal: AbortSignal) => Output | Promise<Output>;
	composite?: (background: Output, signal: AbortSignal) => Output | Promise<Output>;
	gpuTime: number;
};

export type TimelineEvaluationOptions<Output> = {
	time: number; timeDelta: number; isExport: boolean; signal: AbortSignal;
	referenceTime?: TimelineFrameReferenceTime; renderSpace?: TimelineRenderSpace;
	getInput: () => Promise<Output>; session: TimelineEvaluationSession<Output>;
};

export type TimelineLayerRenderer<Output> = {
	// 準備・描画・GPUコマンドの送信・計測を含む。非同期待機後はsignalを確認し、
	// 中断されていれば次の描画へ進まない。送信済みのGPU処理は取り消せない。
	evaluate: (context: TimelineLayerContext<Output>, signal: AbortSignal) => Promise<TimelineLayerEvaluation<Output>>;
	createChildren?: (context: TimelineLayerContext<Output>, options: TimelineEvaluationOptions<Output>) => TimelineEvaluation<Output>;
	destroy: () => void;
};

type TimelineRendererOptions<Output, Entry extends TimelineRenderEntry> = {
	getRenderSpace?: (time: number, isExport: boolean, referenceTime?: TimelineFrameReferenceTime) => TimelineRenderSpace;
	fallbackOutput: Output;
	createLayer: (entry: Entry, clipId: string | null) => TimelineLayerRenderer<Output>;
	/** 定義の変更によって再生成が必要なときだけ変わる値。配置先の解釈は呼び出し側が行う。 */
	getLayerVersion?: (entry: Entry, clipId: string | null) => string | number;
	present?: (output: Output, gpuTime: number) => void;
	onClear?: () => void;
};

// レイヤーの順序と寿命、非同期シークを管理する。GPUやCanvasには依存しない。
export class TimelineRenderer<Output, Entry extends TimelineRenderEntry = TimelineRenderEntry> {
	private options: TimelineRendererOptions<Output, Entry>;
	private layers = new Map<string, { renderer: TimelineLayerRenderer<Output>; version: string | number | null }>();
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
	public async evaluateAt(time: number, timeline: readonly Entry[], timeDelta = 0, isExport = false, parentSignal?: AbortSignal, referenceTime?: TimelineFrameReferenceTime, renderSpace?: TimelineRenderSpace, input = this.options.fallbackOutput): Promise<{ output: Output; gpuTime: number; hasOutput: boolean } | null> {
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		const abort = () => controller.abort();
		parentSignal?.addEventListener('abort', abort, { once: true });
		if (parentSignal?.aborted) abort();
		const isCancelled = () => controller.signal.aborted;
		try {
			if (isCancelled()) return null;
			const session = new TimelineEvaluationSession(this.options.fallbackOutput);
			const evaluation = this.createEvaluation(timeline, {
				time,
				timeDelta,
				isExport,
				signal: controller.signal,
				referenceTime,
				renderSpace: renderSpace ?? this.options.getRenderSpace?.(time, isExport, referenceTime),
				getInput: async () => input,
				session,
			});
			const result = await evaluation.evaluate();
			if (result == null || isCancelled()) return null;
			// レイヤーがない場合も透明な出力を表示し、前回の表示を残さない。
			return result;
		} catch (error) {
			if (isCancelled()) return null;
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

	/**
	 * 画像を生成する前に子孫まで登録する。子の参照解決が親Groupの素材評価を待たないため、
	 * Groupをまたぐ参照にも、通常描画と同じ時計・親変換を使える。
	 */
	public createEvaluation(timeline: readonly Entry[], options: TimelineEvaluationOptions<Output>): TimelineEvaluation<Output> {
		const { time, timeDelta, isExport, signal, referenceTime, renderSpace, session } = options;
		const entries = timeline.flatMap<{ entry: Entry; clip: TimelineClip | null; instanceKey: string; time: number }>(entry => {
			if (entry.isDisabled) return [];
			const evaluationTime = entry.forceDisableMotionBlur && referenceTime != null ? referenceTime.timeMs : time;
			if (entry.clips == null) return [{
				entry,
				clip: null,
				instanceKey: JSON.stringify([entry.id, null]),
				time: evaluationTime,
			}];
			const clip = entry.clips.find(clip => isTimelineClipActive(clip, evaluationTime));
			return clip != null ? [{
				entry,
				clip,
				instanceKey: JSON.stringify([entry.id, clip.id]),
				time: evaluationTime,
			}] : [];
		}).reverse();
		this.releaseUnusedLayers(new Set(entries.map(entry => entry.instanceKey)));
		let previous: () => Promise<TimelineEvaluationResult<Output>> = async () => ({ output: await options.getInput(), hasOutput: false, gpuTime: 0 });
		for (const { entry, clip, instanceKey, time: evaluationTime } of entries) {
			let layer = this.layers.get(instanceKey) ?? null;
			const version = this.options.getLayerVersion?.(entry, clip?.id ?? null) ?? null;
			if (layer != null && layer.version !== version) {
				layer.renderer.destroy(); this.layers.delete(instanceKey); layer = null;
			}
			const isNewLayer = layer == null;
			if (layer == null) {
				layer = { renderer: this.options.createLayer(entry, clip?.id ?? null), version };
				this.layers.set(instanceKey, layer);
			}
			const renderer = layer.renderer;
			let contentTimeMs = evaluationTime;
			let referenceContentTimeMs = referenceTime?.timeMs ?? evaluationTime;
			let contentEndTimeMs = 0;
			if (clip != null) {
				if ('sourceTimeMs' in clip) {
					contentTimeMs = clip.sourceTimeMs; referenceContentTimeMs = clip.sourceTimeMs; contentEndTimeMs = clip.sourceTimeMs;
				} else if ('sourceInMs' in clip) {
					contentTimeMs = getTimelineMediaSourceTime(clip, evaluationTime);
					referenceContentTimeMs = getTimelineMediaSourceTime(clip, referenceContentTimeMs);
					contentEndTimeMs = clip.playbackRate > 0 ? clip.sourceOutMs : clip.sourceInMs;
				} else {
					contentTimeMs = getTimelineClipContentTime(clip, evaluationTime);
					referenceContentTimeMs = getTimelineClipContentTime(clip, referenceContentTimeMs);
					contentEndTimeMs = clip.contentOffsetMs + clip.durationMs;
				}
			}
			const getPrevious = previous;
			const context: TimelineLayerContext<Output> = {
				renderSpace,
				isExport,
				sceneTimeMs: evaluationTime,
				contentTimeMs,
				// 終端は素材の時計、進行率は表示区間を使う。トリムしてもScene上のキーは動かさない。
				contentEndTimeMs,
				referenceTime: referenceTime != null ? { sceneTimeMs: referenceTime.timeMs, contentTimeMs: referenceContentTimeMs, timeDelta: referenceTime.timeDelta } : undefined,
				clipElapsedTimeMs: clip != null ? evaluationTime - clip.startMs : 0,
				clipDurationMs: clip?.durationMs ?? 0,
				// 新規配置の過去の履歴は再現しない。固定した内容の経過時間も一度だけ進める。
				timeDelta: isNewLayer ? 0 : entry.forceDisableMotionBlur && referenceTime != null ? referenceTime.timeDelta : timeDelta,
				getInput: async () => (await getPrevious()).output,
				// 参照する側のブラー無効化では取得先の時計を変えず、登録済みの通常描画を読む。
				getLayerOutput: (id, stage) => session.getLayerOutput(id, stage),
			};
			context.childEvaluation = renderer.createChildren?.(context, options);
			const prepare = () => session.memoize(entry.id, 'prepare', async () => {
				signal.throwIfAborted();
				const result = await renderer.evaluate(context, signal);
				signal.throwIfAborted();
				session.gpuTime += result.gpuTime;
				return result;
			});
			const composite = () => session.memoize(entry.id, 'prefix', async () => {
				const background = await getPrevious();
				// 通常合成から除外しても登録は残す。参照されたときだけ素材と単独描画を評価する。
				if (entry.isIncludedInComposite === false) return background;
				const result = await prepare();
				signal.throwIfAborted();
				const output = result.composite != null ? await result.composite(background.output, signal) : result.output;
				signal.throwIfAborted();
				return { output: output ?? background.output, hasOutput: background.hasOutput || output != null, gpuTime: 0 };
			});
			session.register(entry.id, stage => session.memoize(entry.id, stage, async () => {
				if (stage === 'composited' && entry.isIncludedInComposite === false) return (await composite()).output;
				const result = await prepare();
				signal.throwIfAborted();
				if (result.source == null && result.output == null) return session.fallbackOutput;
				if (stage === 'composited') return (await composite()).output;
				if (stage === 'rendered' && result.rendered != null) return result.rendered(signal);
				return result.source ?? result.output ?? session.fallbackOutput;
			}));
			previous = composite;
		}
		const getResult = previous;
		return { evaluate: async () => ({ ...await getResult(), gpuTime: session.gpuTime }) };
	}
}
