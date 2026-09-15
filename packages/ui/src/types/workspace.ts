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
	ratio: number;
	type: string;
	collapsed?: boolean;
};

export type WorkspaceDivider = {
	id: string;
	ratio: number;
	type: null;
	direction: 'horizontal' | 'vertical';
	children: (WorkspaceDivider | WorkspacePanel)[];
};
