import { getEffectRenderViewSize, isEffectRenderPipelineProbeSafe } from './effect-render-device.ts';
import { EffectRenderPassReplay, callEffectGpuCommand as callCommand } from './effect-render-pass-replay.ts';
import type { EffectGpuPassCommand as PassCommand } from './effect-render-pass-replay.ts';
import { EffectRenderTileSubmissionBudget } from './effect-render-tile-submission-budget.ts';
import type { EffectRenderTileController, EffectRenderTilePlan, EffectRenderPassGpuTimeObserver } from './effect-render-tile-controller.ts';
import type { EffectRenderTiling, EffectRenderWorkloadHint, EffectRenderTilingProgressObserver } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type TimingHelper from '@gs/shared/gpu/TimingHelper.ts';

type Rectangle = { x: number; y: number; width: number; height: number };
type RecordedOperation =
	| { kind: 'render'; descriptor: GPURenderPassDescriptor; commands: PassCommand[] }
	| { kind: 'compute'; descriptor: GPUComputePassDescriptor; commands: PassCommand[] }
	| { kind: 'command'; command: PassCommand };

type ExecutionOptions = {
	timingHelper?: TimingHelper | null;
	collectStatistics?: boolean;
	tileController?: EffectRenderTileController | null;
	workloadHint?: EffectRenderWorkloadHint | null;
	onProgress?: EffectRenderTilingProgressObserver | null;
};

const deviceCompletions = new WeakMap<GPUDevice, { error: Error | null; listeners: Set<(error: Error) => void> }>();

export function waitForEffectGpuWork(device: GPUDevice): Promise<void> {
	let state = deviceCompletions.get(device);
	if (state == null) {
		state = { error: null, listeners: new Set() };
		deviceCompletions.set(device, state);
		const tracked = state;
		// device.lostへタイルごとにthenを追加すると、デバイスの寿命中ずっと保持される。
		// 購読はデバイスに一度だけ行い、各待機のリスナーは完了時に外す。
		void device.lost?.then(info => {
			tracked.error = new Error(info.message || 'Effect GPU device was lost.');
			for (const listener of tracked.listeners) listener(tracked.error);
			tracked.listeners.clear();
		});
	}
	const tracked = state;
	if (tracked.error != null) return Promise.reject(tracked.error);
	return new Promise((resolve, reject) => {
		const lost = (error: Error) => reject(error);
		tracked.listeners.add(lost);
		void device.queue.onSubmittedWorkDone().then(() => {
			tracked.listeners.delete(lost);
			if (tracked.error != null) reject(tracked.error);
			else resolve();
		}, error => { tracked.listeners.delete(lost); reject(error); });
	});
}

export function* effectRenderTiles(width: number, height: number, tileSize: number): Generator<{ tile: Rectangle; last: boolean }> {
	if (!Number.isInteger(tileSize) || tileSize < 1) throw new Error('Effect render tile size must be a positive integer.');
	for (let y = 0; y < height; y += tileSize) {
		for (let x = 0; x < width; x += tileSize) {
			yield { tile: { x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) },
				last: x + tileSize >= width && y + tileSize >= height };
		}
	}
}

function snapshotArguments(method: string, args: unknown[]): unknown[] {
	return args.map((value, index) => {
		// dynamic offsetsなどの呼び出し後の書き換えを、再生時に参照しない。
		if (Array.isArray(value)) return [...value];
		if (value instanceof Uint32Array) return value.slice();
		if (method === 'setBindGroup' && index === 2 && value != null) return Array.from(value as Iterable<number>);
		const copyDescriptor = index < 2 && ['copyBufferToTexture', 'copyTextureToBuffer', 'copyTextureToTexture'].includes(method);
		if (value != null && typeof value === 'object' && (method === 'setBlendConstant' || copyDescriptor)) {
			const origin = Reflect.get(value, 'origin');
			return { ...value, ...(origin == null ? {} : { origin: Array.isArray(origin) ? [...origin] : { ...origin } }) };
		}
		return value;
	});
}

function canProbeRenderPass(operation: Extract<RecordedOperation, { kind: 'render' }>): boolean {
	// clearから始める色パスなら、計測結果は本描画の最初のclearで消せる。
	// load・depth・query・storage書き込み・bundleは再実行の副作用を排除できない。
	return operation.descriptor.depthStencilAttachment == null && operation.descriptor.occlusionQuerySet == null && operation.descriptor.timestampWrites == null
		&& Array.from(operation.descriptor.colorAttachments).every(attachment => attachment == null || attachment.loadOp === 'clear')
		&& operation.commands.some(command => command.method === 'setPipeline')
		&& operation.commands.every(command => command.method !== 'executeBundles'
			&& (command.method !== 'setPipeline' || isEffectRenderPipelineProbeSafe(command.args[0] as GPURenderPipeline)));
}

