<template>
<div class="layers-componet _gs-container">
	<header>
		<select @change="$event => { addFx($event.target.value); $event.target.value = ''; }">
			<option value="" selected disabled>{{ $t('AddEffect') }}...</option>
			<option v-for="k in Object.keys(fxs)" :value="fxs[k].name" :key="fxs[k].name">{{ fxs[k].displayName }}</option>
		</select>
	</header>
	<div class="layers" v-if="layers.length === 0">
		<p class="_gs-no-contents">{{ $t('NoEffects') }}</p>
	</div>
	<XDraggable class="layers" v-else v-model="layers" tag="div" handle=".drag-handle" animation="150" swap-threshold="0.5">
		<XLayer v-for="layer in layers" :layer="layer" :key="layer.id"/>
	</XDraggable>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import uuid from 'uuid/v4';
const XDraggable = require('vuedraggable');
import XLayer from './layer.vue';
import { fxs } from '../glitch/fxs';
import { Layer } from '@/glitch';

export default Vue.extend({
	components: {
		XLayer,
		XDraggable
	},

	data() {
		return {
			fxs: fxs
		};
	},

	computed: {
		layers: {
			get(): Layer[] {
				return (this as any).$store.state.layers;
			},
			set(val): void {
				(this as any).$store.commit('setLayers', { layers: val });
			}
		}
	},

	methods: {
		addFx(fx: string) {
			if (fx == '') return;
			this.$store.commit('addLayer', {
				fx: fx,
				id: uuid()
			});
		}
	}
});
</script>

<style scoped lang="scss">
.layers-componet {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	padding: 8px;

	> header {
		padding-bottom: 8px;
	}

	> .layers {
		flex: 1;
		overflow: auto;
		border: solid 1px rgba(255, 255, 255, 0.1);
		background: rgba(0, 0, 0, 0.3);
		box-shadow: 0 2px 2px rgba(0, 0, 0, 0.7) inset;
		border-radius: 6px;

		> *:not(p) {
			margin: 8px;
		}
	}
}
</style>
