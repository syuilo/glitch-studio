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
		<label>Voice / style
			<select :value="layer.voicevox.styleId" @change="changeSettings({ styleId: Number(($event.target as HTMLSelectElement).value) })">
				<option v-if="!styles.some(style => style.id === layer.voicevox.styleId)" :value="layer.voicevox.styleId">Style {{ layer.voicevox.styleId }} (connect to load voices)</option>
				<option v-for="style in styles" :key="style.id" :value="style.id">{{ style.label }}</option>
			</select>
		</label>
		<label>Speech speed<input type="number" min="0.5" max="2" step="0.05" :value="layer.voicevox.speedScale" @change="changeSettings({ speedScale: Number(($event.target as HTMLInputElement).value) })"/></label>
		<GsButton small @click="add">Add speech key at playhead</GsButton>
		<GsButton small :disabled="layer.clips.length === 0" @click="fitLastClip">Fit last clip to speech</GsButton>
		<div v-for="utterance in sortedUtterances" :key="utterance.id" :class="$style.utterance">
			<label>Scene time (ms)<input type="number" min="0" step="1" :value="utterance.timeMs" @change="edit(utterance.id, { timeMs: Math.round(Number(($event.target as HTMLInputElement).value)) })"/></label>
			<label>Subtitle<textarea :value="utterance.text" @change="edit(utterance.id, { text: ($event.target as HTMLTextAreaElement).value })"></textarea></label>
			<label>Reading (optional)<textarea :value="utterance.reading ?? ''" placeholder="Use subtitle text" @change="edit(utterance.id, { reading: ($event.target as HTMLTextAreaElement).value.trim() || null })"></textarea></label>
			<div>{{ status(utterance) }}</div>
			<div :class="$style.actions">
				<GsButton small @click="appContext.previewPlayback.seekTimeline(utterance.timeMs)">Seek</GsButton>
				<GsButton v-if="desktop && utterance.text" small :disabled="isGenerating(utterance)" @click="regenerate(utterance)">Regenerate</GsButton>
				<GsButton small @click="duplicate(utterance)">Duplicate at playhead</GsButton>
				<GsButton small danger @click="commit(layer.utterances.filter(item => item.id !== utterance.id))">Delete</GsButton>
			</div>
		</div>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsFolder>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import GsFolder from './common/GsFolder.vue';
import GsButton from './common/GsButton.vue';
import type { VoicevoxSettings, VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import { appContext } from '@/app.ts';

const props = defineProps<{ layer: TimelineVoicevoxLayer; sceneId: string }>();
const { stateManager } = appContext.projectContext;
const desktop = window.desktop;
const { endpoint, version, speakers } = appContext.voicevoxConnection;
const connecting = ref(false);
const styles = computed(() => speakers.value.flatMap(speaker => speaker.styles.filter(style => !style.type || style.type === 'talk').map(style => ({ id: style.id, label: `${speaker.name} / ${style.name}` }))));
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

function edit(id: string, value: Partial<VoicevoxUtterance>) { commit(props.layer.utterances.map(item => item.id === id ? { ...item, ...value } : item)); }

function duplicate(utterance: VoicevoxUtterance) {
	commit([...props.layer.utterances, { ...utterance, id: genId(), timeMs: Math.round(appContext.previewPlayback.currentTimelineTime.value) }]);
}

function add() { duplicate({ id: '', timeMs: 0, text: '', reading: null }); }

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

function isGenerating(utterance: VoicevoxUtterance) { return appContext.voicevoxGeneration.statuses.value[key(utterance)]?.state === 'generating'; }

function status(utterance: VoicevoxUtterance) {
	if (!utterance.text) return 'Clear subtitle / stop speech';
	const state = appContext.voicevoxGeneration.statuses.value[key(utterance)];
	if (state?.state === 'generating') return 'Generating…';
	if (state?.state === 'error') return state.message;
	const speech = stateManager.state.generatedSpeech.value.find(item => item.key === key(utterance));
	return speech ? `Ready · ${(speech.durationMs / 1000).toFixed(2)} s` : 'Not generated';
}

async function regenerate(utterance: VoicevoxUtterance) {
	error.value = '';
	try { await appContext.voicevoxGeneration.generate(getVoicevoxRequest(props.layer.voicevox, utterance), true); } catch (cause) { error.value = String(cause); }
}
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

.utterance {
	display: grid;
	gap: 8px;
	padding-top: 12px;
	border-top: 1px solid #fff2;
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 5px;
}

.error {
	color: #ff9b9b;
	white-space: pre-wrap;
}

</style>
