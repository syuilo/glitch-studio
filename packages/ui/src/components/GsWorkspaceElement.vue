<template>
<GsWorkspaceDivider
	v-if="element.type === 'divider'"
	:divider="element"
/>
<GsWorkspaceTabs
	v-else-if="element.type === 'tabs'"
	:tabs="element"
/>
<component
	:is="panelComponents[element.contentType]"
	v-else
	:panel="element"
/>
</template>

<script lang="ts" setup>
import type { WorkspaceElement } from '@/workspace';
import GsWorkspaceDivider from '@/components/GsWorkspaceDivider.vue';
import GsWorkspaceTabs from '@/components/GsWorkspaceTabs.vue';
import XEmpty from '@/components/GsWorkspacePanel.Empty.vue';
import XPreview from '@/components/GsWorkspacePanel.Preview.vue';
import XNodesEditor from '@/components/GsWorkspacePanel.NodesEditor.vue';
import XHistogram from '@/components/GsWorkspacePanel.Histogram.vue';
import XWaveform from '@/components/GsWorkspacePanel.Waveform.vue';
import XAudioSpectrum from '@/components/GsWorkspacePanel.AudioSpectrum.vue';
import XAudioSpectrogram from '@/components/GsWorkspacePanel.AudioSpectrogram.vue';
import XAudioWaveform from '@/components/GsWorkspacePanel.AudioWaveform.vue';
import XStats from '@/components/GsWorkspacePanel.Stats.vue';
import XCommandLog from '@/components/GsWorkspacePanel.CommandLog.vue';
import XMacros from '@/components/GsWorkspacePanel.Macros.vue';
import XPlayers from '@/components/GsWorkspacePanel.Players.vue';
import XTimeline from '@/components/GsWorkspacePanel.Timeline.vue';

const panelComponents = {
	empty: XEmpty,
	preview: XPreview,
	nodesEditor: XNodesEditor,
	histogram: XHistogram,
	waveform: XWaveform,
	waveformHorizontal: XWaveform,
	waveformVertical: XWaveform,
	audioSpectrum: XAudioSpectrum,
	audioSpectrogram: XAudioSpectrogram,
	audioWaveform: XAudioWaveform,
	stats: XStats,
	commandLog: XCommandLog,
	macros: XMacros,
	players: XPlayers,
	timeline: XTimeline,
};

const props = withDefaults(defineProps<{
	element: WorkspaceElement;
}>(), {

});

</script>
