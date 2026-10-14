<template>
<div
	:class="[$style.root, { [$style.isSelected]: isSelected }]"
	draggable="true"
	:title="title"
	@contextmenu.stop="onContextmenu"
	@dragstart="onDragstart"
	@dragend="onDragend"
>
	<div style="pointer-events: none;">
		<GsAssetThumbnail :class="$style.thumbnail" :asset="asset" fit="contain"/>

		<p :class="$style.name">
			<span>{{ asset.name.lastIndexOf('.') != -1 ? asset.name.substring(0, asset.name.lastIndexOf('.')) : asset.name }}</span>
			<span v-if="asset.name.lastIndexOf('.') != -1" style="opacity: 0.5;">{{ asset.name.substring(asset.name.lastIndexOf('.')) }}</span>
		</p>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import GsDialog from './common/GsDialog.vue';
import GsAssetThumbnail from './GsAssetThumbnail.vue';
import type { ProjectAsset } from '@/Project.ts';
import type { MenuItem } from '@/types/menu.ts';
import { appContext } from '@/app.ts';
import { openMediaFile } from '@/utility/open-media-file.ts';
import { popup } from '@/ui.ts';
import * as ui from '@/ui.ts';
import { setDragData } from '@/utility/drag-and-drop.ts';

const { stateManager } = appContext.projectContext;

const props = defineProps<{
	asset: ProjectAsset;
	isSelected?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'dragstart', dragEvent: DragEvent): void;
	(ev: 'dragend'): void;
}>();

const isDragging = ref(false);

const bytes = (v: number | null, digits = 0) => {
	if (v == null) return '?';
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB', 'RB', 'QB'];
	if (v === 0) return '0';
	const isMinus = v < 0;
	if (isMinus) v = -v;
	const i = Math.floor(Math.log(v) / Math.log(1024));
	return (isMinus ? '-' : '') + (v / Math.pow(1024, i)).toFixed(digits).replace(/(\.[1-9]*)0+$/, '$1').replace(/\.$/, '') + (sizes[i] ?? `e+${ i * 3 }B`);
};

const title = computed(() => `${props.asset.name}\n${props.asset.fileDataType} ${bytes(props.asset.fileData.size)}`);

function remove() {
	stateManager.commit('removeAsset', {
		assetId: props.asset.id,
	});
}

async function rename() {
	const { dispose } = popup(GsDialog, { input: { default: props.asset.name } }, {
		done: result => {
			if (!result.canceled && typeof result.result === 'string') {
				stateManager.commit('renameAsset', { assetId: props.asset.id, name: result.result });
			}
		},
		closed: () => dispose(),
	});
}

async function replace() {
	const result = await openMediaFile({ includeFonts: true });
	if (result == null) return;
	stateManager.commit('replaceAsset', {
		id: props.asset.id,
		name: props.asset.name,
		assetId: props.asset.id,
		width: result.width,
		height: result.height,
		fileDataType: result.type,
		fileData: result.fileData,
		sourceFilePath: result.sourceFilePath,
		thumbnailSequence: result.thumbnailSequence,
		hash: result.hash, // TODO
	});
}

function getMenu() {
	const menuItems: MenuItem[] = [];

	menuItems.push({
		text: 'Rename',
		icon: 'ti ti-cursor-text',
		action: () => rename(),
	}, {
		text: 'Replace',
		icon: 'ti ti-replace',
		action: () => replace(),
	}, {
		type: 'divider',
	}, {
		text: 'Remove',
		icon: 'ti ti-trash',
		danger: true,
		action: () => remove(),
	});

	return menuItems;
}

function onContextmenu(ev: PointerEvent) {
	ui.contextMenu(getMenu(), ev);
}

function onDragstart(ev: DragEvent) {
	if (ev.dataTransfer != null) {
		ev.dataTransfer.effectAllowed = 'copy';
		setDragData(ev, 'GsAsset', { assetId: props.asset.id });
	}
	isDragging.value = true;

	emit('dragstart', ev);
}

function onDragend() {
	isDragging.value = false;
	emit('dragend');
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	padding: 8px 0 0 0;
	min-height: 180px;
	border-radius: 8px;
	cursor: pointer;

	&:hover {
		background: rgba(#000, 0.05);

		.label {
			&::before,
			&::after {
				background: #0b65a5;
			}

			&.red {
				&::before,
				&::after {
					background: #c12113;
				}
			}
		}
	}

	&:active {
		background: rgba(#000, 0.1);

		.label {
			&::before,
			&::after {
				background: #0b588c;
			}

			&.red {
				&::before,
				&::after {
					background: #ce2212;
				}
			}
		}
	}

	&.isSelected {
		background: var(--THEME-accent);

		&:hover {
			background: hsl(from var(--THEME-accent) h s calc(l + 10));
		}

		&:active {
			background: hsl(from var(--THEME-accent) h s calc(l - 10));
		}

		.label {
			&::before,
			&::after {
				display: none;
			}
		}

		.name {
			color: var(--THEME-fgOnAccent);
		}

		.thumbnail {
			color: var(--THEME-fgOnAccent);
		}
	}
}

.thumbnail {
	width: 110px;
	height: 110px;
	margin: auto;
}

.name {
	display: block;
	margin: 8px 0 0 0;
	padding: 0 2px;
	font-size: 82%;
	text-align: center;
	word-break: break-all;
	color: var(--THEME-fg);
	overflow: hidden;
}
</style>
