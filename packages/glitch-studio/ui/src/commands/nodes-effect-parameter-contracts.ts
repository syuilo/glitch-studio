import { z } from 'zod';
import { connectionTypePolicySchema, effectResolutionSchema, parameterExpressionModifierSchema, staticSettingValueSchema, structParameterFieldBindingsSchema } from './parameter-contract-schemas.ts';
import { nodesEffectCustomParameterInputSchema, nodesEffectCustomParameterReferenceSchema, nodesEffectNodeParameterReferenceSchema, nodesEffectNodeReferenceSchema, nodesEffectOutputInputSchema, nodesEffectOutputReferenceSchema, nodesEffectParameterBindingSchema, nodesEffectParameterInputSourceSchema, nodesEffectParameterSourceSchema, nodesEffectPublicParameterIdSchema, nodesEffectPublicParameterInputSchema, nodesEffectPublicParameterReferenceSchema, nodesEffectTargetSchema, nodesEffectValueParameterBindingSchema, nodesEffectValueParameterInputSourceSchema, nodesEffectValueParameterSourceSchema } from './nodes-effect-contract-schemas.ts';

const nodeSetup = 'let nodesEffect = Command:createNodesEffect({})\nlet node = Command:createNodesEffectEffectNode({ nodesEffect: nodesEffect, effectSource: { type: "nativeEffect", id: "fill" } })\n';
const customParameterSetup = nodeSetup + 'let parameter = Command:createNodesEffectCustomParameterFromParameter({ target: node, parameterPath: ["color"] })\n';
const publicParameterSetup = nodeSetup + 'let parameter = Command:createNodesEffectPublicParameterFromParameter({ target: node, parameterPath: ["color"] })\n';
const outputSetup = 'let nodesEffect = Command:createNodesEffect({})\nlet output = Command:createNodesEffectOutput({ nodesEffect: nodesEffect, definition: { name: "auxiliary", label: "Auxiliary", dataType: { kind: "color" } } })\n';
const scalarDefinition = '{ nameForReference: "amount", dataType: { kind: "scalar" }, ui: { label: "Amount", control: { controlType: "number" } }, defaultValue: 1, canNode: false }';

