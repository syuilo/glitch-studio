import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';

let nextFontId = 0;

/** 配置に固定したフォントを一度だけWorkerのFontFaceSetに登録する。 */
export async function loadTextFont(source: FileSource | null, signal?: AbortSignal) {
	if (source == null) return { family: 'sans-serif', dispose() {} };
	const family = 'GlitchNativeEffectTextFont' + ++nextFontId;
	const data = await (await readFileSource(source)).arrayBuffer();
	signal?.throwIfAborted();
	const face = await new FontFace(family, data).load();
	signal?.throwIfAborted();
	const fonts = 'fonts' in globalThis ? (globalThis as unknown as { fonts: FontFaceSet }).fonts : document.fonts;
	fonts.add(face);
	return { family, dispose() { fonts.delete(face); } };
}
