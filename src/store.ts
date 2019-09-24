import Vue from 'vue';
import Vuex from 'vuex';
import { Layer } from './glitch';
import { fxs } from './glitch/fxs';
import { genEmptyValue, Macro, Asset } from './glitch/core';
import { Preset } from './settings';
import { decodeAssets } from './decode-assets';

export const store = () => new Vuex.Store({
	state: {
		macros: [] as Macro[],
		layers: [] as Layer[],
		assets: [] as Asset[],
	},

	mutations: {
		// for vuex-undo-redo
		emptyState() {
			this.replaceState({
				macros: [],
				layers: [],
				assets: [],
			});
		},

		init(state) {
			Vue.set(state, 'layers', []);
			Vue.set(state, 'macros', []);
			Vue.set(state, 'assets', []);
		},
		
		addLayer(state, payload) {
			const paramDefs = fxs[payload.fx].paramDefs;
			
			const params = {} as Layer['params'];

			for (const [k, v] of Object.entries(paramDefs)) {
				params[k] = v.default;
			}

			state.layers.push({
				id: payload.id,
				isEnabled: true,
				fx: payload.fx,
				params: params,
			});
		},

		removeLayer(state, payload) {
			Vue.set(state, 'layers', state.layers.filter(layer => layer.id !== payload.layerId));
		},

		toggleEnable(state, payload) {
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer, 'isEnabled', !layer.isEnabled);
		},

		setLayers(state, payload) {
			Vue.set(state, 'layers', payload.layers);
		},

		addMacro(state, payload) {
			state.macros.push({
				id: payload.id,
				type: 'number',
				typeOptions: {},
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

		updateParams(state, payload) {
			const layer = state.layers.find(layer => layer.id === payload.layerId)!;
			Vue.set(layer, 'params', payload.params);
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

		updateMacroTypeOption(state, payload) {
			const macro = state.macros.find(macro => macro.id === payload.macroId)!;
			Vue.set(macro.typeOptions, payload.key, payload.value);
		},

		removeMacro(state, payload) {
			Vue.set(state, 'macros', state.macros.filter(macro => macro.id !== payload.macroId));
		},

		applyPreset(state, payload: Preset) {
			//#region 後方互換性のため
			const layers = [] as Layer[];

			for (const layer of payload.layers) {
				const paramDefs = fxs[layer.fx].paramDefs;
			
				const defaults = {} as Layer['params'];
	
				for (const [k, v] of Object.entries(paramDefs)) {
					defaults[k] = v.default;
				}
	
				layers.push({
					id: layer.id,
					fx: layer.fx,
					isEnabled: layer.isEnabled,
					params: {
						...defaults,
						...layer.params
					}
				});
			}
			//#endregion

			const assets = decodeAssets(payload.assets || []);

			Vue.set(state, 'layers', layers);
			Vue.set(state, 'macros', payload.macros);
			Vue.set(state, 'assets', assets);
		},

		addAsset(state, payload) {
			state.assets.push({
				id: payload.id,
				name: payload.name,
				width: payload.width,
				height: payload.height,
				data: payload.data,
				buffer: payload.buffer,
			});
		},

		renameAsset(state, payload) {
			const asset = state.assets.find(asset => asset.id === payload.assetId)!;
			Vue.set(asset, 'name', payload.name);
		},

		replaceAsset(state, payload) {
			const asset = state.assets.find(asset => asset.id === payload.assetId)!;
			Vue.set(asset, 'width', payload.width);
			Vue.set(asset, 'height', payload.height);
			Vue.set(asset, 'data', payload.data);
			Vue.set(asset, 'buffer', payload.buffer);
		},

		removeAsset(state, payload) {
			Vue.set(state, 'assets', state.assets.filter(asset => asset.id !== payload.assetId));

			// そのAssetを参照しているパラメータをnullにする
			for (const layer of state.layers) {
				const imageParams = Object.entries(fxs[layer.fx].paramDefs).filter(([k, v]) => v.type === 'image').map(([k, v]) => k);
				for (const p of imageParams) {
					if (layer.params[p].type === 'literal' && layer.params[p].value === payload.assetId) {
						Vue.set(layer.params[p], 'value', null);
					}
				}
			}

			// そのAssetを参照しているマクロをnullにする
			for (const macro of state.macros.filter(m => m.type === 'image' && m.value.type === 'literal')) {
				Vue.set(macro, 'value', null);
			}
		},
	}
});
