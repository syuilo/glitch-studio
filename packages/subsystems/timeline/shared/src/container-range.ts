import { getTimelineClipLayers } from './layer-tree.ts';
import type { TimelineContainerLayer } from './types.ts';

/** 仮想クリップは配置の外接区間。空白も含めて一括移動するが、描画の有効判定には使わない。 */
export function getTimelineContainerRange(container: TimelineContainerLayer): { startMs: number; durationMs: number } | null {
	let startMs = Infinity;
	let endMs = 0;
	for (const layer of getTimelineClipLayers(container.layers)) for (const clip of layer.clips) {
		startMs = Math.min(startMs, clip.startMs);
		endMs = Math.max(endMs, clip.startMs + clip.durationMs);
	}
	return startMs === Infinity ? null : { startMs, durationMs: endMs - startMs };
}
