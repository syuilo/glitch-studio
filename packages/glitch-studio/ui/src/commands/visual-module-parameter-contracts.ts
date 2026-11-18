import { z } from 'zod';
import { effectResolutionSchema, parameterExpressionModifierSchema, staticSettingValueSchema, structParameterFieldBindingsSchema } from './parameter-contract-schemas.ts';
import { connectionTypePolicySchema, visualModuleCustomParameterInputSchema, visualModuleCustomParameterReferenceSchema, visualModuleNodeParameterReferenceSchema, visualModuleNodeReferenceSchema, visualModuleOutputInputSchema, visualModuleOutputReferenceSchema, visualModuleParameterBindingSchema, visualModuleParameterInputSourceSchema, visualModuleParameterSourceSchema, visualModulePublicParameterIdSchema, visualModulePublicParameterInputSchema, visualModulePublicParameterReferenceSchema, visualModuleTargetSchema, visualModuleValueParameterBindingSchema, visualModuleValueParameterInputSourceSchema, visualModuleValueParameterSourceSchema } from './visual-module-contract-schemas.ts';

const nodeSetup = 'let visualModule = Command:createVisualModule({})\nlet node = Command:createVisualModuleEffectNode({ visualModule: visualModule, effectId: "fill" })\n';
const customParameterSetup = nodeSetup + 'let parameter = Command:createVisualModuleCustomParameterFromParameter({ target: node, parameterPath: ["color"] })\n';
const publicParameterSetup = nodeSetup + 'let parameter = Command:createVisualModulePublicParameterFromParameter({ target: node, parameterPath: ["color"] })\n';
const outputSetup = 'let visualModule = Command:createVisualModule({})\nlet output = Command:createVisualModuleOutput({ visualModule: visualModule, definition: { name: "auxiliary", label: "Auxiliary", dataType: { kind: "color" } } })\n';
const scalarDefinition = '{ nameForReference: "amount", dataType: { kind: "scalar" }, ui: { label: "Amount", control: { controlType: "number" } }, defaultValue: { inputSource: "literal", value: 1 }, canNode: false }';

