import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import type { DeepReadonly } from 'vue';
import type { LiveEffectStatusSource } from '@gs/glitch-studio_renderer/visual-module-renderer-manager.ts';
import type { TimelineLayerStatusSource } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { VisualModule, VisualModuleNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';

export type RenderFailureOrigin =
	| { source: LiveEffectStatusSource; nodeId: string }
	| { source: TimelineLayerStatusSource; nodeId?: string };

export type RenderFailureDiagnostic = { message: string; origin?: RenderFailureOrigin };

function label(kind: string, id: string, name?: string): string {
	return name ? `${kind} "${name}" (${id})` : `${kind} "${id}"`;
}

function nodeLabel(visualModule: VisualModule | undefined, nodeId: string): string {
	const sourceNode: VisualModuleNode | undefined = visualModule?.nodes.find(node => node.id === nodeId);
	return label('Node', nodeId, sourceNode?.type === 'effect' ? sourceNode.displayName || sourceNode.effectId : sourceNode?.type === 'relay' ? sourceNode.label : undefined);
}

/**
 * 実行状態を破棄しても、通知元のIDから修正対象を表示する。
 * 同じ子Sceneの複数配置を区別するため、Scene境界では配置クリップも経路に含める。
 * 編集で参照先が消えた場合も、保持したIDを表示して診断の所在を失わない。
 */
export function formatRenderFailureOrigin(origin: DeepReadonly<RenderFailureOrigin>, visualModules: readonly ProjectVisualModule[], scenes: readonly TimelineScene[]): string {
	const { source, nodeId } = origin;
	if (source.type === 'live') {
		const sourceVisualModule = visualModules.find(visualModule => visualModule.id === source.visualModuleId);
		const parts = ['LIVE', label('Visual Module', source.visualModuleId, sourceVisualModule?.name)];
		if (nodeId != null) parts.push(nodeLabel(sourceVisualModule, nodeId));
		return parts.join(' / ');
	}
	let currentScene = scenes.find(scene => scene.id === source.rootSceneId);
	const parts = [label('Scene', source.rootSceneId, currentScene?.name)];
	let layer: TimelineLayer | undefined;
	// layerPathは[レイヤーID, 子Sceneを配置するクリップID, レイヤーID, ...]。
	// Group・TransformはSceneを変えないため、その子のIDを同じScene内から探す。
	for (let index = 0; index < source.layerPath.length; index += 2) {
		const layerId = source.layerPath[index];
		layer = currentScene && findTimelineLayer(currentScene.layers, layerId);
		parts.push(label('Layer', layerId, layer?.name));
		const clipId = source.layerPath[index + 1] ?? source.clipId;
		const placementClip = layer && 'clips' in layer ? layer.clips.find(clip => clip.id === clipId) : undefined;
		parts.push(placementClip ? `Clip at ${placementClip.startMs / 1000}s (${clipId})` : label('Clip', clipId));
		if (index + 1 < source.layerPath.length) {
			const childSceneId = placementClip && 'sceneId' in placementClip ? placementClip.sceneId : undefined;
			currentScene = scenes.find(scene => scene.id === childSceneId);
		}
	}
	if (nodeId != null) {
		const sourceVisualModule = layer?.layerType === 'inlineVisualModule' ? layer.visualModule
			: layer?.layerType === 'visualModule' ? visualModules.find(visualModule => visualModule.id === layer.visualModuleId) : undefined;
		parts.push(nodeLabel(sourceVisualModule, nodeId));
	}
	return parts.join(' / ');
}
