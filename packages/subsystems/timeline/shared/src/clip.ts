import type { TimelineClipTiming } from './timing.ts';
import type { TimelineMediaClipTiming } from './media-timing.ts';
import type { TimelineVideoHoldTiming } from './layers/video/video-hold.ts';

/** IDは所有レイヤー内で一意。レイヤーのパラメータ・キー・合成方法はクリップに持たせない。 */
export type TimelineContentClip = TimelineClipTiming & { id: string };
export type TimelineMediaClip = TimelineMediaClipTiming & { id: string; assetId: string };
export type TimelineClip = TimelineContentClip | ((TimelineMediaClipTiming | TimelineVideoHoldTiming) & { id: string });
export type TimelineAssetClip = TimelineContentClip & { assetId: string };
export type TimelineVideoPlaybackClip = TimelineMediaClip & { audioEnabled: boolean };
/** sourceTimeMsとsourceInMsで時間モデルを区別する。固定表示は音声を出力しない。 */
export type TimelineVideoHoldClip = TimelineVideoHoldTiming & { id: string; assetId: string; audioEnabled: false };
export type TimelineVideoClip = TimelineVideoPlaybackClip | TimelineVideoHoldClip;
export type TimelineSceneClip = TimelineContentClip & { sceneId: string };
