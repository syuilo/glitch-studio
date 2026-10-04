<template>
<button type="button" class="_button" :class="[$style.root, { [$style.detailed]: detailed }]" @click="emit('click', $event)">
	<span :class="$style.title">{{ effect.displayName }}</span>
	<span v-if="detailed" :class="$style.description">{{ effect.description['ja-JP'] }}</span>
</button>
</template>

<script setup lang="ts">
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';

withDefaults(defineProps<{
	effect: Pick<EffectDefinition, 'displayName' | 'description'>;
	detailed?: boolean;
}>(), {
	detailed: false,
});

const emit = defineEmits<{
	(ev: 'click', event: MouseEvent): void;
}>();
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
</style>
