<template>
<div :class="$style.root">
	<div v-if="viewWindow" :class="$style.placeholder">
		<span>{{ windowMode === 'pip' ? i18n.tsx._DetachableView.OpenInPip({ title }) : i18n.tsx._DetachableView.OpenInWindow({ title }) }}</span>
		<button class="_button" @click="closeView">{{ i18n.tsx._DetachableView.Return({ title }) }}</button>
	</div>
	<div v-show="!viewWindow" ref="home" :class="$style.root">
		<div ref="view" :class="$style.root" @contextmenu.prevent.stop="onContextmenu">
			<slot :detached="!!viewWindow"></slot>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.ts';
import { inject, useTemplateRef, ref, shallowRef, onBeforeUnmount } from 'vue';
import { fileDropTargetInstallerKey } from '@/utility/file-drop.ts';
import type { MenuItem } from '@/types/menu.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{
	title: string;
}>();

const emit = defineEmits<{ changeWindow: [] }>();

const home = useTemplateRef('home');
const view = useTemplateRef('view');
const viewWindow = shallowRef<Window | null>(null);
const windowMode = ref<'pip' | 'window'>('pip');
const fullscreen = ref(false);
const installFileDrops = inject(fileDropTargetInstallerKey, null);
let disposeFileDrops: (() => void) | null = null;

function updateFullscreen() {
	fullscreen.value = !!viewWindow.value?.document.fullscreenElement;
}

async function toggleFullscreen() {
	const doc = viewWindow.value?.document;
	if (!doc || windowMode.value !== 'window') return;
	try {
		if (doc.fullscreenElement) await doc.exitFullscreen();
		else await doc.documentElement.requestFullscreen();
	} catch (error) {
		ui.alert({ type: 'error', title: i18n.ts._DetachableView.FullscreenFailed, text: String(error) });
	}
}

// Kept local until TypeScript's DOM library includes Document PiP.
const pipApi = (window as Window & {
	documentPictureInPicture?: { requestWindow(options: { width: number; height: number }): Promise<Window> };
}).documentPictureInPicture;
let openingView = false;
let disposed = false;

function restoreView() {
	disposeFileDrops?.();
	disposeFileDrops = null;
	const pip = viewWindow.value;
	if (!pip) return;
	pip.removeEventListener('pagehide', restoreView);
	pip.document.removeEventListener('fullscreenchange', updateFullscreen);
	// Restore synchronously, before the child document or Vue subtree is destroyed.
	if (home.value && view.value) home.value.append(view.value);
	emit('changeWindow');
	viewWindow.value = null;
	fullscreen.value = false;
}

function closeView() {
	const pip = viewWindow.value;
	restoreView();
	pip?.close();
}

async function openView(mode: 'pip' | 'window') {
	if (disposed || openingView || (mode === 'pip' && !pipApi) || !view.value) return;
	if (viewWindow.value && !viewWindow.value.closed) {
		viewWindow.value.focus();
		return;
	}
	openingView = true;
	let pip: Window | null = null;
	try {
		const { width, height } = view.value.getBoundingClientRect();
		const size = { width: Math.max(240, Math.round(width)), height: Math.max(160, Math.round(height)) };
		if (mode === 'pip') {
			pip = await pipApi!.requestWindow(size);
		} else {
			// Open synchronously within the menu click's user activation.
			pip = window.open('', '_blank', `popup,width=${size.width},height=${size.height}`) ?? null;
			if (!pip) throw new Error(i18n.ts._DetachableView.PopupBlocked);
		}
		if (disposed || pip.closed) {
			pip.close();
			return;
		}
		viewWindow.value = pip;
		windowMode.value = mode;
		pip.addEventListener('pagehide', restoreView);
		pip.document.addEventListener('fullscreenchange', updateFullscreen);
		pip.document.title = `Glitch Studio — ${props.title}`;
		for (const style of window.document.querySelectorAll('style, link[rel="stylesheet"]')) {
			pip.document.head.append(style.cloneNode(true));
		}
		pip.document.body.append(view.value!);
		disposeFileDrops = installFileDrops?.(view.value!) ?? null;
		emit('changeWindow');
	} catch (error) {
		restoreView();
		pip?.close();
		if (!disposed) ui.alert({ type: 'error', title: i18n.tsx._DetachableView.OpenFailed({ title: props.title }), text: String(error) });
	} finally {
		openingView = false;
	}
}

// Unlike PiP, ordinary popups can outlive their opener.
window.addEventListener('pagehide', closeView);
onBeforeUnmount(() => {
	disposed = true;
	closeView();
	window.removeEventListener('pagehide', closeView);
});

function onContextmenu(ev: PointerEvent) {
	// Shared context menus render in the main document; detached views have buttons.
	if (viewWindow.value) return;
	const menuItems: MenuItem[] = pipApi ? [{
		text: i18n.ts._DetachableView.StartPip,
		action: () => openView('pip'),
	}] : [{ type: 'label', text: i18n.ts._DetachableView.PipUnsupported }];
	menuItems.unshift({ text: i18n.ts._DetachableView.OpenWindow, action: () => openView('window') });
	ui.contextMenu(menuItems, ev);
}

defineExpose({
	popout: () => openView('window'),
});
</script>

<style module lang="scss">
.root {
	position: relative;
	width: 100%;
	height: 100%;
}

.placeholder {
	height: 100%;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 12px;
}
</style>
