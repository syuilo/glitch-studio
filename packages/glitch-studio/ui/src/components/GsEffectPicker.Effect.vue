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
			<div :class="$style.secondaryPorts">
				<GsNodePort v-for="output in outputPorts.filter(port => !port.isPrimary)" :key="output.key" v-tooltip="`${output.key} (${output.dataType.kind})`" output :class="$style.secondaryPort" :dataType="output.dataType"/>
			</div>
			<GsNodePort v-for="output in outputPorts.filter(port => port.isPrimary)" :key="output.key" v-tooltip="`${output.key} (${output.dataType.kind})`" output style="margin-left: 3px;" :dataType="output.dataType"/>
		</div>
	</div>
</button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GsNodePort from './GsNodePort.vue';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { getEffectInputPorts, getEffectOutputPorts } from '@/utility/effect-ports.ts';

const props = withDefaults(defineProps<{
	effect: Pick<EffectDefinition, 'displayName' | 'description' | 'paramDefs' | 'outputDefs' | 'primaryInputParameter' | 'primaryOutput'>;
	detailed?: boolean;
}>(), {
	detailed: false,
});

const emit = defineEmits<{
	(ev: 'click', event: MouseEvent): void;
}>();

const inputPorts = computed(() => getEffectInputPorts(props.effect));
const outputPorts = computed(() => getEffectOutputPorts(props.effect));
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
	opacity: 0.7;
}

.secondaryPort {
}

.arrow {
	height: var(--height);
	line-height: var(--height);
	opacity: 0.3;
}
</style>
