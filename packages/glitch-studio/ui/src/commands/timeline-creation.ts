import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { createTimelineContainerLayer } from '@gs/subsystems_timeline_shared/container-layer.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { isTimelineContainerLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { createEffectTimelineLayer } from '../utility/effect-timeline-layer.ts';
import { createTextTimelineLayer } from '../utility/text-timeline-layer.ts';
import { createShapeTimelineLayer } from '../utility/shape-timeline-layer.ts';
import { createCameraTimelineLayer } from '../utility/camera-timeline-layer.ts';
import { createVoicevoxTimelineLayer } from '../utility/voicevox-timeline-layer.ts';
import { createImageLayer } from '../utility/image-layer.ts';
import { getEffectDefinitions } from '../utility/project-effects.ts';
import type { EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { ProjectState } from '../Project.ts';
import type { ShapeType } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import type { TimelineLayer, TimelineClipLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipData } from './timeline.ts';

export type TimelineLayerReference = { sceneId: string; layerId: string };
export type TimelineClipReference = TimelineLayerReference & { clipId: string };
export type TimelineLayerRecipe = { name?: string } & (
	| { layerType: 'effect'; effectSource: EffectSource }
	| { layerType: 'shape'; shapeType: ShapeType }
	| { layerType: 'text' | 'camera' | 'voicevox' | 'image' | 'video' | 'audio' | 'scene' | 'folder' | 'parameterContainer' | 'transform' | 'group' }
);

export type TimelineClipRecipe = TimelineClipData extends infer Clip ? Clip extends TimelineClipData ? Omit<Clip, 'id'> : never : never;

/**
 * 保存形式の全フィールドを呼び出し側へ要求しない。既定値は既存の各Layer生成処理と共有する。
 * 時刻や既定の5秒クリップはUIが明示して渡し、空のLayer作成に再生位置を暗黙に使わない。
 */
export function createTimelineLayerFromRecipe(state: ProjectState, recipe: TimelineLayerRecipe, clips: readonly TimelineClipRecipe[] = []): TimelineLayer {
	let layer: TimelineLayer;
	switch (recipe.layerType) {
		case 'effect': {
			const definition = getEffectDefinitions(state).describe(recipe.effectSource);
			layer = createEffectTimelineLayer(definition, 0);
			break;
		}
		case 'shape': layer = createShapeTimelineLayer(recipe.shapeType, 0); break;
		case 'text': layer = createTextTimelineLayer(0); break;
		case 'camera': layer = createCameraTimelineLayer(0); break;
		case 'voicevox': layer = createVoicevoxTimelineLayer(0); break;
		case 'folder':
		case 'parameterContainer':
		case 'transform':
		case 'group': layer = createTimelineContainerLayer(recipe.layerType, genId(), ({ folder: 'Folder', parameterContainer: 'Parameter Container', transform: 'Transform', group: 'Group' })[recipe.layerType]); break;
		case 'image': layer = createImageLayer('', 0); break;
		case 'video': {
			const image = createImageLayer('', 0, 'Video');
			layer = { ...image, layerType: 'video', clips: [], audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) } };
			break;
		}
		case 'audio': layer = {
			id: genId(), name: 'Audio', layerType: 'audio', color: null, isDisabled: false, isSolo: false,
			automationGraphs: [], audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) }, clips: [],
		}; break;
		case 'scene': {
			const image = createImageLayer('', 0, 'Scene');
			layer = { ...image, layerType: 'scene', clips: [], audioParamValues: { volume: deepClone(timelineAudioParamDefs.volume.defaultValue) } };
			break;
		}
		default: throw new Error('Unknown timeline layer type');
	}
	if (recipe.name != null) {
		if (typeof recipe.name !== 'string') throw new Error('Layer name must be a string');
		layer.name = recipe.name;
	}
	if (isTimelineContainerLayer(layer)) {
		if (clips.length > 0) throw new Error('Container layers cannot own clips');
	} else {
		// 作成先Layerとの対応はCommandの検証で確認する。各ClipのIDは一度だけ生成する。
		(layer as TimelineClipLayer).clips = clips.map(clip => ({ ...deepClone(clip), id: genId() })) as TimelineClipLayer['clips'];
	}
	return layer;
}
