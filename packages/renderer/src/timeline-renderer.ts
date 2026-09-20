import type { Timeline, VisualModule, VisualModuleParamValues } from '@glitch/shared/types.ts';

export type TimelineLayerContext<Output> = {
	time: number;
	timeDelta: number;
	progress: number;
	paramValues: VisualModuleParamValues;
	paramTextures: ReadonlyMap<string, Output>;
	pointerPosition: { x: number; y: number };
	pointerPositionPrev: { x: number; y: number };
};

export type TimelineLayerRenderer<Output> = {
	prepare: (context: TimelineLayerContext<Output>, signal: AbortSignal) => Promise<void>;
	// GPUコマンドの送信・計測の完了も実装側で待つ。
	render: (context: TimelineLayerContext<Output>) => Promise<{ output?: Output; gpuTime: number }>;
	destroy: () => void;
};

type TimelineRendererOptions<Output> = {
	fallbackOutput: Output;
	createLayer: (visualModule: VisualModule, entry: Timeline[number]) => TimelineLayerRenderer<Output>;
	present: (output: Output, gpuTime: number) => void;
	onClear?: () => void;
};

// レイヤーの順序と寿命、非同期シークを管理する。GPUやCanvasには依存しない。
export class TimelineRenderer<Output> {
	private options: TimelineRendererOptions<Output>;
	private layers = new Map<string, TimelineLayerRenderer<Output>>();
	private controller: AbortController | null = null;

	constructor(options: TimelineRendererOptions<Output>) {
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
	public async renderAt(time: number, timeline: Timeline, visualModules: VisualModule[]): Promise<void> {
		if (!Number.isFinite(time)) throw new Error('Timeline time must be finite');
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
				const visualModule = visualModules.find(module => module.id === entry.layer.visualModuleId);
				if (visualModule == null) continue;
				let layer = this.layers.get(entry.id);
				if (layer == null) {
					layer = this.options.createLayer(visualModule, entry);
					this.layers.set(entry.id, layer);
				}
				const duration = entry.endTimeMs - entry.startTimeMs;
				const context: TimelineLayerContext<Output> = {
					time: time - entry.startTimeMs,
					timeDelta: 0, // 従来どおり、シーク時は履歴に経過時間を与えない。
					progress: duration > 0 ? (time - entry.startTimeMs) / duration : 0,
					paramValues: entry.layer.paramValues,
					paramTextures: new Map(visualModule.paramDefs.filter(def => def.isPrimaryInput).map(def => [def.id, output])),
					pointerPosition: { x: -99999, y: -99999 },
					pointerPositionPrev: { x: -99999, y: -99999 },
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
