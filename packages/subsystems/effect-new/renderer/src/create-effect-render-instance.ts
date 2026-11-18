import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { getNativeEffectId } from '@gs/subsystems_effect-new_shared/native-effect/native-effect-definitions.ts';
import type { NativeEffectId } from '@gs/subsystems_effect-new_shared/native-effect/native-effect-definitions.ts';
import { createCustomNodeGraphEffectRenderInstance } from './custom-node-graph-effect/custom-node-graph-effect-renderer.ts';
import { createCustomShaderEffectRenderInstance } from './custom-shader-effect/custom-shader-effect-renderer.ts';
import { normalizeEffectParameter, resolveEffectParameterValue } from './effect-parameters.ts';
import { createSolidColorRenderInstance } from './native-effect/solidColor/_impl_.ts';
import type { EffectPlacementOptions, EffectRenderEnvironment, EffectRenderInstance } from './effect-render-instance.ts';

// Native Effectの定義だけ追加して描画実装を登録し忘れた場合は型チェックで知らせる。
const nativeEffectFactories = {
	solidColor: createSolidColorRenderInstance,
} satisfies Record<NativeEffectId, (environment: EffectRenderEnvironment, resolution: Resolution) => EffectRenderInstance>;

/** 定義を検証してから配置を作る。子の生成は同じ検証済みの参照グラフをたどる。 */
export function createEffectRenderInstance(catalog: EffectCatalog, source: EffectSource, environment: EffectRenderEnvironment, options: EffectPlacementOptions): EffectRenderInstance {
	catalog.validate(source);
	return createPlacement(source, options);

	function checkResolution(resolution: Resolution): Resolution {
		const limit = environment.device.limits.maxTextureDimension2D;
		if (![resolution.width, resolution.height].every(size => Number.isSafeInteger(size) && size >= 1 && size <= limit)) {
			throw new Error(`Invalid Effect resolution: ${resolution.width} × ${resolution.height} (limit ${limit})`);
		}
		return { ...resolution };
	}

	function createPlacement(placementSource: EffectSource, placement: EffectPlacementOptions): EffectRenderInstance {
		const definition = catalog.getDefinition(placementSource);
		const resolution = checkResolution(placement.resolution);
		const inputResolutions = new Map<string, Resolution | null>();
		for (const [id, size] of placement.inputResolutions ?? []) {
			if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown Effect input: ${id}`);
			inputResolutions.set(id, size == null ? null : checkResolution(size));
		}
		let instance: EffectRenderInstance;
		switch (placementSource.type) {
			case 'nativeEffect':
				instance = nativeEffectFactories[getNativeEffectId(placementSource.id)](environment, resolution);
				break;
			case 'customShaderEffectReference':
				instance = createCustomShaderEffectRenderInstance(catalog.getCustomShaderEffect(placementSource.id), environment, resolution);
				break;
			case 'inlineCustomNodeGraphEffect': case 'customNodeGraphEffectReference':
				instance = createCustomNodeGraphEffectRenderInstance(catalog.getCustomNodeGraphEffect(placementSource), { resolution, inputResolutions },
					reference => catalog.getDefinition(reference), createPlacement);
				break;
		}
		let destroyed = false;
		const checkAlive = () => {
			if (destroyed) throw new Error('Effect render instance was destroyed');
		};
		const checkOutput = (id: string) => {
			if (!Object.hasOwn(definition.outputDefs, id)) throw new Error(`Unknown Effect output: ${id}`);
		};
		const allParameterIds = new Set(Object.keys(definition.paramDefs));
		const getRequiredParameterIds = (outputIds: ReadonlySet<string>) => {
			checkAlive();
			for (const id of outputIds) checkOutput(id);
			return instance.getRequiredParameterIds?.(outputIds) ?? allParameterIds;
		};
		return {
			getRequiredParameterIds,
			async prepare(outputIds) {
				checkAlive();
				for (const id of outputIds) checkOutput(id);
				await instance.prepare(outputIds);
				checkAlive();
			},
			render(request) {
				const required = getRequiredParameterIds(request.outputIds);
				if (request.outputIds.size === 0) return new Map();
				for (const id of request.parameters.keys()) {
					if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown Effect input: ${id}`);
				}
				const parameters = new Map<string, unknown>();
				for (const id of required) {
					const parameter = definition.paramDefs[id];
					parameters.set(id, request.parameters.has(id) ? normalizeEffectParameter(parameter, request.parameters.get(id))
						: resolveEffectParameterValue(parameter, parameter.defaultValue, request));
				}
				return instance.render({ ...request, parameters });
			},
			getOutputResolution(id) {
				checkAlive();
				checkOutput(id);
				const size = instance.getOutputResolution(id);
				return size == null ? null : { ...size };
			},
			resetRenderHistory() {
				checkAlive();
				instance.resetRenderHistory();
			},
			destroy() {
				if (destroyed) return;
				destroyed = true;
				instance.destroy();
			},
		};
	}
}
