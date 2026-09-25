import type { ParameterDefinition } from '../parameter.ts';
import type { ParameterBinding } from '../types.ts';
import type { EffectDefinition } from './effect-definition.ts';

type EffectParamDef = ParameterDefinition & {
	defaultValue: ParameterBinding;
};

type Definition = Omit<EffectDefinition<any>, 'paramDefs'> & { paramDefs: Record<string, EffectParamDef> };

const modules = import.meta.glob<Definition>('./effects/*/_def_.ts', {
	eager: true,
	import: 'default',
});

// ディレクトリ名を登録キーとし、一覧の表示順を一定にする
export const effectDefinitions: Record<string, Definition> = Object.fromEntries(
	Object.keys(modules).sort().map(path => [path.split('/').at(-2)!, modules[path]]),
);
