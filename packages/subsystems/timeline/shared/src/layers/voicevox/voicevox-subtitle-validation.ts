import { voicevoxSubtitleParamDefs } from './voicevox-subtitle.ts';
import { validateTimelineParameterTree } from '../../parameter-binding.ts';
import type { VoicevoxSubtitleParameterValues } from './voicevox-subtitle.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

export function validateVoicevoxSubtitle(values: VoicevoxSubtitleParameterValues): void {
	const definitions: Record<string, ParameterDefinition> = voicevoxSubtitleParamDefs;
	for (const [key, binding] of Object.entries(values)) {
		if (!Object.hasOwn(definitions, key)) throw new Error('Unknown VOICEVOX subtitle parameter: ' + key);
		validateTimelineParameterTree(definitions[key], binding);
	}
}
