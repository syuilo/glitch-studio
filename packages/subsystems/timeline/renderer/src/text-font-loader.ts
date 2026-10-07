let nextFontId = 0;

/** クリップ単位でフォントを所有し、準備完了をプレビュー・書き出しの双方で待つ。 */
export function createTextFontLoader() {
	const family = `GlitchTimelineTextFont${++nextFontId}`;
	let requestedBlob: Blob | null | undefined;
	let face: FontFace | null = null;
	let fontSet: FontFaceSet | null = null;
	let revision = 0;
	let disposed = false;
	let pending: Promise<void> = Promise.resolve();

	function release() {
		if (face != null) fontSet?.delete(face);
		face = null;
	}

	async function load(blob: Blob, requestRevision: number) {
		const data = await blob.arrayBuffer();
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
		async prepare(blob: Blob | null, signal: AbortSignal): Promise<boolean> {
			if (disposed || signal.aborted) return false;
			if (requestedBlob !== blob) {
				requestedBlob = blob;
				++revision;
				release();
				pending = blob == null ? Promise.resolve() : load(blob, revision);
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
			requestedBlob = undefined;
		},
	};
}
