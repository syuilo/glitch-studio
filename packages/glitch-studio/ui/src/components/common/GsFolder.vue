<template>
<div ref="rootEl" :class="[$style.root, { [$style.asSection]: props.asSection }]">
	<GsStickyContainer>
		<template #header>
			<button :class="[$style.header, { [$style.opened]: opened }]" class="_button" data-testid="folder-header" @click="toggle">
				<div :class="$style.headerIcon"><slot name="icon"></slot></div>
				<div :class="$style.headerText">
					<div :class="$style.headerTextMain">
						<GsCondensedLine><slot name="label"></slot></GsCondensedLine>
					</div>
					<div :class="$style.headerTextSub">
						<slot name="caption"></slot>
					</div>
				</div>
				<div :class="$style.headerRight">
					<span :class="$style.headerRightText"><slot name="suffix"></slot></span>
					<i v-if="opened" class="ti ti-chevron-up icon"></i>
					<i v-else class="ti ti-chevron-down icon"></i>
				</div>
			</button>
		</template>

		<div v-if="openedAtLeastOnce" :class="[$style.body, { [$style.bgSame]: bgSame }]" :style="{ maxHeight: maxHeight ? `${maxHeight}px` : undefined, overflow: maxHeight ? `auto` : undefined }" :aria-hidden="!opened">
			<Transition
				:enterActiveClass="preferences.s.animation ? $style.transition_toggle_enterActive : ''"
				:leaveActiveClass="preferences.s.animation ? $style.transition_toggle_leaveActive : ''"
				:enterFromClass="preferences.s.animation ? $style.transition_toggle_enterFrom : ''"
				:leaveToClass="preferences.s.animation ? $style.transition_toggle_leaveTo : ''"
			>
				<KeepAlive>
					<div v-show="opened">
						<GsStickyContainer>
							<template #header>
								<div v-if="$slots.header" :class="$style.inBodyHeader">
									<slot name="header"></slot>
								</div>
							</template>

							<div v-if="withSpacer" class="_spacer" :style="{ '--SPACER-min': props.spacerMin + 'px', '--SPACER-max': props.spacerMax + 'px' }">
								<slot></slot>
							</div>
							<div v-else>
								<slot></slot>
							</div>

							<template #footer>
								<div v-if="$slots.footer" :class="$style.inBodyFooter">
									<slot name="footer"></slot>
								</div>
							</template>
						</GsStickyContainer>
					</div>
				</KeepAlive>
			</Transition>
		</div>
	</GsStickyContainer>
</div>
</template>

<script lang="ts" setup>
import { nextTick, onMounted, ref, useTemplateRef, watch } from 'vue';
import tinycolor from 'tinycolor2';
import GsCondensedLine from './GsCondensedLine.vue';
import GsStickyContainer from './GsStickyContainer.vue';
import { getBgColor } from '@/utility/get-bg-color.js';
import { preferences } from '@/preferences.ts';

const props = withDefaults(defineProps<{
	defaultOpen?: boolean;
	maxHeight?: number | null;
	withSpacer?: boolean;
	spacerMin?: number;
	spacerMax?: number;
	asSection?: boolean;
}>(), {
	defaultOpen: false,
	maxHeight: null,
	withSpacer: true,
	spacerMin: 8,
	spacerMax: 12,
	asSection: false,
});

const emit = defineEmits<{
	(ev: 'opened'): void;
	(ev: 'closed'): void;
}>();

const rootEl = useTemplateRef('rootEl');
const bgSame = ref(false);
const opened = ref(props.defaultOpen);
const openedAtLeastOnce = ref(opened.value);

async function toggle(ev: PointerEvent) {
	if (!opened.value) {
		openedAtLeastOnce.value = true;
	}

	nextTick(() => {
		opened.value = !opened.value;
	});
}

onMounted(() => {
	if (!props.asSection) {
		const computedStyle = window.getComputedStyle(window.document.documentElement);
		const parentBg = getBgColor(rootEl.value?.parentElement) ?? 'transparent';
		const myBg = computedStyle.getPropertyValue('--THEME-panel');
		bgSame.value = tinycolor(parentBg).toHexString() === tinycolor(myBg).toHexString();
	}
});

watch(opened, (isOpened) => {
	if (isOpened) {
		emit('opened');
	} else {
		emit('closed');
	}
}, { flush: 'post' });
</script>

<style lang="scss" module>
.transition_toggle_enterActive,
.transition_toggle_leaveActive {
	overflow-y: hidden; // 子要素のmarginが突き出るため clip を使ってはいけない
	transition: opacity 0.3s, height 0.3s;
}

.transition_toggle_enterFrom,
.transition_toggle_leaveTo {
	height: 0;
	opacity: 0;
}

.root {
	display: block;
	interpolate-size: allow-keywords; // heightのtransitionを動作させるために必要
}

.header {
	display: flex;
	align-items: center;
	width: 100%;
	box-sizing: border-box;
	padding: 5px 10px 5px 10px;
	font-size: 95%;
	background: var(--THEME-folderHeaderBg);
	-webkit-backdrop-filter: blur(15px);
	backdrop-filter: blur(15px);
	border-radius: 6px;
	transition: border-radius 0.3s;

	&:hover {
		text-decoration: none;
		background: var(--THEME-folderHeaderHoverBg);
	}

	&:focus-within {
		outline-offset: 2px;
	}

	&.active {
		color: var(--THEME-accent);
		background: var(--THEME-folderHeaderHoverBg);
	}

	&.opened {
		border-radius: 6px 6px 0 0;
	}
}

.headerUpper {
	display: flex;
	align-items: center;
}

.headerLower {
	color: color(from var(--THEME-fg) srgb r g b / 0.75);
	font-size: .85em;
	padding-left: 4px;
}

.headerIcon {
	margin-right: 0.75em;
	flex-shrink: 0;
	text-align: center;
	opacity: 0.8;

	&:empty {
		display: none;

		& + .headerText {
			padding-left: 4px;
		}
	}
}

.headerText {
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;
	padding-right: 12px;
}

.headerTextMain,
.headerTextSub {
	width: fit-content;
	max-width: 100%;
}

.headerTextSub {
	color: color(from var(--THEME-fg) srgb r g b / 0.75);
	font-size: .85em;
}

.headerRight {
	margin-left: auto;
	color: color(from var(--THEME-fg) srgb r g b / 0.75);
	white-space: nowrap;
}

.headerRightText:not(:empty) {
	margin-right: 0.75em;
}

.body {
	background: var(--THEME-panel);
	border-radius: 0 0 6px 6px;
	container-type: inline-size;

	&.bgSame {
		background: var(--THEME-bg);

		.inBodyHeader {
			background: color(from var(--THEME-bg) srgb r g b / 0.75);
		}
	}
}

.inBodyHeader {
	background: color(from var(--THEME-panel) srgb r g b / 0.75);
	-webkit-backdrop-filter: blur(15px);
	backdrop-filter: blur(15px);
	border-bottom: solid 0.5px var(--THEME-divider);
}

.inBodyFooter {
	padding: 12px;
	background: color(from var(--THEME-bg) srgb r g b / 0.5);
	-webkit-backdrop-filter: blur(15px);
	backdrop-filter: blur(15px);
	background-size: auto auto;
	background-image: repeating-linear-gradient(135deg, transparent, transparent 5px, var(--THEME-panel) 5px, var(--THEME-panel) 10px);
	border-radius: 0 0 6px 6px;
}

.asSection {
	.header {
		border-radius: 0;
	}

	.body {
		background: transparent;
	}
}
</style>
