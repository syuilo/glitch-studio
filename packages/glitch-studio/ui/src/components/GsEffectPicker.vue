<template>
<GsModal ref="modal" @opened="searchInput?.focus()" @closed="emit('closed')" @click="close">
	<div :class="$style.root" class="_shadow _popup">
		<div :class="$style.header">
			<GsInput ref="searchInput" v-model="query" data-test-effect-picker-search large type="search" :placeholder="i18n.ts.Search" :class="$style.searchInput" @keydown.enter.stop.prevent="chooseFirstResult">
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
					<template #icon><i class="ti ti-filter"></i></template>
					<template #label>{{ i18n.ts._EffectPicker.DataType }}</template>
					<div :class="$style.typeFilters">
						<div>
							<div :class="$style.typeFilterLabel">{{ i18n.ts._EffectPicker.InputType }}</div>
							<div :class="$style.tags">
								<button v-for="{ value, label } in dataTypeItems" :key="value ?? 'all'" :data-test-effect-picker-input-type="value ?? 'all'" class="_button" :class="[$style.tag, { [$style.selected]: selectedInputType === value }]" @click="selectedInputType = value">
									<GsNodePort v-if="value != null" :dataType="{ kind: value }" :class="$style.typePort"/>
									<span>{{ label }}</span>
								</button>
							</div>
						</div>
						<div>
							<div :class="$style.typeFilterLabel">{{ i18n.ts._EffectPicker.OutputType }}</div>
							<div :class="$style.tags">
								<button v-for="{ value, label } in dataTypeItems" :key="value ?? 'all'" :data-test-effect-picker-output-type="value ?? 'all'" class="_button" :class="[$style.tag, { [$style.selected]: selectedOutputType === value }]" @click="selectedOutputType = value">
									<GsNodePort v-if="value != null" output :dataType="{ kind: value }" :class="$style.typePort"/>
									<span>{{ label }}</span>
								</button>
							</div>
						</div>
					</div>
				</GsFolder>
				<GsFolder defaultOpen asSection>
					<template #icon><i class="ti ti-tags"></i></template>
					<template #label>{{ i18n.ts._EffectPicker.Tags }}</template>
					<div :class="$style.tags">
						<button class="_button" :class="[$style.tag, { [$style.selected]: selectedTags.length === 0 }]" @click="selectedTags = []">
							<span>{{ i18n.ts._EffectPicker.All }}</span>
							<span :class="$style.count">{{ effects.length }}</span>
						</button>
						<button v-for="{ tag, count } in tags" :key="tag" :data-test-effect-picker-tag="tag" class="_button" :class="[$style.tag, { [$style.selected]: selectedTags.includes(tag) }]" @click="toggleTag(tag)">
							<span>{{ i18n.ts._EffectTags[tag] }}</span>
							<span :class="$style.count">{{ count }}</span>
						</button>
					</div>
				</GsFolder>
				<GsFolder defaultOpen asSection>
					<template #icon><i class="ti ti-history"></i></template>
					<template #label>{{ i18n.ts._EffectPicker.RecentEffects }}</template>
					<div v-if="recentEffects.length > 0" :class="$style.recentEffects">
						<GsEffectPickerEffect v-for="[key, effect] in recentEffects" :key="key" :effect="effect" :detailed="false" @click="choose(key, effect)"/>
					</div>
				</GsFolder>
			</div>
			<div :class="$style.rightArea">
				<template v-if="isInitialView">
					<GsFolder v-for="section in effectSections" :key="section.id" defaultOpen asSection>
						<template #label>{{ section.label }}</template>
						<div :class="$style.effects">
							<GsEffectPickerEffect v-for="[key, effect] in section.effects" :key="key" :effect="effect" detailed @click="choose(key, effect)"/>
						</div>
					</GsFolder>
				</template>
				<template v-else>
					<GsFolder defaultOpen asSection>
						<template #label>{{ i18n.ts.SearchResults }}</template>
						<div data-test-effect-picker-results :class="$style.effects">
							<GsEffectPickerEffect v-for="[key, effect] in results" :key="key" :data-test-effect-picker-effect="key" :effect="effect" detailed @click="choose(key, effect)"/>
						</div>
						<div v-if="results.length === 0">{{ i18n.ts._EffectPicker.NoResults }}</div>
					</GsFolder>
				</template>
			</div>
		</div>
	</div>
</GsModal>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { EFFECT_TAGS } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { isCustomShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import GsEffectPickerEffect from './GsEffectPicker.Effect.vue';
import GsNodePort from './GsNodePort.vue';
import GsModal from './common/GsModal.vue';
import GsInput from './common/GsInput.vue';
import GsFolder from './common/GsFolder.vue';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectDefinition, EffectTags } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { getEffectDefinitions } from '@/utility/project-effects.ts';
import { useProjectSession } from '@/project-session.ts';
import { i18n } from '@/i18n.ts';
import { getEffectInputPorts, getEffectOutputPorts } from '@/utility/effect-ports.ts';
import { createEffectSearchQuery, matchEffectName, compareEffectNameSearchMatches } from '@/utility/effect-search.ts';

const projectSession = useProjectSession();

const effectDefinitions = computed(() => getEffectDefinitions(projectSession.projectContext.stateManager.state));

