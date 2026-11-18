import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { hasPrimaryColorOutput } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import { createLowerLayerOutputBinding, validateTimelineParameterTree } from '../../parameter-binding.ts';
import { validateTimelineEffectLayerResolution } from './effect-layer-resolution.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { TimelineEffectLayer, TimelineEffectParameterBinding } from '../../types.ts';

export { createLowerLayerOutputBinding } from '../../parameter-binding.ts';

export function getTimelineEffectLayerOutputId(definition: EffectDefinition): string {
	const id = definition.primaryOutputId;
	if (id == null || !hasPrimaryColorOutput(definition)) throw new Error('Timeline Effect layer requires a primary color output');
	return id;
}

// レイヤーの自動接続はEffectを呼ぶ側の規則。ノードとして配置した場合の既定値には影響しない。
export function getEffectLayerParameterDefault(definition: EffectDefinition, id: string): TimelineEffectParameterBinding {
	if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown Effect parameter: ${id}`);
	if (definition.primaryAudioInputId === id) return { inputSource: 'lowerLayerAudio' };
	if (definition.primaryInputId === id) return createLowerLayerOutputBinding();
	return deepClone(definition.paramDefs[id].defaultValue);
}

export function getTimelineEffectLayerParameterBindings(layer: TimelineEffectLayer, definition: EffectDefinition): Record<string, TimelineEffectParameterBinding> {
	for (const id of Object.keys(layer.effectParamValues)) {
		if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown Effect parameter: ${id}`);
	}
	return Object.fromEntries(Object.keys(definition.paramDefs).map(id => [id,
		Object.hasOwn(layer.effectParamValues, id) ? layer.effectParamValues[id] : getEffectLayerParameterDefault(definition, id),
	]));
}

export function getTimelineEffectLayerDefinition(layer: TimelineEffectLayer, catalog: EffectCatalog): EffectDefinition {
	const definition = layer.effect == null ? null : catalog.getDefinition(layer.effect);
	if (definition == null) throw new Error(`Unknown or missing Effect source on layer ${layer.id}`);
	return definition;
}

export function validateTimelineEffectLayer(layer: TimelineEffectLayer, catalog: EffectCatalog,
	onValue?: (definition: ParameterDefinition, binding: ParameterBindingBase) => void): void {
	validateTimelineEffectLayerResolution(layer.resolution);
	const definition = getTimelineEffectLayerDefinition(layer, catalog);
	catalog.validate(layer.effect);
	getTimelineEffectLayerOutputId(definition);
	for (const [id, binding] of Object.entries(getTimelineEffectLayerParameterBindings(layer, definition))) {
		validateTimelineParameterTree(definition.paramDefs[id], binding, true, true, onValue);
	}
}
