import type { Asset } from '@glitch/shared/types.ts';
import type { TimelineRendererManagerStaticOptions } from '@glitch/renderer/timeline-renderer-manager.ts';
import type { TimelineScene } from '@glitch/shared/timeline/types.ts';
import type { ProjectVisualModule } from '@glitch/shared/project/types.ts';
import type { ExportProgress, TimelineExportSettings } from './timeline-export.ts';

export type ExportRequest = {
	settings: TimelineExportSettings;
	project: { assets: Asset[]; visualModules: ProjectVisualModule[]; timelineScenes: TimelineScene[]; sceneId: string };
	renderer: TimelineRendererManagerStaticOptions;
};

export type ExportResponse =
	| { type: 'progress'; progress: ExportProgress }
	| { type: 'complete'; buffer: ArrayBuffer }
	| { type: 'error'; message: string };
