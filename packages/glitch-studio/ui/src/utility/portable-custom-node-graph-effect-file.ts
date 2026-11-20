import type { CustomNodeGraphEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';
import { nativeEffectDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
import { preparePortableCustomNodeGraphEffect } from '@gs/glitch-studio_embed/export.ts';
import { DEFAULT_PORTABLE_CUSTOM_NODE_GRAPH_EFFECT_SETTINGS } from '@gs/glitch-studio_shared/portable-custom-node-graph-effect.ts';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import type { ProjectSessionContext } from '@/ProjectSessionContext.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';

export async function exportPortableCustomNodeGraphEffectFile(session: ProjectSessionContext, customNodeGraphEffect: CustomNodeGraphEffect, name: string, nodeMetadata?: CustomNodeGraphEffectEditorMetadata['nodeMetadata']): Promise<void> {
	if (session.isDisposed) return;
	if (!__ELECTRON__ || window.desktop == null) {
		await ui.alert({ type: 'info', text: i18n.ts._CustomNodeGraphEffect.WebExportDesktopOnly });
		return;
	}
	try {
		const { default: GsCustomNodeGraphEffectWebExportDialog } = await import('@/components/GsCustomNodeGraphEffectWebExportDialog.vue');
		if (session.isDisposed) return;
		const state = session.projectContext.stateManager.state;
		const prepared = preparePortableCustomNodeGraphEffect({
			name, gsVersion: _VERSION_, customNodeGraphEffect, nodeMetadata, customNodeGraphEffects: state.customNodeGraphEffects.value, assets: state.assets.value, players: state.players.value,
			customShaderEffects: state.customShaderEffects.value, aspectRatio: state.resolution.value.width / state.resolution.value.height,
			settings: DEFAULT_PORTABLE_CUSTOM_NODE_GRAPH_EFFECT_SETTINGS, initialParameters: {},
		}, nativeEffectDefinitions);
		await new Promise<void>(resolve => {
			const { dispose } = ui.popup(GsCustomNodeGraphEffectWebExportDialog, { prepared }, { closed: () => { dispose(); resolve(); } }, session);
		});
	} catch (error) {
		await ui.alert({ type: 'error', title: i18n.ts._CustomNodeGraphEffect.WebExport, text: error instanceof Error ? error.message : String(error) });
	}
}
