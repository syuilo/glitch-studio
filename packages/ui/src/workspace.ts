import { genId } from '@glitch/shared/utility/id.js';
import { markRaw } from 'vue';
import { findWorkspaceElement, removeWorkspaceElement, replaceWorkspaceElement, splitAndAddWorkspacePanel } from './utility/workspace.ts';
import type { MenuItem } from './types/menu.ts';
import { preferences } from '@/preferences.ts';
import XBlank from '@/components/GsWorkspacePanel.Blank.vue';
import XPreview from '@/components/GsWorkspacePanel.Preview.vue';
import XVisualModuleEditor from '@/components/GsWorkspacePanel.VisualModuleEditor.vue';
import XHistogram from '@/components/GsWorkspacePanel.Histogram.vue';
import XWaveform from '@/components/GsWorkspacePanel.Waveform.vue';
import XAudioSpectrum from '@/components/GsWorkspacePanel.AudioSpectrum.vue';
import XAudioSpectrogram from '@/components/GsWorkspacePanel.AudioSpectrogram.vue';
import XAudioWaveform from '@/components/GsWorkspacePanel.AudioWaveform.vue';
import XStats from '@/components/GsWorkspacePanel.Stats.vue';
import XCommandLog from '@/components/GsWorkspacePanel.CommandLog.vue';
import XPlayers from '@/components/GsWorkspacePanel.Players.vue';
import XTimeline from '@/components/GsWorkspacePanel.Timeline.vue';
import XAssets from '@/components/GsWorkspacePanel.Assets.vue';

const panelDefinitions = {
	blank: { label: 'Blank', icon: '', component: XBlank },
	audioSpectrum: { label: 'Audio Spectrum', icon: 'ti ti-chart-column', component: XAudioSpectrum },
	audioSpectrogram: { label: 'Audio Spectrogram', icon: 'ti ti-chart-area', component: XAudioSpectrogram },
	audioWaveform: { label: 'Audio Waveform', icon: 'ti ti-wave-sine', component: XAudioWaveform },
	histogram: { label: 'Histogram', icon: 'ti ti-chart-column', component: XHistogram },
	waveformHorizontal: { label: 'Waveform (X)', icon: 'ti ti-chart-column', component: XWaveform },
	waveformVertical: { label: 'Waveform (Y)', icon: 'ti ti-chart-column', component: XWaveform },
	preview: { label: 'Preview', icon: 'ti ti-device-desktop', component: XPreview },
	players: { label: 'Players', icon: 'ti ti-player-play', component: XPlayers },
	visualModuleEditor: { label: 'Visual Module Editor', icon: 'ti ti-chart-dots-3', component: XVisualModuleEditor },
	stats: { label: 'Stats', icon: 'ti ti-activity', component: XStats },
	commandLog: { label: 'Command Log', icon: 'ti ti-logs', component: XCommandLog },
	timeline: { label: 'Timeline', icon: 'ti ti-timeline', component: XTimeline },
	assets: { label: 'Assets', icon: 'ti ti-folder-open', component: XAssets },
} as const;

export const workspacePanelDefinitions: typeof panelDefinitions = markRaw(panelDefinitions);
export const workspacePanelChoices = Object.entries(workspacePanelDefinitions).map(([type, info]) => ({
	type: type as keyof typeof panelDefinitions, ...info,
}));

export type WorkspacePanel = {
	id: string;
	type: 'panel';
	contentType: keyof typeof workspacePanelDefinitions;
	collapsed?: boolean;
};

export type WorkspaceTabs = {
	id: string;
	type: 'tabs';
	children: {
		name: string;
		element: WorkspaceElement;
	}[];
	collapsed?: boolean;
};

export type WorkspaceDivider = {
	id: string;
	type: 'divider';
	direction: 'horizontal' | 'vertical';
	children: {
		ratio: number;
		element: WorkspaceElement;
	}[];
};

export type WorkspaceElement = WorkspacePanel | WorkspaceTabs | WorkspaceDivider;

export function getElementMenu(element: WorkspaceElement) {
	const menuItems: MenuItem[] = [];

	menuItems.push({
		type: 'parent',
		text: 'Switch type to',
		children: workspacePanelChoices.map(({ type, ...info }) => ({
			text: info.label,
			action: () => {
				const workspace = replaceWorkspaceElement(preferences.s.workspaceDefinition, element.id, {
					id: element.id,
					type: 'panel',
					contentType: type,
				});
				preferences.commit('workspaceDefinition', workspace);
			},
		})),
	}, {
		icon: 'ti ti-layout-navbar',
		text: 'Group in tabs',
		action: () => {
			const target = findWorkspaceElement(preferences.s.workspaceDefinition, element.id);
			if (!target) return;
			const tabs: WorkspaceTabs = {
				id: genId(),
				type: 'tabs',
				children: [{
					name: target.type === 'panel' ? workspacePanelDefinitions[target.contentType].label : 'Tab 1',
					element: target,
				}],
			};
			preferences.commit('workspaceDefinition', replaceWorkspaceElement(preferences.s.workspaceDefinition, element.id, tabs));
		},
	}, { type: 'divider' }, {
		icon: 'ti ti-box-align-top',
		text: 'Add panel to above',
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'above')),
	}, {
		icon: 'ti ti-box-align-bottom',
		text: 'Add panel to below',
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'below')),
	}, {
		icon: 'ti ti-box-align-left',
		text: 'Add panel to left',
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'left')),
	}, {
		icon: 'ti ti-box-align-right',
		text: 'Add panel to right',
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'right')),
	});

	menuItems.push({ type: 'divider' }, {
		icon: 'ti ti-x',
		text: 'Close',
		danger: true,
		action: () => preferences.commit('workspaceDefinition', removeWorkspaceElement(preferences.s.workspaceDefinition, element)),
	});

	return menuItems;
}
