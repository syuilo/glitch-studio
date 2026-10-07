<template>
<GsFolder asSection defaultOpen :withSpacer="false">
	<template #icon><i class="ti ti-microphone"></i></template>
	<template #label>VOICEVOX</template>
	<div :class="$style.body">
		<template v-if="desktop">
			<label>Engine URL<input v-model="endpoint" type="text"/></label>
			<GsButton small :disabled="connecting" @click="connect">Connect</GsButton>
			<div v-if="version">Engine {{ version }}</div>
		</template>
		<div v-else>Generation requires the Electron app. Saved audio can be played here.</div>
		<label>Speech speed<input type="number" min="0.5" max="2" step="0.05" :value="layer.voicevox.speedScale" @change="changeSettings({ speedScale: Number(($event.target as HTMLInputElement).value) })"/></label>
		<GsButton small @click="add">Add speech key at playhead</GsButton>
		<GsButton small :disabled="layer.clips.length === 0" @click="fitLastClip">Fit last clip to speech</GsButton>
		<div>Select a speech key in the timeline to edit its voice, text and reading.</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsFolder>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { insertVoicevoxUtterance } from '@/utility/voicevox-utterance-edit.ts';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import type { VoicevoxSettings, VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ layer: TimelineVoicevoxLayer; sceneId: string }>();
const emit = defineEmits<{ selected: [id: string] }>();
const { stateManager } = appContext.projectContext;
const desktop = window.desktop;
const { endpoint, version, speakers } = appContext.voicevoxConnection;
const connecting = ref(false);
const error = ref('');
const sortedUtterances = computed(() => props.layer.utterances.toSorted((a, b) => a.timeMs - b.timeMs));

async function connect() {
	connecting.value = true;
	error.value = '';
	try {
		const result = await desktop!.voicevoxConnect(endpoint.value);
		version.value = result.version;
		speakers.value = result.speakers;
		appContext.voicevoxGeneration.schedule();
	} catch (cause) { error.value = String(cause); } finally { connecting.value = false; }
}

function commit(utterances: VoicevoxUtterance[], voicevox = props.layer.voicevox) {
	error.value = '';
	try { stateManager.commit('editVoicevoxLayer', { sceneId: props.sceneId, layerId: props.layer.id, voicevox, utterances }); } catch (cause) { error.value = String(cause); }
}

function changeSettings(settings: Partial<VoicevoxSettings>) { commit(props.layer.utterances, { ...props.layer.voicevox, ...settings }); }

function add() {
	const inserted = insertVoicevoxUtterance(props.layer.utterances, appContext.previewPlayback.currentTimelineTime.value);
	if (!inserted) return;
	if (inserted.utterances !== props.layer.utterances) commit([...inserted.utterances]);
	emit('selected', inserted.utterance.id);
}

function fitLastClip() {
	error.value = '';
	const clip = props.layer.clips.toSorted((a, b) => a.startMs - b.startMs).at(-1);
	if (!clip) return;
	try {
		let endMs = clip.startMs + 1;
		for (const [index, utterance] of sortedUtterances.value.entries()) {
			if (!utterance.text) continue;
			const nextTime = sortedUtterances.value[index + 1]?.timeMs ?? Infinity;
			if (nextTime <= clip.startMs) continue;
			const speech = stateManager.state.generatedSpeech.value.find(item => item.key === key(utterance));
			if (!speech) throw new Error('Generate the speech before fitting the clip.');
			endMs = Math.max(endMs, Math.min(utterance.timeMs + speech.durationMs, nextTime));
		}
		// 生成音声の小数msの末尾を切らないよう切り上げる。キーは動かさない。
		stateManager.commit('editTimelineClipTiming', {
			sceneId: props.sceneId, layerId: props.layer.id, clipId: clip.id,
			edge: 'end', deltaMs: Math.ceil(endMs) - (clip.startMs + clip.durationMs),
		});
	} catch (cause) { error.value = String(cause); }
}

function key(utterance: VoicevoxUtterance) { return getVoicevoxRequestKey(getVoicevoxRequest(props.layer.voicevox, utterance)); }

</script>

<style module>
.body {
	display: grid;
	gap: 10px;
	padding: 12px;
}

.body label {
	display: grid;
	gap: 4px;
}

.body input,
.body textarea,
.body select {
	box-sizing: border-box;
	width: 100%;
	color: inherit;
	background: #0004;
	border: 1px solid #fff3;
	padding: 6px;
	border-radius: 4px;
	font: inherit;
}

.body textarea {
	min-height: 52px;
	resize: vertical;
}

.error {
	color: #ff9b9b;
	white-space: pre-wrap;
}

</style>
