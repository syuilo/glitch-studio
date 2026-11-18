import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectParamDef } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { TimelineCustomNodeGraphEffectParameterBinding } from '../../parameter-binding.ts';

/** Timelineでの初期割当とリセット。保存済みの明示的な「なし」は呼び出し側で優先する。 */
export function getTimelineCustomNodeGraphEffectArgumentDefault(customNodeGraphEffect: Pick<CustomNodeGraphEffect, 'primaryAudioInputId' | 'primaryInputId'>, def: CustomNodeGraphEffectParamDef): TimelineCustomNodeGraphEffectParameterBinding {
	if (customNodeGraphEffect.primaryInputId === def.id) return { inputSource: 'lowerLayerOutput' };
	return customNodeGraphEffect.primaryAudioInputId === def.id && def.dataType.kind === 'audioSource'
		? { inputSource: 'lowerLayerAudio' } : deepClone(def.defaultValue);
}
