import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { VisualModule, VisualModuleParamDef } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineVisualModuleParameterBinding } from '../../parameter-binding.ts';

/** Timelineでの初期割当とリセット。保存済みの明示的な「なし」は呼び出し側で優先する。 */
export function getTimelineVisualModuleArgumentDefault(visualModule: Pick<VisualModule, 'primaryAudioInputId'>, def: VisualModuleParamDef): TimelineVisualModuleParameterBinding {
	return visualModule.primaryAudioInputId === def.id && def.dataType.kind === 'audioSource'
		? { inputSource: 'lowerLayerAudio' } : deepClone(def.defaultValue);
}