const props = defineProps<{
	selectedOutputType?: TextureDataType['kind'] | null;
	requirePrimaryColorOutput?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'chosen', effect: EffectDefinition): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const searchInput = useTemplateRef('searchInput');

const query = ref('');
const effectSearchQuery = computed(() => createEffectSearchQuery(query.value));
const selectedTags = ref<EffectTags[]>([]);
const selectedInputType = ref<TextureDataType['kind'] | null>(null);
const selectedOutputType = ref<TextureDataType['kind'] | null>(props.selectedOutputType ?? null);
const dataTypeItems: { value: TextureDataType['kind'] | null; label: string }[] = [
	{ value: null, label: i18n.ts._EffectPicker.NoTypeFilter },
	{ value: 'color', label: i18n.ts._EffectPicker._DataTypes.color },
	{ value: 'scalar', label: i18n.ts._EffectPicker._DataTypes.scalar },
	{ value: 'vector', label: i18n.ts._EffectPicker._DataTypes.vector },
	{ value: 'any', label: i18n.ts._EffectPicker._DataTypes.any },
];
const effects = computed(() => Object.entries(effectDefinitions.value).filter(([, definition]) => !props.requirePrimaryColorOutput || definition.primaryOutput != null && definition.outputDefs[definition.primaryOutput]?.dataType.kind === 'color'));
const searchableEffects = computed(() => effects.value.map(([key, effect]) => ({
	key,
	effect,
	inputPorts: getEffectInputPorts(effect),
	outputPorts: getEffectOutputPorts(effect),
})));

// 検索条件でタグの件数や順番が動かないよう、登録済みの全エフェクトから集計する。
// 同数のタグはEFFECT_TAGSの定義順を保つ。
const tags = computed(() => EFFECT_TAGS.map(tag => ({
	tag,
	count: effects.value.filter(([, effect]) => effect.tags.includes(tag)).length,
})).sort((a, b) => b.count - a.count));

const recentEffectsStorageKey = 'glitch-studio:recent-effects';
const maxRecentEffects = 10;
const recentEffectKeys = ref(readRecentEffectKeys());
const recentEffects = computed(() => recentEffectKeys.value.flatMap(key => effects.value.filter(([id]) => id === key)));

const results = computed(() => {
	const inputType = selectedInputType.value;
	const outputType = selectedOutputType.value;
	return searchableEffects.value.filter(({ effect, inputPorts, outputPorts }) => {
		// 接続互換性ではなく定義された型で検索する。any型と「指定なし」も区別する。
		return selectedTags.value.every(tag => effect.tags.includes(tag))
			&& (inputType == null || inputPorts.some(port => port.dataType.kind === inputType))
			&& (outputType == null || outputPorts.some(port => port.dataType.kind === outputType));
	}).flatMap(item => {
		const nameMatch = matchEffectName(item.effect.displayName, effectSearchQuery.value);
		if (nameMatch == null) return [];
		return [{
			...item,
			nameMatch,
			// 検索の一致度が同じ場合、主入出力の両方が一致、片方が一致、どちらも一致しない順。
			// 空の検索では全候補が同点になり、型が未指定なら元の登録順を維持する。
			primaryMatches: Number(item.inputPorts.some(port => port.isPrimary && port.dataType.kind === inputType))
				+ Number(item.outputPorts.some(port => port.isPrimary && port.dataType.kind === outputType)),
		}];
	}).sort((a, b) => compareEffectNameSearchMatches(a.nameMatch, b.nameMatch) || b.primaryMatches - a.primaryMatches)
		.map(({ key, effect }) => [key, effect] as const);
});

const isInitialView = computed(() => effectSearchQuery.value.terms.length === 0 && selectedTags.value.length === 0
	&& selectedInputType.value == null && selectedOutputType.value === (props.selectedOutputType ?? null));

const effectSections = computed(() => [
	{ id: 'customShaderEffects', label: i18n.ts._CustomShaderEffect.Title, effects: results.value.filter(([key]) => isCustomShaderEffectReference(key)) },
	{ id: 'builtin', label: i18n.ts._EffectPicker.BuiltinEffects, effects: results.value.filter(([key]) => !isCustomShaderEffectReference(key)) },
].filter(section => section.effects.length > 0));

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
		const keys = stored.filter((key): key is string => typeof key === 'string' && Object.hasOwn(effectDefinitions.value, key));
		return [...new Set(keys)].slice(0, maxRecentEffects);
	} catch {
		return [];
	}
}

function close() {
	modal.value?.close();
}

function chooseFirstResult(event: KeyboardEvent) {
	if (event.repeat) return;
	const firstResult = results.value[0];
	if (firstResult) choose(firstResult[0], firstResult[1]);
}

function choose(key: string, effect: EffectDefinition) {
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
	width: 100%;
	max-width: 100%;
	height: 100%;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-dialog);
	border-radius: 10px;
}

.header, .actions, .sliderRow {
	display: flex;
	align-items: center;
	gap: 12px;
}
.actions {
	gap: 6px;
}

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
	overflow: auto;
}

.typeFilters {
	display: grid;
	gap: 12px;
}

.typeFilterLabel {
	margin-bottom: 6px;
	font-size: 90%;
}

.typePort {
	--NODE_PORT_SIZE: 16px;
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
	padding: 4px 8px;
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
