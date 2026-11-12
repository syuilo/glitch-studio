import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compress } from 'wawoff2';

export const tablerCssPath = fileURLToPath(import.meta.resolve('@tabler/icons-webfont/dist/tabler-icons.css'));
const tablerFontPath = fileURLToPath(import.meta.resolve('@tabler/icons-webfont/dist/fonts/tabler-icons.ttf'));

export function parseIconStyles(css) {
	const codePoints = new Map();
	for (const match of css.matchAll(/\.(ti-[a-z0-9-]+)::?before\s*\{\s*content:\s*["']\\([a-fA-F0-9]+)["'];?\s*\}/g)) {
		codePoints.set(match[1], Number.parseInt(match[2], 16));
	}
	const baseRule = css.match(/\.ti\s*\{[^}]*\}/)?.[0];
	if (codePoints.size === 0 || baseRule == null) {
		throw new Error('Cannot read Tabler icon definitions. Check the installed @tabler/icons-webfont CSS.');
	}
	return { codePoints, baseRule };
}

export function collectIconNames(sources, codePoints, additionalIconNames = []) {
	const iconNames = new Set();
	const addIcon = (iconName, sourcePath) => {
		// ti-fwはUI側の幅調整用クラスであり、フォントに収録する文字ではない。
		if (iconName === 'ti-fw') return;
		if (!codePoints.has(iconName)) throw new Error(`Unknown Tabler icon "${iconName}" in ${sourcePath}`);
		iconNames.add(iconName);
	};
	for (const { sourcePath, content } of sources) {
		// 条件式の両側やメニュー定義も収集する。anti-aliasなど単語の途中はアイコン名と扱わない。
		// 文字列の連結で作る名前は静的に列挙できないため、additionalIconNamesで明示する。
		for (const match of content.matchAll(/(?<![\w-])ti-[a-z0-9-]+/g)) addIcon(match[0], sourcePath);
	}
	for (const iconName of additionalIconNames) addIcon(iconName, 'additionalIconNames');
	if (iconNames.size === 0) throw new Error('No Tabler icons were found in the UI sources.');
	// ファイルシステムの列挙順によって生成ファイルやアセットハッシュが変わらないようにする。
	return [...iconNames].sort();
}

async function subsetIconFont(codePoints) {
	const [font, wasm] = await Promise.all([
		readFile(tablerFontPath),
		readFile(new URL(import.meta.resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'))),
	]);
	const { instance: { exports: harfbuzz } } = await WebAssembly.instantiate(wasm);
	// 0はWASM側のヌルポインター。部分的に失敗した場合も、作成済みの資源だけをfinallyで解放する。
	let fontBuffer = 0;
	let sourceBlob = 0;
	let sourceFace = 0;
	let subsetInput = 0;
	let subsetFace = 0;
	let resultBlob = 0;
	try {
		fontBuffer = harfbuzz.malloc(font.length);
		if (fontBuffer === 0) throw new Error('Cannot allocate the Tabler font buffer.');
		new Uint8Array(harfbuzz.memory.buffer).set(font, fontBuffer);
		// HB_MEMORY_MODE_READONLY: 元のバッファはface/blobを破棄し終えるまで保持する。
		sourceBlob = harfbuzz.hb_blob_create(fontBuffer, font.length, 1, 0, 0);
		sourceFace = harfbuzz.hb_face_create(sourceBlob, 0);
		subsetInput = harfbuzz.hb_subset_input_create_or_fail();
		if (subsetInput === 0) throw new Error('Cannot create the icon font subset input.');
		const unicodeSet = harfbuzz.hb_subset_input_unicode_set(subsetInput);
		for (const codePoint of codePoints) harfbuzz.hb_set_add(unicodeSet, codePoint);
		subsetFace = harfbuzz.hb_subset_or_fail(sourceFace, subsetInput);
		if (subsetFace === 0) throw new Error('Cannot subset the Tabler font.');
		resultBlob = harfbuzz.hb_face_reference_blob(subsetFace);
		const resultLength = harfbuzz.hb_blob_get_length(resultBlob);
		if (resultLength === 0) throw new Error('The icon font subset is empty.');
		const resultOffset = harfbuzz.hb_blob_get_data(resultBlob, 0);
		// HarfBuzzの処理中にWASMメモリが拡張される可能性があるため、古いviewを使い回さない。
		// 圧縮へ渡す前にコピーし、WASM側の資源の寿命から切り離す。
		const subset = new Uint8Array(harfbuzz.memory.buffer).slice(resultOffset, resultOffset + resultLength);
		return Buffer.from(await compress(subset));
	} finally {
		if (resultBlob !== 0) harfbuzz.hb_blob_destroy(resultBlob);
		if (subsetFace !== 0) harfbuzz.hb_face_destroy(subsetFace);
		if (subsetInput !== 0) harfbuzz.hb_subset_input_destroy(subsetInput);
		if (sourceFace !== 0) harfbuzz.hb_face_destroy(sourceFace);
		if (sourceBlob !== 0) harfbuzz.hb_blob_destroy(sourceBlob);
		if (fontBuffer !== 0) harfbuzz.free(fontBuffer);
	}
}

export async function generateIconFont(sourceDirectory, additionalIconNames = []) {
	const sourcePaths = [];
	for await (const sourcePath of glob('**/*.{ts,vue}', { cwd: sourceDirectory })) {
		sourcePaths.push(path.join(sourceDirectory, sourcePath));
	}
	sourcePaths.sort();
	const sources = await Promise.all(sourcePaths.map(async sourcePath => ({ sourcePath, content: await readFile(sourcePath, 'utf8') })));
	const originalCss = await readFile(tablerCssPath, 'utf8');
	const { codePoints, baseRule } = parseIconStyles(originalCss);
	const iconNames = collectIconNames(sources, codePoints, additionalIconNames);
	const usedCodePoints = [...new Set(iconNames.map(iconName => codePoints.get(iconName)))].sort((first, second) => first - second);
	const font = await subsetIconFont(usedCodePoints);
	// アイコン用の文字を別フォントで一瞬表示しないよう、読み込み中は短時間非表示にする。
	const css = [
		originalCss.match(/\/\*![\s\S]*?\*\//)?.[0] ?? '',
		'@font-face {',
		'\tfont-family: "tabler-icons";',
		'\tfont-style: normal;',
		'\tfont-weight: 400;',
		'\tfont-display: block;',
		'\tsrc: url("./tabler-icons-subset.woff2") format("woff2");',
		'}',
		baseRule,
		...iconNames.map(iconName => `.${iconName}::before { content: "\\${codePoints.get(iconName).toString(16)}"; }`),
		'',
	].join('\n');
	return { css, font, iconNames, codePoints: usedCodePoints, sourcePaths };
}
