import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** キーは保存される配線の識別子。式・WGSLの変数名や表示名が変わっても維持する。 */
export type EffectDefinition = {
	readonly paramDefs: Readonly<Record<string, ParameterDefinition>>;
	readonly outputDefs: Readonly<Record<string, { dataType: TextureDataType; label?: string }>>;
	readonly primaryInputId: string | null;
	readonly primaryAudioInputId: string | null;
	readonly primaryOutputId: string | null;
};

/** Timeline等の合成先が使用する条件。スカラー場などを公開するEffectもノードとしては使用できる。 */
export function hasPrimaryColorOutput(definition: EffectDefinition): boolean {
	const id = definition.primaryOutputId;
	return id != null && Object.hasOwn(definition.outputDefs, id) && definition.outputDefs[id].dataType.kind === 'color';
}
