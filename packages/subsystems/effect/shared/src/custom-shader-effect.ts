import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from './effect-definition.ts';

export interface CustomShaderEffect extends EffectDefinition {
	readonly canHaveLongRunningRenderPass?: boolean;
	readonly shaderApiVersion: 1;
	readonly code: string;
	readonly paramDefs: Readonly<Record<string, ParameterDefinition<TextureDataType> & { canNode: true; nameForReference: string }>>;
	readonly outputDefs: Readonly<Record<string, { dataType: TextureDataType; nameForReference: string; label?: string }>>;
}

type ValidationReason = 'invalidReferenceName' | 'duplicateParameter' | 'duplicateOutput' | 'invalidParameter' | 'invalidOutput' | 'missingOutput' | 'invalidPrimaryInput' | 'invalidPrimaryOutput' | 'invalidResolutionInput' | 'unsupportedShaderApi';

export class CustomShaderEffectDefinitionError extends Error {
	public readonly reason: ValidationReason;
	public readonly referenceName: string;
	constructor(reason: ValidationReason, referenceName = '') {
		super(`${reason}: ${referenceName}`);
		this.reason = reason;
		this.referenceName = referenceName;
	}
}

/** WGSL本文は未完成でも保存する。ここでは編集UIが所有する入出力の契約だけを検証する。 */
export function validateCustomShaderEffectDefinition(definition: CustomShaderEffect): void {
	if (definition.shaderApiVersion !== 1) throw new CustomShaderEffectDefinitionError('unsupportedShaderApi');
	const validateNames = (items: Readonly<Record<string, { nameForReference: string }>>, reason: 'duplicateParameter' | 'duplicateOutput') => {
		const names = new Set<string>();
		for (const [id, item] of Object.entries(items)) {
			if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(item.nameForReference) || item.nameForReference.includes('__') || item.nameForReference.startsWith('gs_')) {
				throw new CustomShaderEffectDefinitionError('invalidReferenceName', item.nameForReference);
			}
			if (id.length === 0 || names.has(item.nameForReference)) throw new CustomShaderEffectDefinitionError(reason, item.nameForReference);
			names.add(item.nameForReference);
		}
	};
	validateNames(definition.paramDefs, 'duplicateParameter');
	validateNames(definition.outputDefs, 'duplicateOutput');
	for (const parameter of Object.values(definition.paramDefs)) {
		const kind = parameter.dataType.kind;
		const defaultValue = parameter.defaultValue;
		if (!['scalar', 'vector', 'color', 'any'].includes(kind) || parameter.canNode !== true
			|| defaultValue == null || defaultValue.inputSource !== 'literal' || !('value' in defaultValue) || defaultValue.expressionModifier != null) {
			throw new CustomShaderEffectDefinitionError('invalidParameter', parameter.nameForReference);
		}
		const value = defaultValue.value;
		const isValidValue = kind === 'scalar' ? typeof value === 'number' && Number.isFinite(value)
			: kind === 'any' && value === null ? true
			: Array.isArray(value) && value.length === (kind === 'vector' ? 2 : 4) && value.every(component => typeof component === 'number' && Number.isFinite(component));
		if (!isValidValue) throw new CustomShaderEffectDefinitionError('invalidParameter', parameter.nameForReference);
	}
	if (Object.keys(definition.outputDefs).length === 0) throw new CustomShaderEffectDefinitionError('missingOutput');
	for (const output of Object.values(definition.outputDefs)) {
		if (!['scalar', 'vector', 'color', 'any'].includes(output.dataType.kind)) throw new CustomShaderEffectDefinitionError('invalidOutput', output.nameForReference);
	}
	if (definition.primaryInputParameter != null && definition.paramDefs[definition.primaryInputParameter]?.dataType.kind !== 'color') {
		throw new CustomShaderEffectDefinitionError('invalidPrimaryInput');
	}
	if (definition.primaryOutput != null && definition.outputDefs[definition.primaryOutput] == null) {
		throw new CustomShaderEffectDefinitionError('invalidPrimaryOutput');
	}
	if (new Set(definition.resolutionInputParameters).size !== definition.resolutionInputParameters.length
		|| definition.resolutionInputParameters.some(id => definition.paramDefs[id] == null)) {
		throw new CustomShaderEffectDefinitionError('invalidResolutionInput');
	}
}

/** ユーザーコードとは別に表示するAPIの案内。実行用のWGSLやGPUのbindingは生成しない。 */
export function describeCustomShaderEffectInterface(definition: CustomShaderEffect): string {
	const shaderType = (dataType: TextureDataType) => dataType.kind === 'scalar' ? 'f32' : dataType.kind === 'vector' ? 'vec2f' : 'vec4f';
	return [
		'struct Output {',
		...Object.values(definition.outputDefs).map(output => `\t${output.nameForReference}: ${shaderType(output.dataType)},`),
		'};',
		'',
		...Object.values(definition.paramDefs).map(parameter => `// read_${parameter.nameForReference}(position: vec2f) -> ${shaderType(parameter.dataType)}`),
		'',
		'// main(position: vec2f) -> Output',
		'// get_resolution() -> vec2f (pixels)',
		'// get_pixel_size() -> f32 (spatial units)',
	].join('\n');
}
