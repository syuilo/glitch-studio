<template>
<GsModal ref="modal" :preferType="'dialog'" :zPriority="'high'" @closed="emit('closed')">
	<div :class="[$style.root]" class="_gaps_l">
		<div v-if="text" :class="$style.text">{{ text }}<GsEllipsis/></div>
		<GsProgressBar :progress="props.progress"/>
		<GsProgressBar v-if="props.subProgress !== undefined" :progress="props.subProgress"/>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { watchPostEffect, useTemplateRef } from 'vue';
import GsModal from './GsModal.vue';
import GsProgressBar from './GsProgressBar.vue';
import GsEllipsis from './GsEllipsis.vue';

const modal = useTemplateRef('modal');
let finished = false;

const props = defineProps<{
	progress: number | null; // nullでwaiting状態を表す
	subProgress?: number | null | undefined; // nullでwaiting状態を表す。undefinedは未設定を表す
	showing: boolean;
	text?: string | null;
}>();

const emit = defineEmits<{
	(ev: 'done'): void;
	(ev: 'closed'): void;
}>();

function done() {
	const currentModal = modal.value;
	if (finished || currentModal == null) return;
	finished = true;
	emit('done');
	currentModal.close();
}

// 同期で終わる処理では、初回描画時点でshowing=falseになっている。
// 値の変化だけを監視せず、初回も含めて描画後にModalの参照を得てから閉じる。
watchPostEffect(() => {
	if (!props.showing) done();
});
</script>

<style lang="scss" module>
.root {
	margin: auto;
	position: relative;
	padding: 32px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-panel);
	border-radius: 8px;
	width: 300px;
}

.text {
}
</style>
