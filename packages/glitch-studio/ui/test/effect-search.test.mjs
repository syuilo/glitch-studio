import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	entryPoints: ['src/utility/effect-search.ts'],
	bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createEffectSearchQuery, matchEffectName, compareEffectNameSearchMatches } = module.exports;

function search(names, text) {
	const query = createEffectSearchQuery(text);
	return names.flatMap(name => {
		const match = matchEffectName(name, query);
		return match == null ? [] : [{ name, match }];
	}).sort((first, second) => compareEffectNameSearchMatches(first.match, second.match)).map(result => result.name);
}

// 【名前全体の完全一致を登録順や名前内の出現位置によらず優先する】
// Neuro Noiseがキー順で先に登録されていても、Noiseを探したときに先頭で選択できる必要がある。
test('ranks the exact effect name before names containing the same word', () => {
	assert.deepEqual(search(['Neuro Noise', 'Noise', 'Noise Field'], 'noise'), ['Noise', 'Noise Field', 'Neuro Noise']);
});

// 【前方一致の強さが同じ場合は一致位置、次に名前の短さを優先する】
// 入力途中のnoiでもNoiseを先頭で選べるようにし、Noise FieldもNeuro Noiseより上に並べる。
// 名前の短さだけで比較すると、途中で一致する短い名前が先頭で一致する名前を追い越してしまう。
test('ranks earlier prefix matches before shorter names and then registration order', () => {
	assert.deepEqual(search(['Neuro Noise', 'Noise Field', 'Noise'], 'noi'), ['Noise', 'Noise Field', 'Neuro Noise']);
	assert.deepEqual(search(['X Noise', 'Noise Generator'], 'noi'), ['Noise Generator', 'X Noise']);
});

// 【一致位置は最も強い一致から選び、typo候補でも補正先の単語の位置を比較する】
// 名前先頭の前方一致を、後ろで成立した単語一致の位置として使うと、一致度と位置の対応が崩れる。
// 同じ強さの一致が複数ある場合には、最初に現れた位置で比較する。
test('uses the earliest position of the strongest match including typo corrections', () => {
	assert.deepEqual(search(['Noiseish Noise', 'X Noise'], 'noise'), ['X Noise', 'Noiseish Noise']);
	assert.deepEqual(search(['X Noise', 'Noise Generator'], 'niose'), ['Noise Generator', 'X Noise']);
	assert.deepEqual(search(['AA Noise', 'X Noise Noise'], 'noi'), ['X Noise Noise', 'AA Noise']);
	assert.deepEqual(search(['Shortoise', 'OiseVeryLongName'], 'ise'), ['OiseVeryLongName', 'Shortoise']);
});

// 【複数語の一致位置を合算し、入力の語順や重複で順位を変えない】
// AND検索では検索語の並びを変えても同じ候補を探しているため、最初の検索語だけの位置で比較しない。
test('sums match positions independently of query term order and repetition', () => {
	const names = ['X Noise Blur', 'Noise Blur Long', 'Noise Blur'];
	for (const query of ['noi blu', 'blu noi', 'noi blu noi']) {
		assert.deepEqual(search(names, query), ['Noise Blur', 'Noise Blur Long', 'X Noise Blur']);
	}
});

// 【全検索語を語順によらず要求し、1語でも一致しなければ候補から除外する】
// スペースを増やす操作は検索の絞り込みであり、別々の語に一致する候補の和集合にはしない。
// 同じ語を重複入力しても、AND条件で求める候補が変わらないことを確認する。
test('requires every query term independently of order and repeated terms', () => {
	const names = ['Noise', 'Neuro Noise', 'Blur', 'Neuro Blur'];
	for (const query of ['neuro noise', 'noise neuro', 'noise neuro noise']) {
		assert.deepEqual(search(names, query), ['Neuro Noise']);
	}
	assert.deepEqual(search(names, 'neuro noise blur'), []);
});

// 【全角英数字・大文字・連続空白を名前と入力の両方で正規化する】
// IMEで入力された全角スペースや英数字、コピーしたタブ等で同じ名前が見つからなくなるのを防ぐ。
test('normalizes width, case and whitespace on both names and queries', () => {
	assert.deepEqual(search(['Neuro Noise', ' ＮＯＩＳＥ ', 'Noise Field'], ' \tＮＯＩＳＥ　\n'), [' ＮＯＩＳＥ ', 'Noise Field', 'Neuro Noise']);
	const match = matchEffectName('ＮＥＵＲＯ　\tＮＯＩＳＥ', createEffectSearchQuery(' neuro   noise '));
	assert.equal(match.isExactName, true);
});

// 【空白だけの入力では名前の有無にかかわらず元の登録順を保つ】
// 未入力と空白入力で表示やソートが変わらず、空の名前だけが優遇されることもないようにする。
test('keeps registration order for empty and whitespace-only queries', () => {
	const names = ['Neuro Noise', '', 'Noise'];
	for (const query of ['', '　 \t\n']) assert.deepEqual(search(names, query), names);
	assert.deepEqual(search([], 'noise'), []);
});

