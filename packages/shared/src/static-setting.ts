/** 静的設定は編集時だけ変更し、式・キー・接続などのBindingを保存しない。 */
export type StaticSettingDataType =
	| { kind: 'assetReference'; assetType: 'image' | 'video' | 'font' | 'lut' }
	| { kind: 'playerReference' }
	| { kind: 'scalar' }
	| { kind: 'bool' }
	| { kind: 'string' }
	| { kind: 'enum'; options: readonly string[] };

export type AssetReferenceDataType = Extract<StaticSettingDataType, { kind: 'assetReference' }>;
export type StaticSettingValue<T extends StaticSettingDataType> =
	T extends { kind: 'scalar' } ? number : T extends { kind: 'bool' } ? boolean :
	T extends { kind: 'enum'; options: infer Options extends readonly string[] } ? Options[number] :
	T extends { kind: 'string' } ? string : string | null;

export type StaticSettingDefinition<T extends StaticSettingDataType = StaticSettingDataType> = T extends StaticSettingDataType ? {
	dataType: T;
	ui: { label: string };
	defaultValue: StaticSettingValue<T>;
} : never;
export type StaticSettingDefinitions = Record<string, StaticSettingDefinition>;
export type StaticSettingValues<Definitions extends StaticSettingDefinitions = StaticSettingDefinitions> = {
	[Key in keyof Definitions]: StaticSettingValue<Definitions[Key]['dataType']>;
};

export function createStaticSettingValues<Definitions extends StaticSettingDefinitions>(definitions: Definitions): StaticSettingValues<Definitions> {
	return Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [key, definition.defaultValue])) as StaticSettingValues<Definitions>;
}

export function validateStaticSettingValue(definition: StaticSettingDefinition, value: unknown): void {
	const type = definition.dataType;
	const valid = type.kind === 'scalar' ? typeof value === 'number' && Number.isFinite(value)
		: type.kind === 'bool' ? typeof value === 'boolean'
		: type.kind === 'string' ? typeof value === 'string'
		: type.kind === 'enum' ? typeof value === 'string' && type.options.includes(value)
		: value === null || (typeof value === 'string' && value.length > 0);
	if (!valid) throw new Error(`Invalid static setting ${JSON.stringify(definition.ui.label)}`);
}

export function validateStaticSettings(definitions: StaticSettingDefinitions, values: StaticSettingValues): void {
	for (const key of Object.keys(values)) {
		if (!Object.hasOwn(definitions, key)) throw new Error(`Unknown static setting: ${key}`);
	}
	for (const [key, definition] of Object.entries(definitions)) validateStaticSettingValue(definition, (Object.hasOwn(values, key) ? values[key] : definition.defaultValue));
}
