import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { EffectParameterInput, EffectRenderOperation } from './effect-instance.ts';

/** 接続・配列長・構造体フィールドは固定。生成時に末端ごとの変更検出だけを組み立てる。 */
export function createRenderCache(inputs: Readonly<Record<string, EffectParameterInput>>, operation: EffectRenderOperation) {
	const changed: (() => boolean)[] = [];

	function watch(input: EffectParameterInput) {
		if (input.kind === 'array' || input.kind === 'struct') {
			for (const child of input.kind === 'array' ? input.elements : Object.values(input.fields)) watch(child);
		} else if (input.kind === 'texture') {
			let texture: GPUTexture | null = null;
			let version: number | undefined;
			changed.push(() => {
				const next = input.texture;
				const nextVersion = input.version;
				// 外部から借りたテクスチャは同じオブジェクトでも内容が変わり得る。変更世代がなければ毎回描画する。
				const dirty = nextVersion == null || next !== texture || nextVersion !== version;
				texture = next;
				version = nextVersion;
				return dirty;
			});
		} else {
			let previous: Parameters<typeof deepEqual>[0];
			changed.push(() => {
				const value = input.value;
				// AudioInputは関数と借用PCMを持つ。取得元が与えるスナップショットのキーだけを比較する。
				const key = (value != null && typeof value === 'object' && 'cacheKey' in value ? value.cacheKey : value) as typeof previous;
				if (deepEqual(previous, key)) return false;
				previous = typeof key === 'object' && key != null ? structuredClone(key) : key;
				return true;
			});
		}
	}

	for (const input of Object.values(inputs)) watch(input);
	let valid = false;
	let lastKey: string | number | undefined;
	return {
		needsRender() {
			const key = operation.cacheKey;
			let dirty = !valid || key == null || key !== lastKey;
			// 全入力を同じフレームの状態に進めるため、最初の変更で走査を打ち切らない。
			for (const read of changed) if (read()) dirty = true;
			lastKey = key;
			return dirty;
		},
		commit() { valid = true; },
		reset() { valid = false; },
	};
}
