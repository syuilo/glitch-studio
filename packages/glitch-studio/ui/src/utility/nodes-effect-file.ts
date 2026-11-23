import type { NodesEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';
import { i18n } from '@/i18n.ts';
import { nativeEffectDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
import { collectNodesEffectFile, encodeNodesEffectFile, decodeNodesEffectFile, prepareNodesEffectImport } from '../nodes-effect-file-codec.ts';
import * as ui from '../ui.ts';
import { applicationActivity } from '../application-activity.ts';
import { resolveExternalAssets } from '../external-assets.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { ProjectContext } from '../Project.ts';

export function pickNodesEffectFile(): Promise<File | null> {
	return new Promise(resolve => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = '.gsne';
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
		input.click();
	});
}

export async function exportNodesEffectFile(context: ProjectContext, nodesEffect: NodesEffect, name: string, nodeMetadata?: NodesEffectEditorMetadata['nodeMetadata']): Promise<void> {
	const releaseActivity = applicationActivity.acquireExport();
	try {
		const state = context.stateManager.state;
		// 素材の読み出し中に編集されても、開始時点の構成だけを書き出す。
		const file = collectNodesEffectFile({
			nodesEffect,
			name,
			gsVersion: _VERSION_,
			customShaderEffects: state.customShaderEffects.value,
			nodeMetadata, nodesEffects: state.nodesEffects.value, assets: state.assets.value,
		}, nativeEffectDefinitions);
		const data = await encodeNodesEffectFile(file);
		const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }));
		const link = window.document.createElement('a');
		link.href = url;
		link.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || i18n.ts.NodesEffect}.gsne`;
		try { link.click(); } finally {
			// ダウンロードがURLを取得する前に解放しない。画面に履歴として保持する必要はない。
			window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
		}
	} catch (error) {
		console.error(error);
		await resolveExternalAssets(context.stateManager.state.assets.value);
		await ui.alert({ type: 'error', title: i18n.ts._NodesEffect.ExportTitle, text: error instanceof Error ? error.message : String(error) });
	} finally { releaseActivity(); }
}

export async function importNodesEffectFile(context: ProjectContext): Promise<string | null> {
	if (context.isDisposed) return null;
	const releaseActivity = applicationActivity.acquire();
	try {
		const file = await pickNodesEffectFile();
		if (file == null || context.isDisposed) return null;
		const data = await file.arrayBuffer();
		if (context.isDisposed) return null;
		const decoded = decodeNodesEffectFile(new Uint8Array(data), _VERSION_);
		const prepared = prepareNodesEffectImport(decoded, nativeEffectDefinitions);
		context.stateManager.commit('importNodesEffect', prepared);
		return prepared.nodesEffect.id;
	} catch (error) {
		if (context.isDisposed) return null;
		console.error(error);
		await ui.alert({ type: 'error', title: i18n.ts._NodesEffect.ImportTitle, text: error instanceof Error ? error.message : String(error) });
		return null;
	} finally { releaseActivity(); }
}
