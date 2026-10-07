import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineRendererManagerStaticOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { ExportProgress, TimelineExportSettings } from './timeline-export.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type ExportRequest = {
	settings: TimelineExportSettings;
	resolutionScale: number;
	project: { timelineFps: number; timelineMotionBlur: TimelineMotionBlurSettings; assets: Asset[]; generatedSpeech: GeneratedSpeech[]; visualModules: ProjectVisualModule[]; timelineScenes: TimelineScene[]; sceneId: string; resolution: Resolution };
	renderer: Pick<TimelineRendererManagerStaticOptions, 'enable32bitDataTextures' | 'intermediateTextureFormat'>;
};

export type ExportResponse =
	| { type: 'progress'; progress: ExportProgress }
	| { type: 'complete'; buffer: ArrayBuffer }
	| { type: 'error'; message: string };
