import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { Asset } from '@gs/shared/types.ts';

/**
 * 評価済みの末端値をエフェクトの実行時入力へ変換する。リソースの所有権は移さない。
 * 式の評価・入力接続の解決・Playerの利用可否は呼び出し側のスコープに属する。
 */
export function resolveEffectParameterValue(definition: Pick<ParameterDefinition, 'dataType' | 'canNode'>, value: any, resources: {
	assets: readonly Asset[];
	assetTextures: ReadonlyMap<string, GPUTexture>;
}): any {
	switch (definition.dataType.kind) {
		case 'assetReference': return resources.assetTextures.get(value) ?? null;
		case 'videoAssetReference': return resources.assets.find(asset => asset.id === value && asset.fileDataType.startsWith('video/')) ?? null;
		case 'fontAssetReference': return resources.assets.find(asset => asset.id === value && asset.fileDataType.startsWith('font/')) ?? null;
		default: return definition.canNode ? constantShaderInput(definition.dataType.kind, value) : value;
	}
}
