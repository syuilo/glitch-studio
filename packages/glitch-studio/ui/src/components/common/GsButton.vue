<template>
<component
	:is="component"
	ref="el"
	class="_button"
	:class="[$style.root, { [$style.inline]: inline, [$style.primary]: primary, [$style.danger]: danger, [$style.rounded]: rounded, [$style.full]: full, [$style.small]: small, [$style.large]: large, [$style.transparent]: transparent, [$style.iconOnly]: iconOnly, [$style.wait]: wait, [$style.active]: active }]"
	v-bind="cProps"
	@click="emit('click', $event)"
>
	<div :class="$style.content">
		<slot name="icon" :class="$style.icon"></slot>
		<slot></slot>
	</div>
</component>
</template>

<script lang="ts" setup>
import { nextTick, computed, onMounted, useTemplateRef } from 'vue';

const props = defineProps<{
	type?: 'button' | 'submit' | 'reset' | 'a';
	primary?: boolean;
	rounded?: boolean;
	inline?: boolean;
	autofocus?: boolean;
	wait?: boolean;
	danger?: boolean;
	full?: boolean;
	small?: boolean;
	large?: boolean;
	transparent?: boolean;
	iconOnly?: boolean;
	active?: boolean;

	// for type=button
	name?: string;
	value?: string;
	disabled?: boolean;

	// for type=a
	href?: string;
	target?: string;
	rel?: string;
}>();

const emit = defineEmits<{
	(ev: 'click', payload: PointerEvent): void;
}>();

const el = useTemplateRef<HTMLButtonElement | HTMLAnchorElement>('el');

const component = computed(() => {
	if (props.type === 'a') return 'a';
	return 'button';
});
const cProps = computed(() => {
	if (props.type === 'a') return { href: props.href ?? '#', target: props.target, rel: props.rel };
	return {
		type: props.type ?? 'button',
		name: props.name,
		value: props.value,
		disabled: props.disabled || props.wait,
	};
});

onMounted(() => {
	if (props.autofocus) {
		nextTick(() => {
			el.value?.focus();
		});
	}
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: block;
	min-width: 80px;
	width: max-content;
	height: var(--GS-CONTROL-HEIGHT);
	line-height: var(--GS-CONTROL-HEIGHT);
	padding: 0 12px;
	text-align: center;
	font-weight: normal;
	box-shadow: none;
	text-decoration: none;
	background: var(--THEME-buttonBg);
	border-radius: 5px;
	overflow: clip;
	box-sizing: border-box;
	transition: background 0.1s ease;

	&:hover {
		text-decoration: none;
	}

	&:not(:disabled):hover {
		background: var(--THEME-buttonHoverBg);
	}

	&:not(:disabled):active {
		background: var(--THEME-buttonHoverBg);
	}

	&.iconOnly {
		padding: 7px;
		min-width: auto !important;

		.icon {
			margin-right: 0;
		}
	}

	&.small {
		padding: 0 8px;
	}

	&.large {
		padding: 0 16px;
	}

	&.full {
		width: 100%;
	}

	&.rounded {
		border-radius: 999px;
	}

	&.primary {
		font-weight: bold;
		color: var(--THEME-fgOnAccent) !important;
		background: var(--THEME-accent);

		&:not(:disabled):hover {
			background: hsl(from var(--THEME-accent) h s calc(l + 5));
		}

		&:not(:disabled):active {
			background: hsl(from var(--THEME-accent) h s calc(l + 5));
		}
	}

	&.transparent {
		background: transparent;
	}

	&.danger {
		font-weight: bold;
		color: var(--THEME-error);

		&.primary {
			color: #fff;
			background: var(--THEME-error);

			&:not(:disabled):hover {
				background: hsl(from var(--THEME-error) h s calc(l + 10));
			}

			&:not(:disabled):active {
				background: hsl(from var(--THEME-error) h s calc(l - 10));
			}
		}
	}

	&.active {
		color: var(--THEME-accent) !important;
	}

	&:disabled {
		opacity: 0.5;
	}

	&.wait {
		cursor: wait !important;
	}

	&:focus-visible {
		outline-offset: 2px;
	}

	&.inline {
		display: inline-block;
		width: auto;
	}
}

.content {
	position: relative;
	z-index: 1;
	pointer-events: none;
}

.icon {
	display: inline-block;
	line-height: var(--GS-CONTROL-HEIGHT);
	margin-right: 0.5em;
}
</style>
