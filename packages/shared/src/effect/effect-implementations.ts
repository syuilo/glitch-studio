import type { EffectImplementation } from '@glitch/shared/effect/effect-implementation.js';

const modules = import.meta.glob<EffectImplementation<any>>('./effects/*/_impl_.ts', {
	eager: true,
	import: 'default',
});

// ディレクトリ名を登録キーとし、一覧の表示順を一定にする。
export const effectImplementations: Record<string, EffectImplementation<any>> = Object.fromEntries(
	Object.keys(modules).sort().map(path => [path.split('/').at(-2)!, modules[path]]),
);
