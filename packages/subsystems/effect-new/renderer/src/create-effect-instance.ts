import { constantShaderInput, toShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import { resolveEffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { createCustomNodeGraphEffectInstance } from './custom-node-graph-effect/custom-node-graph-effect-instance.ts';
import { createCustomShaderEffectInstance } from './custom-shader-effect/custom-shader-effect-instance.ts';
import type { ShaderInput, ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { EffectParameterDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectCatalog, EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { EffectInstance, EffectInstanceOptions } from './effect-instance.ts';
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

/** 編集・読込時に検証済みの定義を受け取る。配置ごとに生成し、参照IDが同じでも履歴を共有しない。 */
export function createEffectInstance(source: EffectSource, options: CreateEffectInstanceOptions): EffectInstance {
	const resolved = resolveEffectSource(source, options.catalog);
	const instanceOptions: EffectInstanceOptions = {
		device: options.device,
		enable32bitDataTextures: options.enable32bitDataTextures,
		resolution: options.resolution,
		getInputResolution: options.getInputResolution ?? (() => null),
		staticSettings: createStaticSettingValues(resolved.definition.staticSettingDefs ?? {}, options.staticSettings),
	};
	let instance: EffectInstance;
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
				(node, getInputResolution) => createEffectInstance(node.effectSource, {
					...options, resolution: node.resolution ?? options.resolution, getInputResolution, staticSettings: node.staticSettings,
				}));
			break;
	}

	const parameters = Object.entries(resolved.definition.paramDefs);
	const requiredParameters = instance.getRequiredParameterIds?.bind(instance);
	let rendering = false;
	let disposed = false;

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		instance.dispose();
	}

	return {
		getRequiredParameterIds: requiredParameters == null ? undefined : id => {
			if (disposed) throw new Error('Effect instance has been disposed');
			return requiredParameters(id);
		},
		getOutputResolution: outputId => disposed ? null : instance.getOutputResolution(outputId),
		async render(request) {
			if (disposed) throw new Error('Effect instance has been disposed');
			if (rendering) throw new Error('Effect instance is already rendering');
			if (request.requestedOutputIds.size === 0) return new Map();
			rendering = true;
			try {
				const params = Object.fromEntries(parameters.map(([id, parameter]) => {
					const value = Object.hasOwn(request.params, id) ? request.params[id] : parameter.defaultValue.value;
					return [id, prepareParameter(parameter, value, resolved.type !== 'customNodeGraphEffect')];
				}));
				const outputs = await instance.render({ ...request, params });
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
