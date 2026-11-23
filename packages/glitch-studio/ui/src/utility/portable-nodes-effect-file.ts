import type { NodesEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';
import { nativeEffectDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
import { preparePortableNodesEffect } from '@gs/glitch-studio_embed/export.ts';
import { DEFAULT_PORTABLE_NODES_EFFECT_SETTINGS } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import type { ProjectSessionContext } from '@/ProjectSessionContext.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';

export async function exportPortableNodesEffectFile(session: ProjectSessionContext, nodesEffect: NodesEffect, name: string, nodeMetadata?: NodesEffectEditorMetadata['nodeMetadata']): Promise<void> {
	if (session.isDisposed) return;
	if (!__ELECTRON__ || window.desktop == null) {
		await ui.alert({ type: 'info', text: i18n.ts._NodesEffect.WebExportDesktopOnly });
		return;
	}
	try {
		const { default: GsNodesEffectWebExportDialog } = await import('@/components/GsNodesEffectWebExportDialog.vue');
		if (session.isDisposed) return;
		const state = session.projectContext.stateManager.state;
		// プロジェクト内で改名した素材も、元のパスがあれば元の拡張子を使えるようにする。
		const assets = state.assets.value.map(asset => ({ ...asset, sourceFileName: asset.sourceFilePath?.split(/[/\\]/).at(-1) ?? asset.name }));
		const prepared = preparePortableNodesEffect({
			name, gsVersion: _VERSION_, nodesEffect, nodeMetadata, nodesEffects: state.nodesEffects.value, assets,
			customShaderEffects: state.customShaderEffects.value, aspectRatio: state.resolution.value.width / state.resolution.value.height,
			settings: DEFAULT_PORTABLE_NODES_EFFECT_SETTINGS, initialParameters: {},
		}, nativeEffectDefinitions);
		await new Promise<void>(resolve => {
			const { dispose } = ui.popup(GsNodesEffectWebExportDialog, { prepared }, { closed: () => { dispose(); resolve(); } }, session);
		});
	} catch (error) {
		await ui.alert({ type: 'error', title: i18n.ts._NodesEffect.WebExport, text: error instanceof Error ? error.message : String(error) });
	}
}
