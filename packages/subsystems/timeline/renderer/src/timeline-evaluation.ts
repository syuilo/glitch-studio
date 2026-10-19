import type { TimelineLayerOutputStage } from '@gs/subsystems_timeline_shared/parameter-binding.ts';

export type TimelineEvaluationResult<Output> = { output: Output; hasOutput: boolean; gpuTime: number };
export type TimelineEvaluation<Output> = { evaluate: () => Promise<TimelineEvaluationResult<Output>> };

/**
 * 同じScene配置・サブサンプル内の評価を共有する。GroupとTransformは同じセッションへ
 * 子を登録し、別Sceneの配置は独立したセッションを作る。履歴を持つ素材も一度だけ生成する。
 */
export class TimelineEvaluationSession<Output> {
	private layers = new Map<string, (stage: TimelineLayerOutputStage) => Promise<Output>>();
	private results = new Map<string, Promise<unknown>>();
	private evaluating = new Set<string>();
	public gpuTime = 0;

	public readonly fallbackOutput: Output;
	constructor(fallbackOutput: Output) { this.fallbackOutput = fallbackOutput; }

	public register(layerId: string, evaluate: (stage: TimelineLayerOutputStage) => Promise<Output>) {
		this.layers.set(layerId, evaluate);
	}

	public getLayerOutput(layerId: string | null, stage: TimelineLayerOutputStage): Promise<Output> {
		return layerId == null ? Promise.resolve(this.fallbackOutput)
			: this.layers.get(layerId)?.(stage) ?? Promise.resolve(this.fallbackOutput);
	}

	public async memoize<Value>(layerId: string, stage: string, evaluate: () => Promise<Value>): Promise<Value> {
		const key = JSON.stringify([layerId, stage]);
		// 依存の要求は直列に行う。静的検証を迂回した入力でも、未完了Promiseへの自己待機で
		// 停止しないよう、キャッシュを返す前に現在の評価経路への再入を拒否する。
		if (this.evaluating.has(key)) throw new Error('Circular layer output reference: ' + layerId + ' / ' + stage);
		const cached = this.results.get(key);
		if (cached != null) return cached as Promise<Value>;
		this.evaluating.add(key);
		const pending = Promise.resolve().then(evaluate).finally(() => this.evaluating.delete(key));
		this.results.set(key, pending);
		return pending;
	}
}
