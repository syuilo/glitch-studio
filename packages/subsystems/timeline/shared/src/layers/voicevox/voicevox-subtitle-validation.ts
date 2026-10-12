import { voicevoxSubtitleParamDefs } from './voicevox-subtitle.ts';
import { inspectTimelineParameters } from '../../parameter-validation.ts';
import type { VoicevoxSubtitleParameterValues } from './voicevox-subtitle.ts';

export function validateVoicevoxSubtitle(values: VoicevoxSubtitleParameterValues): void {
	const diagnostics = inspectTimelineParameters(voicevoxSubtitleParamDefs, values, false, false, 'VOICEVOX subtitle parameter');
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}
