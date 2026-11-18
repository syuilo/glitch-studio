import { constantShaderInput, toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/custom-node-graph-effect-instance.ts';
import { createCustomShaderEffectInstance } from './custom-shader-effect/custom-shader-effect-instance.ts';
import type { ShaderInput, ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { EffectParameterDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectCatalog, EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectInstance, EffectInstanceImplementation, EffectInstanceOptions } from './effect-instance.ts';
import type { NativeEffectImplementation } from './native-effect/native-effect-implementation.ts';

export type CreateEffectInstanceOptions = Omit<EffectInstanceOptions, 'getInputResolution' | 'staticSettings'> &
	Partial<Pick<EffectInstanceOptions, 'getInputResolution' | 'staticSettings'>> & {
		catalog: EffectCatalog;
		nativeEffectImplementations: ReadonlyMap<string, NativeEffectImplementation>;
	};

const defaultSampling: ShaderInputSampling = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };

function isSpatialInput(value: unknown): value is UniformOrTexture | ShaderInput {
	return value != null && typeof value === 'object' && 'kind' in value && (value.kind === 'uniform' || value.kind === 'texture');
}

function prepareParameter(parameter: EffectParameterDefinition, value: unknown, readsTexture: boolean) {
	if (parameter.canNode !== true) return value;
	// リテラル色だけをここでpremultiplyする。配線から借りた値は既に変換済み。
	if (!isSpatialInput(value)) return constantShaderInput(parameter.dataType.kind, value);
	if (!readsTexture) return value.kind === 'texture' ? { kind: 'texture', texture: value.texture } : value;
	if (value.kind === 'texture' && 'fitMode' in value) return value;
	// uniformの欠落チャンネルもr/rgテクスチャのサンプリング時と同じ (0, 0, 1) で補完する。
	return toShaderInput(value, defaultSampling);
}

function createImplementation(source: EffectSource, options: CreateEffectInstanceOptions): EffectInstanceImplementation {
	const resolved = resolveEffectSource(source, options.catalog);
	const instanceOptions: EffectInstanceOptions = {
		device: options.device,
		enable32bitDataTextures: options.enable32bitDataTextures,
		resolution: options.resolution,
		getInputResolution: options.getInputResolution ?? (() => null),
		staticSettings: createStaticSettingValues(resolved.definition.staticSettingDefs ?? {}, options.staticSettings),
	};
	let instance: EffectInstanceImplementation;
	switch (resolved.type) {
		case 'nativeEffect': {
			const implementation = options.nativeEffectImplementations.get(resolved.id);
			if (implementation == null) throw new Error('Native Effect implementation not found: ' + resolved.id);
			instance = implementation(instanceOptions);
			break;
		}
		case 'customShaderEffect':
			instance = createCustomShaderEffectInstance(resolved.definition, instanceOptions);
			break;
		case 'customNodeGraphEffect':
			instance = createCustomNodeGraphEffectInstance(resolved.definition, instanceOptions,
				(node, getInputResolution) => createImplementation(node.effectSource, {
					...options, resolution: node.resolution ?? options.resolution, getInputResolution, staticSettings: node.staticSettings,
				}));
			break;
	}

	const parameters = Object.entries(resolved.definition.paramDefs);
	return {
		getRequiredParameterIds: instance.getRequiredParameterIds?.bind(instance),
		getOutputResolution: id => instance.getOutputResolution(id),
		prepare(request) {
			const params = Object.fromEntries(parameters.map(([id, parameter]) => {
				const value = Object.hasOwn(request.params, id) ? request.params[id] : parameter.defaultValue.value;
				return [id, prepareParameter(parameter, value, resolved.type !== 'customNodeGraphEffect')];
			}));
			return instance.prepare({ ...request, params });
		},
		render: encoder => instance.render(encoder),
		dispose: () => instance.dispose(),
	};
}

type FrameState =
	| { type: 'pending' }
	| { type: 'ready'; outputs: ReadonlyMap<string, UniformOrTexture>; shouldRender: boolean }
	| { type: 'error'; error: unknown };

/** 編集・読込時に検証済みの定義を受け取る。フレームの準備・待機は呼び出し元の配置が一括で管理する。 */
export function createEffectInstance(source: EffectSource, options: CreateEffectInstanceOptions): EffectInstance {
	const implementation = createImplementation(source, options);
	const requiredParameters = implementation.getRequiredParameterIds?.bind(implementation);
	let frame: FrameState | null = null;
	const waiters = new Set<(state: FrameState | null) => void>();
	let rendering = false;
	let disposed = false;

	function setFrame(state: FrameState | null): void {
		frame = state;
		for (const settle of waiters) settle(state);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		setFrame(null);
		implementation.dispose();
	}

	return {
		getRequiredParameterIds: requiredParameters == null ? undefined : id => {
			if (disposed) throw new Error('Effect instance has been disposed');
			return requiredParameters(id);
		},
		getOutputResolution: outputId => disposed ? null : implementation.getOutputResolution(outputId),
		prepare(request) {
			if (disposed) throw new Error('Effect instance has been disposed');
			if (rendering) throw new Error('Effect instance is already rendering');
			const preparing = { type: 'pending' } as const;
			setFrame(preparing);
			try {
				const shouldRender = request.requestedOutputIds.size > 0;
				const { outputs, pending } = shouldRender ? implementation.prepare(request) : { outputs: new Map(), pending: null };
				const ready = { type: 'ready', outputs, shouldRender } as const;
				if (pending == null) {
					if (frame === preparing) setFrame(ready);
					return;
				}
				// 差し替え・破棄の後に旧フレームのコンパイルが完了しても、現在の状態には反映しない。
				void pending.then(
					() => { if (frame === preparing) setFrame(ready); },
					(error: unknown) => { if (frame === preparing) setFrame({ type: 'error', error }); },
				);
			} catch (error) {
				if (frame === preparing) setFrame({ type: 'error', error });
			}
		},
		checkReady() {
			if (frame?.type === 'error') throw frame.error;
			return frame?.type === 'ready';
		},
		waitUntilReady(signal) {
			if (signal?.aborted === true || frame == null) return Promise.resolve(false);
			if (frame.type === 'ready') return Promise.resolve(true);
			if (frame.type === 'error') return Promise.reject(frame.error);
			return new Promise<boolean>((resolve, reject) => {
				const abort = () => settle(null);
				const settle = (state: FrameState | null) => {
					waiters.delete(settle);
					signal?.removeEventListener('abort', abort);
					if (state?.type === 'error') reject(state.error);
					else resolve(state?.type === 'ready');
				};
				waiters.add(settle);
				signal?.addEventListener('abort', abort, { once: true });
			});
		},
		render(commandEncoder) {
			if (disposed) throw new Error('Effect instance has been disposed');
			if (rendering) throw new Error('Effect instance is already rendering');
			if (frame?.type === 'error') throw frame.error;
			if (frame?.type !== 'ready') throw new Error('Effect frame is not ready');
			const { outputs, shouldRender } = frame;
			frame = null;
			rendering = true;
			try {
				if (shouldRender) implementation.render(commandEncoder);
				if (disposed) throw new Error('Effect instance was disposed during rendering');
				return outputs;
			} catch (error) {
				// 先行した子だけが履歴を更新した可能性がある。部分的な状態を次の描画に持ち越さない。
				dispose();
				throw error;
			} finally {
				rendering = false;
			}
		},
		dispose,
	};
}
