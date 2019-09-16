import Vue from 'vue';
import Vuex from 'vuex';
import uuid from 'uuid/v4';
import { Layer } from './glitch';
import { fxs } from './glitch/fxs';
import { genEmptyValue, Macro } from './glitch/core';

export const store = () => new Vuex.Store({
	state: {
		macros: [] as Macro[],
		layers: [] as Layer[],
	},

	mutations: {
		addLayer(state, payload) {
			const paramDefs = fxs[payload.fx].paramDefs;
			
			const params = {} as Layer['params'];

			for (const [k, v] of Object.entries(paramDefs)) {
				params[k] = v.default;
			}

			state.layers.push({
				id: uuid(),
				fx: payload.fx,
				params: params
			});
		},

		toggleValueType(state, payload) {
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			const isLiteral = layer.params[payload.param].type === 'literal';
			if (isLiteral) {
				Vue.set(layer.params, payload.param, {
					type: 'expression',
					value: ''
				});
			} else {
				Vue.set(layer.params, payload.param, {
					type: 'literal',
					value: genEmptyValue(fxs[layer.fx].paramDefs[payload.param])
				});
			}
		},

		updateParamAsLiteral(state, payload) {
			console.debug('UPDATE', payload.param, payload.value);
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer.params, payload.param, {
				type: 'literal',
				value: payload.value
			});
		},

		updateParamAsExpression(state, payload) {
			console.debug('UPDATE', payload.param, payload.value);
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer.params, payload.param, {
				type: 'expression',
				value: payload.value
			});
		},
	}
});
