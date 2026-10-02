import type { Asset } from '@gs/shared/types.ts';
import type { TimelineRendererManagerStaticOptions } from '@gs/glitch-studio_renderer/timeline-renderer-manager.ts';
import type { TimelineScene } from '@gs/shared/timeline/types.ts';
import type { ProjectVisualModule } from '@gs/shared/project/types.ts';
import type { ExportProgress, TimelineExportSettings } from './timeline-export.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

export type ExportRequest = {
	settings: TimelineExportSettings;
	resolutionScale: number;
	project: { assets: Asset[]; visualModules: ProjectVisualModule[]; timelineScenes: TimelineScene[]; sceneId: string; resolution: Resolution };
	renderer: TimelineRendererManagerStaticOptions;
};

export type ExportResponse =
	| { type: 'progress'; progress: ExportProgress }
	| { type: 'complete'; buffer: ArrayBuffer }
	| { type: 'error'; message: string };
