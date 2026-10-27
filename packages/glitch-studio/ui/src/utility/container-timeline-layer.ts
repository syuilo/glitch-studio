import { createTimelineContainerLayer } from '@gs/subsystems_timeline_shared/container-layer.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { TimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineContainerLayerType } from '@gs/subsystems_timeline_shared/container-layer.ts';
import { i18n } from '@/i18n.ts';

export function createContainerTimelineLayer<Type extends TimelineContainerLayerType>(type: Type): Extract<TimelineContainerLayer, { layerType: Type }> {
	const names = { folder: 'Folder', parameterContainer: 'Parameter Container', transform: 'Transform', group: 'Group' };
	return createTimelineContainerLayer(type, genId(), names[type]);
}

export function getTimelineContainerTypeLabel(type: TimelineContainerLayerType): string {
	return { folder: i18n.ts.Folder, parameterContainer: i18n.ts.ParameterContainer, transform: i18n.ts.Transform, group: i18n.ts.Group }[type];
}
