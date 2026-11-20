import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { initCustomShaderEffect } from './custom-shader-effect.ts';
import { createFramePreparation, type PrepareFrame } from './frame-preparation.ts';
import { createRenderCache } from './render-cache.ts';
import { createEffectGpuExecution, type CollectGpuTime } from './effect-gpu-execution.ts';
import { createEffectRenderDevice } from './tiling/effect-render-device.ts';
import { createEffectFrameMapper } from './graph-evaluation.ts';
import { resolveEffectStaticResources } from './effect-static-settings.ts';
import { planEffect, type EffectPlacement, type EvaluateStep } from './plan-effect.ts';
import type { EffectRenderTilingProgressObserver } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { EffectGpuContext, EffectInitContext, EffectInstance, EffectFrameContext, EffectRenderContext, NativeEffectImplementation } from './effect-instance.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
export type { EffectPlacement, EffectPlacementInput } from './plan-effect.ts';
export type { EffectStaticResourceContext } from './effect-static-settings.ts';

function outputFormat(type: TextureDataType, enable32bitDataTextures: boolean): GPUTextureFormat {
	if (type.kind === 'color') return INTERMEDIATE_TEXTURE_FORMAT;
	const channels = type.kind === 'scalar' ? 'r' : type.kind === 'vector' ? 'rg' : 'rgba';
	return `${channels}${enable32bitDataTextures ? 32 : 16}float`;
}

