<template>
<div :class="[$style.root, { [$style.isBypass]: node.isBypass }]">
	<GsNodePort :class="$style.allInPort" dataType="any" @update:element="allInPortEl = $event"/>
	<div :class="[$style.header, { [$style.hasStatus]: effectStatus?.type === 'loading' || effectStatus?.type === 'error' }]" class="drag-handle" @dblclick="expanded = !expanded">
		<div :class="$style.headerLeft">
			<div :class="$style.effectName">{{ name }}</div>
			<div v-if="effectStatus?.type === 'loading'" :class="$style.headerButton" inline small iconOnly title="Loading…"><i class="ti ti-loader-2" :class="$style.loading"></i></div>
			<div v-else-if="effectStatus?.type === 'error'" :class="[$style.headerButton, $style.error]" inline small iconOnly :title="effectStatus.message" @click.stop="showEffectError"><i class="ti ti-alert-triangle"></i></div>
		</div>
		<div :class="$style.headerRight">
			<div :class="$style.nodeId" class="_monospace">{{ node.id }}</div>
			<div :class="$style.headerButtons">
				<GsButton :class="[$style.headerButton]" inline small iconOnly @click="expanded = !expanded"><i class="ti" :class="expanded ? 'ti-chevron-up' : 'ti-chevron-down'"></i></GsButton>
				<GsButton :class="[$style.headerButton]" inline small iconOnly :primary="node.isBypass" :title="node.isBypass ? i18n.ts.ClickToDisable : i18n.ts.ClickToEnable" @click="toggleBypass()"><i class="ti" :class="node.isBypass ? 'ti-eye' : 'ti-eye-off'"></i></GsButton>
				<GsButton :class="[$style.headerButton]" inline small iconOnly :title="i18n.ts.RemoveEffect" @click="remove()"><i class="ti ti-x"></i></GsButton>
			</div>
		</div>
	</div>

	<div v-show="expanded" :class="$style.params" :inert="!node.isBypass">
		<div v-for="param in Object.keys(paramDefs)" v-show="paramDefs[param].visibility == null || paramDefs[param].visibility(node.params)" :key="param" :ref="el => setParamRow(param, el)" :class="$style.param" data-wire-input-row>
			<div :class="[$style.paramLabel, { [$style.expression]: isExpression(param) }]" @click="showPerParamMenu(param, $event)">
				<GsCondensedLine>{{ paramDefs[param].label }}</GsCondensedLine>
			</div>
			<div :class="$style.paramBody">
				<GsInput v-if="isExpression(param)" type="text" :modelValue="getParam(param)" @update:modelValue="updateParamAsExpression(param, $event)">
					<template #caption>
						<div v-if="isExpressionSyntaxError[param]" style="color: var(--THEME-error);"><i class="ti ti-alert-triangle"></i> Syntax error!</div>
					</template>
				</GsInput>
				<GsButton v-else-if="isAutomation(param)" @click="selectAutomation(param, $event)">{{ node.params[param].automationId ? appContext.state.automations.value.find(a => a.id === node.params[param].automationId).name : '(none)' }}</GsButton>
				<GsEffectParamControl
					v-else-if="isNode(param)"
					type="node"
					:node="node"
					:group="group"
					:name="param"
					:options="paramDefs[param]"
					:value="getParam(param)"
					@input="value => appContext.commit('updateParamAsNode', { nodeId: node.id, param, value })"
				/>
				<GsEffectParamControl
					v-else
					:type="paramDefs[param].type"
					:group="group"
					:node="node"
					:name="param"
					:title="paramDefs[param].label"
					:options="paramDefs[param]"
					:value="getParam(param)"
					@input="updateParamAsLiteral(param, $event)"
					@beginChanging="onBeginChanging(param)"
					@changeContinuous="changeContinuous(param, $event)"
					@changeFinished="onFinishChanging(param)"
				/>
			</div>
		</div>
	</div>

	<GsNodeOutputs :node="node"/>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, shallowRef, watchEffect } from 'vue';
import { effectDefinitions } from '@glitch/shared/effect-definitions.ts';
import { genId } from '@glitch/shared/utility/id.ts';
import { areNodeDataTypesCompatible, getNodeInputDataType } from '@glitch/shared/utility/node-outputs.ts';
import * as AiScript from '@syuilo/aiscript';
import GsNodeOutputs from './GsNodeOutputs.vue';
import GsNodePort from './GsNodePort.vue';
import GsEffectParamControl from './GsEffectParamControl.vue';
import GsButton from './common/GsButton.vue';
import GsInput from './common/GsInput.vue';
import GsCondensedLine from './common/GsCondensedLine.vue';
import type { ComponentPublicInstance } from 'vue';
import type { GsAutomation, GsEffectNode, GsGroupNode, GsNode } from '@glitch/shared/types.ts';
import type { MenuItem } from '@/types/menu.ts';
import { i18n } from '@/i18n.ts';
import { appContext, engine, wireMap } from '@/app.ts';
import { getNodeOutputItems, nodeOutputKey } from '@/utility/node-outputs.ts';
import { registerWireInput } from '@/utility/wire-drag.ts';
import * as ui from '@/ui.ts';

