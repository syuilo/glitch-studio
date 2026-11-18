import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterSettings } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { EffectInstanceOptions, EffectInputKind } from './effect-instance.ts';

type InputCheck = (value: unknown) => void;
type Settings = ParameterSettings<DataType>;

function hasConnectableInput(settings: Settings): boolean {
	if ('element' in settings) return hasConnectableInput(settings.element);
	if ('fields' in settings) return Object.values(settings.fields).some(hasConnectableInput);
	return settings.canNode === true;
}

/** 外部から各フレームに渡される公開引数を検査する。内部ノードの入力は初期化時の配線計画で種類が決まる。 */
export function planPublicInputCheck(definition: EffectDefinition, inputKinds: EffectInstanceOptions['inputKinds']): InputCheck | null {
	function plan(settings: Settings, kind: EffectInputKind | undefined, path: string): InputCheck | null {
		if (!hasConnectableInput(settings)) return null;
		if ('element' in settings && Array.isArray(kind)) {
			const elements = kind.map((element, i) => plan(settings.element, element, `${path}[${i}]`));
			return value => {
				if (!Array.isArray(value) || value.length !== elements.length) throw new Error(`Effect input array length changed: ${path}`);
				for (const [i, check] of elements.entries()) check?.(value[i]);
			};
		}
		if ('fields' in settings && kind != null && typeof kind === 'object' && !Array.isArray(kind)) {
			return planFields(settings.fields, kind as Readonly<Record<string, EffectInputKind>>, path + '.');
		}
		if (settings.canNode === true && (kind === 'uniform' || kind === 'texture')) {
			return value => {
				if ((value as { kind?: unknown } | null)?.kind !== kind) throw new Error(`Effect input ${path} requires ${kind}`);
			};
		}
		throw new Error(`Expected a fixed input kind for ${path}`);
	}

	function planFields(fields: Readonly<Record<string, Settings>>, kinds: Readonly<Record<string, EffectInputKind>>, prefix: string): InputCheck | null {
		const checks: [string, InputCheck][] = [];
		for (const [id, field] of Object.entries(fields)) {
			const check = plan(field, Object.hasOwn(kinds, id) ? kinds[id] : null, prefix + id);
			if (check != null) checks.push([id, check]);
		}
		if (checks.length === 0) return null;
		return value => {
			const values = value as Readonly<Record<string, unknown>> | null;
			for (const [id, check] of checks) check(values?.[id]);
		};
	}

	return planFields(definition.paramDefs, inputKinds, '');
}
