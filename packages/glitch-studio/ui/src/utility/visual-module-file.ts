import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { collectVisualModuleFile, encodeVisualModuleFile, decodeVisualModuleFile, prepareVisualModuleImport } from '../gsvm.ts';
import * as ui from '../ui.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ProjectContext } from '../Project.ts';

export function pickVisualModuleFile(): Promise<File | null> {
	return new Promise(resolve => {
		const input = window.document.createElement('input');
		input.type = 'file';
		input.accept = '.gsvm';
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
		input.click();
	});
}

export async function exportVisualModuleFile(context: ProjectContext, visualModule: VisualModule, name: string): Promise<void> {
	try {
		const state = context.stateManager.state;
		// 素材の読み出し中に編集・プロジェクト切替が起きても、開始時点の構成だけを書き出す。
		const file = collectVisualModuleFile({
			visualModule, name, gsVersion: _VERSION_,
			assets: state.assets.value, players: state.players.value,
		}, effectDefinitions);
		const data = await encodeVisualModuleFile(file);
		const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }));
		const link = window.document.createElement('a');
		link.href = url;
		link.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'Visual Module'}.gsvm`;
		try { link.click(); } finally {
			// ダウンロードがURLを取得する前に解放しない。画面に履歴として保持する必要はない。
			window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
		}
	} catch (error) {
		console.error(error);
		await ui.alert({ type: 'error', title: 'Export Visual Module', text: error instanceof Error ? error.message : String(error) });
	}
}

export async function importVisualModuleFile(context: ProjectContext): Promise<string | null> {
	const generation = context.generation;
	try {
		const file = await pickVisualModuleFile();
		if (file == null) return null;
		const decoded = decodeVisualModuleFile(new Uint8Array(await file.arrayBuffer()), _VERSION_);
		const prepared = prepareVisualModuleImport(decoded, effectDefinitions);
		// 同じプロジェクトの再読込でも世代が変わる。古いファイル選択を別の読み込み状態へ適用しない。
		if (context.generation !== generation) return null;
		context.stateManager.commit('importVisualModule', prepared);
		if (prepared.unassignedPlayerNames.length > 0) {
			ui.alert({
				type: 'info',
				title: 'Visual Module imported',
				text: `External inputs were left unassigned: ${prepared.unassignedPlayerNames.join(', ')}. Camera inputs can be selected from the Player menu. Microphone and live stream inputs are not yet supported.`,
			});
		}
		return prepared.visualModule.id;
	} catch (error) {
		console.error(error);
		await ui.alert({ type: 'error', title: 'Import Visual Module', text: error instanceof Error ? error.message : String(error) });
		return null;
	}
}
