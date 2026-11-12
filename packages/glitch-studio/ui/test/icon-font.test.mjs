import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { URL } from 'node:url';
import { Blob, Face, Font } from 'harfbuzzjs';
import { decompress } from 'wawoff2';
import { collectIconNames, generateIconFont, parseIconStyles, tablerCssPath } from '../build/icon-font.mjs';

// 【テンプレート・条件分岐・メニュー定義の全アイコンを重複なく抽出する】
// 初期画面に表示されない操作や別ウィンドウのアイコンも、本番で欠けてはならない。
// 補助クラスやanti-aliasのような普通の単語は、未知のアイコンと誤検知しない。
test('collects static icons from templates and expressions with explicit dynamic additions', () => {
	const codePoints = new Map([['ti-plus', 0xea01], ['ti-minus', 0xea02], ['ti-alert', 0x10001]]);
	const sources = [
		{ sourcePath: 'Control.vue', content: '<i class="ti ti-plus ti-fw" :class="enabled ? \'ti-plus\' : \'ti-minus\'"></i>' },
		{ sourcePath: 'menu.ts', content: 'const menu = [{ icon: "ti ti-plus" }]; // anti-alias\nconst dynamicIcon = `ti-${name}`;' },
	];
	assert.deepEqual(collectIconNames(sources, codePoints, ['ti-alert']), ['ti-alert', 'ti-minus', 'ti-plus']);
	assert.deepEqual(collectIconNames(sources.toReversed(), codePoints, ['ti-alert']), ['ti-alert', 'ti-minus', 'ti-plus']);
});

// 【存在しないアイコンを黙って削除せず、指定元を示して失敗する】
// フォールバックを同梱しないため、タイプミスやTabler更新による名前の消失はビルド時に見つける。
// CSS形式の変更や空の走査結果も、空フォントを配布する前に停止する。
test('rejects unknown icons and missing definitions with actionable errors', () => {
	assert.throws(() => collectIconNames([{ sourcePath: 'Broken.vue', content: 'ti-typo' }], new Map()), /ti-typo.*Broken\.vue/);
	assert.throws(() => collectIconNames([], new Map(), ['ti-typo']), /additionalIconNames/);
	assert.throws(() => collectIconNames([], new Map()), /No Tabler icons/);
	assert.throws(() => parseIconStyles('.unrelated {}'), /Cannot read Tabler/);
});

// 【エイリアスとBMP外のUnicodeを切り捨てずに読む】
// Tablerには同じ文字を指す別名やU+FFFFを超えるアイコンがあり、16ビット文字だけでは収録漏れになる。
test('parses aliases and supplementary Unicode code points', () => {
	const { codePoints, baseRule } = parseIconStyles('.ti { font-family: "icons"; } .ti-plus:before { content: "\\ea01"; } .ti-add::before { content: "\\ea01"; } .ti-new:before { content: "\\10001"; }');
	assert.equal(codePoints.get('ti-plus'), codePoints.get('ti-add'));
	assert.equal(codePoints.get('ti-new'), 0x10001);
	assert.match(baseRule, /font-family/);
});

// 【実際のWOFF2が必要な文字だけを持ち、生成順に依存しない】
// CSSだけのテストでは、フォント本体の欠落・元フォントの混入・圧縮の不具合を検出できない。
// 実パッケージのTTFから生成してWOFF2を復号し、cmapに通常文字とBMP外の文字が残ることを確認する。
// 字形やベースラインが変わると既存UIの配置が崩れるため、元フォントの輪郭とメトリクスも照合する。
test('generates a deterministic WOFF2 containing exactly the requested icons', async t => {
	const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'glitch-studio-icon-font-test-'));
	t.after(async () => {
		// mkdtempで作ったこのテスト専用ディレクトリだけを削除する。
		assert.equal(path.dirname(temporaryDirectory), path.resolve(os.tmpdir()));
		assert.ok(path.basename(temporaryDirectory).startsWith('glitch-studio-icon-font-test-'));
		await rm(temporaryDirectory, { recursive: true, force: true });
	});
	const { codePoints } = parseIconStyles(await readFile(tablerCssPath, 'utf8'));
	const supplementaryIcon = [...codePoints].find(([, codePoint]) => codePoint > 0xffff)[0];
	await mkdir(path.join(temporaryDirectory, 'nested'));
	await writeFile(path.join(temporaryDirectory, 'nested/Control.vue'), `<i class="ti ti-plus ${supplementaryIcon}"></i>`);
	await writeFile(path.join(temporaryDirectory, 'menu.ts'), 'const icon = `ti-${name}`;');
	await writeFile(path.join(temporaryDirectory, 'ignored.md'), 'ti-unknown');
	const first = await generateIconFont(temporaryDirectory, ['ti-alert-triangle']);
	const second = await generateIconFont(temporaryDirectory, ['ti-alert-triangle']);
	assert.deepEqual(first.font, second.font);
	assert.equal(first.css, second.css);
	assert.equal(first.font.subarray(0, 4).toString(), 'wOF2');
	const decoded = new Uint8Array(await decompress(first.font));
	const face = new Face(new Blob(decoded.buffer));
	assert.deepEqual([...face.collectUnicodes()].sort((a, b) => a - b), first.codePoints);
	assert.deepEqual(first.codePoints, ['ti-plus', supplementaryIcon, 'ti-alert-triangle'].map(icon => codePoints.get(icon)).sort((a, b) => a - b));
	const originalBytes = new Uint8Array(await readFile(new URL(import.meta.resolve('@tabler/icons-webfont/dist/fonts/tabler-icons.ttf'))));
	const originalFont = new Font(new Face(new Blob(originalBytes.buffer)));
	const subsetFont = new Font(face);
	assert.deepEqual(subsetFont.hExtents(), originalFont.hExtents());
	assert.equal(face.upem, originalFont.face.upem);
	for (const codePoint of first.codePoints) {
		assert.equal(subsetFont.glyphToPath(subsetFont.nominalGlyph(codePoint)), originalFont.glyphToPath(originalFont.nominalGlyph(codePoint)));
	}
	assert.equal((first.css.match(/@font-face/g) ?? []).length, 1);
	assert.match(first.css, /url\("\.\/tabler-icons-subset\.woff2"\)/);
	assert.doesNotMatch(first.css, /\.ti-minus:/);
});
