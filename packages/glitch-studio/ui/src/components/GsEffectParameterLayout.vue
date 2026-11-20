<template>
<div v-if="parameterKeys.some(isVisible)" :data-test-parameter-section="section?.id">
	<button
		v-if="section != null"
		class="_button"
		:class="$style.header"
		data-test-section-toggle
		:data-test-section-expanded="expanded"
		@pointerdown.stop
		@click.stop="expanded = !expanded"
	>
		<i :class="['ti', expanded ? 'ti-chevron-down' : 'ti-chevron-right', $style.chevron]"></i>
		<GsNodePort
			v-if="node != null"
			v-show="!expanded && hasConnectedParameters"
			data-test-section-collapsed-port
			:dataType="{ kind: 'any' }"
			@update:element="collapsedPortElement = $event"
		/>
		<span :class="$style.label">{{ section.label }}</span>
	</button>
	<div v-show="section == null || expanded" :class="{ [$style.children]: section != null }">
		<template v-for="item in items" :key="typeof item === 'string' ? `parameter:${item}` : `section:${item.id}`">
			<slot v-if="typeof item === 'string'" :parameterKey="item"/>
			<GsEffectParameterLayout
				v-else
				:definition="definition"
				:values="values"
				:defaultBindings="defaultBindings"
				:node="node"
				:previewParameterGroup="previewParameterGroup"
				:section="item"
				:depth="depth + 1"
			>
				<template #default="{ parameterKey }"><slot :parameterKey="parameterKey"/></template>
			</GsEffectParameterLayout>
		</template>
	</div>
</div>
</template>

<script lang="ts" setup>
import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { computed, inject, shallowRef, watchEffect } from 'vue';
import { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
import GsNodePort from './GsNodePort.vue';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { EffectParameterLayoutItem, EffectParameterSection } from '@gs/subsystems_effect_shared/effect-parameter-layout.ts';
import type { EditableParameterBinding } from '@/types/parameter-edit.ts';
import { useProjectSession } from '@/project-session.ts';
import { preferences } from '@/preferences.ts';
import { useParameterExpansionState } from '@/composables/useParameterExpansion.ts';
import { isParameterVisible } from '@/utility/parameter-visibility.ts';
import { connectedNodeParameterPathKeysKey, useCustomNodeGraphEffectWires } from '@/utility/custom-node-graph-effect-wires.ts';

const props = withDefaults(defineProps<{
	definition: EffectDefinition;
	values: Readonly<Record<string, EditableParameterBinding>>;
	defaultBindings?: Readonly<Record<string, EditableParameterBinding>>;
	node?: { id: string };
	previewParameterGroup?: string;
	section?: EffectParameterSection;
	depth?: number;
}>(), { depth: 0 });

defineSlots<{ default(props: { parameterKey: string }): any }>();

const projectSession = useProjectSession();
const wireMap = useCustomNodeGraphEffectWires();
const connectedParameterPathKeys = inject(connectedNodeParameterPathKeysKey, null);
const collapsedPortElement = shallowRef<HTMLElement | null>(null);
const items = computed(() => props.section?.children ?? props.definition.ui?.parameterLayout ?? Object.keys(props.definition.paramDefs));
const parameterKeys = computed(() => {
	const keys: string[] = [];

	function visit(children: readonly EffectParameterLayoutItem[]): void {
		for (const item of children) {
			if (typeof item === 'string') keys.push(item);
			else visit(item.children);
		}
	}

	visit(items.value);
	return keys;
});
const hasConnectedParameters = computed(() => parameterKeys.value.some(key => connectedParameterPathKeys?.value.has(paramPathKey([key])) === true));
const expanded = useParameterExpansionState(projectSession,
	() => ['effectParameterSection', props.node?.id ?? null, props.previewParameterGroup ?? null, props.section?.id ?? null],
	() => props.section?.defaultExpanded ?? true);

function isVisible(parameterKey: string): boolean {
	const definition = props.definition.paramDefs[parameterKey];
	const defaultBinding = props.defaultBindings?.[parameterKey] ?? createDefaultParameterBinding(definition);

	return isParameterVisible(definition, props.values[parameterKey] ?? defaultBinding, defaultBinding, preferences.r.showAdvancedParameters.value);
}

watchEffect(onCleanup => {
	const element = collapsedPortElement.value;
	const nodeId = props.node?.id;
	const sectionId = props.section?.id;
	if (element == null || nodeId == null || sectionId == null || expanded.value) return;
	// 表示用ツリーの所属を登録し、値のパスへセクションIDを混ぜずに配線の集約先を渡す。
	wireMap.collapsedSections[nodeId] ??= {};
	wireMap.collapsedSections[nodeId][sectionId] = { element, parameterKeys: parameterKeys.value, depth: props.depth };
	onCleanup(() => {
		if (wireMap.collapsedSections[nodeId]?.[sectionId]?.element === element) delete wireMap.collapsedSections[nodeId][sectionId];
	});
});
</script>

<style module lang="scss">
.header {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	min-width: 0;
	box-sizing: border-box;
	padding: 2px 10px;
	text-align: left;
	font-weight: bold;
	background: #ffffff06;

	&:hover {
		background: #ffffff0c;
	}
}

.chevron {
	width: var(--NODE_PORT_SIZE, 16px);
	flex-shrink: 0;
	text-align: center;
}

.label {
	min-width: 0;
	overflow: clip;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.children {
	margin-left: 8px;
	border-left: 1px solid #ffffff18;
}
</style>
