// 制御に必要なのはIDと期間だけ。レイヤー固有のデータは生成関数にそのまま渡す。
export type TimelineRenderEntry = {
	id: string;
	startTimeMs: number;
	endTimeMs: number;
};

export type TimelineLayerContext<Output> = {
	isExport: boolean;
	time: number;
	timeDelta: number;
	endTime: number;
	input: Output;
};

export type TimelineLayerRenderer<Output> = {
	prepare: (context: TimelineLayerContext<Output>, signal: AbortSignal) => Promise<void>;
	// GPUコマンドの送信・計測の完了も実装側で待つ。
	render: (context: TimelineLayerContext<Output>) => Promise<{ output?: Output; gpuTime: number }>;
	destroy: () => void;
};

type TimelineRendererOptions<Output, Entry extends TimelineRenderEntry> = {
	fallbackOutput: Output;
	// 描画対象を解決できない場合はundefinedを返し、下の出力を通す。
	createLayer: (entry: Entry) => TimelineLayerRenderer<Output> | undefined;
	present: (output: Output, gpuTime: number) => void;
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
		if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
		if (!Number.isFinite(timeDelta) || timeDelta < 0) throw new Error('Timeline delta must be finite and non-negative');
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		const isCancelled = () => controller.signal.aborted;
		try {
			// 配列の先頭が最下層。終端を含めず、隣接するレイヤーを境界で重ねない。
			const activeEntries = timeline.filter(entry => entry.startTimeMs <= time && time < entry.endTimeMs);
			const activeIds = new Set(activeEntries.map(entry => entry.id));
			for (const [id, layer] of this.layers) {
				if (activeIds.has(id)) continue;
				layer.destroy();
				this.layers.delete(id);
			}
			let output = this.options.fallbackOutput;
			let gpuTime = 0;
			for (const entry of activeEntries) {
				let layer = this.layers.get(entry.id);
				const isNewLayer = layer == null;
				if (layer == null) {
					layer = this.options.createLayer(entry);
					if (layer == null) continue;
					this.layers.set(entry.id, layer);
				}
				const context: TimelineLayerContext<Output> = {
					isExport,
					time: time - entry.startTimeMs,
					// 新規レイヤーには履歴がない。途中からの書き出しでも過去のフレームは再現しない。
					timeDelta: isNewLayer ? 0 : timeDelta,
					// timeと同じレイヤー内の時刻に揃え、PROGRESSや終端合わせの基準が開始位置でずれないようにする。
					endTime: entry.endTimeMs - entry.startTimeMs,
					input: output,
				};
				await layer.prepare(context, controller.signal);
				if (isCancelled()) return;
				const result = await layer.render(context);
				// 準備・描画・計測の待機中に別のシークが開始された場合は表示しない。
				if (isCancelled()) return;
				gpuTime += result.gpuTime;
				if (result.output != null) output = result.output;
			}
			// レイヤーがない場合も透明な出力を表示し、前回の表示を残さない。
			this.options.present(output, gpuTime);
		} catch (error) {
			if (isCancelled()) return;
			this.clear();
			throw error;
		}
	}
}
