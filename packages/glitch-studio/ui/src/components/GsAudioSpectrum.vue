<template><GsAudioMonitor v-model:overlay="overlay" mode="spectrum"/></template>

<script lang="ts" setup>
import GsAudioMonitor from './GsAudioMonitor.vue';
const overlay = defineModel<boolean>('overlay', { default: true });
</script>
