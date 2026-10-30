import { matchesAssetReferenceMimeType } from '@gs/shared/data-type/asset-reference.ts';
import { getFileSourceError } from '@gs/shared/file-source.ts';
import type { StaticSettingDefinitions, StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectStaticResources } from '@gs/subsystems_effect_shared/effect-implementation.ts';

export type EffectStaticResourceContext = {
	assets: readonly Asset[];
	assetTextures: ReadonlyMap<string, GPUTexture>;
	getPlayerResolution?: (playerId: string) => Resolution | null;
	getPlayerVideoFrame?: (playerId: string) => VideoFrame | null;
};

/** GPUやフレームの到着を待たず、保存済みメタデータから原寸を求める。 */
export function getEffectIntrinsicResolution(definition: Pick<EffectDefinition, 'staticSettingDefs' | 'intrinsicResolutionSetting'>,
	values: StaticSettingValues, context: Pick<EffectStaticResourceContext, 'assets' | 'getPlayerResolution'>): Resolution | null {
	const key = definition.intrinsicResolutionSetting;
	if (key == null) return null;
	const setting = definition.staticSettingDefs?.[key];
	const value = (Object.hasOwn(values, key) ? values[key] : setting?.defaultValue);
	if (typeof value !== 'string' || setting == null) return null;
	if (setting.dataType.kind === 'playerReference') return context.getPlayerResolution?.(value) ?? null;
	if (setting.dataType.kind !== 'assetReference') return null;
	const asset = context.assets.find(asset => asset.id === value);
	if (asset == null) throw new Error(`Asset not found: ${value}`);
	if (!(asset.width > 0 && asset.height > 0)) throw new Error(`Asset dimensions are unavailable: ${asset.name}`);
	return { width: asset.width, height: asset.height };
}

export function resolveEffectStaticResources<Definition extends { staticSettingDefs?: StaticSettingDefinitions }>(
	definition: Definition, values: StaticSettingValues, context: EffectStaticResourceContext): EffectStaticResources<Definition> {
	return Object.fromEntries(Object.entries(definition.staticSettingDefs ?? {}).map(([key, setting]) => {
		const value = (Object.hasOwn(values, key) ? values[key] : setting.defaultValue);
		if (value == null) return [key, null];
		if (setting.dataType.kind === 'playerReference') {
			// フレームそのものを初期化時に固定しない。再生状態は注入元が所有する。
			return [key, { getVideoFrame: () => context.getPlayerVideoFrame?.(value as string) ?? null }];
		}
		if (setting.dataType.kind !== 'assetReference') return [key, value];
		const asset = context.assets.find(asset => asset.id === value);
		if (asset == null || !matchesAssetReferenceMimeType(setting.dataType, asset.fileDataType)) throw new Error(`Asset not found or incompatible: ${value}`);
		const error = getFileSourceError(asset.fileData);
		if (error != null) throw new Error(error);
		if (setting.dataType.assetType !== 'image') return [key, asset.fileData];
		// 呼び出し側は素材の準備完了を保証する。選択済み画像の欠落は準備待ちではなく読み込み失敗。
		const texture = context.assetTextures.get(asset.id);
		if (texture == null) throw new Error(`Image asset is unavailable: ${asset.name}`);
		return [key, texture];
	})) as EffectStaticResources<Definition>;
}
