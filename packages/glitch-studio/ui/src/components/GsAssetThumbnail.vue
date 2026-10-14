<template>
<div
	:class="[$style.root, {
		[$style.large]: large,
	}]"
>
	<div v-if="isThumbnailAvailable && is === 'image'" :class="$style.thumbnail">
		<!-- TODO -->
	</div>
	<div v-else-if="isThumbnailAvailable && is === 'video'" :class="$style.thumbnail">
		<!-- TODO -->
	</div>
	<i v-else-if="is === 'image'" class="ti ti-photo" :class="$style.icon"></i>
	<i v-else-if="is === 'video'" class="ti ti-video" :class="$style.icon"></i>
	<i v-else-if="is === 'audio' || is === 'midi'" class="ti ti-music" :class="$style.icon"></i>
	<i v-else-if="is === 'csv'" class="ti ti-file-text" :class="$style.icon"></i>
	<i v-else-if="is === 'pdf'" class="ti ti-file-text" :class="$style.icon"></i>
	<i v-else-if="is === 'textfile'" class="ti ti-file-text" :class="$style.icon"></i>
	<i v-else-if="is === 'archive'" class="ti ti-file-zip" :class="$style.icon"></i>
	<i v-else-if="is === 'font'" class="ti ti-typography" :class="$style.icon"></i>
	<i v-else class="ti ti-file" :class="$style.icon"></i>

	<i v-if="isThumbnailAvailable && is === 'video'" class="ti ti-video" :class="$style.iconSub"></i>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { Asset } from '@gs/shared/types.ts';

const props = defineProps<{
	asset: Asset;
	fit: 'cover' | 'contain';
	large?: boolean;
}>();

const is = computed(() => {
	if (props.asset.fileDataType.startsWith('image/')) return 'image';
	if (props.asset.fileDataType.startsWith('video/')) return 'video';
	if (props.asset.fileDataType === 'audio/midi') return 'midi';
	if (props.asset.fileDataType.startsWith('audio/')) return 'audio';
	if (props.asset.fileDataType.endsWith('/csv')) return 'csv';
	if (props.asset.fileDataType.endsWith('/pdf')) return 'pdf';
	if (props.asset.fileDataType.startsWith('text/')) return 'textfile';
	if (props.asset.fileDataType.startsWith('font/')) return 'font';
	if ([
		'application/zip',
		'application/x-cpio',
		'application/x-bzip',
		'application/x-bzip2',
		'application/java-archive',
		'application/x-rar-compressed',
		'application/x-tar',
		'application/gzip',
		'application/x-7z-compressed',
	].some(archiveType => archiveType === props.asset.fileDataType)) return 'archive';
	return 'unknown';
});

const isThumbnailAvailable = computed(() => {
	return false; // TODO
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: flex;
	background: var(--THEME-panel);
	border-radius: 8px;
	overflow: clip;
}

.iconSub {
	position: absolute;
	width: 30%;
	height: auto;
	margin: 0;
	right: 4%;
	bottom: 4%;
}

.icon {
	pointer-events: none;
	margin: auto;
	font-size: 32px;
	color: #777;
}

.large .icon {
	font-size: 40px;
}

.thumbnail {
	width: 100%;
}
</style>
