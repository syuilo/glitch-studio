<template>
<div :class="$style.root">
	<div :class="$style.players">
		<div v-for="player in appStateManager.state.players.value" :key="player.id" :class="$style.player">
			<GsPlayer :player="player"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@glitch/shared/utility/id.ts';
import GsButton from './common/GsButton.vue';
import GsPlayer from './GsPlayer.vue';
import { appStateManager } from '@/app.ts';
import { i18n } from '@/i18n.ts';

</script>

<style module lang="scss">
.root {

}

.players {
	display: flex;
	flex-direction: column;
	overflow: auto;
	padding: 8px;
	gap: 8px;
}
</style>
