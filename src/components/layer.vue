<template>
<div class="layer">
	<header>{{ layer.fx }}</header>

	<div v-for="param in Object.keys(paramDef)" :key="param">
		<label>{{ param }}</label>
		<template v-if="paramDef[param].type === 'range'">
			<input type="range" step="1" @change="updateParam(param, $event.target.value)"/>
		</template>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import { fxs } from '../glitch/fxs';

export default Vue.extend({
	props: {
		layer: {
			required: true
		}
	},

	data() {
		return {
			paramDef: null
		};
	},

	created() {
		this.paramDef = fxs[this.layer.fx].paramDef;
	},

	methods: {
		updateParam(param: string, value: any) {
			this.$store.commit('updateParam', {
				layerId: this.layer.id,
				param: param,
				value: value
			});
		}
	}
});
</script>

<style scoped lang="scss">
.layer {
	border: solid 1px rgba(255, 255, 255, 0.1);

	> header {

	}
}
</style>
