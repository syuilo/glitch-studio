import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAssetReferenceMimeType, matchesAssetReferenceMimeType } from '../src/data-type/asset-reference.ts';
import { createStaticSettingValues, validateStaticSettings } from '../src/static-setting.ts';
import { validateParameterDefaultValues } from '../src/parameter/static-parameter.ts';

// 【素材参照にはBindingを保存せず、選択したIDを直接保持する】
// literalの加工式でも参照先が変わらないよう、Bindingのオブジェクト自体を入口で拒否する。
test('stores static asset IDs directly and rejects binding sources', () => {
	const definitions = { image: { dataType: { kind: 'assetReference', assetType: 'image' }, ui: { label: 'Image' }, defaultValue: null } };
	assert.deepEqual(createStaticSettingValues(definitions), { image: null });
	for (const image of [null, 'asset']) assert.doesNotThrow(() => validateStaticSettings(definitions, { image }));
	for (const image of [{ inputSource: 'literal', value: 'asset' }, { inputSource: 'expression', expression: 'TIME' }, { inputSource: 'visualModuleCustomParameterReference', parameterId: 'image' }]) assert.throws(() => validateStaticSettings(definitions, { image }), /Invalid static setting/);
});

// 【選択候補と読み込み処理で同じ素材カテゴリの制約を使う】
// 画像もAsset参照へ統合し、画像・動画・フォント・LUTを取り違えない。
test('shares MIME constraints between selection and resource validation', () => {
	for (const [assetType, expectedMimeType, accepted] of [
		['image', 'image/*', ['image/png', 'image/jpeg']], ['font', 'font/*', ['font/ttf', 'font/otf']],
		['video', 'video/*', ['video/mp4', 'video/webm']], ['lut', 'application/x-cube-lut', ['application/x-cube-lut']],
	]) {
		const dataType = { kind: 'assetReference', assetType };
		assert.equal(getAssetReferenceMimeType(dataType), expectedMimeType);
		for (const mimeType of accepted) assert.equal(matchesAssetReferenceMimeType(dataType, mimeType), true);
		for (const mimeType of ['', 'audio/wav', 'fontish/ttf', 'videoish/mp4', 'application/x-cube-lut-extra']) assert.equal(matchesAssetReferenceMimeType(dataType, mimeType), false);
	}
});

// 【公開する通常パラメータへ素材参照型を戻せない】
// ファイルやCommandで作られた定義も検査し、UIの選択肢を隠すだけの制限にしない。
test('rejects resource references in ordinary parameter definitions', () => {
	for (const kind of ['imageAssetTextureReference', 'assetReference', 'playerReference']) assert.throws(() => validateParameterDefaultValues({ dataType: { kind }, ui: { label: 'Resource', control: {} }, defaultValue: { inputSource: 'literal', value: null } }), /Unsupported parameter data type/);
});
