import type { TimelineClipTiming } from './timing.ts';
import type { TimelineVideoClipTiming } from './layers/video/video-timing.ts';

/** IDは所有レイヤー内で一意。レイヤーのパラメータ・キー・合成方法はクリップに持たせない。 */
export type TimelineClip = TimelineClipTiming & { id: string };
export type TimelineAssetClip = TimelineClip & { assetId: string };
export type TimelineVideoClip = TimelineAssetClip & TimelineVideoClipTiming & { audioEnabled: boolean };
export type TimelineSceneClip = TimelineClip & { sceneId: string };
