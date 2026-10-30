import { validateStaticSettings } from '@gs/shared/static-setting.ts';
import { validateEffectResolution } from '@gs/subsystems_effect_shared/resolution.js';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { createLowerLayerOutputBinding, validateTimelineParameterTree } from '../../parameter-binding.ts';
import type { TimelineEffectParameterBinding } from '../../types.ts';
import type { TimelineEffectLayer } from '../../types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.js';
export { createLowerLayerOutputBinding } from '../../parameter-binding.ts';

// エフェクト定義の既定値は変更しない。レイヤーとしての作成・リセットだけで上書きする。
export function getEffectLayerParameterDefault(definition: EffectDefinition, key: string): TimelineEffectParameterBinding {
	if (definition.primaryAudioInputParameter === key) return { inputSource: 'lowerLayerAudio' };
	return definition.kind === 'modify' && definition.primaryInputParameter === key
		? createLowerLayerOutputBinding() : deepClone(definition.paramDefs[key].defaultValue);
}

// 省略可能プロパティや検索結果を直接受け取る境界なので、入力のundefinedも未指定として受け入れる。
export function validateTimelineEffectLayer(layer: TimelineEffectLayer, definition: EffectDefinition | null | undefined): void {
	if (definition == null) throw new Error(`Effect not found: ${layer.effectId}`);
	validateEffectResolution(layer.resolution);
	validateStaticSettings(definition.staticSettingDefs ?? {}, layer.effectStaticSettings ?? {});
	for (const [key, def] of Object.entries(definition.paramDefs)) {
		validateTimelineParameterTree(def, layer.effectParamValues[key] ?? getEffectLayerParameterDefault(definition, key), true, true, (_definition, binding) => {
			if ((binding.inputSource === 'lowerLayerOutput' || binding.inputSource === 'anotherLayerOutput') && !('fitMode' in binding)) throw new Error('Effect image input requires sampling');
		});
	}
}
