<template>
<div :class="$style.root">
	<div :class="$style.macros">
		<div v-for="macro in appContext.state.macros.value" :key="macro.id" :class="$style.macro" data-wire-input-row>
			<label :class="[$style.macroLabel, { [$style.expression]: macro.value.type === 'expression' }]" @dblclick="toggleMacroValueType(macro)">{{ macro.label }}</label>
			<div v-if="macro.value.type === 'expression'" :class="$style.macroControl">
				<input type="text" :class="$style.expression" :value="macro.value.value" @change="updateMacroAsExpression(macro, $event.target.value)"/>
			</div>
			<GsEffectParamControl
				v-else
				:class="$style.macroControl"
				:type="macro.type"
				:value="macro.value.value"
				:options="macro.typeOptions"
				:title="macro.label"
				@input="updateMacroAsLiteral(macro, $event)"
				@beginChanging="onBeginChanging(macro)"
				@changeContinuous="changeContinuous(macro, $event)"
				@changeFinished="onFinishChanging(macro)"
			/>
		</div>
		<p v-if="appContext.state.macros.value.length === 0" class="_gs-no-contents">{{ i18n.ts.NoMacros }}</p>
	</div>
	<div :class="$style.editor">
		<GsButton @click="addMacro()">{{ i18n.ts.AddMacro }}</GsButton>
		<header :class="$style.editorHeader">
			<div :class="$style.headerCell">{{ i18n.ts._Macro.Label }}</div>
			<div :class="$style.headerCell">{{ i18n.ts._Macro.Name }}</div>
			<div :class="$style.headerCell">{{ i18n.ts._Macro.Type }}</div>
			<div :class="[$style.headerCell, $style.headerSpacer]"></div>
		</header>
		<div>
			<GsMacroEditor v-for="macro in appContext.state.macros.value" :key="macro.id" :macro="macro"/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { genId } from '@glitch/shared/utility/id.ts';
import GsEffectParamControl from './GsEffectParamControl.vue';
import GsMacroEditor from './GsMacroEditor.vue';
import GsButton from './common/GsButton.vue';
import type { Macro } from '@glitch/shared/types.ts';
import { appContext } from '@/app.ts';
import { i18n } from '@/i18n.ts';

function addMacro() {
	appContext.commit('addMacro', {
		id: genId(),
	});
}

let commandMergeKey: string | null = null;

function onBeginChanging(macro: Macro) {
	commandMergeKey = genId();
}

function changeContinuous(macro: Macro, value: any) {
	appContext.commit('updateMacroAsLiteral', {
		macroId: macro.id,
		value: value,
	}, commandMergeKey);
}

function onFinishChanging(macro: Macro) {
	commandMergeKey = null;
}

function updateMacroAsLiteral(macro: Macro, value: any) {
	appContext.commit('updateMacroAsLiteral', {
		macroId: macro.id,
		value: value,
	});
}

function updateMacroAsExpression(macro: Macro, value: string) {
	appContext.commit('updateMacroAsExpression', {
		macroId: macro.id,
		value: value,
	});
}

function toggleMacroValueType(macro: Macro) {
	appContext.commit('toggleMacroValueType', {
		macroId: macro.id,
	});
}
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	height: 100%;
	padding: 8px;
}

.macros {
	flex: 1;
	padding: 0 16px;
	margin-bottom: 8px;
	overflow: auto;
}

.macro {
	display: flex;
	padding: 8px 0;

	&:not(:first-child) {
		border-top: solid 1px #0006;
	}
}

.macroLabel {
	width: 30%;
	box-sizing: border-box;
	padding-top: 4px;
	padding-right: 4px;
	flex-shrink: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: hidden;
	cursor: pointer;

	&.expression {
		color: var(--THEME-expression);
	}
}

.macroControl {
	width: 70%;
	flex-shrink: 1;
}

.editor {
	flex: 1;
	padding: 8px;
	overflow: auto;
}

.editorHeader {
	display: flex;
	font-size: 90%;
	margin: 12px 0 0 0;
	opacity: 0.8;
}

.headerCell {
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

.headerSpacer {
	width: 64px;
}
</style>
