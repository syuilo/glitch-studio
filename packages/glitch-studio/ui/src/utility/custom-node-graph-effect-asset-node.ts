import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import { createStaticSettingValues } from '@gs/shared/static-setting.ts';
import imageEffect from '@gs/subsystems_effect_native-effects/fx/image/_def_.ts';
import videoEffect from '@gs/subsystems_effect_native-effects/fx/video/_def_.ts';
import audioWaveformEffect from '@gs/subsystems_effect_native-effects/fx/audioWaveform/_def_.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { CustomNodeGraphEffectEffectNode } from '@/types/custom-node-graph-effect-view.ts';
import type { CustomNodeGraphEffectTarget } from './custom-node-graph-effect-target.ts';
import type { Asset, Player } from '@gs/shared/types.ts';

export type CustomNodeGraphEffectAssetPlacement = { target: CustomNodeGraphEffectTarget; nodes: CustomNodeGraphEffectEffectNode[] };

/** メディアを開く場合と同じエフェクトを使う。配線と出力接続は呼び出し側でも変更しない。 */
export function createCustomNodeGraphEffectAssetNode(asset: Asset, players: readonly Player[]): { node: CustomNodeGraphEffectEffectNode; player: Player | null } | null {
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
	const params: CustomNodeGraphEffectEffectNode['params'] = Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)]));
	const staticSettings: StaticSettingValues = createStaticSettingValues('staticSettingDefs' in definition ? definition.staticSettingDefs : {});
	if (definition === imageEffect) staticSettings.image = asset.id;
	else if (definition === videoEffect) staticSettings.player = playerId;
	else params.audio = { inputSource: 'literal', value: { type: 'player', playerId: playerId! } };
	return {
		player,
		node: {
			id: genId(),
			type: 'effect',
			effectSource: { type: 'nativeEffect', id: definition === imageEffect ? 'image' : definition === videoEffect ? 'video' : 'audioWaveform' },
			displayName: '',
			isBypass: false,
			resolution: { mode: 'auto', scale: 1 },
			pos: { x: 0, y: 0 },
			params,
			staticSettings,
		},
	};
}