const props = defineProps<{
	node: GsEffectNode,
	group: GsGroupNode | null,
}>();

const name = ref<string>(effectDefinitions[props.node.effectId].displayName);
const paramDefs = effectDefinitions[props.node.effectId].paramDefs;
const expanded = ref(true);
const allInPortEl = shallowRef<HTMLElement | null>(null);
const paramRows = ref<Record<string, HTMLElement>>({});
const nodeOutputItems = computed(() => getNodeOutputItems(appContext.state.nodes.value, props.node.id));

function setParamRow(param: string, el: Element | ComponentPublicInstance | null) {
	if (el instanceof HTMLElement) paramRows.value[param] = el;
	else delete paramRows.value[param];
}

watchEffect(onCleanup => {
	for (const [param, row] of Object.entries(paramRows.value)) {
		// node型の入力はコントロール側で登録する。それ以外もcanNodeなら型ごと切り替えられる。
		if (!paramDefs[param].canNode || isNode(param)) continue;
		onCleanup(registerWireInput(row, connection => {
			appContext.commit('updateParamAsNode', { nodeId: props.node.id, param, value: connection });
		}, connection => {
			const output = nodeOutputItems.value.find(item => item.value === nodeOutputKey(connection));
			return output ? areNodeDataTypesCompatible(output.dataType, getNodeInputDataType(paramDefs[param])) : null;
		}));
	}
});

const effectStatus = computed(() => engine.effectStatuses.get(props.node.id));

function showEffectError() {
	if (effectStatus.value?.type !== 'error') return;
	void ui.alert({ type: 'error', title: name.value, text: effectStatus.value.message });
}

function isExpression(param: string) {
	return props.node.params[param].type === 'expression';
}

function isAutomation(param: string) {
	return props.node.params[param].type === 'automation';
}

function isNode(param: string) {
	return props.node.params[param].type === 'node';
}

const aisParser = new AiScript.Parser();

const aiscript = new AiScript.Interpreter({});

const isExpressionSyntaxError = computed(() => {
	const result: Record<string, boolean> = {};
	for (const param in props.node.params) {
		if (!isExpression(param)) continue;
		try {
			aisParser.parse(props.node.params[param].expression);
		} catch (err) {
			result[param] = true;
		}
	}
	return result;
});

function getParam(param: string) {
	const value = props.node.params[param];
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

async function showPerParamMenu(param: string, ev: PointerEvent) {
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

	if (paramDefs[param].canNode) {
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

function remove() {
	appContext.commit('removeNode', {
		nodeId: props.node.id,
	});
}

function toggleBypass() {
	appContext.commit('changeNodeBypassState', {
		nodeId: props.node.id,
		bypass: !props.node.isBypass,
	});
}

watchEffect(onCleanup => {
	const el = allInPortEl.value;
	const nodeId = props.node.id;
	if (el == null) return;
	wireMap.allIn[nodeId] = el;
	onCleanup(() => {
		if (wireMap.allIn[nodeId] === el) delete wireMap.allIn[nodeId];
	});
});
</script>

<style module lang="scss">
.root {
	position: relative;
	background: var(--THEME-nodeBg);
	border-radius: 4px;
	overflow: clip;
	contain: content;

	&:not(.isBypass) {
		.params {
			opacity: 0.5;
		}
	}
}

.allInPort {
	position: absolute;
	top: 0;
	left: 0;
}

.header {
	display: flex;
	padding: 0 0 0 20px;
	&.hasStatus { padding-right: 117px; }
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: 95%;
	cursor: move;
	line-height: 32px;
	//background: linear-gradient(0deg, var(--THEME-nodeBg), hsl(from var(--THEME-nodeBg) h s calc(l + 5)));
	background: var(--THEME-nodeBg);

	&.disabled {
		pointer-events: none;
	}
}

.headerLeft {
	display: flex;
	margin-right: auto;
}

.headerRight {
	display: flex;
	margin-left: auto;
}

.effectName {
	font-weight: bold;
}

.nodeId {
}

.headerButtons {
}

.headerButton {
	display: inline-block;
	width: 23px;
	height: 23px;
	font-size: 90%;
	padding-left: 0;
	padding-right: 0;

	&:not(:first-child) {
		margin-left: 6px;
	}
}

.error {
	color: #ff806f;
}

.loading {
	display: inline-block;
	animation: statusSpin 1s linear infinite;
}

@keyframes statusSpin {
	to { transform: rotate(360deg); }
}

.params {
	&.disabled {
		opacity: 0.7;
		pointer-events: none;
	}
}

.param {
	display: flex;
	padding: 4px 16px;
	box-sizing: border-box;
	min-height: 32px;

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
	width: 65%;
	flex-shrink: 1;
}

</style>
