import type { TimelineClipTiming } from './timing.ts';

/** IDは所有レイヤー内で一意。設定・キー・合成方法はクリップに持たせない。 */
export type TimelineClip = TimelineClipTiming & { id: string };
export type TimelineAssetClip = TimelineClip & { assetId: string };
export type TimelineVideoClip = TimelineAssetClip & { audioEnabled: boolean };
export type TimelineSceneClip = TimelineClip & { sceneId: string };
