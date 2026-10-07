import { createVoicevoxSubtitleParameterValues } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createVoicevoxTimelineLayer(startMs: number): TimelineVoicevoxLayer {
	return {
		id: genId(), name: 'VOICEVOX', layerType: 'voicevox', subtitleParamValues: createVoicevoxSubtitleParameterValues(),
		isDisabled: false, automationGraphs: [],
		voicevox: { speedScale: 1 }, utterances: [],
		audioParamValues: { volume: { inputSource: 'literal', value: 1 } },
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		compositingParamValues: {
			fitMode: deepClone(timelineCompositingParamDefs.fitMode.defaultValue),
			blendMode: deepClone(timelineCompositingParamDefs.blendMode.defaultValue),
			opacity: deepClone(timelineCompositingParamDefs.opacity.defaultValue),
			position: deepClone(timelineCompositingParamDefs.position.defaultValue),
			origin: deepClone(timelineCompositingParamDefs.origin.defaultValue),
			scale: deepClone(timelineCompositingParamDefs.scale.defaultValue),
			rotation: deepClone(timelineCompositingParamDefs.rotation.defaultValue),
		},
	};
}
