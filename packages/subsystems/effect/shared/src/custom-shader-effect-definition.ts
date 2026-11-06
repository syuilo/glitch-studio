import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

// 入力の値・式・配線は利用側が所有する。ここには利用場所に依存しない定義だけを保存する。
export type CustomShaderEffectParameterDefinition = ParameterDefinition<TextureDataType> & {
	id: string;
	nameForReference: string;
	canNode: true;
};

export type CustomShaderEffectOutputDefinition = {
	id: string;
	nameForReference: string;
	label: string;
	dataType: TextureDataType;
};

export type CustomShaderEffectDefinition = {
	shaderApiVersion: 1;
	codeLanguage: 'wgsl';
	code: string;
	kind: 'generate' | 'modify';
	paramDefs: CustomShaderEffectParameterDefinition[];
	outputDefs: CustomShaderEffectOutputDefinition[];
	primaryInputId: string | null;
	primaryOutputId: string | null;
	resolutionInputIds: string[];
};

type ValidationReason = 'invalidReferenceName' | 'duplicateParameter' | 'duplicateOutput' | 'invalidParameter' | 'invalidOutput' | 'missingOutput' | 'invalidPrimaryInput' | 'invalidPrimaryOutput' | 'invalidResolutionInput' | 'unsupportedShaderApi';

export class CustomShaderEffectDefinitionError extends Error {
	constructor(public readonly reason: ValidationReason, public readonly referenceName = '') {
		super(`${reason}: ${referenceName}`);
	}
}

/** WGSL本文は未完成でも保存する。ここでは編集UIが所有する入出力の契約だけを検証する。 */
export function validateCustomShaderEffectDefinition(definition: CustomShaderEffectDefinition): void {
	if (definition.shaderApiVersion !== 1) throw new CustomShaderEffectDefinitionError('unsupportedShaderApi');
	const validateNames = (items: { id: string; nameForReference: string }[], reason: 'duplicateParameter' | 'duplicateOutput') => {
		const ids = new Set<string>();
		const names = new Set<string>();
		for (const item of items) {
			if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(item.nameForReference) || item.nameForReference.includes('__') || item.nameForReference.startsWith('gs_')) {
				throw new CustomShaderEffectDefinitionError('invalidReferenceName', item.nameForReference);
			}
			if (item.id.length === 0 || ids.has(item.id) || names.has(item.nameForReference)) throw new CustomShaderEffectDefinitionError(reason, item.nameForReference);
			ids.add(item.id);
			names.add(item.nameForReference);
		}
	};
	validateNames(definition.paramDefs, 'duplicateParameter');
	validateNames(definition.outputDefs, 'duplicateOutput');
	for (const parameter of definition.paramDefs) {
		const kind = parameter.dataType.kind;
		if (!['scalar', 'vector', 'color', 'any'].includes(kind) || parameter.canNode !== true || parameter.defaultValue.inputSource !== 'literal') {
			throw new CustomShaderEffectDefinitionError('invalidParameter', parameter.nameForReference);
		}
		const value = parameter.defaultValue.value;
		const isValidValue = kind === 'scalar' ? typeof value === 'number' && Number.isFinite(value)
			: kind === 'any' && value == null ? true
			: Array.isArray(value) && value.length === (kind === 'vector' ? 2 : 4) && value.every(component => typeof component === 'number' && Number.isFinite(component));
		if (!isValidValue) throw new CustomShaderEffectDefinitionError('invalidParameter', parameter.nameForReference);
	}
	if (definition.outputDefs.length === 0) throw new CustomShaderEffectDefinitionError('missingOutput');
	for (const output of definition.outputDefs) {
		if (!['scalar', 'vector', 'color', 'any'].includes(output.dataType.kind)) throw new CustomShaderEffectDefinitionError('invalidOutput', output.nameForReference);
	}
	if (definition.primaryInputId != null && !definition.paramDefs.some(parameter => parameter.id === definition.primaryInputId && parameter.dataType.kind === 'color')) {
		throw new CustomShaderEffectDefinitionError('invalidPrimaryInput');
	}
	if (definition.primaryOutputId != null && !definition.outputDefs.some(output => output.id === definition.primaryOutputId && output.dataType.kind === 'color')) {
		throw new CustomShaderEffectDefinitionError('invalidPrimaryOutput');
	}
	if (new Set(definition.resolutionInputIds).size !== definition.resolutionInputIds.length || definition.resolutionInputIds.some(id => !definition.paramDefs.some(parameter => parameter.id === id))) {
		throw new CustomShaderEffectDefinitionError('invalidResolutionInput');
	}
}

/** ユーザーコードとは別に表示するAPIの案内。実行用のWGSLやGPUのbindingは生成しない。 */
export function describeCustomShaderEffectInterface(definition: CustomShaderEffectDefinition): string {
	const shaderType = (dataType: TextureDataType) => dataType.kind === 'scalar' ? 'f32' : dataType.kind === 'vector' ? 'vec2f' : 'vec4f';
	return [
		'struct CustomShaderEffectOutput {',
		...definition.outputDefs.map(output => `\t${output.nameForReference}: ${shaderType(output.dataType)},`),
		'};',
		'',
		...definition.paramDefs.map(parameter => `// read_${parameter.nameForReference}(position: vec2f) -> ${shaderType(parameter.dataType)}`),
		'',
		'// main(position: vec2f) -> CustomShaderEffectOutput',
	].join('\n');
}
