import { LUT_ASSET_MIME_TYPE } from '@gs/shared/media/lut.ts';
import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { Asset } from '@gs/shared/types.ts';
import { getFileSourceError } from '@gs/shared/file-source.ts';

/**
 * 評価済みの末端値をエフェクトの実行時入力へ変換する。リソースの所有権は移さない。
 * 式の評価・入力接続の解決・Playerの利用可否は呼び出し側のスコープに属する。
 */
export function resolveEffectParameterValue(definition: Pick<ParameterDefinition, 'dataType' | 'canNode'>, value: any, resources: {
	assets: readonly Asset[];
	assetTextures: ReadonlyMap<string, GPUTexture>;
}): any {
	const kind = definition.dataType.kind;
	if (value != null && ['imageAssetTextureReference', 'videoAssetReference', 'fontAssetReference', 'lutAssetReference'].includes(kind)) {
		const asset = resources.assets.find(asset => asset.id === value);
		const error = asset == null ? null : getFileSourceError(asset.fileData);
		if (error != null) throw new Error(error);
		if (kind === 'imageAssetTextureReference' && asset != null && !resources.assetTextures.has(value)) throw new Error(`Image asset is unavailable: ${asset.name}`);
	}
	switch (definition.dataType.kind) {
		case 'imageAssetTextureReference': return resources.assetTextures.get(value) ?? null;
		case 'videoAssetReference': return resources.assets.find(asset => asset.id === value && asset.fileDataType.startsWith('video/')) ?? null;
		case 'fontAssetReference': return resources.assets.find(asset => asset.id === value && asset.fileDataType.startsWith('font/')) ?? null;
		case 'lutAssetReference': return resources.assets.find(asset => asset.id === value && asset.fileDataType === LUT_ASSET_MIME_TYPE) ?? null;
		default: return definition.canNode ? constantShaderInput(definition.dataType.kind, value) : value;
	}
}
