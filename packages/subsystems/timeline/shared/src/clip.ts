import type { TimelineClipTiming } from './timing.ts';
import type { TimelineMediaClipTiming } from './media-timing.ts';

/** IDは所有レイヤー内で一意。レイヤーのパラメータ・キー・合成方法はクリップに持たせない。 */
export type TimelineContentClip = TimelineClipTiming & { id: string };
export type TimelineMediaClip = TimelineMediaClipTiming & { id: string; assetId: string };
export type TimelineClip = TimelineContentClip | (TimelineMediaClipTiming & { id: string });
export type TimelineAssetClip = TimelineContentClip & { assetId: string };
export type TimelineVideoClip = TimelineMediaClip & { audioEnabled: boolean };
export type TimelineSceneClip = TimelineContentClip & { sceneId: string };
