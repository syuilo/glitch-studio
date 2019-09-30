<template>
<div class="macros-componet _gs-container">
	<div class="macros _gs-container">
		<div v-for="macro in $store.state.macros" :key="macro.id">
			<label :class="{ expression: macro.value.type === 'expression' }" @dblclick="toggleMacroValueType(macro)">{{ macro.label }}</label>
			<div v-if="macro.value.type === 'expression'">
				<input type="text" class="expression" :value="macro.value.value" @change="updateMacroAsExpression(macro, $event.target.value)"/>
			</div>
			<XControl v-else :type="macro.type" :value="macro.value.value" :options="macro.typeOptions" @input="updateMacroAsLiteral(macro, $event)"/>
		</div>
		<p v-if="$store.state.macros.length === 0" class="_gs-no-contents">{{ $t('NoMacros') }}</p>
	</div>
	<div class="macros-editor _gs-container">
		<button @click="addMacro()">{{ $t('AddMacro') }}</button>
		<header>
			<div>{{ $t('_Macro.Label') }}</div>
			<div>{{ $t('_Macro.Name') }}</div>
			<div>{{ $t('_Macro.Type') }}</div>
			<div class="padding"></div>
		</header>
		<div class="list">
			<div v-for="macro in $store.state.macros" :key="macro.id" class="macro" :class="macro.type">
				<div>
					<input type="text" :value="macro.label" @change="updateMacroLabel(macro, $event.target.value)"/>
					<input type="text" :value="macro.name" @change="updateMacroName(macro, $event.target.value)"/>
					<select :value="macro.type" @change="updateMacroType(macro, $event.target.value)">
						<option value="number">{{ $t('_Macro._Types.Number') }}</option>
						<option value="range">{{ $t('_Macro._Types.Range') }}</option>
						<option value="bool">{{ $t('_Macro._Types.Flag') }}</option>
						<option value="color">{{ $t('_Macro._Types.Color') }}</option>
						<option value="image">{{ $t('_Macro._Types.Image') }}</option>
					</select>
					<button class="remove" title="Remove macro" @click="remove(macro.id)"><fa :icon="faTimes"/></button>
				</div>
				<div class="minmax" v-if="['number', 'range'].includes(macro.type)">
					<label>Min/Max</label>
					<div>
						<input type="number" :value="macro.typeOptions.min" @change="updateMacroTypeOption(macro, 'min', parseFloat($event.target.value, 10))"/>
						<input type="number" :value="macro.typeOptions.max" @change="updateMacroTypeOption(macro, 'max', parseFloat($event.target.value, 10))"/>
					</div>
				</div>
				<div class="step" v-if="['number', 'range'].includes(macro.type)">
					<label>Step</label>
					<div>
						<input type="number" :value="macro.typeOptions.step" @change="updateMacroTypeOption(macro, 'step', parseFloat($event.target.value, 10))"/>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts">
import Vue from 'vue';
import uuid from 'uuid/v4';
import { faTimes } from '@fortawesome/free-solid-svg-icons';
import XControl from './control.vue';
import { Macro } from '../glitch/core';

export default Vue.extend({
	components: {
		XControl
	},

	data() {
		return {
			faTimes
		};
	},

	methods: {
		addMacro() {
			this.$store.commit('addMacro', {
				id: uuid()
			});
		},

		updateMacroAsLiteral(macro: Macro, value: any) {
			this.$store.commit('updateMacroAsLiteral', {
				macroId: macro.id,
				value: value
			});
		},

		updateMacroAsExpression(macro: Macro, value: string) {
			this.$store.commit('updateMacroAsExpression', {
				macroId: macro.id,
				value: value
			});
		},

		toggleMacroValueType(macro: Macro) {
			this.$store.commit('toggleMacroValueType', {
				macroId: macro.id,
			});
		},

		updateMacroLabel(macro: Macro, value: string) {
			this.$store.commit('updateMacroLabel', {
				macroId: macro.id,
				value: value
			});
		},

		updateMacroName(macro: Macro, value: string) {
			this.$store.commit('updateMacroName', {
				macroId: macro.id,
				value: value
			});
		},

		updateMacroType(macro: Macro, value: string) {
			this.$store.commit('updateMacroType', {
				macroId: macro.id,
				value: value
			});
		},

		updateMacroTypeOption(macro: Macro, key: string, value: any) {
			this.$store.commit('updateMacroTypeOption', {
				macroId: macro.id,
				key: key,
				value: value
			});
		},

		remove(macroId: string) {
			this.$store.commit('removeMacro', {
				macroId: macroId,
			});
		}
	}
});
</script>

<style scoped lang="scss">
.macros-componet {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	padding: 8px;

	> .macros {
		flex: 1;
		padding: 0 16px;
		margin-bottom: 8px;
		overflow: auto;

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

	> .macros-editor {
		flex: 1;
		padding: 8px;
		overflow: auto;

		> header {
			display: flex;
			font-size: 12px;
			margin: 12px 0 0 0;
			opacity: 0.8;

			> * {
				width: 100%;
				margin: 0 2px;
				padding: 0 2px;

				&:first-child {
					margin-left: 0;
				}

				&:last-child {
					margin-right: 0;
				}
			}

			> .padding {
				width: 64px;
			}
		}

		> .list {
			> .macro {
				padding: 8px 0;

				&:not(:first-child) {
					border-top: solid 1px rgba(255, 255, 255, 0.05);
				}

				&:not(:last-child) {
					border-bottom: solid 1px rgba(0, 0, 0, 0.5);
				}

				> div:first-child {
					display: flex;

					> * {
						margin: 0 2px;

						&:first-child {
							margin-left: 0;
						}

						&:last-child {
							margin-right: 0;
						}

						&.remove {
							width: 64px;
						}
					}
				}

				> div:not(:first-child) {
					display: flex;
					padding: 8px 0;

					> label {
						width: 30%;
						box-sizing: border-box;
						padding-left: 8px;
						padding-top: 4px;
						padding-right: 8px;
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

				&.range {
					> .minmax > div {
						display: flex;

						> *:first-child {
							margin-right: 4px;
						}
					}
				}
			}
		}
	}
}
</style>
