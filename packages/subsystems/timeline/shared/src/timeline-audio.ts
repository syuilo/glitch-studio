import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { TimelineVoicevoxLayer, TimelineAudioLayer, TimelineVideoLayer, TimelineSceneLayer, TimelineLayer, TimelineScene } from './types.ts';

export const timelineAudioParamDefs = {
	volume: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Volume', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 },
		canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;

/** Scene直下から選べる、音声出力を持つレイヤー。無効・空でも参照は維持できる。 */
export function isTimelineAudioOutputLayer(layer: TimelineLayer): layer is TimelineAudioLayer | TimelineVideoLayer | TimelineSceneLayer | TimelineVoicevoxLayer {
	return layer.layerType === 'voicevox' || layer.layerType === 'audio' || layer.layerType === 'video' || layer.layerType === 'scene';
}

/**
 * 音声入力の参照範囲を所属Scene直下に限定し、編集時と描画時で同じ規則を使う。
 * 無効・空のレイヤーも有効な参照先とする。解決できない場合の拒否や入力なしへの変換は
 * 呼び出し側で決め、削除後のUndoに必要な参照IDは書き換えない。
 */
export function resolveTimelineAudioLayerReference(scene: TimelineScene, ownerLayerId: string, referencedLayerId: string | null): TimelineAudioLayer | TimelineVideoLayer | TimelineSceneLayer | TimelineVoicevoxLayer | null {
	if (referencedLayerId === null || referencedLayerId === ownerLayerId) return null;
	const layer = scene.layers.find(candidate => candidate.id === referencedLayerId);
	return layer && isTimelineAudioOutputLayer(layer) ? layer : null;
}
