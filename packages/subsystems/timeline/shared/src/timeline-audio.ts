import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineAudioLayer, TimelineVideoLayer, TimelineSceneLayer, TimelineLayer } from './types.ts';

export const timelineAudioParamDefs = {
	volume: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Volume', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 },
		canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;

/** Scene直下から選べる、音声出力を持つレイヤー。無効・空でも参照は維持できる。 */
export function isTimelineAudioOutputLayer(layer: TimelineLayer): layer is TimelineAudioLayer | TimelineVideoLayer | TimelineSceneLayer {
	return layer.layerType === 'audio' || layer.layerType === 'video' || layer.layerType === 'scene';
}
