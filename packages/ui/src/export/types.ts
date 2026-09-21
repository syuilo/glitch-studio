import type { Asset, Timeline, VisualModule } from '@glitch/shared/types.ts';
import type { IntermediateTextureFormat } from '@glitch/shared/effect-implementation.js';
import type { ExportProgress, TimelineExportSettings } from './timeline-export.ts';

export type ExportRequest = {
	settings: TimelineExportSettings;
	project: { assets: Asset[]; visualModules: VisualModule[]; timeline: Timeline };
	renderer: { enable32bitDataTextures: boolean; intermediateTextureFormat: IntermediateTextureFormat };
};

export type ExportResponse =
	| { type: 'progress'; progress: ExportProgress }
	| { type: 'complete'; buffer: ArrayBuffer }
	| { type: 'error'; message: string };
