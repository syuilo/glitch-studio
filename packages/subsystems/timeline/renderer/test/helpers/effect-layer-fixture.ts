import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayerContext } from '../../src/timeline-renderer.ts';
import type { TimelineImage } from '../../src/timeline-image.ts';

export function testEffectLayer(effectSource: TimelineEffectLayer['effectSource']): TimelineEffectLayer {
	return {
		layerType: 'effect', effectSource, id: 'layer', name: 'Effect', color: null, isDisabled: false, isSolo: false, clips: [],
		isIncludedInComposite: true, forceDisableMotionBlur: false, coordinateSpace: 'screen', mask: null, layerMask: null,
		resolution: { mode: 'auto', scale: 1 }, effectParamValues: {}, effectStaticSettings: {}, automationGraphs: [],
		compositingParamValues: Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])) as TimelineEffectLayer['compositingParamValues'],
	};
}

export function testLayerContext(): TimelineLayerContext<TimelineImage> {
	const unexpected = async (): Promise<never> => { throw new Error('Unexpected Timeline image input'); };
	return { isExport: false, sceneTimeMs: 900, contentTimeMs: 250, contentEndTimeMs: 2000, clipElapsedTimeMs: 125,
		clipDurationMs: 1000, timeDelta: 16, getInput: unexpected, getLayerOutput: unexpected };
}
