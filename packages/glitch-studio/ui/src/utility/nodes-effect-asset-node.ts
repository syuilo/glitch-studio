import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import imageEffect from '@gs/subsystems_effect_native-effects/fx/image/_def_.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { NodesEffectEffectNode } from '@/types/nodes-effect-view.ts';
import type { NodesEffectTarget } from './nodes-effect-target.ts';
import type { Asset } from '@gs/shared/types.ts';

export type NodesEffectAssetPlacement = { target: NodesEffectTarget; nodes: NodesEffectEffectNode[] };

/** 画像のドロップで素材を参照するノードを作る。 */
export function createNodesEffectAssetNode(asset: Asset): NodesEffectEffectNode | null {
	if (!asset.fileDataType.startsWith('image/')) return null;
	return {
		id: genId(),
		type: 'effect',
		effectSource: { type: 'nativeEffect', id: 'image' },
		displayName: '',
		isBypass: false,
		resolution: { mode: 'auto', scale: 1 },
		pos: { x: 0, y: 0 },
		params: { fit: createDefaultParameterBinding(imageEffect.paramDefs.fit) },
		staticSettings: { image: asset.id },
	};
}
