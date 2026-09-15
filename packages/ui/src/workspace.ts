import { deepClone } from '@glitch/shared/utility/deep-clone.js';
import { genId } from '@glitch/shared/utility/id.js';
import { findWorkspaceParent, removeWorkspaceElement, splitAndAddWorkspacePanel } from './utility/workspace.ts';
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
];

export type WorkspacePanel = {
	id: string;
	type: 'panel';
	contentType: string;
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
				const workspace = deepClone(preferences.s.workspaceDefinition);
				// TODO
				preferences.commit('workspaceDefinition', workspace);
			},
		})),
	}, { type: 'divider' }, {
		icon: 'ti ti-box-align-top',
		text: 'Add panel to above',
		action: () => splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'above'),
	}, {
		icon: 'ti ti-box-align-bottom',
		text: 'Add panel to below',
		action: () => splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'below'),
	}, {
		icon: 'ti ti-box-align-left',
		text: 'Add panel to left',
		action: () => splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'left'),
	}, {
		icon: 'ti ti-box-align-right',
		text: 'Add panel to right',
		action: () => splitAndAddWorkspacePanel(preferences.s.workspaceDefinition, element, 'right'),
	});

	menuItems.push({ type: 'divider' }, {
		icon: 'ti ti-x',
		text: 'Close',
		danger: true,
		action: () => removeWorkspaceElement(preferences.s.workspaceDefinition, element),
	});

	return menuItems;
}

