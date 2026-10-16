import { LUT_ASSET_MIME_TYPE } from '@gs/shared/media/lut.ts';
import GsDialog from '@/components/common/GsDialog.vue';
import type { ProjectAsset } from '@/Project.ts';
import type { MenuItem } from '@/types/menu.ts';
import { appContext } from '@/app.ts';
import { popup } from '@/ui.ts';
import { openMediaFile } from './open-media-file.ts';

export function getAssetMenu(asset: ProjectAsset): MenuItem[] {
	const { stateManager } = appContext.projectContext;

	function rename() {
		const { dispose } = popup(GsDialog, { input: { default: asset.name } }, {
			done: result => {
				if (!result.canceled && typeof result.result === 'string') {
					stateManager.commit('renameAsset', { assetId: asset.id, name: result.result });
				}
			},
			closed: () => dispose(),
		});
	}

	async function replace() {
		const result = await openMediaFile({ includeFonts: true, allowAnyFile: asset.fileDataType === LUT_ASSET_MIME_TYPE });
		if (result == null) return;
		stateManager.commit('replaceAsset', {
			id: asset.id,
			name: asset.name,
			assetId: asset.id,
			width: result.width,
			height: result.height,
			fileDataType: result.type,
			fileData: result.fileData,
			sourceFilePath: result.sourceFilePath,
			thumbnailSequence: result.thumbnailSequence,
			hash: result.hash,
		});
	}

	return [{
		text: 'Rename',
		icon: 'ti ti-cursor-text',
		action: rename,
	}, {
		text: 'Replace',
		icon: 'ti ti-replace',
		action: replace,
	}, {
		type: 'divider',
	}, {
		text: 'Remove',
		icon: 'ti ti-trash',
		danger: true,
		action: () => stateManager.commit('removeAsset', { assetId: asset.id }),
	}];
}
