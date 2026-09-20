<template>
<GsModal ref="modal" preferType="dialog" @closed="emit('closed')">
	<div>
		<div>
			<input v-model="name" type="text"/>
		</div>
		<footer>
			<button @click="cancel()">Cancel</button>
			<button class="primary" @click="save()">Export</button>
		</footer>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef } from 'vue';
import { encode } from '@msgpack/msgpack';
import { genId } from '@glitch/shared/utility/id.ts';
import GsModal from './common/GsModal.vue';
import * as api from '@/api.ts';

const modal = useTemplateRef('modal');

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const name = ref('');

async function save() {
	const data = encode({
		id: genId(),
		gsVersion: _VERSION_,
		name: name.value,
		nodes: store.nodes,
		assets: await api.encodeAssets(store.assets),
	});
	await api.saveFile({
		defaultPath: name.value,
		filters: [{
			name: 'Glitch Studio Preset',
			extensions: ['gsp'],
		}],
	}, data);
	ok();
}

function cancel() {
	ok();
}

function ok() {
	modal.value!.close();
}
</script>
