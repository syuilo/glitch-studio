import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
import { MAX_CUBE_FILE_BYTES, parseCubeLut } from './cube.ts';
import type { EffectStatus } from '../../effect-status.ts';
import type { CubeLut } from './cube.ts';

/** インスタンスに固定された素材の非同期読み込みとリソースの寿命を所有する。 */
export function createLutLoader<Resource extends { dispose: () => void }>(
	fileSource: FileSource | null,
	createResource: (lut: CubeLut) => Resource,
	reportStatus: (status: EffectStatus) => void,
) {
	let resource: Resource | null = null;
	let cacheVersion = 0;
	let disposed = false;
	let ready = fileSource == null;

	async function load(source: FileSource) {
		try {
			if (source.size > MAX_CUBE_FILE_BYTES) throw new Error('Cube LUT exceeds the 128 MiB file limit.');
			const text = await ('url' in source ? readFileSource(source).then(file => file.text()) : source.text());
			if (disposed) return;
			resource = createResource(parseCubeLut(text));
			ready = true;
			++cacheVersion;
			reportStatus({ type: 'ready' });
		} catch (error) {
			if (disposed) return;
			reportStatus({ type: 'error', message: `Could not load LUT: ${error instanceof Error ? error.message : String(error)}` });
		}
	}

	if (fileSource == null) reportStatus({ type: 'ready' });
	else {
		reportStatus({ type: 'loading' });
		void load(fileSource);
	}

	return {
		get resource() { return resource; },
		get ready() { return ready; },
		get cacheVersion() { return cacheVersion; },
		dispose() {
			disposed = true;
			resource?.dispose();
			resource = null;
		},
	};
}
