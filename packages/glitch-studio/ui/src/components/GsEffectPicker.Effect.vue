<template>
<button type="button" class="_button" :class="[$style.root, { [$style.detailed]: detailed }]" @click="emit('click', $event)">
	<span :class="$style.title">{{ effect.displayName }}</span>
	<span v-if="detailed" :class="$style.description">{{ effect.description['ja-JP'] }}</span>
	<div v-if="detailed" :class="$style.footer">
		<div :class="$style.ports">
			<GsNodePort v-for="input in inputPorts.filter(port => port.isPrimary)" :key="input.key" v-tooltip="`${input.label} (${input.dataType.kind})`" style="margin-right: 3px;" :dataType="input.dataType"/>
			<div :class="$style.secondaryPorts">
				<GsNodePort v-for="input in inputPorts.filter(port => !port.isPrimary)" :key="input.key" v-tooltip="`${input.label} (${input.dataType.kind})`" :class="$style.secondaryPort" :dataType="input.dataType"/>
			</div>
		</div>
		<i class="ti ti-arrow-right" :class="$style.arrow"></i>
		<div :class="[$style.ports, $style.outputs]">
			<GsNodePort v-for="(output, key) in effect.outputDefs" :key="key" v-tooltip="`${key} (${output.dataType.kind})`" :class="{ [$style.secondaryPort]: key !== effect.primaryOutput }" :dataType="output.dataType"/>
		</div>
	</div>
</button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import GsNodePort from './GsNodePort.vue';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';

const props = withDefaults(defineProps<{
	effect: Pick<EffectDefinition, 'displayName' | 'description' | 'paramDefs' | 'outputDefs' | 'primaryInputParameter' | 'primaryOutput'>;
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
	isPrimary: boolean;
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
	return [{
		key: JSON.stringify(path),
		label,
		dataType: definition.dataType,
		isPrimary: path.length === 1 && path[0] === props.effect.primaryInputParameter,
	}];
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
	padding: 8px 10px;
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
	--height: 15px;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	gap: 8px;
	margin-top: auto;
	padding-top: 8px;
	border-top: solid 1px light-dark(#0001, #fff1);
}

.ports {
	--NODE_PORT_SIZE: var(--height);
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	min-width: 0;
}

.outputs {
	justify-content: flex-end;
}

.secondaryPorts {
	--gap: 2px;
	--NODE_PORT_SIZE: calc((var(--height) / 2) - (var(--gap) / 2));
	display: flex;
	flex-direction: column;
	flex-wrap: wrap;
	gap: var(--gap);
	height: var(--height);
	box-sizing: border-box;
}

.secondaryPort {
}

.arrow {
	height: var(--height);
	line-height: var(--height);
	opacity: 0.3;
}
</style>
