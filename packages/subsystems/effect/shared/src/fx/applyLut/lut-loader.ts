import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
import { MAX_CUBE_FILE_BYTES, parseCubeLut } from './cube.ts';
import type { EffectStatus } from '../../effect-status.ts';
import type { CubeLut } from './cube.ts';

/** 非同期読み込みの世代とリソースの寿命を所有する。GPUへの変換は呼び出し側から渡す。 */
export function createLutLoader<Resource extends { dispose: () => void }>(
	createResource: (lut: CubeLut) => Resource,
	reportStatus: (status: EffectStatus) => void,
) {
	let requestedFileSource: FileSource | null = null;
	let resource: Resource | null = null;
	let revision = 0;
	let disposed = false;
	let ready = true;

	async function load(fileSource: FileSource, generation: number) {
		try {
			if (fileSource.size > MAX_CUBE_FILE_BYTES) throw new Error('Cube LUT exceeds the 128 MiB file limit.');
			const text = await ('url' in fileSource ? readFileSource(fileSource).then(file => file.text()) : fileSource.text());
			if (disposed || generation !== revision) return;
			resource = createResource(parseCubeLut(text));
			ready = true;
			revision++;
			reportStatus({ type: 'ready' });
		} catch (error) {
			if (disposed || generation !== revision) return;
			reportStatus({ type: 'error', message: `Could not load LUT: ${error instanceof Error ? error.message : String(error)}` });
		}
	}

	return {
		get resource() { return resource; },
		get ready() { return ready; },
		get cacheVersion() { return revision; },
		prepare(fileSource: FileSource | null) {
			if (disposed || requestedFileSource === fileSource) return;
			requestedFileSource = fileSource;
			revision++;
			resource?.dispose();
			resource = null;
			ready = fileSource == null;
			if (fileSource == null) reportStatus({ type: 'ready' });
			else {
				reportStatus({ type: 'loading' });
				void load(fileSource, revision);
			}
		},
		dispose() {
			disposed = true;
			revision++;
			resource?.dispose();
			resource = null;
			requestedFileSource = null;
		},
	};
}
