<template>
<div :class="$style.root">
</div>
</template>

<script lang="ts" setup>
import GsSelect from './common/GsSelect.vue';
import GsInput from './common/GsInput.vue';
import GsButton from './common/GsButton.vue';
import type { GsGroupNode, Macro } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

const props = defineProps<{
}>();

</script>

<style module lang="scss">
.root {

}

</style>
