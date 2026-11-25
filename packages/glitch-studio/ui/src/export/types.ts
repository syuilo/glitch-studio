import type { SharedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineRendererManagerStaticOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectCustomShaderEffect, ProjectNodesEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { ExportProgress, TimelineExportSettings } from './timeline-export.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type ExportRequest = {
	settings: TimelineExportSettings;
	/** nullは出力寸法をSceneの基準サイズに使うカスタム指定。 */
	resolutionScale: number | null;
	project: { customShaderEffects: ProjectCustomShaderEffect[]; functionCurves: SharedFunctionCurve[]; timelineFps: number; timelineMotionBlur: TimelineMotionBlurSettings; assets: Asset[]; generatedSpeech: GeneratedSpeech[]; nodesEffects: ProjectNodesEffect[]; timelineScenes: TimelineScene[]; sceneId: string; resolution: Resolution };
	renderer: Pick<TimelineRendererManagerStaticOptions, 'enable32bitDataTextures' | 'effectRenderTiling'>;
};

export type ExportResponse =
	| { type: 'progress'; progress: ExportProgress }
	| { type: 'chunk'; sequence: number; buffer: ArrayBuffer; position: number; totalBytes: number | null }
	| { type: 'complete'; buffer: ArrayBuffer; totalBytes: number }
	| { type: 'error'; message: string };

export type ExportChunkAcknowledgement = { type: 'chunk-written'; sequence: number };
