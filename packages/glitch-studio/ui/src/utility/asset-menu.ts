import { i18n } from '@/i18n.ts';
import { LUT_ASSET_MIME_TYPE } from '@gs/shared/media/lut.ts';
import GsDialog from '@/components/common/GsDialog.vue';
import type { ProjectAsset } from '@/Project.ts';
import type { MenuItem } from '@/types/menu.ts';
import { appContext } from '@/app.ts';
import { popup, alert, progress } from '@/ui.ts';
import { openExternalAsset, resolveExternalAssets } from '../external-assets.ts';
import { readFileSource } from '@gs/shared/file-source.ts';
import type { OpenedMediaFile } from '../api.ts';
import { openMediaFile } from './open-media-file.ts';
import { applicationActivity } from '../application-activity.ts';

const assetOperationGenerations = new WeakMap<ProjectAsset, number>();

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

	function applyImported(result: OpenedMediaFile, undoable = true) {
		const replacement = {
			id: asset.id,
			name: asset.name,
			assetId: asset.id,
			width: result.width,
			height: result.height,
			fileDataType: result.type,
			fileData: result.fileData,
			isExternalReference: result.isExternalReference,
			sourceFilePath: result.sourceFilePath,
			thumbnailSequence: result.thumbnailSequence,
			hash: result.hash,
		};
		// 同じパスの再選択でも取り込み結果を最新とする。Commandの変更通知で
		// 古いメタデータが再適用されないよう、履歴へ反映する前に記録する。
		appContext.projectContext.externalAssetMetadata.record(replacement);
		if (undoable) stateManager.commit('replaceAsset', replacement);
		else {
			const { assetId: _assetId, ...updated } = replacement;
			Object.assign(asset, updated);
		}
	}

	async function run(operation: (isCurrent: () => boolean) => Promise<void>) {
		const generation = appContext.projectContext.generation;
		const sourcePath = asset.sourceFilePath;
		const isExternalReference = asset.isExternalReference;
		const operationGeneration = (assetOperationGenerations.get(asset) ?? 0) + 1;
		assetOperationGenerations.set(asset, operationGeneration);
		const release = applicationActivity.acquire();
		const waiting = progress({ text: asset.name });
		const isCurrent = () => generation === appContext.projectContext.generation && stateManager.state.assets.value.includes(asset)
			&& asset.sourceFilePath === sourcePath && asset.isExternalReference === isExternalReference && assetOperationGenerations.get(asset) === operationGeneration;
		try { await operation(isCurrent); } catch (error) { await resolveExternalAssets(stateManager.state.assets.value); await alert({ type: 'error', text: error instanceof Error ? error.message : String(error) }); } finally { waiting.done(); release(); }
	}

	async function chooseReference() {
		await run(async isCurrent => {
			const path = await window.desktop!.chooseAssetFile(asset.sourceFilePath);
			if (path == null || !isCurrent()) return;
			const result = await openExternalAsset(path, asset.fileDataType);
			if (result != null && isCurrent()) applyImported(result);
		});
	}

	async function replace() {
		if (asset.isExternalReference) return chooseReference();
		const result = await openMediaFile({ isExternalReference: false, includeFonts: true, allowAnyFile: asset.fileDataType === LUT_ASSET_MIME_TYPE });
		if (result != null && stateManager.state.assets.value.includes(asset)) applyImported(result);
	}

	async function reload() {
		await run(async isCurrent => {
			if (asset.sourceFilePath == null) throw new Error('External reference has no file path.');
			const result = await openExternalAsset(asset.sourceFilePath, asset.fileDataType);
			if (result != null && isCurrent()) applyImported(result, false);
		});
	}

	async function embed() {
		await run(async isCurrent => {
			if (asset.sourceFilePath == null) throw new Error('External reference has no file path.');
			const result = await openExternalAsset(asset.sourceFilePath, asset.fileDataType, false);
			if (result != null && isCurrent()) applyImported(result);
		});
	}

	async function exportFile() {
		await run(async isCurrent => {
			const name = asset.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'asset';
			const id = await window.desktop!.beginAssetExport(name);
			if (id == null) return;
			try {
				if (!isCurrent()) return;
				const blob = await readFileSource(asset.fileData);
				// IPCも全体バッファを作らず、一つずつ書き込み完了を待って送る。
				for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
					await window.desktop!.writeAssetExport(id, new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer()));
				}
				await window.desktop!.writeAssetExport(id, null);
			} finally { await window.desktop!.abortAssetExport(id); }
		});
	}

	return [{
		id: 'rename',
		text: i18n.ts.Rename,
		icon: 'ti ti-cursor-text',
		action: rename,
	}, {
		id: 'replace',
		text: i18n.ts.Replace,
		icon: 'ti ti-replace',
		action: replace,
		disabled: asset.isExternalReference && window.desktop == null,
	}, ...(asset.isExternalReference ? [
		{
			id: 'reload',
			text: i18n.ts._Assets.Reload,
			icon: 'ti ti-refresh',
			disabled: window.desktop == null,
			action: reload,
		},
		{
			id: 'relink',
			text: `${i18n.ts._Assets.Relink}...`,
			icon: 'ti ti-link',
			disabled: window.desktop == null,
			action: chooseReference,
		},
		{
			id: 'embed',
			text: i18n.ts._Assets.Embed,
			icon: 'ti ti-package',
			disabled: window.desktop == null,
			action: embed,
		},
	] : [
		{
			id: 'convertToExternalReference',
			text: `${i18n.ts._Assets.ConvertToExternalReference}...`,
			icon: 'ti ti-link',
			disabled: window.desktop == null,
			action: chooseReference,
		},
		{
			id: 'exportOriginal',
			text: `${i18n.ts._Assets.ExportOriginal}...`,
			icon: 'ti ti-download',
			disabled: window.desktop == null,
			action: exportFile,
		},
	]), {
		type: 'divider',
	}, {
		id: 'remove',
		text: i18n.ts.Remove,
		icon: 'ti ti-trash',
		danger: true,
		action: () => stateManager.commit('removeAsset', { assetId: asset.id }),
	}];
}
