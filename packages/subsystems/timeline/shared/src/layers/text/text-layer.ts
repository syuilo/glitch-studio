import { textParamDefs } from './text.ts';
import { inspectTimelineParameters } from '../../parameter-validation.ts';
import type { TextParameterValues } from './text.ts';

export function validateTimelineText(values: TextParameterValues): void {
	const diagnostics = inspectTimelineParameters(textParamDefs, values, false, false, 'text parameter');
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}
