import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';
const { resolveEffectStaticResources, getEffectIntrinsicResolution } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_effect_renderer/effect-static-settings.ts')));

// 【静的設定から素材を借用し、画像のアップロード前にも原寸を取得できる】
// GPUリソースの生成時期で解像度が変わらず、借用した素材を複製しないことを確認する。
test('resolves static resources and dimensions independently of GPU readiness', () => {
	const definition = { staticSettingDefs: { image: { dataType: { kind: 'assetReference', assetType: 'image' }, ui: { label: 'Image' }, defaultValue: null } }, intrinsicResolutionSetting: 'image' };
	const asset = { id: 'image', width: 640, height: 360, fileDataType: 'image/png', fileData: new Blob() };
	const context = { assets: [asset], assetTextures: new Map() };
	assert.deepEqual(getEffectIntrinsicResolution(definition, { image: asset.id }, context), { width: 640, height: 360 });
	assert.equal(resolveEffectStaticResources(definition, { image: asset.id }, context).image, null);
	const texture = { width: 640, height: 360 };
	context.assetTextures.set(asset.id, texture);
	assert.equal(resolveEffectStaticResources(definition, { image: asset.id }, context).image, texture);
	assert.equal(resolveEffectStaticResources(definition, { image: null }, context).image, null);
	assert.throws(() => resolveEffectStaticResources(definition, { image: 'missing' }, context), /not found/);
});

// 【動画・フォント・LUTは素材メタデータから分離した読み取り口だけを渡す】
// 埋め込みのBlobと外部参照のURLをそのまま借用し、エフェクト実装へIDや寸法を渡さない。
// 動画の原寸は別途メタデータから解決し、ファイル読み込み前にも確定できるようにする。
test('resolves file sources separately from asset metadata', () => {
	for (const [assetType, fileDataType] of [['video', 'video/mp4'], ['font', 'font/ttf'], ['lut', 'application/x-cube-lut']]) {
		const definition = { staticSettingDefs: { file: { dataType: { kind: 'assetReference', assetType }, ui: { label: 'File' }, defaultValue: null } },
			intrinsicResolutionSetting: assetType === 'video' ? 'file' : null };
		for (const fileData of [new Blob(), { url: 'https://example.test/asset', size: 100, error: null }]) {
			const asset = { id: 'asset', width: 640, height: 360, fileDataType, fileData };
			const context = { assets: [asset], assetTextures: new Map() };
			assert.equal(resolveEffectStaticResources(definition, { file: asset.id }, context).file, fileData);
			assert.equal(resolveEffectStaticResources(definition, { file: null }, context).file, null);
			assert.deepEqual(getEffectIntrinsicResolution(definition, { file: asset.id }, context), assetType === 'video' ? { width: 640, height: 360 } : null);
		}
	}
});

// 【固定したPlayer参照から最新の映像を読み、解像度はメタデータだけを使う】
// 初期化時のフレームを固定すると再生できず、到着したフレームで寸法を変えると静的性が崩れる。
test('reads changing frames through a fixed player while keeping dimensions static', () => {
	const definition = { staticSettingDefs: { player: { dataType: { kind: 'playerReference' }, ui: { label: 'Player' }, defaultValue: null } }, intrinsicResolutionSetting: 'player' };
	let frame = null;
	const context = { assets: [], assetTextures: new Map(), getPlayerVideoFrame: () => frame, getPlayerResolution: () => ({ width: 1920, height: 1080 }) };
	const resource = resolveEffectStaticResources(definition, { player: 'player' }, context).player;
	assert.equal(resource.getVideoFrame(), null);
	frame = { displayWidth: 320, displayHeight: 240 };
	assert.equal(resource.getVideoFrame(), frame);
	assert.deepEqual(getEffectIntrinsicResolution(definition, { player: 'player' }, context), { width: 1920, height: 1080 });
});
