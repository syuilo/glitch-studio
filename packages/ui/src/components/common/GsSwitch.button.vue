<template>
<span
	v-tooltip="checked ? 'it\'s ON' : 'it\'s OFF'"
	:class="{
		[$style.button]: true,
		[$style.buttonChecked]: checked,
		[$style.buttonDisabled]: props.disabled
	}"
	data-testid="switch-toggle"
	@click.prevent.stop="toggle"
>
	<div :class="{ [$style.knob]: true, [$style.knobChecked]: checked }"></div>
</span>
</template>

<script lang="ts" setup>
import { toRefs } from 'vue';
import type { Ref } from 'vue';

const props = withDefaults(defineProps<{
	checked: boolean | Ref<boolean>;
	disabled?: boolean | Ref<boolean>;
}>(), {
	disabled: false,
});

const emit = defineEmits<{
	(ev: 'toggle'): void;
}>();

const checked = toRefs(props).checked;
const toggle = () => {
	emit('toggle');
};
</script>

<style lang="scss" module>
.button {
	--height: 19px;
	--switchOffBg: #fff3;
	--switchOnBg: var(--THEME-accent);
	--switchOffFg: #fff;
	--switchOnFg: #fff;

	position: relative;
	display: inline-flex;
	flex-shrink: 0;
	margin: 0;
	box-sizing: border-box;
	width: calc(var(--height) * 1.6);
	height: calc(var(--height) + 2px); // 枠線
	outline: none;
	background: var(--switchOffBg);
	background-clip: content-box;
	border: solid 1px var(--switchOffBg);
	border-radius: 999px;
	cursor: pointer;
	transition: inherit;
	user-select: none;
}

.buttonChecked {
	background-color: var(--switchOnBg) !important;
	border-color: var(--switchOnBg) !important;
}

.buttonDisabled {
	cursor: not-allowed;
}

.knob {
	position: absolute;
	box-sizing: border-box;
	top: 3px;
	width: calc(var(--height) - 6px);
	height: calc(var(--height) - 6px);
	border-radius: 999px;
	transition: all 0.2s ease;

	&:not(.knobChecked) {
		left: 3px;
		background: var(--switchOffFg);
	}
}

.knobChecked {
	left: calc(calc(100% - var(--height)) + 3px);
	background: var(--switchOnFg);
}
</style>
