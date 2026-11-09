import { exportTimeline } from '../../src/export/client.ts';
import type { ExportProgress } from '../../src/export/timeline-export.ts';
import type { ExportRequest } from '../../src/export/types.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';

function request(compression: 'none' | 'zip'): ExportRequest {
	return { settings: { format: 'exr', compression, width: 5, height: 273, positionMs: 500 }, resolutionScale: 1,
		renderer: { enable32bitDataTextures: false }, project: {
			resolution: { width: 5, height: 273 }, timelineFps: 60, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 },
			assets: [], visualModules: [], customShaderEffects: [], automationGraphs: [], generatedSpeech: [], sceneId: 'scene',
			timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{
				id: 'fill', name: 'Fill', color: null, isDisabled: false, isSolo: false, layerType: 'effect', effectId: 'fill', resolution: { mode: 'auto', scale: 1 },
				coordinateSpace: 'screen', mask: null, layerMask: null, isIncludedInComposite: true, forceDisableMotionBlur: false, effectStaticSettings: {},
				effectParamValues: { color: { inputSource: 'literal', value: [4, -1, 0.5, 0.5] } },
				compositingParamValues: Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, definition]) => [key, definition.defaultValue])) as TimelineEffectLayer['compositingParamValues'],
				automationGraphs: [], clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }],
			}] }],
		} };
}

export async function run() {
	const files: { compression: string; bytes: number[] }[] = [];
	for (const compression of ['none', 'zip'] as const) {
		const updates: ExportProgress[] = [];
		const buffer = await exportTimeline(request(compression), new AbortController().signal, value => updates.push(value));
		const blocks = updates.filter(value => value.phase === 'encoding-exr');
		const expected = compression === 'zip' ? Math.ceil(273 / 16) : 273;
		if (blocks.length < 2 || blocks.at(-1)?.completedBlocks !== expected) throw new Error(`Missing ${compression} progress`);
		if (new DataView(buffer).getUint32(0, true) !== 20000630) throw new Error('Invalid EXR file');
		files.push({ compression, bytes: Array.from(new Uint8Array(buffer)) });
	}
	const controller = new AbortController();
	let cancelled = false;
	try {
		await exportTimeline(request('zip'), controller.signal, value => { if (value.phase === 'encoding-exr') controller.abort(); });
	} catch (error) { cancelled = error instanceof DOMException && error.name === 'AbortError'; }
	if (!cancelled) throw new Error('EXR export ignored cancellation');
	return { files, cancelled };
}
