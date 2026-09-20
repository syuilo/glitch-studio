<template>
<div :class="$style.root">
	<div :class="$style.header"><GsCondensedLine>{{ player.name }}</GsCondensedLine></div>
	<button class="_button" :class="$style.menuButton" @click="showMenu"><i class="ti ti-dots"></i></button>
	<div :class="$style.body">
		<GsVideoControls
			v-if="videoEl != null" :video="videoEl" :class="$style.videoControl"
			:play="() => engine.playPlayer(player.id)"
		/>
		<div :class="$style.levelMeter"><GsAudioLevelMeter :orientation="'vertical'" :levels="engine.getPlayerLevels(player.id)"/></div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import GsButton from './common/GsButton.vue';
import GsVideoControls from './common/GsVideoControls.vue';
import GsAudioLevelMeter from './common/GsAudioLevelMeter.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import type { Player } from '@glitch/shared/types.ts';
import { i18n } from '@/i18n.ts';
import * as api from '@/api.ts';
import * as ui from '@/ui.ts';
import { appContext, engine } from '@/app.ts';

const props = defineProps<{
	player: Player;
}>();

const videoEl = computed(() => engine.getMediaElement(props.player.id));

function remove() {
	//appContext.commit('removePlayer', {
	//	playerId: props.player.id,
	//});
}

async function rename() {
	//const { canceled, result } = await inputDialog({ default: props.asset.name });
	//if (canceled) return;
	//appContext.commit('renamePlayer', {
	//	playerId: props.player.id,
	//	name: result,
	//});
}

function showMenu(ev: PointerEvent) {
	ui.popupMenu([{
		text: 'Webcam',
		icon: 'ti ti-camera',
		active: props.player.sourceType === 'webcam',
		action: () => {
			if (props.player.sourceType === 'webcam') return;
			appContext.commit('updatePlayerSourceType', {
				playerId: props.player.id,
				sourceType: 'webcam',
			});
		},
	}], ev.currentTarget ?? ev.target);
}

</script>

<style module lang="scss">
.root {
	position: relative;
	border-radius: 4px;
	overflow: clip;
	background: var(--THEME-panel);
}

.header {
	padding: 0 32px 0 8px;
	white-space: nowrap;
	overflow: clip;
	text-overflow: ellipsis;
	font-weight: bold;
	line-height: 32px;
	font-size: 95%;
}

.menuButton {
	position: absolute;
	top: 4px;
	right: 4px;
	width: 28px;
	height: 28px;
	font-size: 90%;
}

.body {
	display: flex;
	flex-direction: row;
	gap: 16px;
	height: 120px;
	padding: 6px 12px 12px 12px;
}

.videoControl {
	flex: 1;
	min-height: 0;
	width: 100%;
}

.levelMeter {
	width: 16px;
	height: 100%;
}
</style>
