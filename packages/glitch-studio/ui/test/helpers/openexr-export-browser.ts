import { exportTimeline } from '../../src/export/client.ts';
import { BrowserExportFile } from '../../src/export/browser-export-file.ts';
import type { ExportProgress } from '../../src/export/timeline-export.ts';
import type { ExportRequest } from '../../src/export/types.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { TimelineEffectLayer } from '@gs/subsystems_timeline_shared/types.ts';

function request(compression: 'none' | 'zip', resolution = { width: 5, height: 273 }): ExportRequest {
	return { settings: { format: 'exr', compression, ...resolution, positionMs: 500 }, resolutionScale: 1,
		renderer: { enable32bitDataTextures: false }, project: {
			resolution, timelineFps: 60, timelineMotionBlur: { enabled: true, shutterAngle: 180, samples: 4 },
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

function getOpenExrResolution(buffer: ArrayBuffer) {
	const bytes = new Uint8Array(buffer);
	const view = new DataView(buffer);
	let position = 8;
	const string = () => { const end = bytes.indexOf(0, position); const value = new TextDecoder().decode(bytes.subarray(position, end)); position = end + 1; return value; };
	for (let name; (name = string()) !== '';) {
		string();
		const length = view.getUint32(position, true);
		position += 4;
		if (name === 'dataWindow') return { width: view.getInt32(position + 8, true) + 1, height: view.getInt32(position + 12, true) + 1 };
		position += length;
	}
	throw new Error('Missing EXR data window');
}

async function collectExport(job: ExportRequest, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<ArrayBuffer> {
	const root = await navigator.storage.getDirectory();
	const directoryName = 'glitch-export-test-' + crypto.randomUUID();
	const directory = await root.getDirectoryHandle(directoryName, { create: true });
	const name = 'output.' + job.settings.format;
	const writer = new BrowserExportFile({ directory, name, handle: null });
	try {
		const size = await exportTimeline(job, signal, onProgress, async (chunk, _totalBytes, position) => writer.write(chunk, position));
		await writer.finish(size);
		return await (await (await directory.getFileHandle(name)).getFile()).arrayBuffer();
	} finally {
		await writer.abort();
		await root.removeEntry(directoryName, { recursive: true });
	}
}

async function exportAndReadStillResolution(format: 'exr' | 'webp', resolution: { width: number; height: number }, motionBlurEnabled: boolean) {
	const job = request('zip', resolution);
	job.project.timelineMotionBlur.enabled = motionBlurEnabled;
	if (format === 'webp') job.settings = { format, quality: 'lossless', ...resolution, positionMs: 500 };
	const buffer = await collectExport(job, new AbortController().signal, () => {});
	if (format === 'exr') return { format, ...getOpenExrResolution(buffer) };
	const image = await createImageBitmap(new Blob([buffer], { type: 'image/webp' }));
	try { return { format, width: image.width, height: image.height }; }
	finally { image.close(); }
}

export async function run(largeSquare = false) {
	const files: { compression: string; bytes: number[] }[] = [];
	for (const compression of ['none', 'zip'] as const) {
		const updates: ExportProgress[] = [];
		const buffer = await collectExport(request(compression), new AbortController().signal, value => updates.push(value));
		const blocks = updates.filter(value => value.phase === 'encoding-exr');
		const expected = compression === 'zip' ? Math.ceil(273 / 16) : 273;
		if (blocks.length < 2 || blocks.at(-1)?.completedBlocks !== expected) throw new Error(`Missing ${compression} progress`);
		if (new DataView(buffer).getUint32(0, true) !== 20000630) throw new Error('Invalid EXR file');
		files.push({ compression, bytes: Array.from(new Uint8Array(buffer)) });
	}
	const controller = new AbortController();
	let cancelled = false;
	try {
		await collectExport(request('zip'), controller.signal, value => { if (value.phase === 'encoding-exr') controller.abort(); });
	} catch (error) { cancelled = error instanceof DOMException && error.name === 'AbortError'; }
	if (!cancelled) throw new Error('EXR export ignored cancellation');
	const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
	if (adapter == null) throw new Error('WebGPU is unavailable.');
	const textureLimit = adapter.limits.maxTextureDimension2D;
	const largeStills: { format: string; width: number; height: number }[] = [];
	if (textureLimit > 8192) {
		for (const format of ['exr', 'webp'] as const) {
			const maxDimension = format === 'webp' ? Math.min(textureLimit, 16383) : textureLimit;
			for (const resolution of [{ width: maxDimension, height: 19 }, { width: 17, height: maxDimension }]) {
				largeStills.push(await exportAndReadStillResolution(format, resolution, true));
			}
		}
		// 明示実行時だけ両辺8K超の画像も検証する。通常のGPUテストでは、能力の
		// 検証のために数GiBのVRAMを占有せず、各軸の上限と形式制限を照合する。
		if (largeSquare) {
			const size = Math.min(9000, textureLimit);
			for (const format of ['exr', 'webp'] as const) largeStills.push(await exportAndReadStillResolution(format, { width: size, height: size }, false));
		}
	}
	return { files, cancelled, textureLimit, largeStills };
}
