import { deepClone } from '../utility/deep-clone.ts';
import type { DataType } from '../data-type/data-type.ts';
import type { ParameterSettings } from './parameter-definition.ts';

// 型変更時にも利用するため、完成済みのUIや最上位の初期値は要求しない。
// structの空値には各フィールドのBindingの初期値を使う。
type EmptyValueDefinition =
	| { dataType: Exclude<DataType, { kind: 'struct' }> }
	| { dataType: Extract<DataType, { kind: 'struct' }>; fields: Record<string, ParameterSettings<DataType>> };

export function genEmptyValue(paramDef: EmptyValueDefinition): any {
	switch (paramDef.dataType.kind) {
		case 'scalar': return 0;
		case 'enum': return paramDef.dataType.options[0] ?? '';
		case 'bool': return false;
		case 'string': return '';
		case 'blendMode': return 'normal';
		case 'fitMode': return 'stretch';
		case 'wrapMode': return 'repeatMirrored';
		case 'vector': return [0, 0];
		case 'color': return [0, 0, 0, 1];
		case 'any': case 'assetReference': case 'videoAssetReference': case 'fontAssetReference': case 'playerReference': case 'audioSource': return null;
		case 'array': return [];
		case 'struct': {
			if (!('fields' in paramDef)) throw new Error('Struct parameter settings are required');
			return Object.fromEntries(Object.keys(paramDef.dataType.fields).map(key => [key, deepClone(paramDef.fields[key].defaultValue)]));
		}
	}
}
