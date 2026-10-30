import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
let nextFontId = 0;

/** クリップ単位でフォントを所有し、準備完了をプレビュー・書き出しの双方で待つ。 */
export function createTextFontLoader(fileSource: FileSource | null) {
	const family = `GlitchTimelineTextFont${++nextFontId}`;
	let face: FontFace | null = null;
	let fontSet: FontFaceSet | null = null;
	let disposed = false;
	let pending: Promise<void> | null = null;

	function release() {
		if (face != null) fontSet?.delete(face);
		face = null;
	}

	async function load(source: FileSource) {
		const data = await ('url' in source ? readFileSource(source).then(file => file.arrayBuffer()) : source.arrayBuffer());
		if (disposed) return;
		const loaded = await new FontFace(family, data).load();
		// 設定変更ではローダーも破棄される。完了した古いフォントを登録しない。
		if (disposed) return;
		fontSet = 'fonts' in globalThis ? (globalThis as unknown as { fonts: FontFaceSet }).fonts : globalThis.document.fonts;
		fontSet.add(loaded);
		face = loaded;
	}

	return {
		get family() { return face == null ? 'sans-serif' : family; },
		async waitUntilReady(signal: AbortSignal): Promise<boolean> {
			if (disposed || signal.aborted) return false;
			// 初回の待機で読み込みを開始し、使われないインスタンスでは読み込みも失敗も発生させない。
			pending ??= fileSource == null ? Promise.resolve() : load(fileSource);
			// 中断時は読み込みを待ち続けない。同じフォントの次回評価はpendingを再利用する。
			let abort: () => void = () => {};
			try {
				await Promise.race([pending, new Promise<void>(resolve => {
					abort = resolve;
					signal.addEventListener('abort', abort, { once: true });
				})]);
				return !disposed && !signal.aborted;
			} finally {
				signal.removeEventListener('abort', abort);
			}
		},
		dispose() {
			disposed = true;
			release();
		},
	};
}
