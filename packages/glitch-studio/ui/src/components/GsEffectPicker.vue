<template>
<GsModal ref="modal" @opened="searchInput?.focus()" @closed="emit('closed')">
	<div :class="$style.root" class="_shadow _popup">
		<div :class="$style.header">
			<GsInput ref="searchInput" v-model="query" type="search" :placeholder="i18n.ts._EffectPicker.Search" :class="$style.searchInput">
				<template #prefix>
					<i class="ti ti-search"></i>
				</template>
			</GsInput>
			<div :class="$style.actions">
				<div :class="$style.button" :title="i18n.ts._EffectPicker.Close" tabindex="0" @click="close" @keydown.enter.prevent="close"><i class="ti ti-x"></i></div>
			</div>
		</div>
		<div :class="$style.body">
			<div :class="$style.leftArea">
				<GsFolder defaultOpen asSection>
					<template #label><i class="ti ti-tags"></i> {{ i18n.ts._EffectPicker.Tags }}</template>
					<div :class="$style.tags">
						<button type="button" class="_button" :class="[$style.tag, { [$style.selected]: selectedTags.length === 0 }]" @click="selectedTags = []">
							<span>{{ i18n.ts._EffectPicker.AllEffects }}</span>
							<span :class="$style.count">{{ effects.length }}</span>
						</button>
						<button v-for="{ tag, count } in tags" :key="tag" type="button" class="_button" :class="[$style.tag, { [$style.selected]: selectedTags.includes(tag) }]" @click="toggleTag(tag)">
							<span>{{ i18n.ts._EffectTags[tag] }}</span>
							<span :class="$style.count">{{ count }}</span>
						</button>
					</div>
				</GsFolder>
				<GsFolder defaultOpen asSection>
					<template #label><i class="ti ti-history"></i> {{ i18n.ts._EffectPicker.RecentEffects }}</template>
					<div v-if="recentEffects.length > 0" :class="$style.recentEffects">
						<GsEffectPickerEffect v-for="[key, effect] in recentEffects" :key="key" :effect="effect" :detailed="false" @click="choose(key, effect)"/>
					</div>
				</GsFolder>
			</div>
			<div :class="$style.rightArea">
				<div :class="$style.effects">
					<GsEffectPickerEffect v-for="[key, effect] in results" :key="key" :effect="effect" detailed @click="choose(key, effect)"/>
				</div>
				<div v-if="results.length === 0">{{ i18n.ts._EffectPicker.NoResults }}</div>
			</div>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { EFFECT_TAGS } from '@gs/subsystems_effect_shared/effect-definition.ts';
import GsEffectPickerEffect from './GsEffectPicker.Effect.vue';
import GsModal from './common/GsModal.vue';
import GsInput from './common/GsInput.vue';
import GsFolder from './common/GsFolder.vue';
import type { EffectTags } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { i18n } from '@/i18n.ts';

const emit = defineEmits<{
	(ev: 'chosen', effect: typeof effectDefinitions[keyof typeof effectDefinitions]): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const searchInput = useTemplateRef('searchInput');

const query = ref('');
const selectedTags = ref<EffectTags[]>([]);
const effects = Object.entries(effectDefinitions);

// 検索条件でタグの件数や順番が動かないよう、登録済みの全エフェクトから集計する。
// 同数のタグはEFFECT_TAGSの定義順を保つ。
const tags = EFFECT_TAGS.map(tag => ({
	tag,
	count: effects.filter(([, effect]) => effect.tags.includes(tag)).length,
})).sort((a, b) => b.count - a.count);

const recentEffectsStorageKey = 'glitch-studio:recent-effects';
const maxRecentEffects = 10;
const recentEffectKeys = ref(readRecentEffectKeys());
const recentEffects = computed(() => recentEffectKeys.value.map(key => [key, effectDefinitions[key]] as const));

const results = computed(() => {
	const keyword = query.value.toLowerCase();
	return effects.filter(([, effect]) => {
		return effect.displayName.toLowerCase().includes(keyword)
			&& selectedTags.value.every(tag => effect.tags.includes(tag));
	});
});

function toggleTag(tag: EffectTags) {
	selectedTags.value = selectedTags.value.includes(tag)
		? selectedTags.value.filter(value => value !== tag)
		: [...selectedTags.value, tag];
}

function readRecentEffectKeys(): string[] {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(recentEffectsStorageKey) ?? '[]');
		if (!Array.isArray(stored)) return [];
		// 保存後に削除されたエフェクトを除外し、登録キーごとに最新の1件だけを残す。
		const keys = stored.filter((key): key is string => typeof key === 'string' && Object.hasOwn(effectDefinitions, key));
		return [...new Set(keys)].slice(0, maxRecentEffects);
	} catch {
		return [];
	}
}

function close() {
	modal.value?.close();
}

function choose(key: string, effect: typeof effectDefinitions[keyof typeof effectDefinitions]) {
	recentEffectKeys.value = [key, ...recentEffectKeys.value.filter(value => value !== key)].slice(0, maxRecentEffects);
	try {
		localStorage.setItem(recentEffectsStorageKey, JSON.stringify(recentEffectKeys.value));
	} catch {
		// ストレージが無効・容量不足でも、エフェクトの選択は継続する。
	}
	emit('chosen', effect);
	close();
}

</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	margin: auto;
	position: relative;
	width: 1200px;
	max-width: 100%;
	height: 100%;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.header, .actions, .sliderRow { display: flex; align-items: center; gap: 12px; }
.actions { gap: 6px; }

.header {
	padding: 16px;
	border-bottom: solid 1px #fff2;
}

.searchInput {
	width: 100%;
}

.body {
	flex: 1;
	display: flex;
	flex-direction: row;
	min-height: 0;
}
.leftArea {
	flex: 0.3;
	display: flex;
	flex-direction: column;
	min-width: 0;
	border-right: solid 1px #fff2;
	text-align: left;
	overflow: auto;
}
.rightArea {
	flex: 0.7;
	min-width: 0;
	padding: 16px;
	overflow: auto;
}

.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.tag {
	display: flex;
	align-items: center;
	gap: 8px;
	max-width: 100%;
	padding: 6px 8px;
	text-align: left;
	overflow-wrap: anywhere;
	background: var(--THEME-buttonBg);
	border-radius: 6px;

	&:hover {
		background: var(--THEME-buttonHoverBg);
	}

	&.selected {
		color: var(--THEME-fgOnAccent);
		background: var(--THEME-accent);
	}
}

.count {
	font-variant-numeric: tabular-nums;
	opacity: 0.7;
}

.recentEffects {
	display: grid;
	gap: 6px;
}

.effects {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 8px;
}

</style>