export async function createEffectInstance(placement: EffectPlacement, gpu: EffectGpuContext,
	getNativeEffectImplementation: (id: string) => NativeEffectImplementation, signal?: AbortSignal): Promise<EffectInstance> {
	signal?.throwIfAborted();
	const { steps, outputs, contextResolution, resources, valueUpdates } = planEffect(placement, gpu.device?.limits?.maxTextureDimension2D);
	const tiling = placement.tiling ?? { mode: 'disabled' };
	if (tiling.mode === 'manual' && (!Number.isSafeInteger(tiling.tileSize) || tiling.tileSize <= 0)) throw new Error('Expected a positive tile size');
	const device = gpu.device;
	const reportFrameGpuTime = placement.onFrameGpuTime;
	if (tiling.mode !== 'disabled' || placement.onGpuTime != null || reportFrameGpuTime != null) gpu = { ...gpu, device: createEffectRenderDevice(device) };
	const prepareSteps: PrepareFrame[] = [];
	const prepareSources: (PrepareFrame | EvaluateStep)[] = [];
	const preparation = createFramePreparation(prepareSteps, placement.onPreparationStatus);
	const renderSteps: {
		needsRender: () => boolean;
		record: (frame: EffectFrameContext, encoder: GPUCommandEncoder, collectGpuTime?: CollectGpuTime) => void;
		shouldTile: () => boolean;
		renderTiled: (frame: EffectFrameContext, signal: AbortSignal, progress?: EffectRenderTilingProgressObserver, collectGpuTime?: CollectGpuTime) => Promise<void>;
		commit: () => void;
	}[] = [];
	const historyResets: (() => void)[] = [];
	const disposers: (() => void)[] = [];
	let dependsOnRenderHistory = false;
	let tiledRequest: AbortController | null = null;
	let disposed = false;

	// 式修飾子や音声の選択状態は値編集で切り替わる。静的値の読み取りはフレームごとの準備から除外する。
	function updatePrepareSteps() {
		prepareSteps.length = 0;
		for (const source of prepareSources) {
			if (typeof source === 'function') prepareSteps.push(source);
			else if (source.active) prepareSteps.push(source.evaluate);
		}
	}

	function reset() {
		// 描画の中断後に途中まで更新した結果を再利用しないよう、履歴に加えて準備状態とキャッシュも破棄する。
		preparation.invalidate();
		for (const reset of historyResets) reset();
	}

	function release() {
		preparation.afterPending(() => {
			for (let index = disposers.length - 1; index >= 0; index--) disposers[index]();
			disposers.length = 0;
		});
		renderSteps.length = prepareSteps.length = prepareSources.length = historyResets.length = 0;
		valueUpdates.clear();
		outputs.clear();
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		preparation.invalidate();
		if (tiledRequest != null) tiledRequest.abort();
		else release();
	}

	function checkAvailable() {
		if (disposed) throw new Error('Effect instance is disposed');
		if (tiledRequest != null) throw new Error('Tiled rendering is already in progress');
	}

	function measureFrameGpuTime(frame: EffectFrameContext) {
		if (reportFrameGpuTime == null) return null;
		const measurements: (number | null | Promise<number | null>)[] = [];
		const collect: CollectGpuTime = time => { measurements.push(time); };
		return {
			collect,
			report() {
				// 通常パスのreadbackは後続フレームと並行するため、このフレームで登録した分だけを待つ。
				const result = Promise.all(measurements).then(times => {
					let total = 0;
					for (const time of times) {
						if (time == null) return null;
						total += time;
					}
					return total;
				});
				reportFrameGpuTime(frame, result);
			},
		};
	}

	try {
		for (const step of steps) {
			if ('evaluate' in step) {
				prepareSources.push(step);
				continue;
			}
			const { effect, resolution } = step;
			const outputTextures = new Map<string, GPUTexture>();
			const native = effect.type === 'nativeEffect' ? getNativeEffectImplementation(effect.id) : null;
			for (const [id, bind] of step.bindOutputTextures) {
				const texture = native?.createOutputTexture?.(id, resolution, gpu) ?? gpu.device.createTexture({
					size: resolution, format: outputFormat(effect.definition.outputDefs[id].dataType, gpu.enable32bitDataTextures),
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
				});
				outputTextures.set(id, texture);
				bind(texture);
				disposers.push(() => texture.destroy());
			}
			const context: EffectInitContext = {
				...gpu, resolution, inputs: step.inputs, staticSettings: step.staticSettings, outputTextures, signal,
				resources: resolveEffectStaticResources(effect.definition, step.staticSettings, resources),
			};
			// タイル描画の途中で中断されても、未完成の書き込み先を次のノードや公開ポートへ渡さない。
			const pending = new Map<(texture: GPUTexture) => void, GPUTexture>();
			const publishers = new Map([...step.bindOutputTextures].map(([id, bind]) => [id, (texture: GPUTexture) => { pending.set(bind, texture); }]));
			const operation = effect.type === 'customShaderEffect' ? await initCustomShaderEffect(effect.definition, context) : await native!.init(context, publishers);
			disposers.push(() => operation.dispose());
			signal?.throwIfAborted();
			const usesHistory = operation.resetRenderHistory != null || (effect.type === 'nativeEffect' && effect.definition.dependsOnRenderHistory === true);
			dependsOnRenderHistory ||= usesHistory;
			const cache = !usesHistory && 'cacheKey' in operation ? createRenderCache(step.inputs, operation) : null;
			const report = placement.onGpuTime;
			const gpuExecution = createEffectGpuExecution(device, operation, tiling, effect.definition.canHaveLongRunningRenderPass === true,
				report == null ? undefined : (pass, time) => report(step.path, pass, time));
			disposers.push(() => gpuExecution.dispose());
			let historyResetPending = false;
			const map = createEffectFrameMapper(contextResolution, resolution);
			const nodeFrame = (frame: EffectFrameContext) => {
				const mapped = map(frame);
				// リセットをまたぐ時間・移動量の積算を防ぐ。内容時刻と現在の位置は保持する。
				return historyResetPending ? { ...mapped, timeDelta: 0, pointerVector: [0, 0] as const } : mapped;
			};
			if (operation.prepare != null) prepareSources.push((frame, signal) => operation.prepare!(nodeFrame(frame), signal));
			renderSteps.push({
				needsRender: () => cache?.needsRender() ?? true,
				record: (frame, encoder, collectGpuTime) => gpuExecution.record(nodeFrame(frame), encoder, collectGpuTime),
				shouldTile: gpuExecution.shouldTile,
				renderTiled: (frame, signal, progress, collectGpuTime) => gpuExecution.renderTiled(nodeFrame(frame), signal, progress, collectGpuTime),
				commit() {
					for (const [bind, texture] of pending) bind(texture);
					pending.clear();
					step.version++;
					historyResetPending = false;
					cache?.commit();
				},
			});
			historyResets.push(() => {
				pending.clear(); cache?.reset(); gpuExecution.reset();
				historyResetPending = usesHistory;
				operation.invalidateRenderCache?.();
				operation.resetRenderHistory?.();
			});
		}
		updatePrepareSteps();
		return {
			outputs, dependsOnRenderHistory,
			get preparationStatus() { return preparation.status; },
			tryPrepare(frame) { checkAvailable(); return preparation.tryPrepare(frame); },
			async prepare(frame, signal) { checkAvailable(); await preparation.prepare(frame, signal); },
			updateCustomNodeGraphEffectValues(id, update) {
				checkAvailable();
				const revision = valueUpdates.preparationLayoutRevision;
				if (!valueUpdates.apply(id, update)) return;
				preparation.invalidate();
				if (revision !== valueUpdates.preparationLayoutRevision) updatePrepareSteps();
			},
			render(source: EffectFrameContext, encoder?: GPUCommandEncoder) {
				checkAvailable();
				const frame = preparation.take(source);
				const commandEncoder = encoder ?? (source as EffectRenderContext).commandEncoder;
				const gpuTime = measureFrameGpuTime(source);
				try {
					for (const step of renderSteps) {
						if (!step.needsRender()) continue;
						step.record(frame, commandEncoder, gpuTime?.collect);
						step.commit();
					}
					gpuTime?.report();
				} catch (error) { reset(); throw error; }
			},
			async renderTiled(source, signal, progress) {
				checkAvailable();
				signal?.throwIfAborted();
				tiledRequest = new AbortController();
				const active = signal == null ? tiledRequest.signal : AbortSignal.any([signal, tiledRequest.signal]);
				const gpuTime = measureFrameGpuTime(source);
				let encoder: GPUCommandEncoder | null = null;
				const flush = () => {
					if (encoder != null) device.queue.submit([encoder.finish()]);
					encoder = null;
				};
				try {
					await preparation.prepare(source, active);
					active.throwIfAborted();
					const frame = preparation.take(source);
					for (const step of renderSteps) {
						if (!step.needsRender()) continue;
						if (!step.shouldTile()) {
							encoder ??= device.createCommandEncoder();
							step.record(frame, encoder, gpuTime?.collect);
						} else {
							// 軽い処理はまとめて記録し、タイル描画が上流の出力を読む直前にsubmitする。
							flush();
							await step.renderTiled(frame, active, progress, gpuTime?.collect);
							active.throwIfAborted();
						}
						step.commit();
					}
					flush();
					gpuTime?.report();
				} catch (error) { reset(); throw error; } finally {
					tiledRequest = null;
					if (disposed) release();
					progress?.(null);
				}
			},
			resetRenderHistory() {
				if (tiledRequest != null) tiledRequest.abort();
				else reset();
			},
			dispose,
		};
	} catch (error) {
		// 途中で初期化に失敗したら、まだ公開していない配置が確保済みのリソースを解放する。
		dispose();
		throw error;
	}
}
