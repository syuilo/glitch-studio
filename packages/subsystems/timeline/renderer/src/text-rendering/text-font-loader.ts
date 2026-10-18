import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
let nextFontId = 0;

/** クリップ単位でフォントを所有し、準備完了をプレビュー・書き出しの双方で待つ。 */
export function createTextFontLoader() {
	const family = `GlitchTimelineTextFont${++nextFontId}`;
	// undefinedは未要求、nullは標準フォントを要求済み。初回のprepare(null)でも準備と状態通知を行うため区別する。
	let requestedFileSource: FileSource | null | undefined;
	let face: FontFace | null = null;
	let fontSet: FontFaceSet | null = null;
	let revision = 0;
	let disposed = false;
	let pending: Promise<void> = Promise.resolve();

	function release() {
		if (face != null) fontSet?.delete(face);
		face = null;
	}

	async function load(fileSource: FileSource, requestRevision: number) {
		const data = await ('url' in fileSource ? readFileSource(fileSource).then(file => file.arrayBuffer()) : fileSource.arrayBuffer());
		if (disposed || revision !== requestRevision) return;
		const loaded = await new FontFace(family, data).load();
		// 破棄・フォント変更より前の要求をWorkerのFontFaceSetへ登録しない。
		if (disposed || revision !== requestRevision) return;
		fontSet = 'fonts' in globalThis ? (globalThis as unknown as { fonts: FontFaceSet }).fonts : globalThis.document.fonts;
		fontSet.add(loaded);
		face = loaded;
	}

	return {
		get family() { return face == null ? 'sans-serif' : family; },
		get cacheVersion() { return revision; },
		async prepare(fileSource: FileSource | null, signal: AbortSignal): Promise<boolean> {
			if (disposed || signal.aborted) return false;
			if (requestedFileSource !== fileSource) {
				requestedFileSource = fileSource;
				++revision;
				release();
				pending = fileSource == null ? Promise.resolve() : load(fileSource, revision);
			}
			const requestRevision = revision;
			// 中断時は読み込みを待ち続けない。同じフォントの次回評価はpendingを再利用する。
			let abort: () => void = () => {};
			try {
				await Promise.race([pending, new Promise<void>(resolve => {
					abort = resolve;
					signal.addEventListener('abort', abort, { once: true });
				})]);
				return !disposed && !signal.aborted && revision === requestRevision;
			} finally {
				signal.removeEventListener('abort', abort);
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
