import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { constantShaderInputComponents } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectParameterInput } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';

/** Web Componentの公開値を、描画計画が実際に要求した入力だけに束縛する。 */
export function createPortableEffectInputs(definitions: CustomNodeGraphEffect['paramDefs'], initial: Record<string, unknown>) {
	let values = initial;
	const sameLayout: (() => boolean)[] = [];
	const updateUniforms: (() => void)[] = [];

	function bind(def: ParameterDefinition, read: () => unknown): EffectParameterInput {
		if (isParameterType(def, 'array')) {
			const array = () => read() as unknown[];
			const length = array().length;
			sameLayout.push(() => array().length === length);
			const element = getArrayElementDefinition(def);
			return { kind: 'array', elements: Array.from({ length }, (_, i) => bind(element, () => array()[i])) };
		}
		if (isParameterType(def, 'struct')) {
			return { kind: 'struct', fields: Object.fromEntries(Object.entries(getStructFieldDefinitions(def)).map(([key, field]) =>
				[key, bind(field, () => (read() as Record<string, unknown>)[key])])) };
		}
		if (def.canNode === true) {
			const components = () => constantShaderInputComponents(def.dataType.kind, read());
			let value = components();
			updateUniforms.push(() => { value = components(); });
			return { kind: 'uniform', get value() { return value; } };
		}
		return { kind: 'value', get value() { return read(); } };
	}

	const inputs: Record<string, EffectParameterInput> = Object.create(null);
	for (const [id, def] of Object.entries(definitions)) {
		const name = def.nameForReference ?? id;
		let input: EffectParameterInput | null = null;
		Object.defineProperty(inputs, id, { get: () => input ??= bind(def, () => values[name]), enumerable: true });
	}
	return {
		inputs,
		update(next: Record<string, unknown>) {
			values = next;
			// 親から順に調べるため、短くなった配列の範囲外にある子を読まない。
			if (!sameLayout.every(check => check())) return false;
			for (const update of updateUniforms) update();
			return true;
		},
	};
}
