import type { ParameterDefinition } from '../parameter.ts';
import type { EffectDefinition } from './effect-definition.ts';

type Definition = Omit<EffectDefinition<any>, 'paramDefs'> & { paramDefs: Record<string, ParameterDefinition> };

const modules = import.meta.glob<Definition>('./fx/*/_def_.ts', {
	eager: true,
	import: 'default',
});

// ディレクトリ名を登録キーとし、一覧の表示順を一定にする
export const effectDefinitions: Record<string, Definition> = Object.fromEntries(
	Object.keys(modules).sort().map(path => [path.split('/').at(-2)!, modules[path]]),
);
