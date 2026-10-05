import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.js';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { validateTimelineParameterTree } from './parameter-binding.ts';
import type { TimelineEffectParameterBinding } from './types.ts';
import type { TimelineEffectLayer } from './types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.js';
import type { TimelineLayerInputBinding } from './parameter-binding.ts';

export function createLayerInputBinding(): TimelineLayerInputBinding {
	return { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
}

// エフェクト定義の既定値は変更しない。レイヤーとしての作成・リセットだけで上書きする。
export function getEffectLayerParameterDefault(definition: EffectDefinition, key: string): TimelineEffectParameterBinding {
	if (definition.primaryAudioInputParameter === key) return { inputSource: 'lowerLayerAudio' };
	return definition.kind === 'modify' && definition.primaryInputParameter === key
		? createLayerInputBinding() : deepClone(definition.paramDefs[key].defaultValue);
}

export function validateTimelineEffectLayer(layer: TimelineEffectLayer, definition: EffectDefinition | undefined): void {
	if (definition == null) throw new Error(`Effect not found: ${layer.effectId}`);
	validateEffectResolution(layer.resolution);
	for (const [key, def] of Object.entries(definition.paramDefs)) {
		validateTimelineParameterTree(def, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key), true);
	}
}
