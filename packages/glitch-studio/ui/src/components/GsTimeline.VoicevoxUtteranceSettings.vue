<template>
<GsFolder defaultOpen asSection :withSpacer="false">
	<template #icon><i class="ti ti-keyframe"></i></template>
	<template #label>{{ i18n.ts._Voicevox.SpeechKey }}</template>
	<div class="_spacer _gaps_m">
		<GsInput type="number" :min="bounds?.min ?? 0" :max="bounds?.max" :modelValue="utterance.timeMs" @update:modelValue="editTime">
			<template #label>{{ i18n.ts.Time }}</template><template #suffix>ms</template>
		</GsInput>
		<GsSelect :modelValue="utterance.styleId" :items="voiceStyleItems" @update:modelValue="styleId => edit({ styleId })">
			<template #label>{{ i18n.ts._Voicevox.VoiceStyle }}</template>
		</GsSelect>
		<GsTextarea :modelValue="utterance.text" @update:modelValue="text => edit({ text })"><template #label>{{ i18n.ts.Subtitle }}</template></GsTextarea>
		<GsSelect :modelValue="utterance.subtitleDuration.mode" :items="subtitleDurationModes" @update:modelValue="changeSubtitleDurationMode">
			<template #label>{{ i18n.ts._Voicevox.SubtitleDuration }}</template>
		</GsSelect>
		<GsInput v-if="utterance.subtitleDuration.mode === 'specified'" type="number" :min="0" :max="Number.MAX_SAFE_INTEGER - utterance.timeMs" :step="1" :modelValue="utterance.subtitleDuration.durationMs" @update:modelValue="editSubtitleDuration">
			<template #label>{{ i18n.ts._Voicevox.DisplayLength }}</template><template #suffix>ms</template>
		</GsInput>
		<GsInput v-if="utterance.subtitleDuration.mode === 'speech'" type="number" :min="0" :max="Number.MAX_SAFE_INTEGER - utterance.timeMs" :step="1" :modelValue="utterance.subtitleDuration.extensionMs" @update:modelValue="editSubtitleExtension">
			<template #label>{{ i18n.ts._Voicevox.ExtendAfterSpeech }}</template><template #suffix>ms</template>
		</GsInput>
		<GsTextarea :modelValue="utterance.reading ?? ''" :placeholder="i18n.ts._Voicevox.UseSubtitleText" @update:modelValue="reading => edit({ reading: reading.trim() || null })"><template #label>{{ i18n.ts._Voicevox.Reading }}</template></GsTextarea>
		<div>{{ status }}</div>
		<GsButton v-if="desktop && utterance.text" :disabled="generating" @click="regenerate">{{ i18n.ts._Voicevox.Regenerate }}</GsButton>
		<GsButton danger icon="ti ti-trash" @click="remove">{{ i18n.ts._Voicevox.RemoveSpeechKey }}</GsButton>
		<div v-if="error" :class="$style.error">{{ error }}</div>
	</div>
</GsFolder>
</template>

