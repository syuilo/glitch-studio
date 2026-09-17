<template>
<div :class="$style.root" data-wire-input-row>
	<div :class="[$style.paramLabel, { [$style.expression]: paramValue.type === 'expression' }]" @click="showMenu">
		<GsCondensedLine>{{ paramDef.label }}</GsCondensedLine>
	</div>
	<div :class="$style.paramBody">
		<GsNodePort v-if="paramDef.canNode" :dataType="getNodeInputDataType(paramDef)" @update:element="portEl = $event"/>
		<i v-if="hasNodeInputTypeMismatch(appContext.state.nodes.value, getInnerValue())" v-tooltip="'Data type mismatch'" class="ti ti-alert-triangle" :class="$style.typeWarning"></i>

		<div style="flex: 1;">
			<GsInput v-if="paramValue.type === 'expression'" type="text" :modelValue="getInnerValue()" @update:modelValue="updateParamAsExpression">
				<template #caption>
					<div v-if="isExpressionSyntaxError" style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> Syntax error!</div>
				</template>
			</GsInput>
			<GsButton v-else-if="paramValue.type === 'automation'" @click="selectAutomation">{{ paramValue.automationId ? appContext.state.automations.value.find(a => a.id === node.params[param].automationId).name : '(none)' }}</GsButton>
			<div v-else-if="paramValue.type === 'node'">
				<GsSelect
					small
					style="flex: 1; min-width: 0;"
					:modelValue="nodeOutputKey(paramValue)"
					:items="[{ label: i18n.ts.None, value: null }, ...getNodeOutputItems(appContext.state.nodes.value, props.node.id)]"
					@update:modelValue="updateParamAsNode"
				/>
			</div>
			<GsEffectParamControl
				v-else
				:type="paramDef.type"
				:title="paramDef.label"
				:options="paramDef"
				:value="getInnerValue()"
				@input="updateParamAsLiteral"
				@beginChanging="onBeginChanging"
				@changeContinuous="changeContinuous"
				@changeFinished="onFinishChanging"
			/>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, shallowRef, watchEffect } from 'vue';
