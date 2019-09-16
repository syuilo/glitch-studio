<template>
<div class="layers-componet">
	<header>
		<select @change="$event => { addFx($event.target.value); $event.target.value = ''; }">
			<option value="" selected disabled>Add FX...</option>
			<option v-for="k in Object.keys(fxs)" :value="fxs[k].name" :key="fxs[k].name">{{ fxs[k].displayName }}</option>
		</select>
	</header>
	<div class="layers">
		<XLayer v-for="layer in $store.state.layers" :layer="layer" :key="layer.id"/>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import XLayer from './layer.vue';
import { fxs } from '../glitch/fxs';

export default Vue.extend({
	components: {
		XLayer
	},

	data() {
		return {
			fxs: fxs
		};
	},

	methods: {
		addFx(fx: string) {
			if (fx == '') return;
			this.$store.commit('addLayer', { fx: fx });
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
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
	overflow: hidden;

	> header {
		padding-bottom: 8px;
	}

	> .layers {
		flex: 1;
		overflow: auto;
		border: solid 1px rgba(255, 255, 255, 0.1);
		background: rgba(0, 0, 0, 0.3);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.5) inset;
		border-radius: 6px;

		> * {
			margin: 8px;
		}
	}
}
</style>