<script setup lang="ts">
import { i18n } from '@/i18n.ts';
import { computed, ref } from 'vue';
import { getVoicevoxRequest, getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import GsFolder from './common/GsFolder.vue';
import GsInput from './common/GsInput.vue';
import GsSelect from './common/GsSelect.vue';
import GsTextarea from './common/GsTextarea.vue';
import GsButton from './common/GsButton.vue';
import type { TimelineVoicevoxLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import { appContext } from '@/app.ts';
import { getDefaultVoicevoxSubtitleDuration, getVoicevoxUtteranceTimeBounds } from '@/utility/voicevox-utterance-edit.ts';

const props = defineProps<{ sceneId: string; layer: TimelineVoicevoxLayer; utterance: VoicevoxUtterance }>();
const emit = defineEmits<{ selected: [id: string] }>();
const { stateManager } = appContext.projectContext;
const desktop = window.desktop;
const { speakers } = appContext.voicevoxConnection;
const voiceStyleItems = computed(() => {
	const items = speakers.value.flatMap(speaker => speaker.styles.filter(style => !style.type || style.type === 'talk')
		.map(style => ({ value: style.id, label: `${speaker.name} / ${style.name}` })));
	// 接続前やエンジンにない声も保存したIDを表示し、別の声へ暗黙に差し替えない。
	if (!items.some(item => item.value === props.utterance.styleId)) items.unshift({
		value: props.utterance.styleId,
		label: i18n.tsx._Voicevox.MissingStyle({ id: props.utterance.styleId, status: speakers.value.length > 0 ? i18n.ts._Voicevox.Unavailable : i18n.ts._Voicevox.ConnectToLoadVoices }),
	});
	return items;
});
const error = ref('');
const subtitleDurationModes = [
	{ value: 'fill', label: i18n.ts._Voicevox.Fill },
	{ value: 'specified', label: i18n.ts._Voicevox.Specified },
	{ value: 'speech', label: i18n.ts._Voicevox.MatchSpeechDuration },
];
const bounds = computed(() => getVoicevoxUtteranceTimeBounds(props.layer.utterances, props.utterance.id));
const request = computed(() => getVoicevoxRequest(props.layer.voicevox, props.utterance));
const key = computed(() => getVoicevoxRequestKey(request.value));
const generation = computed(() => appContext.voicevoxGeneration.statuses.value[key.value]);
const generating = computed(() => generation.value?.state === 'generating');
const status = computed(() => {
	if (!props.utterance.text) return i18n.ts._Voicevox.ClearSubtitle;
	if (generating.value) return `${i18n.ts._Voicevox.Generating}...`;
	if (generation.value?.state === 'error') return generation.value.message;
	const speech = stateManager.state.generatedSpeech.value.find(item => item.key === key.value);
	return speech ? i18n.tsx._Voicevox.Ready({ seconds: (speech.durationMs / 1000).toFixed(2) }) : i18n.ts._Voicevox.NotGenerated;
});

function commit(utterances: VoicevoxUtterance[]) {
	error.value = '';
	try {
		stateManager.commit('editVoicevoxLayer', {
			sceneId: props.sceneId,
			layerId: props.layer.id,
			voicevox: props.layer.voicevox,
			utterances,
		});
		return true;
	} catch (cause) { error.value = String(cause); return false; }
}

function edit(patch: Partial<VoicevoxUtterance>) {
	commit(props.layer.utterances.map(utterance => utterance.id === props.utterance.id ? { ...utterance, ...patch } : utterance));
}

function editTime(value: string | number) {
	const time = Number(value);
	if (!Number.isFinite(time) || !bounds.value) return;
	edit({ timeMs: Math.max(bounds.value.min, Math.min(bounds.value.max, Math.round(time))) });
}

function changeSubtitleDurationMode(mode: string) {
	if (mode === props.utterance.subtitleDuration.mode) return;
	if (mode === 'fill') {
		edit({ subtitleDuration: { mode: 'fill' } });
	} else if (mode === 'specified') {
		edit({ subtitleDuration: { mode: 'specified', durationMs: getDefaultVoicevoxSubtitleDuration(props.layer.utterances, props.layer.clips, props.utterance.id, stateManager.state.generatedSpeech.value.find(speech => speech.key === key.value)?.durationMs) } });
	} else if (mode === 'speech') {
		edit({ subtitleDuration: { mode: 'speech', extensionMs: 0 } });
	}
}

function editSubtitleDuration(value: string | number) {
	if (props.utterance.subtitleDuration.mode !== 'specified') return;
	const duration = Number(value);
	if (!Number.isFinite(duration)) return;
	edit({ subtitleDuration: { mode: 'specified', durationMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - props.utterance.timeMs, Math.round(duration))) } });
}

function editSubtitleExtension(value: string | number) {
	if (props.utterance.subtitleDuration.mode !== 'speech') return;
	const extension = Number(value);
	if (!Number.isFinite(extension)) return;
	edit({ subtitleDuration: { mode: 'speech', extensionMs: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER - props.utterance.timeMs, Math.round(extension))) } });
}

function remove() { commit(props.layer.utterances.filter(utterance => utterance.id !== props.utterance.id)); }

async function regenerate() {
	error.value = '';
	try { await appContext.voicevoxGeneration.generate(request.value, true); } catch (cause) { error.value = String(cause); }
}
</script>

<style module>
.error {
	color: #ff9b9b;
	white-space: pre-wrap;
}
</style>
