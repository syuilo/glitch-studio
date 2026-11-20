import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { validateEffectResolution } from '@gs/subsystems_effect-new_shared/resolution.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { resolveEffectSource, type EffectDefinitions, type EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { createLowerLayerOutputBinding, validateTimelineParameterTree } from '../../parameter-binding.ts';
import type { TimelineEffectParameterBinding, TimelineEffectLayer } from '../../types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
export { createLowerLayerOutputBinding } from '../../parameter-binding.ts';

export function findTimelineEffectOutput(definition: EffectDefinition): string | null {
	const port = definition.primaryOutput;
	return port != null && definition.outputDefs[port]?.dataType.kind === 'color' ? port : null;
}

export function getTimelineEffectOutput(definition: EffectDefinition): string {
	const port = findTimelineEffectOutput(definition);
	if (port == null) throw new Error('Timeline Effect requires a primary color output');
	return port;
}

// エフェクト定義の既定値は変更しない。レイヤーとしての作成・リセットだけで上書きする。
export function getEffectLayerParameterDefault(definition: EffectDefinition, key: string): TimelineEffectParameterBinding {
	if (definition.primaryAudioInputParameter === key) return { inputSource: 'lowerLayerAudio' };
	return definition.kind === 'modify' && definition.primaryInputParameter === key
		? createLowerLayerOutputBinding() : deepClone(definition.paramDefs[key].defaultValue);
}

/** 配置の受け入れ時に、インライン定義と入れ子の参照も含めて検証する。 */
export function validateTimelineEffectSource(source: EffectSource, definitions: EffectDefinitions): EffectDefinition {
	validateEffectSource(source, definitions);
	const { definition } = resolveEffectSource(source, definitions);
	getTimelineEffectOutput(definition);
	return definition;
}

export function validateTimelineEffectLayer(layer: TimelineEffectLayer, definitions: EffectDefinitions): void {
	const definition = validateTimelineEffectSource(layer.effectSource, definitions);
	validateEffectResolution(layer.resolution);
	validateStaticSettings(definition.staticSettingDefs ?? {}, layer.effectStaticSettings ?? {});
	for (const [key, def] of Object.entries(definition.paramDefs)) {
		validateTimelineParameterTree(def, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key), true, true);
	}
}
