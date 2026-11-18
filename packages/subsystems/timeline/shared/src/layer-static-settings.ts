import type { StaticSettingDefinitions, StaticSettingValues } from '@gs/shared/static-setting.ts';
import { textStaticSettingDefs } from './layers/text/text.ts';
import { voicevoxSubtitleStaticSettingDefs } from './layers/voicevox/voicevox-subtitle.ts';
import type { TimelineLayer } from './types.ts';

/** 親となるTimelineが各レイヤー所有の定義・値を組み合わせる。 */
export function getTimelineLayerStaticSettings(layer: TimelineLayer): {
	definitions: StaticSettingDefinitions; values: StaticSettingValues;
} {
	if (layer.layerType === 'text') return { definitions: textStaticSettingDefs, values: layer.textStaticSettings };
	if (layer.layerType === 'voicevox') return { definitions: voicevoxSubtitleStaticSettingDefs, values: layer.subtitleStaticSettings };
	return { definitions: {}, values: {} };
}
