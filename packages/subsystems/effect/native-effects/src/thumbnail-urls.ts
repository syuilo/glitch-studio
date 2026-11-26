import { nativeEffectDefinitions } from './definitions.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';

// ピッカー専用の入口からのみ参照する。実装や定義のカタログを使うWorkerには画像を取り込まない。
const thumbnailUrls = import.meta.glob<string>('./fx/*/thumbnail.webp', { eager: true, import: 'default', query: '?url&no-inline' });
const definitions: Readonly<Record<string, NativeEffectDefinition>> = nativeEffectDefinitions;

export function getNativeEffectThumbnailUrl(nativeEffectId: string): string | null {
	const mode = definitions[nativeEffectId]?.thumbnail?.mode ?? 'none';
	return mode === 'none' ? null : thumbnailUrls[`./fx/${nativeEffectId}/thumbnail.webp`] ?? null;
}
