<template>
<div class="layers">
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
		addFx(fx) {
			if (fx == '') return;
			this.$store.commit('addLayer', { fx: fx });
		}
	}
});
</script>

<style scoped lang="scss">
.layers {
	> .layers {
		> * {
			margin: 4px;
		}
	}
}
</style>
