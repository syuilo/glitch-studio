import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
import type { EffectStatus } from './effect-status.ts';

let nextFontId = 0;

export function createTextFontLoader(reportStatus: (status: EffectStatus) => void) {
	// 同じWorkerで複数のノードが別々のフォントを使っても衝突しない登録名。
	const family = `GlitchTextFont${++nextFontId}`;
	// undefinedは未要求、nullは標準フォントを要求済み。初回のprepare(null)でも準備と状態通知を行うため区別する。
	let requestedFileSource: FileSource | null | undefined;
	let face: FontFace | null = null;
	let fontSet: FontFaceSet | null = null;
	let revision = 0;
	let cacheVersion = 0;
	let ready = false;
	let disposed = false;

	function release() {
		if (face != null) fontSet?.delete(face);
		face = null;
	}

	async function load(fileSource: FileSource, requestRevision: number) {
		try {
			const data = await ('url' in fileSource ? readFileSource(fileSource).then(file => file.arrayBuffer()) : fileSource.arrayBuffer());
			if (disposed || revision !== requestRevision) return;
			const loadedFace = await new FontFace(family, data).load();
			// 選択変更・Asset置換・ノード破棄の前に開始した要求は公開しない。
			if (disposed || revision !== requestRevision) return;
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
			if (disposed || revision !== requestRevision) return;
			reportStatus({ type: 'error', message: `Could not load text font: ${error instanceof Error ? error.message : String(error)}` });
		}
	}

	return {
		get ready() { return ready; },
		get family() { return face == null ? 'sans-serif' : family; },
		get cacheVersion() { return cacheVersion; },
		prepare(fileSource: FileSource | null) {
			if (disposed || requestedFileSource === fileSource) return;
			requestedFileSource = fileSource;
			++revision;
			++cacheVersion;
			release();
			ready = fileSource == null;
			if (fileSource == null) {
				reportStatus({ type: 'ready' });
			} else {
				reportStatus({ type: 'loading' });
				void load(fileSource, revision);
			}
		},
		dispose() {
			disposed = true;
			++revision;
			release();
			requestedFileSource = undefined; // 未要求状態に戻す（nullは標準フォントの要求を表す）。
		},
	};
}
