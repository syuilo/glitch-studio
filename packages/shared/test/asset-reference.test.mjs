import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areDataTypesEqual } from '../src/data-type/data-type.ts';
import { getAssetReferenceMimeType, matchesAssetReferenceMimeType } from '../src/data-type/asset-reference.ts';
import { genEmptyValue } from '../src/parameter/parameter-default.ts';
import { staticParameterShape } from '../src/parameter/static-parameter.ts';

// 【Asset参照の種類を型の同一性に含める】
// kindが共通でも、フォント用の値をLUTや動画へ引き継ぐことはできない。
// 配列・構造体の内部も比較し、公開パラメータやキーフレームの互換判定を維持する。
test('compares asset categories including nested data types', () => {
	const nested = assetType => ({ kind: 'array', elementType: { kind: 'struct', fields: {
		asset: { kind: 'assetReference', assetType },
	} } });
	for (const assetType of ['font', 'lut', 'video']) {
		const dataType = { kind: 'assetReference', assetType };
		assert.equal(areDataTypesEqual(dataType, structuredClone(dataType)), true);
		assert.equal(areDataTypesEqual(dataType, { kind: 'imageAssetTextureReference' }), false);
		for (const otherAssetType of ['font', 'lut', 'video']) {
			assert.equal(areDataTypesEqual(dataType, { kind: 'assetReference', assetType: otherAssetType }), assetType === otherAssetType);
			assert.equal(areDataTypesEqual(nested(assetType), nested(otherAssetType)), assetType === otherAssetType);
		}
	}
});

// 【選択候補と実行時の種類チェックで同じMIME制約を使う】
// 動画・フォントは各形式を許可する一方、LUTは専用MIMEだけを受け付ける。
// prefixの判定が広すぎて別カテゴリや似た名前のMIMEを許可することを防ぐ。
test('shares MIME constraints between selection and resource validation', () => {
	for (const [assetType, expectedMimeType, accepted] of [
		['font', 'font/*', ['font/ttf', 'font/otf', 'font/woff2']],
		['video', 'video/*', ['video/mp4', 'video/webm']],
		['lut', 'application/x-cube-lut', ['application/x-cube-lut']],
	]) {
		const dataType = { kind: 'assetReference', assetType };
		assert.equal(getAssetReferenceMimeType(dataType), expectedMimeType);
		for (const mimeType of accepted) assert.equal(matchesAssetReferenceMimeType(dataType, mimeType), true);
		for (const mimeType of ['', 'image/png', 'audio/wav', 'fontish/ttf', 'videoish/mp4', 'application/x-cube-lut-extra']) {
			assert.equal(matchesAssetReferenceMimeType(dataType, mimeType), false);
		}
	}
});

// 【全種類のAsset参照を未選択で初期化し、参照先の変更を静的検証へ通知する】
// 通常の値編集を検証キャッシュから除外しても、素材IDの変更は依存先を変える。
// 統合後のkindを参照として扱い忘れると、差し替えや削除による不整合を見落とす。
test('initializes references to null and retains IDs in static validation shapes', () => {
	for (const assetType of ['font', 'lut', 'video']) {
		const definition = { dataType: { kind: 'assetReference', assetType } };
		assert.equal(genEmptyValue(definition), null);
		assert.deepEqual(staticParameterShape(definition, { inputSource: 'literal', value: 'first' }), ['literal', 'first']);
		assert.deepEqual(staticParameterShape(definition, { inputSource: 'literal', value: 'second' }), ['literal', 'second']);
	}
});
