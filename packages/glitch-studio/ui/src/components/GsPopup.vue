<template>
<component :is="popup.component" v-bind="popup.props" v-on="popup.events"/>
</template>

<script setup lang="ts">
import { provide } from 'vue';
import { projectSessionKey } from '@/project-session.ts';
import type { Popup } from '@/ui.ts';

const props = defineProps<{ popup: Popup }>();
// DOMを追加せず、Teleport先でも起点となったセッションを提供する。
// アプリ共通のダイアログはnullを提供し、親の編集対象へ偶然依存させない。
provide(projectSessionKey, props.popup.projectSession);
</script>
