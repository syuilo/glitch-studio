import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { createVoicevoxSubtitleParameterValues } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';

export function createVoicevoxTimelineLayer(startMs: number): TimelineVoicevoxLayer {
	return {
		id: genId(),
		name: 'VOICEVOX',
		layerType: 'voicevox',
		subtitleStaticSettings: { font: null },
		subtitleParamValues: createVoicevoxSubtitleParameterValues(),
		isDisabled: false,
		isSolo: false,
		color: null,
		automationGraphs: [],
		voicevox: { speedScale: 1 },
		utterances: [],
		audioParamValues: { volume: { inputSource: 'literal', value: 1 } },
		clips: [{ id: genId(), ...createTimelineClipTiming(startMs, 5000) }],
		forceDisableMotionBlur: false,
		mask: null,
		layerMask: null,
		isIncludedInComposite: true,
		coordinateSpace: 'screen',
		compositingParamValues: {
			depth: { inputSource: 'literal', value: 0 },
			clipToFrame: { inputSource: 'literal', value: false },
			fitMode: createDefaultParameterBinding(timelineCompositingParamDefs.fitMode),
			blendMode: createDefaultParameterBinding(timelineCompositingParamDefs.blendMode),
			opacity: createDefaultParameterBinding(timelineCompositingParamDefs.opacity),
			position: createDefaultParameterBinding(timelineCompositingParamDefs.position),
			origin: createDefaultParameterBinding(timelineCompositingParamDefs.origin),
			scale: createDefaultParameterBinding(timelineCompositingParamDefs.scale),
			rotation: createDefaultParameterBinding(timelineCompositingParamDefs.rotation),
		},
	};
}
