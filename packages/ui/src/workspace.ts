import { genId } from '@glitch/shared/utility/id.js';
import { findWorkspaceElement, removeWorkspaceElement, replaceWorkspaceElement, splitAndAddWorkspacePanel } from './utility/workspace.ts';
import type { MenuItem } from './types/menu.ts';
import { preferences } from '@/preferences.ts';

export const workspacePanelChoices = [
	{ type: 'audioSpectrum', label: 'Audio Spectrum' },
	{ type: 'audioSpectrogram', label: 'Audio Spectrogram' },
	{ type: 'audioWaveform', label: 'Audio Waveform' },
	{ type: 'histogram', label: 'Histogram' },
	{ type: 'waveformHorizontal', label: 'Waveform (X)' },
	{ type: 'waveformVertical', label: 'Waveform (Y)' },
	{ type: 'preview', label: 'Preview' },
	{ type: 'players', label: 'Players' },
	{ type: 'nodesEditor', label: 'Nodes' },
	{ type: 'macros', label: 'Macros' },
	{ type: 'stats', label: 'Stats' },
	{ type: 'commandLog', label: 'Command Log' },
	{ type: 'timeline', label: 'Timeline' },
] as const;

export type WorkspacePanel = {
	id: string;
	type: 'panel';
	contentType: 'empty' | 'waveform' | typeof workspacePanelChoices[number]['type'];
	collapsed?: boolean;
};

export type WorkspaceTabs = {
	id: string;
	type: 'tabs';
	children: {
		name: string;
		element: WorkspaceElement;
	}[];
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
		children: workspacePanelChoices.map(choice => ({
			text: choice.label,
			action: () => {
				const workspace = replaceWorkspaceElement(preferences.s.workspaceDefinition, element.id, {
					id: element.id,
					type: 'panel',
					contentType: choice.type,
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
					name: target.type === 'panel' ? workspacePanelChoices.find(choice => choice.type === target.contentType)?.label ?? 'Tab 1' : 'Tab 1',
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
