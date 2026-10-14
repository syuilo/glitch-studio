<template>
<GsModalWindow
	ref="dialog"
	:width="800"
	:height="500"
	:withOkButton="true"
	:okButtonDisabled="selected.length === 0"
	@click="cancel()"
	@close="cancel()"
	@esc="cancel()"
	@ok="ok()"
	@closed="emit('closed')"
>
	<template #header>
		{{ multiple ? 'Select Assets' : 'Select Asset' }}
		<span v-if="selected.length > 0" style="margin-left: 8px; opacity: 0.5;">({{ selected.length }})</span>
	</template>
	<GsAssets :multiple="multiple" :mimeType="mimeType" select="asset" @changeSelectedAssets="onChangeSelection"/>
</GsModalWindow>
</template>

<script lang="ts" setup>
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { ref, useTemplateRef } from 'vue';
import GsAssets from './GsAssets.vue';
import GsModalWindow from './common/GsModalWindow.vue';
import type { ProjectAsset } from '@/Project.ts';

withDefaults(defineProps<{
	multiple: boolean;
	mimeType: string | null;
}>(), {
});

const emit = defineEmits<{
	(ev: 'done', r?: ProjectAsset[]): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const selected = ref<ProjectAsset[]>([]);

function ok() {
	emit('done', deepClone(selected.value)); // selected.valueをそのまま渡すと純粋なオブジェクトではなくProxyが渡されてしまい、シチュエーションによってはそれによって不具合の原因になる(workerにpostMessageで渡せないなど)
	dialog.value?.close();
}

function cancel() {
	emit('done');
	dialog.value?.close();
}

function onChangeSelection(v: ProjectAsset[]) {
	selected.value = v;
}
</script>
