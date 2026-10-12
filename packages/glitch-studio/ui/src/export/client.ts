import { getTimelineScene, getSceneDuration } from '@gs/subsystems_timeline_shared/scenes.ts';
import { getSceneBaseResolution } from '@gs/subsystems_timeline_shared/scene-resolution.ts';
import { scaleExportResolution } from './export-settings.ts';
import { validateExportSettings } from './timeline-export.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { ProjectValidationState } from '../project-validation-state.ts';
import { inspectRenderOptions } from '../render-options-validation.ts';
import type { ExportRequest, ExportResponse } from './types.ts';
import type { ExportProgress } from './timeline-export.ts';

export function exportTimeline(request: ExportRequest, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<ArrayBuffer> {
	return new Promise<ArrayBuffer>((resolve, reject) => {
		signal.throwIfAborted();
		// 書き出しはプレビューとは倍率・ブラー設定が異なる。固定スナップショットをUIで一度検査する。
		const validation = new ProjectValidationState(effectDefinitions);
		validation.updateAssets(request.project.assets);
		validation.replace(request.project);
		validation.setOptions(inspectRenderOptions({ ...request.project, resolutionScale: request.resolutionScale }, 8192, request.project), request.resolutionScale, 8192);
		if (!validation.valid) throw new Error(validation.diagnostics.firstMessage ?? 'Invalid project settings');
		const scene = getTimelineScene(request.project.timelineScenes, request.project.sceneId);
		if (getSceneDuration(scene) <= 0) throw new Error('Cannot export an empty scene.');
		const settings = { ...request.settings, ...scaleExportResolution(getSceneBaseResolution(scene.resolution, request.project.resolution), request.resolutionScale, request.settings.format) };
		const validationError = validateExportSettings(settings);
		if (validationError) throw new Error(validationError);
		request = { ...request, settings };
		const worker = new Worker(new URL('./timeline-export.worker.ts', import.meta.url), { type: 'module' });
		const dispose = () => {
			worker.terminate();
			signal.removeEventListener('abort', abort);
		};
		const fail = (error: unknown) => { dispose(); reject(error); };
		const abort = () => fail(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		worker.onerror = event => fail(new Error(event.message || 'Export worker failed.'));
		worker.onmessageerror = () => fail(new Error('Could not read the export worker response.'));
		worker.onmessage = (event: MessageEvent<ExportResponse>) => {
			const message = event.data;
			if (message.type === 'progress') onProgress(message.progress);
			else if (message.type === 'error') fail(new Error(message.message));
			else {
				dispose();
				resolve(message.buffer);
			}
		};
		try { worker.postMessage(request); } catch (error) { fail(error); }
	});
}
