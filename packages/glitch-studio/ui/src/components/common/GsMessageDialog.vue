<template>
<GsModal ref="modal" :preferType="'dialog'" :zPriority="'high'" @click="onCancel" @closed="emit('closed')" @esc="onCancel">
	<div :class="$style.root">
		<div :class="[$style.icon]">
			<GsSystemIcon v-if="type === 'success'" :class="$style.iconInner" type="success"/>
			<GsSystemIcon v-else-if="type === 'error'" :class="$style.iconInner" type="error"/>
			<GsSystemIcon v-else-if="type === 'warning'" :class="$style.iconInner" type="warn"/>
			<GsSystemIcon v-else-if="type === 'info'" :class="$style.iconInner" type="info"/>
			<GsSystemIcon v-else-if="type === 'question'" :class="$style.iconInner" type="question"/>
		</div>
		<div v-if="title" :class="$style.title" class="_selectable">{{ title }}</div>
		<div v-if="text" :class="$style.text" class="_selectable">{{ text }}</div>
		<div v-if="actions" :class="$style.buttons">
			<GsButton
				v-for="action in actions"
				:key="action.id"
				large
				inline
				:primary="action.primary"
				:danger="action.danger"
				:autofocus="action.isAutofocus"
				@click="onActionClick(action)"
			>{{ action.text }}</GsButton>
		</div>
	</div>
</GsModal>
</template>

<script lang="ts" setup>
import { useTemplateRef } from 'vue';
import GsModal from '@/components/common/GsModal.vue';
import GsButton from '@/components/common/GsButton.vue';
import GsSystemIcon from '@/components/common/GsSystemIcon.vue';

type Action = {
	id: string;
	text: string;
	primary?: boolean;
	danger?: boolean;
	isAutofocus?: boolean;
	isCancel?: boolean;
};

const props = defineProps<{
	type: 'success' | 'error' | 'warning' | 'info' | 'question';
	title: string | null;
	text: string | null;
	actions: Action[];
	canCancel: boolean;
}>();

const emit = defineEmits<{
	(ev: 'done', v: { canceled: boolean, result?: string }): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');

function onActionClick(action: Action) {
	if (action.isCancel === true) {
		onCancel();
	} else {
		emit('done', { canceled: false, result: action.id });
		modal.value?.close();
	}
}

function onCancel() {
	if (props.canCancel) {
		emit('done', { canceled: true });
		modal.value?.close();
	}
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	margin: auto;
	padding: 28px;
	min-width: 320px;
	max-width: 480px;
	box-sizing: border-box;
	text-align: center;
	background: var(--THEME-panel);
	border-radius: 10px;
}

.icon {
	font-size: 24px;

	& + .title {
		margin-top: 8px;
	}
}

.iconInner {
	display: block;
	margin: 0 auto;
	width: 42px;
}

.title {
	margin: 0 0 8px 0;
	font-weight: bold;
	font-size: 120%;

	& + .text {
		margin-top: 8px;
	}
}

.text {
	margin: 8px 0 0 0;
	font-size: 110%;
}

.buttons {
	margin-top: 12px;
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}
</style>
