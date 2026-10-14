<template>
<div
	:data-test-asset="asset.id"
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
import { computed } from 'vue';
import GsAssetThumbnail from './GsAssetThumbnail.vue';
import type { ProjectAsset } from '@/Project.ts';
import { getAssetMenu } from '@/utility/asset-menu.ts';
import { contextMenu } from '@/ui.ts';
import { useDragSession } from '@/composables/useDragSession.ts';

const props = defineProps<{
	asset: ProjectAsset;
	isSelected?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'dragstart', dragEvent: DragEvent): void;
	(ev: 'dragend'): void;
}>();

const dragSession = useDragSession();

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

function onContextmenu(ev: PointerEvent) {
	contextMenu(getAssetMenu(props.asset), ev);
}

function onDragstart(ev: DragEvent) {
	if (ev.dataTransfer != null) {
		ev.dataTransfer.effectAllowed = 'copy';
		dragSession.start(ev, 'GsAsset', { assetId: props.asset.id });
	}

	emit('dragstart', ev);
}

function onDragend() {
	dragSession.finish();
	emit('dragend');
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	padding: 8px 0 0 0;
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
