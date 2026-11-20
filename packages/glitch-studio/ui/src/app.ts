import { watch } from 'vue';
import { makeHotkey } from './utility/hotkey.ts';
import type { Keymap } from './utility/hotkey.ts';
import { ProjectSessionManager } from './ProjectSessionManager.ts';
import { createProjectActions } from './project-actions.ts';
import { isLocaleUnconfigured } from './i18n.ts';
import { configureLocale } from './locale-settings-ui.ts';
import { preferences } from './preferences.ts';
import { connectMcpEditor } from './mcp/editor-connection.ts';

if (isLocaleUnconfigured) {
	void configureLocale().catch(console.error);
}

export const projectSessions = new ProjectSessionManager();
const disconnectMcpEditor = window.desktop?.onMcpRequest == null ? null : connectMcpEditor(projectSessions, window.desktop);

const stopProjectTitle = watch(() => projectSessions.activeSession.value?.projectDisplayName.value, name => {
	window.document.title = name != null ? `Glitch Studio (${name})` : 'Glitch Studio';
}, { immediate: true });

(window as any).projectSessions = projectSessions; // debug

function benchmark(count = 100, customNodeGraphEffectId = projectSessions.activeSession.value?.projectContext.stateManager.state.customNodeGraphEffects.value[0]?.id) {
	const projectSession = projectSessions.activeSession.value;
	if (projectSession == null || customNodeGraphEffectId == null) return;
	for (let i = 0; i < count; i++) {
		projectSession.projectContext.stateManager.commit('createCustomNodeGraphEffectEffectNode', {
			customNodeGraphEffect: { customNodeGraphEffectId },
			effectSource: { type: 'nativeEffect', id: 'blockShuffle' },
			connectionMode: preferences.s.customNodeGraphEffectAutoConnectOnNodeAdd ? 'appendToPrimaryOutput' : 'none',

			parameters: {
				seed: { inputSource: 'literal', value: Math.random() * 1000 },
			},
		});
	}
}

(window as any).benchmark = benchmark; // debug

export const rendererEnv = {
	mouseX: 0,
	mouseY: 0,
};

export const { openProject, openRecentProject, newProject, newProjectFromImageOrVideo, newProjectFromMediaPath } = createProjectActions(projectSessions);

const stopProjectActivation = window.desktop?.onActivateProjectFile?.(id => { void projectSessions.selectFile(id).catch(console.error); });

const keymap = {
	'space': () => {
		const projectSession = projectSessions.activeSession.value;
		if (projectSession == null) return;
		if (projectSession.previewPlayback.isTimelinePlaying.value) {
			projectSession.previewPlayback.pauseTimeline();
		} else {
			projectSession.previewPlayback.playTimeline();
		}
	},
} as const satisfies Keymap;
const listener = makeHotkey(keymap);
window.document.addEventListener('keydown', listener, { passive: false });

// ブラウザーの終了はVueのunmountを呼ばない。両経路から呼べる終了処理にする。
const onPageHide = (event: PageTransitionEvent) => {
	// 戻る操作で復帰できるページはセッションを保持する。
	if (!event.persisted) void disposeApplication().catch(console.error);
};
window.addEventListener?.('pagehide', onPageHide);

export function disposeApplication(): Promise<void> {
	disconnectMcpEditor?.();
	stopProjectTitle();
	stopProjectActivation?.();
	window.document.removeEventListener('keydown', listener);
	window.removeEventListener?.('pagehide', onPageHide);
	return projectSessions.dispose();
}
