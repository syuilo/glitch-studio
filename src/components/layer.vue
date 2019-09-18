<template>
<div class="layer-component">
	<header class="drag-handle" :class="{ disabled: rendering }" @dblclick="minimized = !minimized">{{ name }}</header>
	<div class="indicator" :class="{ active: layer.isEnabled, processing }"></div>
	<div class="buttons" :class="{ disabled: rendering }">
		<button class="randomize" @click="randomize()" title="Randomize"><fa :icon="faRandom"/></button>
		<button class="active" :class="{ primary: layer.isEnabled }" @click="toggleEnable()" :title="layer.isEnabled ? 'Click to disable' : 'Click to enable'"><fa :icon="layer.isEnabled ? faEye : faEyeSlash"/></button>
		<button class="remove" @click="remove()" title="Remove effect"><fa :icon="faTimes"/></button>
	</div>

	<div class="params" v-show="!minimized" :class="{ disabled: rendering }">
		<div v-for="param in Object.keys(paramDefs)" :key="param">
			<label :class="{ expression: isExpression(param) }" @dblclick="toggleParamValueType(param)">{{ paramDefs[param].label }}</label>
			<div v-if="isExpression(param)">
				<input type="text" class="expression" :value="getParam(param)" @change="updateParamAsExpression(param, $event.target.value)"/>
			</div>
			<XControl v-else :type="paramDefs[param].type" :options="paramDefs[param]" :value="getParam(param)" @input="updateParamAsLiteral(param, $event)"/>
		</div>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import { faTimes, faRandom } from '@fortawesome/free-solid-svg-icons';
import { faEye, faEyeSlash } from '@fortawesome/free-regular-svg-icons';
import XControl from './control.vue';
import { fxs } from '../glitch/fxs';
import { ParamDefs } from '../glitch/core';
import { Layer } from '../glitch';

export default Vue.extend({
	components: {
		XControl
	},

	props: {
		layer: {
			type: Object,
			required: true
		},

		processing: {
			type: Boolean,
			required: true,
		},

		rendering: {
			type: Boolean,
			required: true,
		},
	},

	data() {
		return {
			name: null as string | null,
			paramDefs: null as ParamDefs | null,
			minimized: false,
			faTimes, faEye, faEyeSlash, faRandom
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

		remove() {
			this.$store.commit('removeLayer', {
				layerId: this.layer.id,
			});
		},

		toggleEnable() {
			this.$store.commit('toggleEnable', {
				layerId: this.layer.id,
			});
		},

		randomize() {
			const rnd = () => 1 - Math.sqrt(Math.random());
			const blendModes = [
				'none',
				'normal',
				'darken',
				'multiply',
				'colorBurn',
				'lighten',
				'screen',
				'colorDodge',
				'overlay',
				'softLight',
				'hardLight',
				'difference',
				'exclusion',
				'hue',
				'saturation',
				'color',
				'luminosity',
			];
			const params = {} as Layer['params'];
			for (const [k, p] of Object.entries(this.paramDefs!)) {
				const set = (v: any) => {
					params[k] = {
						type: 'literal',
						value: v
					};
				};

				if (p.type === 'number') {
					set(Math.floor(rnd() * 2048));
				} else if (p.type === 'range') {
					set(Math.floor(Math.random() * ((p as any)['max'] - (p as any)['min']) + (p as any)['min']));
				} else if (p.type === 'enum') {
					set((p as any)['options'][Math.floor(Math.random() * (p as any)['options'].length)].value);
				} else if (p.type === 'bool') {
					set(Math.floor(Math.random() * 2) === 0);
				} else if (p.type === 'blendMode') {
					set(blendModes[Math.floor(Math.random() * blendModes.length)]);
				} else if (p.type === 'signal') {
					set([Math.floor(Math.random() * 2) === 0, Math.floor(Math.random() * 2) === 0, Math.floor(Math.random() * 2) === 0]);
				} else if (p.type === 'xy') {
					set([Math.floor(rnd() * 1024), Math.floor(rnd() * 1024)]);
				} else if (p.type === 'wh') {
					set([Math.floor(rnd() * 2048), Math.floor(rnd() * 2048)]);
				}
			}
			this.$store.commit('updateParams', {
				layerId: this.layer.id,
				params: params,
			});
		},
	}
});
</script>

<style scoped lang="scss">
.layer-component {
	position: relative;
	background: rgba(255, 255, 255, 0.1);
	border: solid 1px rgba(255, 255, 255, 0.1);
	border-radius: 4px;
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
	overflow: hidden;

	> header {
		padding: 0 16px;
		font-size: 14px;
		font-weight: bold;
		background: linear-gradient(0deg, rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.025));
		border-bottom: solid 1px rgba(0, 0, 0, 0.5);
		cursor: move;
		line-height: 32px;
		text-shadow: 0 -1px #000;

		&.disabled {
			pointer-events: none;
		}
	}

	> .indicator {
		position: absolute;
		top: 9px;
		left: 6px;
		width: 4px;
		height: 12px;
		border-top: solid 1px transparent;
		border-bottom: solid 1px #383838;
		background: #111;
		box-shadow: 0px 1px 1px rgba(0, 0, 0, 0.3) inset;
		border-radius: 2px;

		&.active {
			background: #26cfe0;
			background-clip: content-box;
		}

		&.processing {
			background: #ff0;
			background-clip: content-box;
		}
	}

	> .buttons {
		position: absolute;
		top: 4px;
		right: 4px;
		text-align: right;
		width: 85px;

		&.disabled {
			opacity: 0.7;
			pointer-events: none;
		}

		> button {
			display: inline-block;
			width: 23px;
			height: 23px;
			font-size: 12px;
			padding-left: 0;
			padding-right: 0;

			&:not(:first-child) {
				margin-left: 6px;
			}

			> * {
				height: 100%;
			}
		}
	}

	> .params {
		background: rgba(0, 0, 0, 0.3);
		padding: 0 16px;

		&.disabled {
			opacity: 0.7;
			pointer-events: none;
		}

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
