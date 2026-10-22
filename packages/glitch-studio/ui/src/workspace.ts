import { genId } from '@gs/shared/utility/id.js';
import { markRaw } from 'vue';
import { findWorkspaceElement, removeWorkspaceElement, replaceWorkspaceElement, splitAndAddWorkspacePanel } from './utility/workspace.ts';
import type { MenuItem } from './types/menu.ts';
import { i18n } from '@/i18n.ts';
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
import XAutomationGraphs from '@/components/GsWorkspacePanel.AutomationGraphs.vue';
import XProjectInfo from '@/components/GsWorkspacePanel.ProjectInfo.vue';
import XTimelineInspectorPanel from '@/components/GsWorkspacePanel.TimelineInspectorPanel.vue';

const panelDefinitions = {
	blank: { label: i18n.ts._Workspace.Blank, icon: '', component: XBlank },
	audioSpectrum: { label: i18n.ts._Workspace.AudioSpectrum, icon: 'ti ti-chart-column', component: XAudioSpectrum },
	audioSpectrogram: { label: i18n.ts._Workspace.AudioSpectrogram, icon: 'ti ti-chart-area', component: XAudioSpectrogram },
	audioWaveform: { label: i18n.ts._Workspace.AudioWaveform, icon: 'ti ti-wave-sine', component: XAudioWaveform },
	histogram: { label: i18n.ts._Workspace.Histogram, icon: 'ti ti-chart-column', component: XHistogram },
	waveformHorizontal: { label: i18n.ts._Workspace.WaveformX, icon: 'ti ti-chart-column', component: XWaveform },
	waveformVertical: { label: i18n.ts._Workspace.WaveformY, icon: 'ti ti-chart-column', component: XWaveform },
	preview: { label: i18n.ts.Preview, icon: 'ti ti-device-desktop', component: XPreview },
	players: { label: i18n.ts.Players, icon: 'ti ti-player-play', component: XPlayers },
	visualModuleEditor: { label: i18n.ts._Workspace.VisualModuleEditor, icon: 'ti ti-chart-dots-3', component: XVisualModuleEditor },
	stats: { label: i18n.ts._Workspace.Stats, icon: 'ti ti-activity', component: XStats },
	commandLog: { label: i18n.ts._Workspace.CommandLog, icon: 'ti ti-logs', component: XCommandLog },
	timeline: { label: i18n.ts._Workspace.Timeline, icon: 'ti ti-timeline', component: XTimeline },
	assets: { label: i18n.ts.Assets, icon: 'ti ti-folder-open', component: XAssets },
	projectInfo: { label: i18n.ts._Workspace.ProjectInfo, icon: 'ti ti-file-description', component: XProjectInfo },
	timelineInspectorPanel: { label: i18n.ts._Workspace.TimelineInspectorPanel, icon: 'ti ti-layout-sidebar-right', component: XTimelineInspectorPanel },
	automationGraphs: { label: i18n.ts._Workspace.AutomationGraphs, icon: 'ti ti-ease-in-out-control-points', component: XAutomationGraphs },
} as const;

export const workspacePanelDefinitions: typeof panelDefinitions = markRaw(panelDefinitions);
export const workspacePanelChoices = Object.entries(workspacePanelDefinitions).map(([type, info]) => ({
	type: type as keyof typeof panelDefinitions,
	...info,
}));

export type WorkspacePanel = {
	id: string;
	type: 'panel';
	direction: 'horizontal' | 'vertical';
	contentType: keyof typeof workspacePanelDefinitions;
	collapsed?: boolean;
};

export type WorkspaceTabs = {
	id: string;
	type: 'tabs';
	direction: 'horizontal' | 'vertical';
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
		text: i18n.ts._Workspace.SwitchType,
		children: workspacePanelChoices.map(({ type, ...info }) => ({
			text: info.label,
			action: () => {
				const workspace = replaceWorkspaceElement(preferences.s.workspaceDefinition, element.id, {
					id: element.id,
					type: 'panel',
					direction: element.type === 'panel' ? element.direction : 'horizontal',
					contentType: type,
				});
				preferences.commit('workspaceDefinition', workspace);
			},
		})),
	}, {
		icon: 'ti ti-layout-navbar',
		text: i18n.ts._Workspace.GroupInTabs,
		action: () => {
			const target = findWorkspaceElement(preferences.s.workspaceDefinition, element.id);
			if (!target) return;
			const tabs: WorkspaceTabs = {
				id: genId(),
				type: 'tabs',
				direction: 'horizontal',
				children: [{
					name: target.type === 'panel' ? workspacePanelDefinitions[target.contentType].label : 'Tab 1',
					element: target,
				}],
			};
			preferences.commit('workspaceDefinition', replaceWorkspaceElement(preferences.s.workspaceDefinition, element.id, tabs));
		},
	}, { type: 'divider' }, {
		icon: 'ti ti-box-align-top',
		text: i18n.ts._Workspace.AddAbove,
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'above')),
	}, {
		icon: 'ti ti-box-align-bottom',
		text: i18n.ts._Workspace.AddBelow,
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'below')),
	}, {
		icon: 'ti ti-box-align-left',
		text: i18n.ts._Workspace.AddLeft,
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'left')),
	}, {
		icon: 'ti ti-box-align-right',
		text: i18n.ts._Workspace.AddRight,
		action: () => preferences.commit('workspaceDefinition', splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'right')),
	});

	if (element.type === 'tabs' || element.type === 'panel') {
		menuItems.push({
			type: 'parent',
			text: element.type === 'tabs' ? i18n.ts._Workspace.TabDirection : i18n.ts._Workspace.HeaderDirection,
			children: (['horizontal', 'vertical'] as const).map(direction => ({
				type: 'radioOption',
				text: direction === 'horizontal' ? i18n.ts._Workspace.Horizontal : i18n.ts._Workspace.Vertical,
				active: element.direction === direction,
				action: () => {
					const target = findWorkspaceElement(preferences.s.workspaceDefinition, element.id);
					if (target?.type !== 'tabs' && target?.type !== 'panel') return;
					preferences.commit('workspaceDefinition', replaceWorkspaceElement(preferences.s.workspaceDefinition, element.id, { ...target, direction }));
				},
			})),
		});
	}

	menuItems.push({ type: 'divider' }, {
		icon: 'ti ti-x',
		text: i18n.ts.Close,
		danger: true,
		action: () => preferences.commit('workspaceDefinition', removeWorkspaceElement(preferences.s.workspaceDefinition, element)),
	});

	return menuItems;
}