// 共通のパラメータ更新処理を使うCommandにも、その公開入力ごとの契約を付ける。
// 保存形式の形は再利用し、修飾式の保持・入力方式切替など操作固有の意味はここで説明する。
export const NODES_EFFECT_PARAMETER_CONTRACTS = {
	setNodesEffectNodeParameterSource: {
		description: 'Set a leaf parameter input source while preserving its expression modifier. Literal values use the parameter dataType; colors are linear sRGB and positions use the shared spatial units. preserveNodeSampling keeps the existing sampling settings when reconnecting an already connected node. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'Command:setNodesEffectNodeParameterSource({ target: node, parameterPath: ["color"], source: { inputSource: "literal", value: [1, 0.2, 0.1, 1] } })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ source: nodesEffectParameterSourceSchema, preserveNodeSampling: z.boolean().nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	switchNodesEffectNodeParameterInputSource: {
		description: 'Switch a leaf parameter to an input source with initial settings chosen for that parameter. Preserves a compatible expression modifier. This does not set the expression, connection, or reference itself; configure it with setNodesEffectNodeParameterSource afterwards.',
		examples: [nodeSetup + 'Command:switchNodesEffectNodeParameterInputSource({ target: node, parameterPath: ["color"], inputSource: "expression" })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ inputSource: nodesEffectParameterInputSourceSchema }), resultSchema: z.null(),
	},
	setNodesEffectNodeParameterExpressionModifier: {
		description: 'Replace the post-input expression modifier without changing the input source. null removes it. Only parameters and input sources that support value modifiers are accepted.',
		examples: [nodeSetup + 'Command:setNodesEffectNodeParameterExpressionModifier({ target: node, parameterPath: ["color"], expressionModifier: null })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ expressionModifier: parameterExpressionModifierSchema.nullable() }), resultSchema: z.null(),
	},
	replaceNodesEffectNodeParameterBinding: {
		description: 'Replace the entire parameter binding, including its expression modifier. An omitted modifier removes the previous one. Container bindings must preserve valid struct fields or array element IDs. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'Command:replaceNodesEffectNodeParameterBinding({ target: node, parameterPath: ["color"], binding: { inputSource: "literal", value: [0, 0, 0, 1] } })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ binding: nodesEffectParameterBindingSchema, connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	resetNodesEffectNodeParameter: {
		description: 'Reset the parameter binding to its definition default, removing input references and expression modifiers. Array defaults receive fresh element IDs.',
		examples: [nodeSetup + 'Command:resetNodesEffectNodeParameter({ target: node, parameterPath: ["color"] })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema, resultSchema: z.null(),
	},
	setNodesEffectNodeParameterFields: {
		description: 'Update selected leaf fields of a literal struct parameter together. Each field must already use the same literal or keyframes input source. Other fields and compatible expression modifiers are preserved.',
		examples: ['// node is a target from Query:listNodes; viewport is a literal struct with a literal center field.\nCommand:setNodesEffectNodeParameterFields({ target: node, parameterPath: ["viewport"], fields: { center: { inputSource: "literal", value: [0, 0] } } })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ fields: structParameterFieldBindingsSchema }), resultSchema: z.null(),
	},
	insertNodesEffectNodeParameterArrayElement: {
		description: 'Insert an array element using the element definition default and a generated ID. beforeElementId inserts before that existing element; null or omission appends. Returns the new element parameter path. The definition\'s maximum element count is enforced.',
		examples: ['// node is a target whose items parameter is an array.\nlet element = Command:insertNodesEffectNodeParameterArrayElement({ target: node, parameterPath: ["items"] })\n<: element.parameterPath'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ beforeElementId: z.string().nullish() }), resultSchema: nodesEffectNodeParameterReferenceSchema,
	},
	removeNodesEffectNodeParameterArrayElements: {
		description: 'Remove the specified element IDs from an array parameter. IDs must belong to this array; numeric positions are not accepted. Other elements keep their IDs and bindings.',
		examples: ['// arrayTarget identifies an array parameter and elementId belongs to that array.\nCommand:removeNodesEffectNodeParameterArrayElements({ target: arrayTarget.target, parameterPath: arrayTarget.parameterPath, elementIds: [elementId] })'],
		inputSchema: nodesEffectNodeParameterReferenceSchema.extend({ elementIds: z.array(z.string()) }), resultSchema: z.null(),
	},
	setNodesEffectNodeBypass: {
		description: 'Enable or disable bypass on an effect node. A bypassed node forwards a texture from its primary input to a compatible primary output. Other outputs are absent.',
		examples: [nodeSetup + 'Command:setNodesEffectNodeBypass({ target: node, bypass: true })'],
		inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, bypass: z.boolean() }), resultSchema: z.null(),
	},
	setNodesEffectNodeDisplayName: {
		description: 'Set the display name of an effect or relay node. Pass an empty string to use the default name.',
		examples: [nodeSetup + 'Command:setNodesEffectNodeDisplayName({ target: node, displayName: "Background color" })'],
		inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, displayName: z.string() }), resultSchema: z.null(),
	},
	setNodesEffectNodeStaticSetting: {
		description: 'Set one plain static setting using its key from Query:getEffect().staticSettingDefs. Static settings do not accept expressions or bindings. Referenced Assets must already exist.',
		examples: ['// node and settingKey come from Query:listNodes and Query:getEffect respectively.\nCommand:setNodesEffectNodeStaticSetting({ target: node, key: settingKey, value: true })'],
		inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, key: z.string(), value: staticSettingValueSchema }), resultSchema: z.null(),
	},
	setNodesEffectNodeResolution: {
		description: 'Set the effect node render resolution. auto/context use a positive common width/height scale; customAbsolute uses positive integer pixel dimensions.',
		examples: [nodeSetup + 'Command:setNodesEffectNodeResolution({ target: node, resolution: { mode: "auto", scale: 0.5 } })'],
		inputSchema: z.object({ target: nodesEffectNodeReferenceSchema, resolution: effectResolutionSchema }), resultSchema: z.null(),
	},
	setNodesEffectOutputConnection: {
		description: 'Connect a Nodes Effect output to an output port in the same Nodes Effect. Pass null as source to disconnect it. An In connection, including through a relay, produces output only when the placement supplies a texture. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'let nodesEffectState = Query:getNodesEffect(nodesEffect)\nCommand:setNodesEffectOutputConnection({ target: { nodesEffect: nodesEffect, outputId: nodesEffectState.primaryOutputId }, source: { nodeId: node.nodeId, outputPort: "output" } })'],
		inputSchema: z.object({ target: nodesEffectOutputReferenceSchema, source: z.object({ nodeId: z.string(), outputPort: z.string() }).nullable(), connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	setNodesEffectPrimaryInput: {
		description: 'Choose the node-capable color public parameter used as the primary image input. null clears the designation. The parameter must belong to this Nodes Effect.',
		examples: ['let nodesEffect = Command:createNodesEffect({})\nCommand:setNodesEffectPrimaryInput({ target: nodesEffect, primaryInputId: null })'],
		inputSchema: z.object({ target: nodesEffectTargetSchema, primaryInputId: nodesEffectPublicParameterIdSchema.nullable() }), resultSchema: z.null(),
	},
	setNodesEffectPrimaryAudioInput: {
		description: 'Choose the non-node audioSource public parameter used for automatic audio input assignment. null clears the designation. This is independent from the primary image input.',
		examples: ['let nodesEffect = Command:createNodesEffect({})\nCommand:setNodesEffectPrimaryAudioInput({ target: nodesEffect, primaryAudioInputId: null })'],
		inputSchema: z.object({ target: nodesEffectTargetSchema, primaryAudioInputId: nodesEffectPublicParameterIdSchema.nullable() }), resultSchema: z.null(),
	},
	setNodesEffectPrimaryOutput: {
		description: 'Choose a color output as the Nodes Effect primary output, or clear the designation with null. This changes which existing output is primary without reconnecting it.',
		examples: [outputSetup + 'Command:setNodesEffectPrimaryOutput({ target: nodesEffect, primaryOutputId: output.outputId })'],
		inputSchema: z.object({ target: nodesEffectTargetSchema, primaryOutputId: z.string().nullable() }), resultSchema: z.null(),
	},
	createNodesEffectPublicParameter: {
		description: 'Create a public parameter with a generated ID. Provide a full parameter definition and a unique nameForReference; omit id. Only texture-capable data types can enable canNode. Returns its public parameter reference.',
		examples: ['let nodesEffect = Command:createNodesEffect({})\nlet parameter = Command:createNodesEffectPublicParameter({ nodesEffect: nodesEffect, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ nodesEffect: nodesEffectTargetSchema, definition: nodesEffectPublicParameterInputSchema }), resultSchema: nodesEffectPublicParameterReferenceSchema,
	},
	replaceNodesEffectPublicParameterDefinition: {
		description: 'Replace a public parameter definition while retaining its ID. The name must stay unique. Clears unsupported primary input designations and resets incompatible arguments on affected Nodes and Timeline Layers. Undo restores the previous definition and arguments together.',
		examples: [publicParameterSetup + 'Command:replaceNodesEffectPublicParameterDefinition({ target: parameter, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ target: nodesEffectPublicParameterReferenceSchema, definition: nodesEffectPublicParameterInputSchema }), resultSchema: z.null(),
	},
	removeNodesEffectPublicParameter: {
		description: 'Remove a public parameter, its primary input designation, and the corresponding arguments on Nodes and Layers. Connections inside the definition retain their IDs as unresolved references. Undo restores the definition and arguments.',
		examples: [publicParameterSetup + 'Command:removeNodesEffectPublicParameter({ target: parameter })'],
		inputSchema: z.object({ target: nodesEffectPublicParameterReferenceSchema }), resultSchema: z.null(),
	},
	createNodesEffectPublicParameterFromParameter: {
		description: 'Expose an existing eligible literal leaf parameter as a newly created public parameter and connect the node parameter to it. Copies its definition and current value, generates a unique name/ID, and returns the public reference.',
		examples: [publicParameterSetup + '<: parameter'], inputSchema: nodesEffectNodeParameterReferenceSchema, resultSchema: nodesEffectPublicParameterReferenceSchema,
	},
	createNodesEffectCustomParameterFromParameter: {
		description: 'Create a Nodes Effect-local custom parameter from an eligible literal leaf parameter and replace the node input with a reference to it. Custom parameters share CPU values and do not expose node inputs.',
		examples: [customParameterSetup + '<: parameter'], inputSchema: nodesEffectNodeParameterReferenceSchema, resultSchema: nodesEffectCustomParameterReferenceSchema,
	},
	createNodesEffectCustomParameter: {
		description: 'Create a Nodes Effect-local custom parameter with a generated ID and unique nameForReference. Supported kinds are scalar, bool, string, color, vector, enum, colorRamp, and sizeReference; canNode must be false.',
		examples: ['let nodesEffect = Command:createNodesEffect({})\nlet parameter = Command:createNodesEffectCustomParameter({ nodesEffect: nodesEffect, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ nodesEffect: nodesEffectTargetSchema, definition: nodesEffectCustomParameterInputSchema }), resultSchema: nodesEffectCustomParameterReferenceSchema,
	},
	replaceNodesEffectCustomParameterDefinition: {
		description: 'Replace a custom parameter definition while retaining its ID. Changing the dataType kind clears its stored value so the new default is used. Remaining values are validated against the new definition.',
		examples: [customParameterSetup + 'Command:replaceNodesEffectCustomParameterDefinition({ target: parameter, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema, definition: nodesEffectCustomParameterInputSchema }), resultSchema: z.null(),
	},
	removeNodesEffectCustomParameter: {
		description: 'Remove a custom parameter definition and its stored value. References elsewhere remain unresolved until repaired or restored with Undo.',
		examples: [customParameterSetup + 'Command:removeNodesEffectCustomParameter({ target: parameter })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema }), resultSchema: z.null(),
	},
	setNodesEffectCustomParameterSource: {
		description: 'Set a custom parameter input source while preserving its expression modifier. Node texture connections are unavailable; use literal values, expressions, animation, or compatible parameter references.',
		examples: [customParameterSetup + 'Command:setNodesEffectCustomParameterSource({ target: parameter, source: { inputSource: "literal", value: [0.2, 0.5, 1, 1] } })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema, source: nodesEffectValueParameterSourceSchema }), resultSchema: z.null(),
	},
	switchNodesEffectCustomParameterInputSource: {
		description: 'Switch a custom parameter input source and create suitable initial settings, preserving a compatible expression modifier. Supported sources depend on the parameter dataType.',
		examples: [customParameterSetup + 'Command:switchNodesEffectCustomParameterInputSource({ target: parameter, inputSource: "expression" })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema, inputSource: nodesEffectValueParameterInputSourceSchema }), resultSchema: z.null(),
	},
	setNodesEffectCustomParameterExpressionModifier: {
		description: 'Replace or clear a custom parameter\'s post-input expression modifier without changing its source. null removes the modifier; the current definition and binding must support it.',
		examples: [customParameterSetup + 'Command:setNodesEffectCustomParameterExpressionModifier({ target: parameter, expressionModifier: null })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema, expressionModifier: parameterExpressionModifierSchema.nullable() }), resultSchema: z.null(),
	},
	replaceNodesEffectCustomParameterBinding: {
		description: 'Replace the complete custom parameter binding, including its expression modifier. An omitted modifier removes any previous modifier.',
		examples: [customParameterSetup + 'Command:replaceNodesEffectCustomParameterBinding({ target: parameter, binding: { inputSource: "literal", value: [0, 0, 0, 1] } })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema, binding: nodesEffectValueParameterBindingSchema }), resultSchema: z.null(),
	},
	resetNodesEffectCustomParameter: {
		description: 'Remove the custom parameter\'s stored binding so its definition default is used again.',
		examples: [customParameterSetup + 'Command:resetNodesEffectCustomParameter({ target: parameter })'],
		inputSchema: z.object({ target: nodesEffectCustomParameterReferenceSchema }), resultSchema: z.null(),
	},
	createNodesEffectOutput: {
		description: 'Create a named texture output with a generated ID. The name and ID must be unique within the Nodes Effect. The first color output becomes primary if no primary output is selected. Connect it separately with setNodesEffectOutputConnection.',
		examples: [outputSetup + '<: output'], inputSchema: z.object({ nodesEffect: nodesEffectTargetSchema, definition: nodesEffectOutputInputSchema }), resultSchema: nodesEffectOutputReferenceSchema,
	},
	replaceNodesEffectOutputDefinition: {
		description: 'Replace the output name, label, and texture data type while retaining its ID and connection. A primary output changed away from color loses its primary designation.',
		examples: [outputSetup + 'Command:replaceNodesEffectOutputDefinition({ target: output, definition: { name: "auxiliary", label: "Mask", dataType: { kind: "scalar" } } })'],
		inputSchema: z.object({ target: nodesEffectOutputReferenceSchema, definition: nodesEffectOutputInputSchema }), resultSchema: z.null(),
	},
	removeNodesEffectOutput: {
		description: 'Remove an output definition, clear its primary designation if necessary, and disconnect wires to that port in all placements of the registered Nodes Effect. Undo restores the output and its original wiring.',
		examples: [outputSetup + 'Command:removeNodesEffectOutput({ target: output })'],
		inputSchema: z.object({ target: nodesEffectOutputReferenceSchema }), resultSchema: z.null(),
	},
};
