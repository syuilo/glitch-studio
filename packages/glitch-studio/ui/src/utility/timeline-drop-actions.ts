import { i18n } from '@/i18n.ts';
import { importAssets } from './import-assets.ts';
import { createTimelineAssetLayer, getTimelineAssetLayerType } from './timeline-asset-layer.ts';
import { alert, progress } from '../ui.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { ProjectContext } from '../Project.ts';
import type { TimelineAssetPlacement } from './timeline-asset-layer.ts';
import type { TimelineClipMediaInfo } from './timeline-clip-media.ts';

type TimelineDropActionsOptions = {
	context: ProjectContext;
	sceneId: string;
	currentTime: () => number;
	isActive: () => boolean;
	inspectMedia: (asset: Asset) => Promise<TimelineClipMediaInfo>;
	revealAssets: () => void;
};

/** ドロップ位置には依存せず、読み込み前の再生ヘッド位置に素材を配置する。 */
export function createTimelineDropActions(options: TimelineDropActionsOptions) {
	const { context, sceneId, currentTime, isActive, inspectMedia, revealAssets } = options;

	async function prepare(assets: readonly Asset[], startMs: number, dialog: ReturnType<typeof progress>, messages: string[]) {
		const placement: TimelineAssetPlacement = { sceneId, layers: [], sourceDurationsMs: {} };
		for (const [index, asset] of assets.entries()) {
			if (!isActive()) break;
			dialog.setText(i18n.tsx._Assets.PreparingTimelineLayerProgress({ name: asset.name, current: index + 1, total: assets.length }));
			dialog.setProgress(assets.length > 1 ? index / assets.length : null);
			dialog.setSubProgress(assets.length > 1 ? null : undefined);
			const type = getTimelineAssetLayerType(asset);
			if (type == null) continue;
			try {
				const media = type === 'image' ? null : await inspectMedia(asset);
				const layer = createTimelineAssetLayer(asset, startMs, media);
				if (layer == null) continue;
				placement.layers.push(layer);
				if (media != null) placement.sourceDurationsMs[layer.id] = { [layer.clips[0].id]: media.durationMs };
				// 映像は利用できても音声のデコードだけが失敗する場合は、無音で配置して終了後に知らせる。
				if (media?.audioError != null) messages.push(`${asset.name}: ${media.audioError}`);
			} catch (error) {
				messages.push(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		dialog.setText(i18n.ts._Assets.AddingTimelineLayers);
		dialog.setProgress(null);
		dialog.setSubProgress(undefined);
		return isActive() ? placement : null;
	}

	async function report(messages: string[]) {
		if (messages.length > 0) await alert({ type: 'warning', title: i18n.ts._Timeline.Drop, text: messages.join('\n') });
	}

	async function dropFiles(files: readonly File[]) {
		const startMs = currentTime();
		const messages: string[] = [];
		let hasUnplacedAssets = false;
		const ids = await importAssets(context, files, undefined, async (assets, _players, dialog) => {
			const placement = await prepare(assets, startMs, dialog, messages);
			hasUnplacedAssets = placement == null || placement.layers.length < assets.length;
			return { timeline: placement };
		});
		if (ids.length > 0 && hasUnplacedAssets) revealAssets();
		await report(messages);
	}

	async function dropAsset(assetId: string) {
		const asset = context.stateManager.state.assets.value.find(asset => asset.id === assetId);
		if (asset == null || getTimelineAssetLayerType(asset) == null || !isActive()) return;
		const startMs = currentTime();
		const fileSource = asset.fileData;
		const messages: string[] = [];
		const dialog = progress({ text: i18n.tsx._Assets.PreparingTimelineLayer({ name: asset.name }) });
		try {
			const placement = await prepare([asset], startMs, dialog, messages);
			if (placement != null && placement.layers.length > 0 && context.stateManager.state.assets.value.includes(asset) && asset.fileData === fileSource) {
				context.stateManager.commit('addTimelineAssetLayers', placement);
			}
		} finally { dialog.done(); }
		await report(messages);
	}

	return { dropFiles, dropAsset };
}
