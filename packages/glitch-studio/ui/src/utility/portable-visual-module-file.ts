import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { preparePortableVisualModule } from '@gs/glitch-studio_embed/export.ts';
import { DEFAULT_PORTABLE_VISUAL_MODULE_SETTINGS } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import GsVisualModuleWebExportDialog from '@/components/GsVisualModuleWebExportDialog.vue';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';
import type { ProjectSessionContext } from '@/ProjectSessionContext.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';

export async function exportPortableVisualModuleFile(session: ProjectSessionContext, visualModule: VisualModule, name: string): Promise<void> {
	if (session.isDisposed) return;
	try {
		const state = session.projectContext.stateManager.state;
		const prepared = preparePortableVisualModule({
			name, gsVersion: _VERSION_, visualModule, assets: state.assets.value, players: state.players.value,
			customShaderEffects: state.customShaderEffects.value, aspectRatio: state.resolution.value.width / state.resolution.value.height,
			settings: DEFAULT_PORTABLE_VISUAL_MODULE_SETTINGS, initialParameters: {},
		}, effectDefinitions);
		await new Promise<void>(resolve => {
			const { dispose } = ui.popup(GsVisualModuleWebExportDialog, { prepared }, { closed: () => { dispose(); resolve(); } }, session);
		});
	} catch (error) {
		await ui.alert({ type: 'error', title: i18n.ts._VisualModule.WebExport, text: error instanceof Error ? error.message : String(error) });
	}
}
