import { isTimelineContainerLayer, isTimelineVisualLayer } from './types.ts';
import type { TimelineLayer } from './types.ts';

export type TimelineLayerActivity = {
	/** 参照用の素材評価も含む。ソロで除外するだけなら無効化しない。 */
	isEnabled: boolean;
	/** 同じ合成境界内での出力。通常合成からの除外設定も反映する。 */
	isIncludedInComposite: boolean;
	/** ソロと表示設定による出力対象。通常合成の除外とは独立して音声・UIにも使う。 */
	isOutputEnabled: boolean;
};

export type TimelineLayerActivityMap = ReadonlyMap<string, TimelineLayerActivity>;

/** Scene参照は辿らず、折りたたみや現在のクリップ区間から独立して判定する。 */
export function getTimelineSoloState(layers: readonly TimelineLayer[]): { hasSolo: boolean; layers: TimelineLayerActivityMap } {
	const selectedBranches = new Set<string>();
	const collect = (layers: readonly TimelineLayer[]): boolean => {
		let selected = false;
		for (const layer of layers) {
			const childrenSelected = isTimelineContainerLayer(layer) && collect(layer.layers);
			if ((layer.layerType !== 'camera' && layer.isSolo === true) || childrenSelected) {
				selectedBranches.add(layer.id);
				selected = true;
			}
		}
		return selected;
	};
	const hasSolo = collect(layers);
	const activity = new Map<string, TimelineLayerActivity>();
	const visit = (layers: readonly TimelineLayer[], parentEnabled: boolean, outputScope: boolean, referenceScope: boolean, cameraParentEnabled: boolean) => {
		for (const layer of layers) {
			if (layer.layerType === 'camera') {
				const isEnabled = cameraParentEnabled && !layer.isDisabled;
				activity.set(layer.id, { isEnabled, isOutputEnabled: isEnabled, isIncludedInComposite: false });
				continue;
			}
			const selected = selectedBranches.has(layer.id);
			const isEnabled = selected || (parentEnabled && !layer.isDisabled);
			const isOutputEnabled = selected || (outputScope && !layer.isDisabled);
			activity.set(layer.id, {
				isEnabled,
				isOutputEnabled,
				isIncludedInComposite: isEnabled && (isOutputEnabled || referenceScope)
					&& (selected || !isTimelineVisualLayer(layer) || layer.isIncludedInComposite !== false),
			});
			if (isTimelineContainerLayer(layer)) {
				// 子だけのソロでは祖先の処理を残し、兄弟は合成しない。コンテナ自身の
				// ソロでは内部を通常表示するが、明示した子のソロは非表示設定を上書きする。
				const childOutputScope = layer.isSolo === true || (outputScope && !layer.isDisabled);
				// 非ソロのGroup・Transformも参照元になれる。最終出力からは親を除外し、
				// 内部の合成は維持する。Folderは画像の境界を作らないのでここに含めない。
				const childReferenceScope = !isOutputEnabled && (referenceScope || layer.layerType === 'group' || layer.layerType === 'transform');
				visit(layer.layers, isEnabled, childOutputScope, childReferenceScope, cameraParentEnabled && !layer.isDisabled);
			}
		}
	};
	visit(layers, true, !hasSolo, false, true);
	return { hasSolo, layers: activity };
}
