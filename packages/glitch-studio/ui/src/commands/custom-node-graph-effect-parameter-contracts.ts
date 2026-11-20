import { z } from 'zod';
import { connectionTypePolicySchema, effectResolutionSchema, parameterExpressionModifierSchema, staticSettingValueSchema, structParameterFieldBindingsSchema } from './parameter-contract-schemas.ts';
import { customNodeGraphEffectCustomParameterInputSchema, customNodeGraphEffectCustomParameterReferenceSchema, customNodeGraphEffectNodeParameterReferenceSchema, customNodeGraphEffectNodeReferenceSchema, customNodeGraphEffectOutputInputSchema, customNodeGraphEffectOutputReferenceSchema, customNodeGraphEffectParameterBindingSchema, customNodeGraphEffectParameterInputSourceSchema, customNodeGraphEffectParameterSourceSchema, customNodeGraphEffectPublicParameterIdSchema, customNodeGraphEffectPublicParameterInputSchema, customNodeGraphEffectPublicParameterReferenceSchema, customNodeGraphEffectTargetSchema, customNodeGraphEffectValueParameterBindingSchema, customNodeGraphEffectValueParameterInputSourceSchema, customNodeGraphEffectValueParameterSourceSchema } from './custom-node-graph-effect-contract-schemas.ts';

const nodeSetup = 'let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet node = Command:createCustomNodeGraphEffectEffectNode({ customNodeGraphEffect: customNodeGraphEffect, effectSource: { type: "nativeEffect", id: "fill" } })\n';
const customParameterSetup = nodeSetup + 'let parameter = Command:createCustomNodeGraphEffectCustomParameterFromParameter({ target: node, parameterPath: ["color"] })\n';
const publicParameterSetup = nodeSetup + 'let parameter = Command:createCustomNodeGraphEffectPublicParameterFromParameter({ target: node, parameterPath: ["color"] })\n';
const outputSetup = 'let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet output = Command:createCustomNodeGraphEffectOutput({ customNodeGraphEffect: customNodeGraphEffect, definition: { name: "auxiliary", label: "Auxiliary", dataType: { kind: "color" } } })\n';
const scalarDefinition = '{ nameForReference: "amount", dataType: { kind: "scalar" }, ui: { label: "Amount", control: { controlType: "number" } }, defaultValue: { inputSource: "literal", value: 1 }, canNode: false }';

