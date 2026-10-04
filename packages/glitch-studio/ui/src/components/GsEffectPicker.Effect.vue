<template>
<button type="button" class="_button" :class="[$style.root, { [$style.detailed]: detailed }]" @click="emit('click', $event)">
	<span :class="$style.title">{{ effect.displayName }}</span>
	<span v-if="detailed" :class="$style.description">{{ effect.description['ja-JP'] }}</span>
	<div v-if="detailed" :class="$style.footer">
		<div :class="$style.ports">
			<GsNodePort v-for="input in inputPorts" :key="input.key" :dataType="input.dataType" :title="`${input.label} (${input.dataType.kind})`"/>
		</div>
		<i class="ti ti-arrow-right" :class="$style.arrow"></i>
		<div :class="[$style.ports, $style.outputs]">
			<GsNodePort v-for="(output, key) in effect.outputDefs" :key="key" :dataType="output.dataType" :title="`${key} (${output.dataType.kind})`"/>
		</div>
	</div>
</button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { isTextureDataType, type TextureDataType } from '@gs/shared/data-type/data-type.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, type ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import GsNodePort from './GsNodePort.vue';

const props = withDefaults(defineProps<{
	effect: Pick<EffectDefinition, 'displayName' | 'description' | 'paramDefs' | 'outputDefs'>;
	detailed?: boolean;
}>(), {
	detailed: false,
});

const emit = defineEmits<{
	(ev: 'click', event: MouseEvent): void;
}>();

type InputPort = {
	key: string;
	label: string;
	dataType: TextureDataType;
};

const inputPorts = computed(() => Object.entries(props.effect.paramDefs).flatMap(([key, definition]) =>
	getInputPorts(definition, [key], definition.ui.label)));

function getInputPorts(definition: ParameterDefinition, path: string[], label: string): InputPort[] {
	if (definition.dataType.kind === 'array') {
		// Pickerではまだ配列要素が確定していないため、初期値の個数ではなく要素の定義を1回表示する。
		return getInputPorts(getArrayElementDefinition(definition), path, `${label}[]`);
	}
	if (definition.dataType.kind === 'struct') {
		return Object.entries(getStructFieldDefinitions(definition)).flatMap(([key, field]) =>
			getInputPorts(field, [...path, key], `${label} / ${field.ui.label}`));
	}
	if (definition.canNode !== true || !isTextureDataType(definition.dataType)) return [];
	return [{ key: JSON.stringify(path), label, dataType: definition.dataType }];
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
	padding: 8px;
	text-align: center;
	background: light-dark(#0001, #fff1);
	border-radius: 6px;

	&:hover {
		background: light-dark(#0002, #fff2);
	}
}

.detailed {
	text-align: left;

	.title {
		font-weight: bold;
	}
}

.title, .description {
	overflow-wrap: anywhere;
}

.description {
	font-size: 85%;
	line-height: 1.5;
	opacity: 0.7;
}

.footer {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: 8px;
	margin-top: auto;
	padding-top: 8px;
	border-top: solid 1px light-dark(#0001, #fff1);
}

.ports {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	min-width: 0;
}

.outputs {
	justify-content: flex-end;
}

.arrow {
	opacity: 0.5;
}
</style>
