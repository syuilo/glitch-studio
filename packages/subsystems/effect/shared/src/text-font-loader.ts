import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
import type { EffectStatus } from './effect-status.ts';

let nextFontId = 0;

export function createTextFontLoader(fileSource: FileSource | null, reportStatus: (status: EffectStatus) => void) {
	// 同じWorkerで複数のノードが別々のフォントを使っても衝突しない登録名。
	const family = `GlitchTextFont${++nextFontId}`;
	let face: FontFace | null = null;
	let fontSet: FontFaceSet | null = null;
	let cacheVersion = 0;
	let ready = fileSource == null;
	let disposed = false;

	function release() {
		if (face != null) fontSet?.delete(face);
		face = null;
	}

	async function load(source: FileSource) {
		try {
			const data = await ('url' in source ? readFileSource(source).then(file => file.arrayBuffer()) : source.arrayBuffer());
			if (disposed) return;
			const loadedFace = await new FontFace(family, data).load();
			// 素材変更ではローダーごと破棄されるため、破棄後の結果だけを除外する。
			if (disposed) return;
			// Workerでは自身のFontFaceSetへ登録する。非Workerの描画にも対応する。
			fontSet = 'fonts' in globalThis
				? (globalThis as unknown as { fonts: FontFaceSet }).fonts
				: globalThis.document.fonts;
			fontSet.add(loadedFace);
			face = loadedFace;
			ready = true;
			++cacheVersion;
			reportStatus({ type: 'ready' });
		} catch (error) {
			if (disposed) return;
			reportStatus({ type: 'error', message: `Could not load text font: ${error instanceof Error ? error.message : String(error)}` });
		}
	}

	if (fileSource == null) reportStatus({ type: 'ready' });
	else {
		reportStatus({ type: 'loading' });
		void load(fileSource);
	}

	return {
		get ready() { return ready; },
		get family() { return face == null ? 'sans-serif' : family; },
		get cacheVersion() { return cacheVersion; },
		dispose() {
			disposed = true;
			release();
		},
	};
}