// 共通のパラメータ更新処理を使うCommandにも、その公開入力ごとの契約を付ける。
// 保存形式の形は再利用し、修飾式の保持・入力方式切替など操作固有の意味はここで説明する。
export const CUSTOM_NODE_GRAPH_EFFECT_PARAMETER_CONTRACTS = {
	setCustomNodeGraphEffectNodeParameterSource: {
		description: 'Set a leaf parameter input source while preserving its expression modifier. Literal values use the parameter dataType; colors are linear sRGB and positions use the shared spatial units. preserveNodeSampling keeps the existing sampling settings when reconnecting an already connected node. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'Command:setCustomNodeGraphEffectNodeParameterSource({ target: node, parameterPath: ["color"], source: { inputSource: "literal", value: [1, 0.2, 0.1, 1] } })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ source: customNodeGraphEffectParameterSourceSchema, preserveNodeSampling: z.boolean().nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	switchCustomNodeGraphEffectNodeParameterInputSource: {
		description: 'Switch a leaf parameter to an input source with initial settings chosen for that parameter. Preserves a compatible expression modifier. This does not set the expression, connection, or reference itself; configure it with setCustomNodeGraphEffectNodeParameterSource afterwards.',
		examples: [nodeSetup + 'Command:switchCustomNodeGraphEffectNodeParameterInputSource({ target: node, parameterPath: ["color"], inputSource: "expression" })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ inputSource: customNodeGraphEffectParameterInputSourceSchema }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectNodeParameterExpressionModifier: {
		description: 'Replace the post-input expression modifier without changing the input source. null removes it. Only parameters and input sources that support value modifiers are accepted.',
		examples: [nodeSetup + 'Command:setCustomNodeGraphEffectNodeParameterExpressionModifier({ target: node, parameterPath: ["color"], expressionModifier: null })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ expressionModifier: parameterExpressionModifierSchema.nullable() }), resultSchema: z.null(),
	},
	replaceCustomNodeGraphEffectNodeParameterBinding: {
		description: 'Replace the entire parameter binding, including its expression modifier. An omitted modifier removes the previous one. Container bindings must preserve valid struct fields or array element IDs. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'Command:replaceCustomNodeGraphEffectNodeParameterBinding({ target: node, parameterPath: ["color"], binding: { inputSource: "literal", value: [0, 0, 0, 1] } })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ binding: customNodeGraphEffectParameterBindingSchema, connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	resetCustomNodeGraphEffectNodeParameter: {
		description: 'Reset the parameter binding to its definition default, removing input references and expression modifiers. Array defaults receive fresh element IDs.',
		examples: [nodeSetup + 'Command:resetCustomNodeGraphEffectNodeParameter({ target: node, parameterPath: ["color"] })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema, resultSchema: z.null(),
	},
	setCustomNodeGraphEffectNodeParameterFields: {
		description: 'Update selected leaf fields of a literal struct parameter together. Each field must already use the same literal or keyframes input source. Other fields and compatible expression modifiers are preserved.',
		examples: ['// node is a target from Query:listNodes; viewport is a literal struct with a literal center field.\nCommand:setCustomNodeGraphEffectNodeParameterFields({ target: node, parameterPath: ["viewport"], fields: { center: { inputSource: "literal", value: [0, 0] } } })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ fields: structParameterFieldBindingsSchema }), resultSchema: z.null(),
	},
	insertCustomNodeGraphEffectNodeParameterArrayElement: {
		description: 'Insert an array element using the element definition default and a generated ID. beforeElementId inserts before that existing element; null or omission appends. Returns the new element parameter path. The definition\'s maximum element count is enforced.',
		examples: ['// node is a target whose items parameter is an array.\nlet element = Command:insertCustomNodeGraphEffectNodeParameterArrayElement({ target: node, parameterPath: ["items"] })\n<: element.parameterPath'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ beforeElementId: z.string().nullish() }), resultSchema: customNodeGraphEffectNodeParameterReferenceSchema,
	},
	removeCustomNodeGraphEffectNodeParameterArrayElements: {
		description: 'Remove the specified element IDs from an array parameter. IDs must belong to this array; numeric positions are not accepted. Other elements keep their IDs and bindings.',
		examples: ['// arrayTarget identifies an array parameter and elementId belongs to that array.\nCommand:removeCustomNodeGraphEffectNodeParameterArrayElements({ target: arrayTarget.target, parameterPath: arrayTarget.parameterPath, elementIds: [elementId] })'],
		inputSchema: customNodeGraphEffectNodeParameterReferenceSchema.extend({ elementIds: z.array(z.string()) }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectNodeBypass: {
		description: 'Enable or disable bypass on an effect node without deleting its definition, bindings, or connections.',
		examples: [nodeSetup + 'Command:setCustomNodeGraphEffectNodeBypass({ target: node, bypass: true })'],
		inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, bypass: z.boolean() }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectNodeDisplayName: {
		description: 'Set the display name of an effect or relay node. Pass an empty string to use the default name.',
		examples: [nodeSetup + 'Command:setCustomNodeGraphEffectNodeDisplayName({ target: node, displayName: "Background color" })'],
		inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, displayName: z.string() }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectNodeStaticSetting: {
		description: 'Set one plain static setting using its key from Query:getEffect().staticSettingDefs. Static settings do not accept expressions or bindings. Referenced Assets and Players must already exist.',
		examples: ['// node and settingKey come from Query:listNodes and Query:getEffect respectively.\nCommand:setCustomNodeGraphEffectNodeStaticSetting({ target: node, key: settingKey, value: true })'],
		inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, key: z.string(), value: staticSettingValueSchema }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectNodeResolution: {
		description: 'Set the effect node render resolution. auto/context use a positive common width/height scale; customAbsolute uses positive integer pixel dimensions.',
		examples: [nodeSetup + 'Command:setCustomNodeGraphEffectNodeResolution({ target: node, resolution: { mode: "auto", scale: 0.5 } })'],
		inputSchema: z.object({ target: customNodeGraphEffectNodeReferenceSchema, resolution: effectResolutionSchema }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectOutputConnection: {
		description: 'Connect a Custom Node Graph Effect output to an output port on a node in the same Custom Node Graph Effect. source: null disconnects it. Output port identifiers come from the node\'s effect definition. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'let customNodeGraphEffectState = Query:getCustomNodeGraphEffect(customNodeGraphEffect)\nCommand:setCustomNodeGraphEffectOutputConnection({ target: { customNodeGraphEffect: customNodeGraphEffect, outputId: customNodeGraphEffectState.primaryOutputId }, source: { nodeId: node.nodeId, outputPort: "output" } })'],
		inputSchema: z.object({ target: customNodeGraphEffectOutputReferenceSchema, source: z.object({ nodeId: z.string(), outputPort: z.string() }).nullable(), connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectPrimaryInput: {
		description: 'Choose the node-capable color public parameter used as the primary image input. null clears the designation. The parameter must belong to this Custom Node Graph Effect.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nCommand:setCustomNodeGraphEffectPrimaryInput({ target: customNodeGraphEffect, primaryInputId: null })'],
		inputSchema: z.object({ target: customNodeGraphEffectTargetSchema, primaryInputId: customNodeGraphEffectPublicParameterIdSchema.nullable() }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectPrimaryAudioInput: {
		description: 'Choose the non-node audioSource public parameter used for automatic audio input assignment. null clears the designation. This is independent from the primary image input.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nCommand:setCustomNodeGraphEffectPrimaryAudioInput({ target: customNodeGraphEffect, primaryAudioInputId: null })'],
		inputSchema: z.object({ target: customNodeGraphEffectTargetSchema, primaryAudioInputId: customNodeGraphEffectPublicParameterIdSchema.nullable() }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectPrimaryOutput: {
		description: 'Choose a color output as the Custom Node Graph Effect primary output, or clear the designation with null. This changes which existing output is primary without reconnecting it.',
		examples: [outputSetup + 'Command:setCustomNodeGraphEffectPrimaryOutput({ target: customNodeGraphEffect, primaryOutputId: output.outputId })'],
		inputSchema: z.object({ target: customNodeGraphEffectTargetSchema, primaryOutputId: z.string().nullable() }), resultSchema: z.null(),
	},
	createCustomNodeGraphEffectPublicParameter: {
		description: 'Create a public parameter with a generated ID. Provide a full parameter definition and a unique nameForReference; omit id. Only texture-capable data types can enable canNode. Returns its public parameter reference.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet parameter = Command:createCustomNodeGraphEffectPublicParameter({ customNodeGraphEffect: customNodeGraphEffect, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, definition: customNodeGraphEffectPublicParameterInputSchema }), resultSchema: customNodeGraphEffectPublicParameterReferenceSchema,
	},
	replaceCustomNodeGraphEffectPublicParameterDefinition: {
		description: 'Replace a public parameter definition while retaining its ID. The name must stay unique. Primary image/audio input designations are cleared if the new type no longer supports them.',
		examples: [publicParameterSetup + 'Command:replaceCustomNodeGraphEffectPublicParameterDefinition({ target: parameter, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ target: customNodeGraphEffectPublicParameterReferenceSchema, definition: customNodeGraphEffectPublicParameterInputSchema }), resultSchema: z.null(),
	},
	removeCustomNodeGraphEffectPublicParameter: {
		description: 'Remove a public parameter and clear any primary input designation that references it. Existing references are retained as unresolved so Undo can restore their meaning.',
		examples: [publicParameterSetup + 'Command:removeCustomNodeGraphEffectPublicParameter({ target: parameter })'],
		inputSchema: z.object({ target: customNodeGraphEffectPublicParameterReferenceSchema }), resultSchema: z.null(),
	},
	createCustomNodeGraphEffectPublicParameterFromParameter: {
		description: 'Expose an existing eligible literal leaf parameter as a newly created public parameter and connect the node parameter to it. Copies its definition and current value, generates a unique name/ID, and returns the public reference.',
		examples: [publicParameterSetup + '<: parameter'], inputSchema: customNodeGraphEffectNodeParameterReferenceSchema, resultSchema: customNodeGraphEffectPublicParameterReferenceSchema,
	},
	createCustomNodeGraphEffectCustomParameterFromParameter: {
		description: 'Create a Custom Node Graph Effect-local custom parameter from an eligible literal leaf parameter and replace the node input with a reference to it. Custom parameters share CPU values and do not expose node inputs.',
		examples: [customParameterSetup + '<: parameter'], inputSchema: customNodeGraphEffectNodeParameterReferenceSchema, resultSchema: customNodeGraphEffectCustomParameterReferenceSchema,
	},
	createCustomNodeGraphEffectCustomParameter: {
		description: 'Create a Custom Node Graph Effect-local custom parameter with a generated ID and unique nameForReference. Supported kinds are scalar, bool, string, color, vector, enum, colorRamp, and sizeReference; canNode must be false.',
		examples: ['let customNodeGraphEffect = Command:createCustomNodeGraphEffect({})\nlet parameter = Command:createCustomNodeGraphEffectCustomParameter({ customNodeGraphEffect: customNodeGraphEffect, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, definition: customNodeGraphEffectCustomParameterInputSchema }), resultSchema: customNodeGraphEffectCustomParameterReferenceSchema,
	},
	replaceCustomNodeGraphEffectCustomParameterDefinition: {
		description: 'Replace a custom parameter definition while retaining its ID. Changing the dataType kind clears its stored value so the new default is used. Remaining values are validated against the new definition.',
		examples: [customParameterSetup + 'Command:replaceCustomNodeGraphEffectCustomParameterDefinition({ target: parameter, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema, definition: customNodeGraphEffectCustomParameterInputSchema }), resultSchema: z.null(),
	},
	removeCustomNodeGraphEffectCustomParameter: {
		description: 'Remove a custom parameter definition and its stored value. References elsewhere remain unresolved until repaired or restored with Undo.',
		examples: [customParameterSetup + 'Command:removeCustomNodeGraphEffectCustomParameter({ target: parameter })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectCustomParameterSource: {
		description: 'Set a custom parameter input source while preserving its expression modifier. Node texture connections are unavailable; use literal values, expressions, animation, or compatible parameter references.',
		examples: [customParameterSetup + 'Command:setCustomNodeGraphEffectCustomParameterSource({ target: parameter, source: { inputSource: "literal", value: [0.2, 0.5, 1, 1] } })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema, source: customNodeGraphEffectValueParameterSourceSchema }), resultSchema: z.null(),
	},
	switchCustomNodeGraphEffectCustomParameterInputSource: {
		description: 'Switch a custom parameter input source and create suitable initial settings, preserving a compatible expression modifier. Supported sources depend on the parameter dataType.',
		examples: [customParameterSetup + 'Command:switchCustomNodeGraphEffectCustomParameterInputSource({ target: parameter, inputSource: "expression" })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema, inputSource: customNodeGraphEffectValueParameterInputSourceSchema }), resultSchema: z.null(),
	},
	setCustomNodeGraphEffectCustomParameterExpressionModifier: {
		description: 'Replace or clear a custom parameter\'s post-input expression modifier without changing its source. null removes the modifier; the current definition and binding must support it.',
		examples: [customParameterSetup + 'Command:setCustomNodeGraphEffectCustomParameterExpressionModifier({ target: parameter, expressionModifier: null })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema, expressionModifier: parameterExpressionModifierSchema.nullable() }), resultSchema: z.null(),
	},
	replaceCustomNodeGraphEffectCustomParameterBinding: {
		description: 'Replace the complete custom parameter binding, including its expression modifier. An omitted modifier removes any previous modifier.',
		examples: [customParameterSetup + 'Command:replaceCustomNodeGraphEffectCustomParameterBinding({ target: parameter, binding: { inputSource: "literal", value: [0, 0, 0, 1] } })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema, binding: customNodeGraphEffectValueParameterBindingSchema }), resultSchema: z.null(),
	},
	resetCustomNodeGraphEffectCustomParameter: {
		description: 'Remove the custom parameter\'s stored binding so its definition default is used again.',
		examples: [customParameterSetup + 'Command:resetCustomNodeGraphEffectCustomParameter({ target: parameter })'],
		inputSchema: z.object({ target: customNodeGraphEffectCustomParameterReferenceSchema }), resultSchema: z.null(),
	},
	createCustomNodeGraphEffectOutput: {
		description: 'Create a named texture output with a generated ID. The name and ID must be unique within the Custom Node Graph Effect. The first color output becomes primary if no primary output is selected. Connect it separately with setCustomNodeGraphEffectOutputConnection.',
		examples: [outputSetup + '<: output'], inputSchema: z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, definition: customNodeGraphEffectOutputInputSchema }), resultSchema: customNodeGraphEffectOutputReferenceSchema,
	},
	replaceCustomNodeGraphEffectOutputDefinition: {
		description: 'Replace the output name, label, and texture data type while retaining its ID and connection. A primary output changed away from color loses its primary designation.',
		examples: [outputSetup + 'Command:replaceCustomNodeGraphEffectOutputDefinition({ target: output, definition: { name: "auxiliary", label: "Mask", dataType: { kind: "scalar" } } })'],
		inputSchema: z.object({ target: customNodeGraphEffectOutputReferenceSchema, definition: customNodeGraphEffectOutputInputSchema }), resultSchema: z.null(),
	},
	removeCustomNodeGraphEffectOutput: {
		description: 'Remove an output definition and clear its primary designation if necessary. The Out node connection is retained so Undo restores the original wiring.',
		examples: [outputSetup + 'Command:removeCustomNodeGraphEffectOutput({ target: output })'],
		inputSchema: z.object({ target: customNodeGraphEffectOutputReferenceSchema }), resultSchema: z.null(),
	},
};