// 共通のパラメータ更新処理を使うCommandにも、その公開入力ごとの契約を付ける。
// 保存形式の形は再利用し、修飾式の保持・入力方式切替など操作固有の意味はここで説明する。
export const VISUAL_MODULE_PARAMETER_CONTRACTS = {
	setVisualModuleNodeParameterSource: {
		description: 'Set a leaf parameter input source while preserving its expression modifier. Literal values use the parameter dataType; colors are linear sRGB and positions use the shared spatial units. preserveNodeSampling keeps the existing sampling settings when reconnecting an already connected node. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'Command:setVisualModuleNodeParameterSource({ target: node, parameterPath: ["color"], source: { inputSource: "literal", value: [1, 0.2, 0.1, 1] } })'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ source: visualModuleParameterSourceSchema, preserveNodeSampling: z.boolean().nullish(), connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	switchVisualModuleNodeParameterInputSource: {
		description: 'Switch a leaf parameter to an input source with initial settings chosen for that parameter. Preserves a compatible expression modifier. This does not set the expression, connection, or reference itself; configure it with setVisualModuleNodeParameterSource afterwards.',
		examples: [nodeSetup + 'Command:switchVisualModuleNodeParameterInputSource({ target: node, parameterPath: ["color"], inputSource: "expression" })'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ inputSource: visualModuleParameterInputSourceSchema }), resultSchema: z.null(),
	},
	setVisualModuleNodeParameterExpressionModifier: {
		description: 'Replace the post-input expression modifier without changing the input source. null removes it. Only parameters and input sources that support value modifiers are accepted.',
		examples: [nodeSetup + 'Command:setVisualModuleNodeParameterExpressionModifier({ target: node, parameterPath: ["color"], expressionModifier: null })'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ expressionModifier: parameterExpressionModifierSchema.nullable() }), resultSchema: z.null(),
	},
	replaceVisualModuleNodeParameterBinding: {
		description: 'Replace the entire parameter binding, including its expression modifier. An omitted modifier removes the previous one. Container bindings must preserve valid struct fields or array element IDs. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'Command:replaceVisualModuleNodeParameterBinding({ target: node, parameterPath: ["color"], binding: { inputSource: "literal", value: [0, 0, 0, 1] } })'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ binding: visualModuleParameterBindingSchema, connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	resetVisualModuleNodeParameter: {
		description: 'Reset the parameter binding to its definition default, removing input references and expression modifiers. Array defaults receive fresh element IDs.',
		examples: [nodeSetup + 'Command:resetVisualModuleNodeParameter({ target: node, parameterPath: ["color"] })'],
		inputSchema: visualModuleNodeParameterReferenceSchema, resultSchema: z.null(),
	},
	setVisualModuleNodeParameterFields: {
		description: 'Update selected leaf fields of a literal struct parameter together. Each field must already use the same literal or keyframes input source. Other fields and compatible expression modifiers are preserved.',
		examples: ['// node is a target from Query:listNodes; viewport is a literal struct with a literal center field.\nCommand:setVisualModuleNodeParameterFields({ target: node, parameterPath: ["viewport"], fields: { center: { inputSource: "literal", value: [0, 0] } } })'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ fields: structParameterFieldBindingsSchema }), resultSchema: z.null(),
	},
	insertVisualModuleNodeParameterArrayElement: {
		description: 'Insert an array element using the element definition default and a generated ID. beforeElementId inserts before that existing element; null or omission appends. Returns the new element parameter path. The definition\'s maximum element count is enforced.',
		examples: ['// node is a target whose items parameter is an array.\nlet element = Command:insertVisualModuleNodeParameterArrayElement({ target: node, parameterPath: ["items"] })\n<: element.parameterPath'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ beforeElementId: z.string().nullish() }), resultSchema: visualModuleNodeParameterReferenceSchema,
	},
	removeVisualModuleNodeParameterArrayElements: {
		description: 'Remove the specified element IDs from an array parameter. IDs must belong to this array; numeric positions are not accepted. Other elements keep their IDs and bindings.',
		examples: ['// arrayTarget identifies an array parameter and elementId belongs to that array.\nCommand:removeVisualModuleNodeParameterArrayElements({ target: arrayTarget.target, parameterPath: arrayTarget.parameterPath, elementIds: [elementId] })'],
		inputSchema: visualModuleNodeParameterReferenceSchema.extend({ elementIds: z.array(z.string()) }), resultSchema: z.null(),
	},
	setVisualModuleNodeBypass: {
		description: 'Enable or disable bypass on an effect node without deleting its definition, bindings, or connections.',
		examples: [nodeSetup + 'Command:setVisualModuleNodeBypass({ target: node, bypass: true })'],
		inputSchema: z.object({ target: visualModuleNodeReferenceSchema, bypass: z.boolean() }), resultSchema: z.null(),
	},
	setVisualModuleNodeDisplayName: {
		description: 'Set the display name of an effect or relay node. Pass an empty string to use the default name.',
		examples: [nodeSetup + 'Command:setVisualModuleNodeDisplayName({ target: node, displayName: "Background color" })'],
		inputSchema: z.object({ target: visualModuleNodeReferenceSchema, displayName: z.string() }), resultSchema: z.null(),
	},
	setVisualModuleNodeStaticSetting: {
		description: 'Set one plain static setting using its key from Query:getEffect().staticSettingDefs. Static settings do not accept expressions or bindings. Referenced Assets and Players must already exist.',
		examples: ['// node and settingKey come from Query:listNodes and Query:getEffect respectively.\nCommand:setVisualModuleNodeStaticSetting({ target: node, key: settingKey, value: true })'],
		inputSchema: z.object({ target: visualModuleNodeReferenceSchema, key: z.string(), value: staticSettingValueSchema }), resultSchema: z.null(),
	},
	setVisualModuleNodeResolution: {
		description: 'Set the effect node render resolution. auto/context use a positive common width/height scale; customAbsolute uses positive integer pixel dimensions.',
		examples: [nodeSetup + 'Command:setVisualModuleNodeResolution({ target: node, resolution: { mode: "auto", scale: 0.5 } })'],
		inputSchema: z.object({ target: visualModuleNodeReferenceSchema, resolution: effectResolutionSchema }), resultSchema: z.null(),
	},
	setVisualModuleOutputConnection: {
		description: 'Connect a Visual Module output to an output port on a node in the same Visual Module. source: null disconnects it. Output port identifiers come from the node\'s effect definition. connectionTypePolicy defaults to strict.',
		examples: [nodeSetup + 'let visualModuleState = Query:getVisualModule(visualModule)\nCommand:setVisualModuleOutputConnection({ target: { visualModule: visualModule, outputId: visualModuleState.primaryOutputId }, source: { nodeId: node.nodeId, outputPort: "output" } })'],
		inputSchema: z.object({ target: visualModuleOutputReferenceSchema, source: z.object({ nodeId: z.string(), outputPort: z.string() }).nullable(), connectionTypePolicy: connectionTypePolicySchema.nullish() }), resultSchema: z.null(),
	},
	setVisualModulePrimaryInput: {
		description: 'Choose the node-capable color public parameter used as the primary image input. null clears the designation. The parameter must belong to this Visual Module.',
		examples: ['let visualModule = Command:createVisualModule({})\nCommand:setVisualModulePrimaryInput({ target: visualModule, primaryInputId: null })'],
		inputSchema: z.object({ target: visualModuleTargetSchema, primaryInputId: visualModulePublicParameterIdSchema.nullable() }), resultSchema: z.null(),
	},
	setVisualModulePrimaryAudioInput: {
		description: 'Choose the non-node audioSource public parameter used for automatic audio input assignment. null clears the designation. This is independent from the primary image input.',
		examples: ['let visualModule = Command:createVisualModule({})\nCommand:setVisualModulePrimaryAudioInput({ target: visualModule, primaryAudioInputId: null })'],
		inputSchema: z.object({ target: visualModuleTargetSchema, primaryAudioInputId: visualModulePublicParameterIdSchema.nullable() }), resultSchema: z.null(),
	},
	setVisualModulePrimaryOutput: {
		description: 'Choose a color output as the Visual Module primary output, or clear the designation with null. This changes which existing output is primary without reconnecting it.',
		examples: [outputSetup + 'Command:setVisualModulePrimaryOutput({ target: visualModule, primaryOutputId: output.outputId })'],
		inputSchema: z.object({ target: visualModuleTargetSchema, primaryOutputId: z.string().nullable() }), resultSchema: z.null(),
	},
	createVisualModulePublicParameter: {
		description: 'Create a public parameter with a generated ID. Provide a full parameter definition and a unique nameForReference; omit id. Only texture-capable data types can enable canNode. Returns its public parameter reference.',
		examples: ['let visualModule = Command:createVisualModule({})\nlet parameter = Command:createVisualModulePublicParameter({ visualModule: visualModule, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ visualModule: visualModuleTargetSchema, definition: visualModulePublicParameterInputSchema }), resultSchema: visualModulePublicParameterReferenceSchema,
	},
	replaceVisualModulePublicParameterDefinition: {
		description: 'Replace a public parameter definition while retaining its ID. The name must stay unique. Primary image/audio input designations are cleared if the new type no longer supports them.',
		examples: [publicParameterSetup + 'Command:replaceVisualModulePublicParameterDefinition({ target: parameter, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ target: visualModulePublicParameterReferenceSchema, definition: visualModulePublicParameterInputSchema }), resultSchema: z.null(),
	},
	removeVisualModulePublicParameter: {
		description: 'Remove a public parameter and clear any primary input designation that references it. Existing references are retained as unresolved so Undo can restore their meaning.',
		examples: [publicParameterSetup + 'Command:removeVisualModulePublicParameter({ target: parameter })'],
		inputSchema: z.object({ target: visualModulePublicParameterReferenceSchema }), resultSchema: z.null(),
	},
	createVisualModulePublicParameterFromParameter: {
		description: 'Expose an existing eligible literal leaf parameter as a newly created public parameter and connect the node parameter to it. Copies its definition and current value, generates a unique name/ID, and returns the public reference.',
		examples: [publicParameterSetup + '<: parameter'], inputSchema: visualModuleNodeParameterReferenceSchema, resultSchema: visualModulePublicParameterReferenceSchema,
	},
	createVisualModuleCustomParameterFromParameter: {
		description: 'Create a Visual Module-local custom parameter from an eligible literal leaf parameter and replace the node input with a reference to it. Custom parameters share CPU values and do not expose node inputs.',
		examples: [customParameterSetup + '<: parameter'], inputSchema: visualModuleNodeParameterReferenceSchema, resultSchema: visualModuleCustomParameterReferenceSchema,
	},
	createVisualModuleCustomParameter: {
		description: 'Create a Visual Module-local custom parameter with a generated ID and unique nameForReference. Supported kinds are scalar, bool, string, color, vector, enum, colorRamp, and sizeReference; canNode must be false.',
		examples: ['let visualModule = Command:createVisualModule({})\nlet parameter = Command:createVisualModuleCustomParameter({ visualModule: visualModule, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ visualModule: visualModuleTargetSchema, definition: visualModuleCustomParameterInputSchema }), resultSchema: visualModuleCustomParameterReferenceSchema,
	},
	replaceVisualModuleCustomParameterDefinition: {
		description: 'Replace a custom parameter definition while retaining its ID. Changing the dataType kind clears its stored value so the new default is used. Remaining values are validated against the new definition.',
		examples: [customParameterSetup + 'Command:replaceVisualModuleCustomParameterDefinition({ target: parameter, definition: ' + scalarDefinition + ' })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema, definition: visualModuleCustomParameterInputSchema }), resultSchema: z.null(),
	},
	removeVisualModuleCustomParameter: {
		description: 'Remove a custom parameter definition and its stored value. References elsewhere remain unresolved until repaired or restored with Undo.',
		examples: [customParameterSetup + 'Command:removeVisualModuleCustomParameter({ target: parameter })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema }), resultSchema: z.null(),
	},
	setVisualModuleCustomParameterSource: {
		description: 'Set a custom parameter input source while preserving its expression modifier. Node texture connections are unavailable; use literal values, expressions, animation, or compatible parameter references.',
		examples: [customParameterSetup + 'Command:setVisualModuleCustomParameterSource({ target: parameter, source: { inputSource: "literal", value: [0.2, 0.5, 1, 1] } })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema, source: visualModuleValueParameterSourceSchema }), resultSchema: z.null(),
	},
	switchVisualModuleCustomParameterInputSource: {
		description: 'Switch a custom parameter input source and create suitable initial settings, preserving a compatible expression modifier. Supported sources depend on the parameter dataType.',
		examples: [customParameterSetup + 'Command:switchVisualModuleCustomParameterInputSource({ target: parameter, inputSource: "expression" })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema, inputSource: visualModuleValueParameterInputSourceSchema }), resultSchema: z.null(),
	},
	setVisualModuleCustomParameterExpressionModifier: {
		description: 'Replace or clear a custom parameter\'s post-input expression modifier without changing its source. null removes the modifier; the current definition and binding must support it.',
		examples: [customParameterSetup + 'Command:setVisualModuleCustomParameterExpressionModifier({ target: parameter, expressionModifier: null })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema, expressionModifier: parameterExpressionModifierSchema.nullable() }), resultSchema: z.null(),
	},
	replaceVisualModuleCustomParameterBinding: {
		description: 'Replace the complete custom parameter binding, including its expression modifier. An omitted modifier removes any previous modifier.',
		examples: [customParameterSetup + 'Command:replaceVisualModuleCustomParameterBinding({ target: parameter, binding: { inputSource: "literal", value: [0, 0, 0, 1] } })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema, binding: visualModuleValueParameterBindingSchema }), resultSchema: z.null(),
	},
	resetVisualModuleCustomParameter: {
		description: 'Remove the custom parameter\'s stored binding so its definition default is used again.',
		examples: [customParameterSetup + 'Command:resetVisualModuleCustomParameter({ target: parameter })'],
		inputSchema: z.object({ target: visualModuleCustomParameterReferenceSchema }), resultSchema: z.null(),
	},
	createVisualModuleOutput: {
		description: 'Create a named texture output with a generated ID. The name and ID must be unique within the Visual Module. The first color output becomes primary if no primary output is selected. Connect it separately with setVisualModuleOutputConnection.',
		examples: [outputSetup + '<: output'], inputSchema: z.object({ visualModule: visualModuleTargetSchema, definition: visualModuleOutputInputSchema }), resultSchema: visualModuleOutputReferenceSchema,
	},
	replaceVisualModuleOutputDefinition: {
		description: 'Replace the output name, label, and texture data type while retaining its ID and connection. A primary output changed away from color loses its primary designation.',
		examples: [outputSetup + 'Command:replaceVisualModuleOutputDefinition({ target: output, definition: { name: "auxiliary", label: "Mask", dataType: { kind: "scalar" } } })'],
		inputSchema: z.object({ target: visualModuleOutputReferenceSchema, definition: visualModuleOutputInputSchema }), resultSchema: z.null(),
	},
	removeVisualModuleOutput: {
		description: 'Remove an output definition and clear its primary designation if necessary. The Out node connection is retained so Undo restores the original wiring.',
		examples: [outputSetup + 'Command:removeVisualModuleOutput({ target: output })'],
		inputSchema: z.object({ target: visualModuleOutputReferenceSchema }), resultSchema: z.null(),
	},
};