// 【通常の一致は単語一致・前方一致・部分一致の順で、typo一致より上に並べる】
// 名前の途中を入力して探す既存の動作を維持し、似た綴りの別名に順位を追い越されないようにする。
test('ranks word, prefix and substring matches before typo matches', () => {
	assert.deepEqual(search(['Noize', 'Denoise', 'Noiseless', 'White Noise'], 'noise'), ['White Noise', 'Noiseless', 'Denoise', 'Noize']);
	assert.deepEqual(search(['Neuro Noize', 'Aneuro Annoise'], 'neuro noise'), ['Aneuro Annoise', 'Neuro Noize']);
});

// 【4文字以上の語では挿入・削除・置換・隣接入れ替えを1回まで許容する】
// 特に隣接入れ替えを2回の置換として扱うと、よくあるn i o s eの誤入力を救済できない。
// 語頭・語中・語尾と繰り返し文字で、文字の読み飛ばしや末尾判定に欠落がないことを確認する。
test('tolerates one insertion, deletion, replacement or adjacent transposition per term', () => {
	for (const query of ['xnoise', 'noxise', 'noisex', 'oise', 'nise', 'nois', 'xoise', 'noize', 'noisx', 'onise', 'niose', 'noies']) {
		assert.deepEqual(search(['Noise'], query), ['Noise'], query);
	}
	assert.deepEqual(search(['Bloom'], 'blom'), ['Bloom']);
	assert.deepEqual(search(['Noise', 'Neuro Noise'], 'neuro niose'), ['Neuro Noise']);
	assert.deepEqual(search(['Chromatic Aberration'], 'chromtaic aberration'), ['Chromatic Aberration']);
});

// 【短い検索語のtypoや、1語に2回以上の編集が必要な候補は許容しない】
// 関連の薄い候補が増えるのを防ぎ、名前の一部へのtypo検索で許容回数を迂回することも避ける。
// 長い語でも上限は1回であり、長さに比例して許容回数を増やさない。
test('rejects typos in short terms and more than one edit in a term', () => {
	assert.deepEqual(search(['SDF'], 'sdr'), []);
	assert.deepEqual(search(['Noise'], 'no'), ['Noise']);
	for (const query of ['nxize', 'noizes']) assert.deepEqual(search(['Noise'], query), [], query);
	assert.deepEqual(search(['Chromatic'], 'chromxticx'), []);
	assert.deepEqual(search(['Neuro Noise'], 'neuro xniose'), []);
});

// 【複数語のtypoを許容しつつ、必要な編集回数が少ない候補を優先する】
// AND検索の各語で独立にtypoを判定し、全体の編集回数で候補の関連度を比較する。
test('ranks fewer typos first across multiple query terms', () => {
	assert.deepEqual(search(['Nero Noize', 'Neuro Noize', 'Neuro Noise Field', 'Neuro Noise'], 'neuro noise'),
		['Neuro Noise', 'Neuro Noise Field', 'Neuro Noize', 'Nero Noize']);
});

// 【区切り記号を含む名前の単語と、日本語・記号の部分一致を検索できる】
// Custom Shader Effectには任意の名前が付けられるため、英語の空白区切りだけに依存しない。
test('supports word boundaries at punctuation and preserves literal non-Latin searches', () => {
	assert.deepEqual(search(['Thin-Film (Noise)'], 'film noise'), ['Thin-Film (Noise)']);
	assert.deepEqual(search(['Thin-Film (Noise)'], 'flim niose'), ['Thin-Film (Noise)']);
	assert.deepEqual(search(['ノイズ生成'], 'イズ'), ['ノイズ生成']);
	assert.deepEqual(search(['Noise + Blur'], '+ blur'), ['Noise + Blur']);
});

// 【typoの文字数・一致位置・名前の長さはUnicodeのコードポイント数で判断する】
// サロゲートペアを含む3文字の検索語でtypoが有効になったり、1文字の置換が2回と数えられるのを防ぐ。
// 名前の長さや一致位置の比較でも、サロゲートペアを含む文字だけが不利にならないようにする。
test('counts Unicode code points for typo limits, edits, match positions and name lengths', () => {
	assert.deepEqual(search(['a𠮷b'], 'a𠮷c'), []);
	assert.deepEqual(search(['ab𠮷d'], 'ab𠮷e'), ['ab𠮷d']);
	assert.deepEqual(search(['ab𠮷d'], 'ab𠮶d'), ['ab𠮷d']);
	assert.deepEqual(search(['abc Noise', '𠮷𠮷 Noise'], 'noi'), ['𠮷𠮷 Noise', 'abc Noise']);
	assert.deepEqual(search(['Noiabc', 'Noi𠮷𠮷'], 'noi'), ['Noi𠮷𠮷', 'Noiabc']);
});
