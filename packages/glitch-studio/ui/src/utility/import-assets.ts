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
export async function importAssets(context: ProjectContext, files?: readonly File[], prepareProject?: () => Promise<void>,
	preparePlacement?: (assets: ProjectAsset[], players: Player[], dialog: ReturnType<typeof progress>) => AssetImportPlacement | null | Promise<AssetImportPlacement | null>): Promise<string[]> {
	const selected = await selectMediaFiles({ files, multiple: true, allowAnyFile: true });
	if (selected == null || selected.length === 0) return [];
	const errors: string[] = [];
	const assets: ProjectAsset[] = [];
	try {
		await importMediaFiles(selected, {
			allowAnyFile: true,
			onFileError(file, error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); },
			onImported: async (imported, dialog) => {
				if (imported.length === 0) return;
				await prepareProject?.();
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
				context.stateManager.commit('importAssets', { assets, players, ...placement });
			},
		});
	} catch (error) {
		await alert({ type: 'error', title: i18n.ts._Assets.Import, text: error instanceof Error ? error.message : String(error) });
		return [];
	}
	if (errors.length > 0) await alert({ type: 'error', title: i18n.ts._Assets.ImportFailed, text: errors.join('\n') });
	return assets.map(asset => asset.id);
}