import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@glitch/shared/utility/node-outputs.ts';
import * as AiScript from '@syuilo/aiscript';
import GsNodePort from './GsNodePort.vue';
import GsEffectParamControl from './GsEffectParamControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import GsSelect from './common/GsSelect.vue';
import type { ComponentPublicInstance } from 'vue';
import type { EffectParamDef, EffectParamValue, GsAutomation, GsEffectNode, GsGroupNode, GsNode } from '@glitch/shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { appContext, wireMap } from '@/app.ts';
import { getNodeOutputItems, hasNodeInputTypeMismatch, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{
	node: GsEffectNode;
	paramDef: EffectParamDef;
	paramValue: EffectParamValue;
}>();

const allInPortEl = shallowRef<HTMLElement | null>(null);
const paramRows = ref<Record<string, HTMLElement>>({});
const nodeOutputItems = computed(() => getNodeOutputItems(appContext.state.nodes.value, props.node.id));

function setParamRow(param: string, el: Element | ComponentPublicInstance | null) {
	if (el instanceof HTMLElement) paramRows.value[param] = el;
	else delete paramRows.value[param];
}

/*
watchEffect(onCleanup => {
	for (const [param, row] of Object.entries(paramRows.value)) {
		// node型の入力はコントロール側で登録する。それ以外もcanNodeなら型ごと切り替えられる。
		if (!paramDef.canNode || isNode(param)) continue;
		onCleanup(registerWireInput(row, connection => {
			appContext.commit('updateParamAsNode', { nodeId: props.node.id, param, value: connection });
		}, connection => {
			const output = nodeOutputItems.value.find(item => item.value === nodeOutputKey(connection));
			return output ? areNodeDataTypesCompatible(output.dataType, getNodeInputDataType(paramDef)) : null;
		}));
	}
});
*/

const aisParser = new AiScript.Parser();

const isExpressionSyntaxError = computed(() => {
	if (props.paramValue.type !== 'expression') return false;
	try {
		aisParser.parse(props.paramValue.expression);
	} catch (err) {
		return true;
	}
	return false;
});

function getInnerValue() {
	const value = props.paramValue;
	switch (value.type) {
		case 'expression': return value.expression;
		case 'automation': return value.automationId;
		case 'node': return value.nodeId == null ? null : { nodeId: value.nodeId, outputPort: value.outputPort };
		case 'literal': return value.value;
	}
}

async function selectAutomation(param: string, ev: MouseEvent) {
	const a = await new Promise<GsAutomation | null>((res) => {
		ui.popupMenu([{
			text: '(none)',
			action: () => {
				res(null);
			},
		}, ...(appContext.state.automations.value.map(a => ({
			text: a.name,
			action: () => {
				res(a);
			},
		})))], ev.currentTarget ?? ev.target);
	});

	appContext.commit('updateParamAsAutomation', {
		nodeId: props.node.id,
		param: param,
		value: a?.id ?? null,
	});
}

async function showMenu(ev: PointerEvent) {
	const menuItems: MenuItem[] = [{
		text: 'Copy',
		action: () => {
		},
	}, {
		text: 'Paste',
		action: () => {
		},
	}, {
		text: 'Reset',
		danger: true,
		action: () => {
			appContext.commit('resetNodeParam', {
				nodeId: props.node.id,
				param: param,
			});
		},
	}, {
		type: 'label',
		text: 'Type',
	}, {
		text: 'Literal',
		action: () => {
			appContext.commit('changeParamValueType', {
				nodeId: props.node.id,
				param: param,
				type: 'literal',
			});
		},
	}, {
		text: 'Automation',
		action: () => {
			appContext.commit('changeParamValueType', {
				nodeId: props.node.id,
				param: param,
				type: 'automation',
			});
		},
	}, {
		text: 'Expression',
		action: () => {
			appContext.commit('changeParamValueType', {
				nodeId: props.node.id,
				param: param,
				type: 'expression',
			});
		},
	}];

	if (props.paramDef.canNode) {
		menuItems.push({
			text: 'Node',
			action: () => {
				appContext.commit('changeParamValueType', {
					nodeId: props.node.id,
					param: param,
					type: 'node',
				});
			},
		});
	}

	ui.popupMenu(menuItems, ev.currentTarget ?? ev.target);
}

let commandMergeKey: string | null = null;

function onBeginChanging(param: string) {
	commandMergeKey = genId();
}

function changeContinuous(param: string, value: any) {
	appContext.commit('updateParamAsLiteral', {
		nodeId: props.node.id,
		param: param,
		value: value,
	}, commandMergeKey);
}

function onFinishChanging(param: string) {
	commandMergeKey = null;
}

function updateParamAsLiteral(param: string, value: any) {
	appContext.commit('updateParamAsLiteral', {
		nodeId: props.node.id,
		param: param,
		value: value,
	});
}

function updateParamAsExpression(param: string, value: string) {
	appContext.commit('updateParamAsExpression', {
		nodeId: props.node.id,
		param: param,
		value: value,
	});
}

function updateParamAsNode(param: string, key) {
	appContext.commit('updateParamAsNode', {
		nodeId: props.node.id,
		param: param,
		value: getNodeOutputItems(appContext.state.nodes.value, props.node?.id, getNodeInputDataType(paramDef)).find(item => item.value === key)?.connection,
	});
}

/*
watchEffect(onCleanup => {
	const el = allInPortEl.value;
	const nodeId = props.node.id;
	if (el == null) return;
	wireMap.allIn[nodeId] = el;
	onCleanup(() => {
		if (wireMap.allIn[nodeId] === el) delete wireMap.allIn[nodeId];
	});
});
*/
</script>

<style module lang="scss">
.root {
	display: flex;
	padding: 3px 16px;
	box-sizing: border-box;
	min-height: 30px;

	&:hover {
		background: #ffffff08;
	}
}

.paramLabel {
	place-content: center left;
	width: 35%;
	box-sizing: border-box;
	padding-right: 12px;
	flex-shrink: 0;
	white-space: nowrap;
	text-overflow: ellipsis;
	overflow: clip;
	font-size: 95%;
	cursor: pointer;

	&.expression {
		color: var(--THEME-expression);
	}
}

.paramBody {
	display: flex;
	width: 65%;
	flex-shrink: 1;
	align-items: center;
	gap: 8px;
}

.typeWarning {
	color: var(--THEME-warn);
}
</style>
