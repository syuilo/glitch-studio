import imageEffect from '@gs/subsystems_effect_shared/fx/image/_def_.ts';
import videoEffect from '@gs/subsystems_effect_shared/fx/video/_def_.ts';
import audioWaveformEffect from '@gs/subsystems_effect_shared/fx/audioWaveform/_def_.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';
import type { VisualModuleTarget } from './visual-module-target.ts';
import type { Asset, Player } from '@gs/shared/types.ts';

export type VisualModuleAssetPlacement = { target: VisualModuleTarget; nodes: VisualModuleEffectNode[] };

/** メディアを開く場合と同じエフェクトを使う。配線と出力接続は呼び出し側でも変更しない。 */
export function createVisualModuleAssetNode(asset: Asset, players: readonly Player[]): { node: VisualModuleEffectNode; player: Player | null } | null {
	const definition = asset.fileDataType.startsWith('image/') ? imageEffect : asset.fileDataType.startsWith('video/') ? videoEffect
		: asset.fileDataType.startsWith('audio/') ? audioWaveformEffect : null;
	if (definition == null) return null;
	let player: Player | null = null;
	let playerId: string | null = null;
	if (definition !== imageEffect) {
		playerId = players.find(player => player.sourceType === 'asset' && player.assetId === asset.id)?.id ?? null;
		if (playerId == null) {
			player = {
				id: genId(),
				name: asset.name,
				sourceType: 'asset',
				assetId: asset.id,
			};
			playerId = player.id;
		}
	}
	const params: VisualModuleEffectNode['params'] = deepClone(Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, def.defaultValue])));
	if (definition === imageEffect) params.image = { inputSource: 'literal', value: asset.id };
	else if (definition === videoEffect) params.player = { inputSource: 'literal', value: playerId };
	else params.audio = { inputSource: 'literal', value: { type: 'player', playerId: playerId! } };
	return {
		player,
		node: {
			id: genId(),
			type: 'effect',
			effectId: definition.id,
			displayName: '',
			isBypass: false,
			resolution: { mode: 'auto' },
			pos: { x: 0, y: 0 },
			params,
		},
	};
}
