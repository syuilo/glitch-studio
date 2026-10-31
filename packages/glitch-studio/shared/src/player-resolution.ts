import type { Asset, Player } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';

/** ファイルPlayerは素材のメタデータ、ライブ入力は呼び出し側の描画基準に従う。 */
export function getPlayerIntrinsicResolution(playerId: string, players: readonly Player[], assets: readonly Asset[]): Resolution | null {
	const player = players.find(player => player.id === playerId);
	if (player?.sourceType !== 'asset') return null;
	const asset = assets.find(asset => asset.id === player.assetId);
	if (asset == null) throw new Error(`Player asset not found: ${player.assetId}`);
	if (!(asset.width > 0 && asset.height > 0)) return null;
	return { width: asset.width, height: asset.height };
}