function recordPass<T extends GPURenderPassEncoder | GPUComputePassEncoder>(commands: PassCommand[], finish: () => void): T {
	let ended = false;
	return new Proxy({ label: '' }, {
		get(target, property) {
			if (property === 'label') return target.label;
			return (...args: unknown[]) => {
				if (ended) throw new Error('Effect pass has already ended.');
				if (property === 'end') {
					ended = true;
					finish();
				} else {
					const method = String(property);
					commands.push({ method, args: snapshotArguments(method, args) });
				}
			};
		},
	}) as T;
}

/**
 * エフェクト1回分のコマンドだけを保持する。queueへのCPUアップロードは従来どおり
 * render中に行い、全コマンドの送信より前に完了する。同じインスタンスの次回描画は
 * execute完了まで開始しないため、記録中のuniformや内部テクスチャを上書きしない。
 */
export class EffectGpuCommandRecorder {
	private operations: RecordedOperation[] = [];
	private openPass = false;
	readonly encoder: GPUCommandEncoder;

	constructor() {
		this.encoder = new Proxy({ label: '' }, {
			get: (target, property) => {
				if (property === 'label') return target.label;
				if (property === 'beginRenderPass') return this.beginRenderPass;
				if (property === 'beginComputePass') return this.beginComputePass;
				return (...args: unknown[]) => {
					if (this.openPass || property === 'finish') throw new Error('Effect command encoder is owned by the tiled executor.');
					const method = String(property);
					this.operations.push({ kind: 'command', command: { method, args: snapshotArguments(method, args) } });
				};
			},
		}) as GPUCommandEncoder;
	}

	beginRenderPass = (descriptor: GPURenderPassDescriptor): GPURenderPassEncoder => {
		this.startPass();
		const commands: PassCommand[] = [];
		// WebIDLの省略可能なプロパティはnullではなくundefinedで未指定を表す。
		const snapshot = { ...descriptor, colorAttachments: Array.from(descriptor.colorAttachments, attachment => attachment == null ? null : { ...attachment,
			clearValue: attachment.clearValue == null ? undefined : Array.isArray(attachment.clearValue) ? [...attachment.clearValue] : { ...attachment.clearValue } }),
			depthStencilAttachment: descriptor.depthStencilAttachment == null ? undefined : { ...descriptor.depthStencilAttachment } };
		return recordPass(commands, () => { this.openPass = false; this.operations.push({ kind: 'render', descriptor: snapshot, commands }); });
	};

	beginComputePass = (descriptor: GPUComputePassDescriptor = {}): GPUComputePassEncoder => {
		this.startPass();
		const commands: PassCommand[] = [];
		return recordPass(commands, () => { this.openPass = false; this.operations.push({ kind: 'compute', descriptor: { ...descriptor }, commands }); });
	};

	private startPass() {
		if (this.openPass) throw new Error('Effect command encoder already has an open pass.');
		this.openPass = true;
	}

	/** 通常描画の定期計測。submit・readback・GPU完了を待たず、呼び出し側のencoderへ一度だけ再生する。 */
	replayUntiled(encoder: GPUCommandEncoder, timingHelper: TimingHelper, onRenderPassTime: EffectRenderPassGpuTimeObserver) {
		if (this.openPass) throw new Error('Effect render returned with an open pass.');
		for (const [index, operation] of this.operations.entries()) {
			if (operation.kind === 'command') {
				callCommand(encoder, operation.command);
				continue;
			}
			let pass: GPURenderPassEncoder | GPUComputePassEncoder;
			if (operation.kind === 'compute') {
				pass = timingHelper.beginComputePass(encoder, operation.descriptor);
			} else {
				const attachments = Array.from(operation.descriptor.colorAttachments);
				const view = attachments.find(attachment => attachment != null)?.view ?? operation.descriptor.depthStencilAttachment?.view;
				if (view == null) throw new Error('Measured effect render pass needs a render target.');
				const { width, height } = getEffectRenderViewSize(view);
				const pipelines = operation.commands.filter(command => command.method === 'setPipeline').map(command => command.args[0]);
				pass = timingHelper.beginRenderPass(encoder, operation.descriptor,
					duration => onRenderPassTime(index, pipelines, width, height, duration == null ? null : duration / 1_000_000));
			}
			for (const command of operation.commands) callCommand(pass, command);
			pass.end();
		}
	}

