import type { StaticSettingDefinitions, StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { textStaticSettingDefs } from './layers/text/text.ts';
import { voicevoxSubtitleStaticSettingDefs } from './layers/voicevox/voicevox-subtitle.ts';
import type { TimelineLayer } from './types.ts';

/** 親となるTimelineが各レイヤー所有の定義・値を組み合わせる。 */
export function getTimelineLayerStaticSettings(layer: TimelineLayer, effect?: EffectDefinition | null): {
	definitions: StaticSettingDefinitions; values: StaticSettingValues;
} {
	if (layer.layerType === 'effect') return { definitions: effect?.staticSettingDefs ?? {}, values: layer.effectStaticSettings };
	if (layer.layerType === 'text') return { definitions: textStaticSettingDefs, values: layer.textStaticSettings };
	if (layer.layerType === 'voicevox') return { definitions: voicevoxSubtitleStaticSettingDefs, values: layer.subtitleStaticSettings };
	return { definitions: {}, values: {} };
}
