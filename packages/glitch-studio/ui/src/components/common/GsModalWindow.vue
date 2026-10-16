<template>
<GsModal ref="modal" v-slot="{ type }" :preferType="'dialog'" @click="onBgClick" @closed="emit('closed')" @esc="emit('esc')">
	<div ref="rootEl" :class="[$style.root, type === 'drawer' ? $style.asDrawer : null]" :style="{ width: type === 'drawer' ? '' : `${width}px`, height: type === 'drawer' ? '' : `min(${height}px, 100%)` }">
		<div :class="$style.header">
			<button v-if="withCloseButton" :class="$style.headerButton" class="_button" data-testid="modal-window-close" @click="emit('close')"><i class="ti ti-x"></i></button>
			<span :class="$style.title">
				<slot name="header"></slot>
			</span>
			<div v-if="withOkButton" style="padding: 0 16px; place-content: center;">
				<GsButton primary small rounded :disabled="okButtonDisabled" @click="emit('ok')">{{ i18n.ts.Done }} <i class="ti ti-check"></i></GsButton>
			</div>
		</div>
		<div :class="$style.body">
			<slot></slot>
		</div>
		<div v-if="$slots.footer" :class="$style.footer">
			<slot name="footer"></slot>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { onMounted, onUnmounted, useTemplateRef, ref } from 'vue';
import GsModal from './GsModal.vue';
import GsButton from './GsButton.vue';

const props = withDefaults(defineProps<{
	withOkButton?: boolean;
	withCloseButton?: boolean;
	okButtonDisabled?: boolean;
	width?: number;
	height?: number;
}>(), {
	withOkButton: false,
	withCloseButton: true,
	okButtonDisabled: false,
	width: 400,
	height: 500,
});

const emit = defineEmits<{
	(event: 'click'): void;
	(event: 'close'): void;
	(event: 'closed'): void;
	(event: 'ok'): void;
	(event: 'esc'): void;
}>();

const modal = useTemplateRef('modal');

function close() {
	modal.value?.close();
}

function onBgClick() {
	emit('click');
}

defineExpose({
	close,
});
</script>

<style lang="scss" module>
.root {
	margin: auto;
	overflow: clip;
	display: flex;
	flex-direction: column;
	contain: content;
	border-radius: 8px;

	--root-margin: 24px;

	--headerHeight: 46px;
	--headerHeightNarrow: 42px;

	@media (max-width: 500px) {
		--root-margin: 16px;
	}

	&.asDrawer {
		height: calc(100dvh - 30px);
		border-radius: 0;

		.body {
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}

		.footer {
			padding-bottom: max(12px, env(safe-area-inset-bottom, 0px));
		}
	}
}

.header {
	display: flex;
	flex-shrink: 0;
	background: var(--THEME-panel);
	-webkit-backdrop-filter: blur(15px);
	backdrop-filter: blur(15px);
}

.headerButton {
	height: var(--headerHeight);
	width: var(--headerHeight);

	@media (max-width: 500px) {
		height: var(--headerHeightNarrow);
		width: var(--headerHeightNarrow);
	}
}

.title {
	flex: 1;
	line-height: var(--headerHeight);
	padding-left: 32px;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;

	@media (max-width: 500px) {
		line-height: var(--headerHeightNarrow);
		padding-left: 16px;
	}
}

.headerButton + .title {
	padding-left: 0;
}

.body {
	flex: 1;
	overflow: auto;
	background: var(--THEME-bg);
	container-type: size;
}

.footer {
	padding: 12px 16px;
	overflow: auto;
	background: var(--THEME-bg);
	border-top: 1px solid #fff3;
}
</style>