	async execute(device: GPUDevice, tiling: EffectRenderTiling, signal: AbortSignal, options: ExecutionOptions = {}): Promise<number> {
		if (this.openPass) throw new Error('Effect render returned with an open pass.');
		const { timingHelper = null, collectStatistics = false, tileController = null, workloadHint = null, onProgress = null } = options;
		const usesGpuTiming = timingHelper != null && device.features.has('timestamp-query');
		const renderPlans = new Map<number, {
			replay: EffectRenderPassReplay;
			size: { width: number; height: number };
			plan: EffectRenderTilePlan | null;
			tileSize: number;
			remainingTiles: number;
		}>();
		let completedTiles = 0;
		let totalTiles = 0;
		for (const [operationIndex, operation] of this.operations.entries()) {
			if (operation.kind !== 'render') continue;
			const attachments = Array.from(operation.descriptor.colorAttachments);
			const view = attachments.find(attachment => attachment != null)?.view ?? operation.descriptor.depthStencilAttachment?.view;
			if (view == null) throw new Error('Tiled effect render pass needs a render target.');
			const size = getEffectRenderViewSize(view);
			// クエリを持つパスは分割しない。全Render Passを先に計画し、後続パスも総数へ含める。
			const tiled = operation.descriptor.occlusionQuerySet == null;
			const plan = tiled && tiling.mode === 'auto' ? tileController?.beginPass(operationIndex,
				operation.commands.filter(command => command.method === 'setPipeline').map(command => command.args[0]),
				size.width, size.height, workloadHint, usesGpuTiming) ?? null : null;
			const tileSize = tiled && tiling.mode === 'manual' ? tiling.tileSize : Math.max(size.width, size.height);
			const remainingTiles = onProgress == null ? 0 : plan?.remainingTileCount
				?? Math.ceil(size.width / tileSize) * Math.ceil(size.height / tileSize);
			renderPlans.set(operationIndex, { replay: new EffectRenderPassReplay(device, operation.descriptor, operation.commands), size, plan, tileSize, remainingTiles });
			totalTiles += remainingTiles;
		}
		if (totalTiles > 0) onProgress?.({ completedTiles, totalTiles });
		if (tiling.mode === 'auto' && this.operations.length > 0) {
			// 先行ノードの描画やuniformアップロードの待ち時間を最初のタイルへ帰属させない。
			signal.throwIfAborted();
			await waitForEffectGpuWork(device);
			signal.throwIfAborted();
		}
		let gpuTime = 0;
		const readbacks = new Set<Promise<number | null>>();
		const submissions = new Set<Promise<unknown>>();
		let readbackError: unknown = null;
		const submit = async (encode: (encoder: GPUCommandEncoder, measuredTimingHelper: TimingHelper | null) => void, measureGpuTime = false) => {
			// readbackだけが遅い場合にもバッファを無制限に増やさない。GPU完了を待った後の
			// 統計は次の描画と重ね、同時に保持する結果は最大三つに制限する。
			while (readbacks.size >= 3) await readbacks.values().next().value;
			if (readbackError != null) throw readbackError;
			signal.throwIfAborted();
			const encoder = device.createCommandEncoder();
			const measuredTimingHelper = collectStatistics || measureGpuTime ? timingHelper : null;
			encode(encoder, measuredTimingHelper);
			const commandBuffer = encoder.finish();
			const startTime = performance.now();
			device.queue.submit([commandBuffer]);
			let result: Promise<number | null> | null = null;
			if (measuredTimingHelper != null) {
				result = measuredTimingHelper.getResult().then(duration => {
					if (Number.isFinite(duration) && duration > 0) gpuTime += duration;
					return duration;
				}, error => { readbackError ??= error; return null; });
				readbacks.add(result);
				const pending = result;
				void result.then(() => readbacks.delete(pending));
			}
			// 自動制御が必要とする実測だけ待つ。統計のreadbackはGPU完了と独立させ、
			// 次のタイルを送信するまでの空白へ加えない。
			const completed = waitForEffectGpuWork(device).then(() => performance.now() - startTime);
			const [elapsedMs, duration] = await Promise.all([completed, measureGpuTime ? result : null]);
			if (readbackError != null) throw readbackError;
			signal.throwIfAborted();
			return { elapsedMs, gpuTimeMs: usesGpuTiming && duration != null ? duration / 1_000_000 : null };
		};
		try {
			for (const [operationIndex, operation] of this.operations.entries()) {
				if (operation.kind === 'command') {
					await submit(encoder => callCommand(encoder, operation.command));
				} else if (operation.kind === 'compute') {
					await submit((encoder, measuredTimingHelper) => {
						const pass = measuredTimingHelper?.beginComputePass(encoder, operation.descriptor) ?? encoder.beginComputePass(operation.descriptor);
						for (const command of operation.commands) callCommand(pass, command);
						pass.end();
					});
				} else {
					const renderPlan = renderPlans.get(operationIndex)!;
					const { replay, size, plan, tileSize } = renderPlan;
					if (plan != null && timingHelper != null && canProbeRenderPass(operation)) {
						for (const tile of plan.gpuProbes()) {
							const timing = await submit(encoder => {
								const pass = timingHelper.beginRenderPass(encoder, replay.descriptor(true, false, true));
								replay.replay(pass, tile);
							}, true);
							plan.observeGpuProbe(timing.gpuTimeMs);
						}
						if (onProgress != null) {
							// 計測は完成画像のタイルではない。完了数へ加算せず、本描画の予定数だけ更新する。
							const remainingTiles = plan.remainingTileCount;
							totalTiles += remainingTiles - renderPlan.remainingTiles;
							renderPlan.remainingTiles = remainingTiles;
							onProgress({ completedTiles, totalTiles });
						}
					}
					const tiles = plan?.tiles() ?? effectRenderTiles(size.width, size.height, tileSize);
					const submissionBudget = new EffectRenderTileSubmissionBudget();
					let index = 0;
					while (true) {
						const batch = [];
						const maximumPendingTilePixels = plan?.maximumPendingTilePixels ?? Math.min(size.width, tileSize) * Math.min(size.height, tileSize);
						const maximumInFlightTiles = submissionBudget.maximumInFlightTiles(maximumPendingTilePixels);
						for (let pendingIndex = 0; pendingIndex < maximumInFlightTiles; pendingIndex++) {
							const next = tiles.next();
							if (next.done) break;
							const { tile, last } = next.value;
							const pixels = tile.width * tile.height;
							const descriptor = replay.descriptor(index === 0, last);
							// 手動分割では統計が既に取得するQueryを初期確認にも使う。
							// 統計も自動計測もない描画ではQueryを追加せず、従来どおり一枚ずつ送る。
							const measureGpuTime = plan?.shouldMeasureGpuTime(pixels)
								?? (usesGpuTiming && collectStatistics && submissionBudget.shouldMeasureGpuTime(pixels));
							const result = submit((encoder, measuredTimingHelper) => {
								const pass = measuredTimingHelper?.beginRenderPass(encoder, descriptor) ?? encoder.beginRenderPass(descriptor);
								replay.replay(pass, tile);
							}, measureGpuTime);
							submissions.add(result);
							void result.then(() => submissions.delete(result), () => {});
							batch.push({ pixels, result, measureGpuTime });
							index++;
							// 面積変更や定期計測の結果は、次を選ぶ前に反映する。
							if (measureGpuTime) break;
						}
						if (batch.length === 0) break;
						for (const [batchIndex, pending] of batch.entries()) {
							const timing = await pending.result;
							plan?.observe(pending.pixels, timing.elapsedMs, timing.gpuTimeMs);
							submissionBudget.observe(pending.pixels, timing.gpuTimeMs, pending.measureGpuTime);
							if (onProgress != null) {
								completedTiles++;
								// 列挙済みでもGPU完了前のタイルは残数に含め、100%を先に通知しない。
								const remainingTiles = plan == null ? renderPlan.remainingTiles - 1 : plan.remainingTileCount + batch.length - batchIndex - 1;
								totalTiles += remainingTiles - renderPlan.remainingTiles + 1;
								renderPlan.remainingTiles = remainingTiles;
								onProgress({ completedTiles, totalTiles });
							}
						}
					}
					plan?.finish();
				}
			}
		} finally {
			// 中断・失敗でも先行投入済みのタイルとreadbackを回収してから所有者へ戻す。
			// ここより前にuniform・出力・TimingHelperが破棄されないようにする。
			await Promise.allSettled(submissions);
			// readback枠の空きを待っていたsubmitも、結果を登録し終えてから回収する。
			await Promise.allSettled(readbacks);
		}
		if (readbackError != null) throw readbackError;
		signal.throwIfAborted();
		return gpuTime;
	}
}
