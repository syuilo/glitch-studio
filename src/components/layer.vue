<template>
<div class="layer-component">
	<header>{{ name }}</header>

	<div>
		<div v-for="param in Object.keys(paramDefs)" :key="param">
			<label :class="{ expression: isExpression(param) }" @dblclick="toggleParamValueType(param)">{{ decamelize(param) }}</label>
			<div v-if="isExpression(param)">
				<input type="text" class="expression" :value="getParam(param)" @change="updateParamAsExpression(param, $event.target.value)"/>
			</div>
			<XControl v-else :type="paramDefs[param].type" :value="getParam(param)" @input="updateParamAsLiteral(param, $event)"/>
		</div>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import XControl from './control.vue';
import { fxs } from '../glitch/fxs';
import { ParamDefs } from '../glitch/core';

export default Vue.extend({
	components: {
		XControl
	},

	props: {
		layer: {
			type: Object,
			required: true
		}
	},

	data() {
		return {
			name: null as string | null,
			paramDefs: null as ParamDefs | null
		};
	},

	created() {
		this.name = fxs[this.layer.fx].displayName;
		this.paramDefs = fxs[this.layer.fx].paramDefs;
	},

	methods: {
		isExpression(param: string) {
			const layer = this.$store.state.layers.find((layer: any) => layer.id === this.layer.id)!;
			return layer.params[param].type === 'expression';
		},

		getParam(param: string) {
			const layer = this.$store.state.layers.find((layer: any) => layer.id === this.layer.id)!;
			return layer.params[param].value;
		},

		updateParamAsLiteral(param: string, value: any) {
			this.$store.commit('updateParamAsLiteral', {
				layerId: this.layer.id,
				param: param,
				value: value
			});
		},

		updateParamAsExpression(param: string, value: string) {
			this.$store.commit('updateParamAsExpression', {
				layerId: this.layer.id,
				param: param,
				value: value
			});
		},

		toggleParamValueType(param: string) {
			this.$store.commit('toggleParamValueType', {
				layerId: this.layer.id,
				param: param,
			});
		},

		decamelize(str: string) {
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
				white-space: nowrap;
				text-overflow: ellipsis;
				overflow: hidden;
				font-size: 14px;
				color: rgba(255, 255, 255, 0.9);
				cursor: pointer;

				&.expression {
					color: #9edc29;
				}
			}

			> div {
				width: 70%;
				flex-shrink: 1;
			}
		}
	}
}
</style>
