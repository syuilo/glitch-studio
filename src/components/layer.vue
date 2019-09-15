<template>
<div class="layer">
	<header>{{ name }}</header>

	<div>
		<div v-for="param in Object.keys(paramDef)" :key="param">
			<label>{{ param }}</label>
			<template v-if="paramDef[param].type === 'range'">
				<input type="range" step="1" @change="updateParam(param, $event.target.value)"/>
			</template>
		</div>
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
			name: null,
			paramDef: null
		};
	},

	created() {
		this.name = fxs[this.layer.fx].displayName;
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
	border-radius: 4px;
	box-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
	overflow: hidden;

	> header {
		padding: 8px;
		background: linear-gradient(0deg, rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.025));
		border-bottom: solid 1px rgba(0, 0, 0, 0.5);
	}

	> div {
		padding: 8px;
		background: rgba(0, 0, 0, 0.3);
	}
}
</style>
