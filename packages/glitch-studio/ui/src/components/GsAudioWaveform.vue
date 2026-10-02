<template><GsAudioMonitor v-model:overlay="overlay" mode="waveform"/></template>
<script lang="ts" setup>
import GsAudioMonitor from './GsAudioMonitor.vue';
const overlay = defineModel<boolean>('overlay', { default: false });
</script>
