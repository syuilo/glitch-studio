import { genId } from '@gs/shared/utility/id.ts';
import { selectMediaFiles } from '../api.ts';
import { alert } from '../ui.ts';
import { importMediaFiles } from './open-media-file.ts';
import type { progress } from '../ui.ts';
import type { ProjectContext, ProjectAsset } from '../Project.ts';
import type { Player } from '@gs/shared/types.ts';
import type { TimelineAssetPlacement } from './timeline-asset-layer.ts';
import type { VisualModuleAssetPlacement } from './visual-module-asset-node.ts';
import { i18n } from '@/i18n.ts';

export type AssetImportPlacement = { timeline?: TimelineAssetPlacement | null; visualModule?: VisualModuleAssetPlacement | null };

/** ファイル選択と全体ドロップで同じ取り込み・Player作成・Undo単位を使う。 */
export async function importAssets(destination: ProjectContext | (() => Promise<ProjectContext | null>), files?: readonly File[],
	preparePlacement?: (assets: ProjectAsset[], players: Player[], dialog: ReturnType<typeof progress>) => AssetImportPlacement | null | Promise<AssetImportPlacement | null>): Promise<string[]> {
	if (typeof destination !== 'function' && destination.isDisposed) return [];
	const selected = await selectMediaFiles({ files, multiple: true, allowAnyFile: true });
	if (selected == null || selected.length === 0) return [];
	if (typeof destination !== 'function' && destination.isDisposed) return [];
	const errors: string[] = [];
	let importedAssetIds: string[] = [];
	try {
		await importMediaFiles(selected, {
			allowAnyFile: true,
			onFileError(file, error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); },
			onImported: async (imported, dialog) => {
				if (imported.length === 0) return;
				// 素材を一つも取り込めなかった場合は空のタブを作らない。
				// 新規作成は別セッションになるので、その戻り値を今回の取り込み先に固定する。
				const target = typeof destination === 'function' ? await destination() : destination;
				if (target == null || target.isDisposed) return;
				const assets: ProjectAsset[] = [];
				const players: Player[] = [];
				for (const result of imported) {
					const id = genId();
					assets.push({
						id,
						name: result.name,
						width: result.width,
						height: result.height,
						fileDataType: result.type,
						fileData: result.fileData,
						isExternalReference: result.isExternalReference,
						sourceFilePath: result.sourceFilePath,
						thumbnailSequence: result.thumbnailSequence,
						hash: result.hash,
					});
					if (result.type.startsWith('audio/') || result.type.startsWith('video/')) {
						players.push({
							id: genId(),
							name: result.name,
							sourceType: 'asset',
							assetId: id,
						});
					}
				}
				const placement = await preparePlacement?.(assets, players, dialog) ?? {};
				// ファイル読み込みや配置準備の間に終了したプロジェクトへ、素材と履歴を追加しない。
				if (target.isDisposed) return;
				target.stateManager.commit('importAssets', { assets, players, ...placement });
				// 反映できたIDだけを返し、中止時に呼び出し元がパネル表示などを続行しないようにする。
				importedAssetIds = assets.map(asset => asset.id);
			},
		});
	} catch (error) {
		await alert({ type: 'error', title: i18n.ts._Assets.Import, text: error instanceof Error ? error.message : String(error) });
		return [];
	}
	if (errors.length > 0) await alert({ type: 'error', title: i18n.ts._Assets.ImportFailed, text: errors.join('\n') });
	return importedAssetIds;
}
