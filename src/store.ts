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

		addMacro(state) {
			state.macros.push({
				id: uuid(),
				type: 'number',
				label: 'Macro',
				name: 'macro',
				value: {
					type: 'literal',
					value: 0
				}
			});
		},

		toggleParamValueType(state, payload) {
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
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer.params, payload.param, {
				type: 'literal',
				value: payload.value
			});
		},

		updateParamAsExpression(state, payload) {
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer.params, payload.param, {
				type: 'expression',
				value: payload.value
			});
		},

		toggleMacroValueType(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			const isLiteral = macro.value.type === 'literal';
			if (isLiteral) {
				Vue.set(macro, 'value', {
					type: 'expression',
					value: ''
				});
			} else {
				Vue.set(macro, 'value', {
					type: 'literal',
					value: genEmptyValue(macro)
				});
			}
		},

		updateMacroAsLiteral(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			Vue.set(macro, 'value', {
				type: 'literal',
				value: payload.value
			});
		},

		updateMacroAsExpression(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			Vue.set(macro, 'value', {
				type: 'expression',
				value: payload.value
			});
		},

		updateMacroLabel(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			Vue.set(macro, 'label', payload.value);
		},

		updateMacroName(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			Vue.set(macro, 'name', payload.value);
		},

		updateMacroType(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			Vue.set(macro, 'type', payload.value);
		},
	}
});
