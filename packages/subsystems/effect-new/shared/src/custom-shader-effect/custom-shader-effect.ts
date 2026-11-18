import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition, EffectOutputDefinition } from '../effect-definition.ts';

export type CustomShaderEffectParameterDefinition = ParameterDefinition<TextureDataType> & {
	nameForReference: string;
	canNode: true;
};

export type CustomShaderEffectOutputDefinition = EffectOutputDefinition & {
	nameForReference: string;
};

// キーは配線用の固定ID。WGSLから参照する名前は編集でき、IDとは寿命が異なる。
export type CustomShaderEffect = EffectDefinition<
	Record<string, CustomShaderEffectParameterDefinition>,
	Record<string, CustomShaderEffectOutputDefinition>
> & {
	shaderApiVersion: 1;
	codeLanguage: 'wgsl';
	code: string;
	primaryAudioInputParameter?: null;
	staticSettingDefs?: never;
};

function validateReferenceNames(definitions: Record<string, { nameForReference: string }>): void {
	const names = new Set<string>();
	for (const [id, { nameForReference }] of Object.entries(definitions)) {
		if (id.length === 0) throw new Error('Custom Shader Effect port ID must be nonempty');
		if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(nameForReference) || nameForReference.startsWith('gs_') || nameForReference.includes('__')) {
			throw new Error(`Invalid Custom Shader Effect reference name: ${nameForReference}`);
		}
		if (names.has(nameForReference)) throw new Error(`Duplicate Custom Shader Effect reference name: ${nameForReference}`);
		names.add(nameForReference);
	}
}

/** 編集・読み込み時の公開定義の検証。WGSLのコンパイルは入力の表現を確定した配置ごとに行う。 */
export function validateCustomShaderEffectDefinition(definition: CustomShaderEffect): void {
	if (definition.shaderApiVersion !== 1 || definition.codeLanguage !== 'wgsl') throw new Error('Unsupported Custom Shader Effect API');
	if (Object.keys(definition.outputDefs).length === 0) throw new Error('Custom Shader Effect requires at least one output');
	validateReferenceNames(definition.paramDefs);
	validateReferenceNames(definition.outputDefs);
	for (const [id, parameter] of Object.entries(definition.paramDefs)) {
		if (!isTextureDataType(parameter.dataType) || parameter.canNode !== true || parameter.defaultValue.inputSource !== 'literal') {
			throw new Error(`Invalid Custom Shader Effect input: ${id}`);
		}
		const { kind } = parameter.dataType;
		const value = parameter.defaultValue.value;
		const valid = kind === 'scalar' ? typeof value === 'number' && Number.isFinite(value)
			: kind === 'any' && value === null ? true
			: Array.isArray(value) && value.length === (kind === 'vector' ? 2 : 4) && value.every(Number.isFinite);
		if (!valid) throw new Error(`Invalid Custom Shader Effect input default: ${id}`);
	}
	for (const [id, output] of Object.entries(definition.outputDefs)) {
		if (!isTextureDataType(output.dataType)) throw new Error(`Invalid Custom Shader Effect output: ${id}`);
	}
	if (definition.primaryInputParameter != null && definition.paramDefs[definition.primaryInputParameter]?.dataType.kind !== 'color') {
		throw new Error('Custom Shader Effect primary input must be a color parameter');
	}
	if (definition.primaryOutput != null && definition.outputDefs[definition.primaryOutput]?.dataType.kind !== 'color') {
		throw new Error('Custom Shader Effect primary output must be a color output');
	}
	for (const id of definition.resolutionInputParameters) {
		if (!Object.hasOwn(definition.paramDefs, id)) throw new Error(`Unknown Custom Shader Effect resolution input: ${id}`);
	}
}
