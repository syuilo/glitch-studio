<template>
<div
	ref="root"
	:class="[$style.root, {
		[$style.large]: large,
	}]"
>
	<img v-if="imageUrl != null" data-test-asset-thumbnail-image :src="imageUrl" :class="$style.thumbnail" :style="{ objectFit: fit }">
	<i v-else-if="is === 'image'" class="ti ti-photo" :class="$style.icon"></i>
	<i v-else-if="is === 'video'" class="ti ti-video" :class="$style.icon"></i>
	<i v-else-if="is === 'audio' || is === 'midi'" class="ti ti-music" :class="$style.icon"></i>
	<i v-else-if="is === 'csv'" class="ti ti-file-text" :class="$style.icon"></i>
	<i v-else-if="is === 'pdf'" class="ti ti-file-text" :class="$style.icon"></i>
	<i v-else-if="is === 'textfile'" class="ti ti-file-text" :class="$style.icon"></i>
	<i v-else-if="is === 'archive'" class="ti ti-file-zip" :class="$style.icon"></i>
	<i v-else-if="is === 'font'" class="ti ti-typography" :class="$style.icon"></i>
	<i v-else-if="is === 'lut'" class="ti ti-color-swatch" :class="$style.icon"></i>
	<i v-else class="ti ti-file" :class="$style.icon"></i>

	<i v-if="imageUrl != null && is === 'video'" class="ti ti-video" :class="$style.iconSub"></i>
	<i v-if="asset.isExternalReference" class="ti ti-arrow-narrow-down-dashed" :class="$style.externalIcon"></i>
</div>
</template>

<script lang="ts" setup>
import { getFileSourceUrl, getFileSourceError, releaseFileSourceUrl } from '@gs/shared/file-source.ts';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { LUT_ASSET_MIME_TYPE } from '@gs/shared/media/lut.ts';
import type { ProjectAsset } from '@/Project.ts';

const props = defineProps<{
	asset: ProjectAsset;
	fit: 'cover' | 'contain';
	large?: boolean;
}>();

const is = computed(() => {
	if (props.asset.fileDataType === LUT_ASSET_MIME_TYPE) return 'lut';
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

const root = useTemplateRef<HTMLElement>('root');
const visible = ref(false);
const documentVisible = ref(false);
const imageUrl = shallowRef<string | null>(null);

onMounted(() => {
	const element = root.value;
	if (element == null) return;
	const ownerDocument = element.ownerDocument;
	const updateVisibility = () => { documentVisible.value = !ownerDocument.hidden; };
	updateVisibility();
	ownerDocument.addEventListener('visibilitychange', updateVisibility);
	const observer = new IntersectionObserver(entries => {
		visible.value = entries.some(entry => entry.isIntersecting);
	});
	observer.observe(element);
	onBeforeUnmount(() => {
		observer.disconnect();
		ownerDocument.removeEventListener('visibilitychange', updateVisibility);
	});
});

watch(() => [props.asset.fileData, props.asset.fileDataType, props.asset.thumbnailSequence, visible.value, documentVisible.value] as const,
	([fileData, type, sequence, isVisible, isDocumentVisible], _previous, onCleanup) => {
		imageUrl.value = null;
		if (!isVisible || !isDocumentVisible) return;
		if (getFileSourceError(fileData) != null) return;
		const files = type.startsWith('image/') ? [fileData]
			: type.startsWith('video/') ? sequence?.frames.map(frame => frame.fileData) ?? [] : [];
		if (files.length === 0) return;
		const urls = files.map(file => getFileSourceUrl(file));
		let active = true;
		let timer: ReturnType<typeof window.setTimeout> | null = null;
		let pendingImage: HTMLImageElement | null = null;
		const prepare = (index: number) => {
			const image = new Image();
			image.src = urls[index];
			pendingImage = image;
			// 保持するデコード画像は表示中と次の1枚だけ。全素材の11枚を常時展開しない。
			const ready = image.decode();
			void ready.catch(() => {});
			return { image, ready };
		};
		const display = async (index: number, prepared: ReturnType<typeof prepare>) => {
			try {
				await prepared.ready;
				if (!active) return;
				imageUrl.value = urls[index];
				pendingImage = null;
				if (files.length === 1) return;
				const nextIndex = (index + 1) % files.length;
				const next = prepare(nextIndex);
				// 次の画像を先読みし、デコード完了前にsrcを変えてちらつかせない。
				timer = window.setTimeout(() => { timer = null; void display(nextIndex, next); }, 500);
			} catch {
				// 表示用画像の失敗は素材本体の利用を妨げず、最後に表示できた画像を維持する。
			}
		};
		onCleanup(() => {
			active = false;
			if (timer != null) window.clearTimeout(timer);
			pendingImage?.removeAttribute('src');
			for (const [index, url] of urls.entries()) releaseFileSourceUrl(files[index], url);
		});
		void display(0, prepare(0));
	}, { immediate: true });
</script>

<style lang="scss" module>
.root {
	position: relative;
	display: flex;
	background: var(--THEME-panel);
	border-radius: 4px 14px 4px 4px;
	corner-shape: bevel;
	overflow: clip;
}

.iconSub {
	position: absolute;
	display: block;
	width: 30px;
	height: 30px;
	margin: 0;
	left: 0;
	top: 0;
	line-height: 30px;
	background: var(--THEME-panel);
}

.externalIcon {
	position: absolute;
	display: block;
	width: 30px;
	height: 30px;
	margin: 0;
	right: 0;
	bottom: 0;
	line-height: 30px;
	background: var(--THEME-panel);
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
	height: 100%;
	display: block;
}
</style>
