import type { DataType } from '../data-type/data-type.ts';
import type { ParameterBindingBase } from './parameter-binding.ts';
import type { ParameterDefaultValue } from './parameter-definition.ts';

/** 未接続の音声入力はnullで保存する。接続はプレビューやTimelineなどの配置側が所有する。 */
export function validateLiteralAudioSourceBinding(binding: ParameterBindingBase): asserts binding is ParameterBindingBase & { inputSource: 'literal'; value: null } {
	if (binding.inputSource !== 'literal' || !('value' in binding)) throw new Error('Audio sources must use a static input');
	if (binding.value !== null) throw new Error('Unconnected audio inputs must be null');
}

type AudioSourceDefaultValue = ParameterDefaultValue<{ kind: 'audioSource' }>;

/** 配列や構造体に入った取得元も、保存先や配布先に合わせて付け替える。 */
export function mapParameterAudioSourceValues(
	dataType: DataType,
	value: ParameterDefaultValue,
	mapAudioSource: (value: AudioSourceDefaultValue) => AudioSourceDefaultValue,
): ParameterDefaultValue {
	if (dataType.kind === 'array' && Array.isArray(value)) {
		return value.map(element => mapParameterAudioSourceValues(dataType.elementType, element, mapAudioSource));
	}
	if (dataType.kind === 'struct' && value != null && typeof value === 'object' && !Array.isArray(value)) {
		const fields = value as Record<string, ParameterDefaultValue>;
		return Object.fromEntries(Object.entries(fields).map(([key, fieldValue]) => [
			key, Object.hasOwn(dataType.fields, key) ? mapParameterAudioSourceValues(dataType.fields[key], fieldValue, mapAudioSource) : fieldValue,
		]));
	}
	return dataType.kind === 'audioSource' ? mapAudioSource(value as AudioSourceDefaultValue) : value;
}
