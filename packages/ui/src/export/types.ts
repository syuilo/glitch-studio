import type { Asset } from '@glitch/shared/types.ts';
import type { RendererStaticOptions } from '@glitch/renderer/renderer.ts';
import type { Timeline } from '@glitch/shared/timeline/types.ts';
import type { VisualModule } from '@glitch/shared/visual-module/types.ts';
import type { ExportProgress, TimelineExportSettings } from './timeline-export.ts';

export type ExportRequest = {
	settings: TimelineExportSettings;
	project: { assets: Asset[]; visualModules: VisualModule[]; timeline: Timeline };
	renderer: RendererStaticOptions;
};

export type ExportResponse =
	| { type: 'progress'; progress: ExportProgress }
	| { type: 'complete'; buffer: ArrayBuffer }
	| { type: 'error'; message: string };
