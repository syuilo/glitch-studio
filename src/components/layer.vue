<template>
<div class="layer-component">
	<header>{{ name }}</header>

	<div>
		<div v-for="param in Object.keys(paramDef)" :key="param">
			<label>{{ decamelize(param) }}</label>
			<div v-if="paramDef[param].type === 'range'">
				<input type="number" :value="getParam(param)" step="1" @change="updateParam(param, parseInt($event.target.value, 10))"/>
			</div>
			<div v-if="paramDef[param].type === 'number'">
				<input type="number" :value="getParam(param)" @change="updateParam(param, parseInt($event.target.value, 10))"/>
			</div>
			<div v-if="paramDef[param].type === 'bool'">
				<button @click="updateParam(param, !getParam(param))">{{ getParam(param) ? 'On' : 'Off' }}</button>
			</div>
			<div v-if="paramDef[param].type === 'enum'">
				<select :value="getParam(param)" @change="updateParam(param, $event.target.value)">
					<option v-for="o in paramDef[param].options" :value="o" :key="o">{{ decamelize(o) }}</option>
				</select>
			</div>
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
		getParam(param: string) {
			const layer = this.$store.state.layers.find(layer => layer.id === this.layer.id)!;
			return layer.params[param];
		},

		updateParam(param: string, value: any) {
			this.$store.commit('updateParam', {
				layerId: this.layer.id,
				param: param,
				value: value
			});
		},

		decamelize(str){
			return str[0].toUpperCase() + str.substr(1)
				.replace(/([a-z\d])([A-Z])/g, '$1 $2')
				.replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1 $2')
				.toLowerCase();
		}
	}
});
</script>

<style scoped lang="scss">
.layer-component {
	background: rgba(255, 255, 255, 0.1);
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
	overflow: hidden;

	> header {
		padding: 8px 16px;
		font-size: 14px;
		font-weight: bold;
		background: linear-gradient(0deg, rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.025));
		border-bottom: solid 1px rgba(0, 0, 0, 0.5);
	}

	> div {
		background: rgba(0, 0, 0, 0.3);
		padding: 0 16px;

		> div {
			display: flex;
			padding: 8px 0;

			&:not(:first-child) {
				border-top: solid 1px rgba(255, 255, 255, 0.05);
			}

			&:not(:last-child) {
				border-bottom: solid 1px rgba(0, 0, 0, 0.5);
			}

			> label {
				width: 30%;
				box-sizing: border-box;
				padding-top: 4px;
				padding-right: 4px;
				flex-shrink: 0;
				text-overflow: ellipsis;
				overflow: hidden;
				font-size: 14px;
				color: rgba(255, 255, 255, 0.9);
			}

			> div {
				width: 70%;
				flex-shrink: 1;
			}
		}
	}
}
</style>
