import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import * as z from 'zod';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { validateProjectFunctionCurveName } from '@gs/glitch-studio_shared/project/function-curves.ts';
import { createProjectFunctionCurve } from '../utility/curve-animation.ts';
import { defineCommand, definePublicCommand, withCommandContract } from './definition.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { projectResolutionSchema, timelineMotionBlurSettingsSchema, functionCurveDefinitionSchema } from './project-contract-schemas.ts';
import { newFunctionCurveSchema } from './parameter-contract-schemas.ts';
import type { ExportDialogSettings } from '../export/export-settings.ts';
import type { ProjectState } from '../Project.ts';
import type { SharedFunctionCurve } from '@gs/shared/function-curve/function-curve.ts';

function projectTextCommand<Field extends 'name' | 'description' | 'author'>(field: Field, label: string) {
	return withCommandContract(defineCommand<Record<Field, string>>({
		label,
		getAutoMergeKey: () => `project:${field}`,
		prepare(state, input) {
			const value = input[field];
			if (typeof value !== 'string') throw new Error(`Project ${field} must be a string`);
			return prepareProjectValueChange({
				before: state[field].value,
				after: value,
				write: (current, next) => { current[field].value = next; },
				changes: [],
				result: undefined,
			});
		},
	}), {
		inputSchema: z.object({ [field]: z.string() }), resultSchema: z.null(),
		description: `Set the project ${field}. An empty string clears the text. This changes project metadata without saving the project file.`,
		examples: [`Command:setProject${field[0].toUpperCase()}${field.slice(1)}({ ${field}: "Example" })`],
	});
}

const setProjectName = projectTextCommand('name', 'Set project name');
const setProjectDescription = projectTextCommand('description', 'Set project description');
const setProjectAuthor = projectTextCommand('author', 'Set project author');

const setExportSettings = defineCommand<{ settings: ExportDialogSettings }>({
	label: 'Set export settings',
	prepare(state, { settings }) {
		return prepareProjectValueChange<ExportDialogSettings | null>({
			before: state.exportSettings.value,
			after: settings,
			write: (current, next) => { current.exportSettings.value = next; },
			changes: [],
			result: undefined,
		});
	},
});

const setTimelineRenderSettings = definePublicCommand({
	label: 'Set timeline render settings',
	inputSchema: z.object({ timelineFps: z.number().min(1).max(120), timelineMotionBlur: timelineMotionBlurSettingsSchema }), resultSchema: z.null(),
	description: 'Set the project Timeline frame rate (1–120 fps) and motion blur settings. Applies to the project, not just the selected Scene.',
	examples: ['Command:setTimelineRenderSettings({ timelineFps: 30, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 8 } })'],
	prepare(state, input) {
		validateTimelineFps(input.timelineFps);
		validateTimelineMotionBlur(input.timelineMotionBlur);
		return prepareProjectValueChange({
			before: { timelineFps: state.timelineFps.value, timelineMotionBlur: state.timelineMotionBlur.value }, after: input,
			write(current, next) { current.timelineFps.value = next.timelineFps; current.timelineMotionBlur.value = next.timelineMotionBlur; },
			changes: [{ type: 'timelineRenderSettings' }], result: undefined,
		});
	},
});

const setProjectResolution = definePublicCommand({
	label: 'Set project resolution',
	inputSchema: z.object({ resolution: projectResolutionSchema }),
	resultSchema: z.null(),
	description: 'Set the project resolution in pixels. Width and height must be positive safe integers. Scenes that inherit project resolution follow this setting.',
	examples: ['Command:setProjectResolution({ resolution: { width: 1920, height: 1080 } })'],
	prepare(state, { resolution }) {
		if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
			throw new Error('Resolution width and height must be positive integers');
		}
		return prepareProjectValueChange({
			before: state.resolution.value,
			after: resolution,
			write: (current, next) => { current.resolution.value = next; },
			changes: [{ type: 'projectResolution' }],
			result: undefined,
		});
	},
});

function prepareFunctionCurveCreation(state: ProjectState, functionCurve: SharedFunctionCurve) {
	validateProjectFunctionCurveName(state.functionCurves.value, functionCurve);
	const saved = deepClone(functionCurve);
	return { result: { functionCurveId: saved.id }, change: {
		changes: [{ type: 'functionCurves' as const }],
		apply: (current: ProjectState) => { current.functionCurves.value.push(deepClone(saved)); },
		revert: (current: ProjectState) => { current.functionCurves.value = current.functionCurves.value.filter(functionCurve => functionCurve.id !== saved.id); },
	} };
}

const createProjectFunctionCurveCommand = definePublicCommand({
	label: 'Create project Function Curve',
	inputSchema: z.object({
		nameForReference: z.string().nullish().describe('Omit or pass null to generate a unique name based on my_function_curve.'),
		data: newFunctionCurveSchema.nullish().describe('Omit or pass null for the default Bézier Function Curve. Bézier point IDs are generated.'),
	}), resultSchema: z.object({ functionCurveId: z.string() }),
	description: 'Create a project Function Curve and return its reference. The supplied reference name must be valid and unique in the project.',
	examples: ['let functionCurve = Command:createProjectFunctionCurve({ nameForReference: "brightness", data: { type: "smoothPulse" } })\n<: Query:getProjectFunctionCurve(functionCurve)'],
	prepare(state, input) {
		const defaultCurve = createProjectFunctionCurve(state.functionCurves.value);
		const data = input.data;
		const functionCurve = data == null ? defaultCurve : data.type === 'bezier'
			? { ...data, points: data.points.map(point => ({ ...point, id: genId() })) }
			: data;
		return prepareFunctionCurveCreation(state, { ...functionCurve, id: defaultCurve.id, nameForReference: input.nameForReference ?? defaultCurve.nameForReference });
	},
});

const duplicateProjectFunctionCurve = definePublicCommand({
	label: 'Duplicate project Function Curve',
	inputSchema: z.object({ functionCurveId: z.string().min(1), nameForReference: z.string().nullish() }),
	resultSchema: z.object({ functionCurveId: z.string() }),
	description: 'Duplicate a project Function Curve and generate a new ID for the copy and for any Bézier points. Omit nameForReference or pass null to generate a unique name from the original.',
	examples: ['let functionCurve = Command:createProjectFunctionCurve({})\nlet copy = Command:duplicateProjectFunctionCurve(functionCurve)'],
	prepare(state, input) {
		const source = state.functionCurves.value.find(functionCurve => functionCurve.id === input.functionCurveId);
		if (source == null) throw new Error('Function Curve not found');
		const definition = createProjectFunctionCurve(state.functionCurves.value, source);
		if (input.nameForReference != null) definition.nameForReference = input.nameForReference;
		return prepareFunctionCurveCreation(state, definition);
	},
});

const replaceProjectFunctionCurve = definePublicCommand({
	label: 'Replace project Function Curve',
	inputSchema: z.object({ functionCurveId: z.string().min(1), definition: functionCurveDefinitionSchema }),
	resultSchema: z.null(),
	description: 'Replace the reference name and curve data of a project Function Curve while preserving its ID. Supply all settings for the curve type. Preserve point IDs when editing Bézier points.',
	examples: ['let functionCurve = Command:createProjectFunctionCurve({})\nCommand:replaceProjectFunctionCurve({ functionCurveId: functionCurve.functionCurveId, definition: { nameForReference: "empty_function_curve", type: "bezier", isXNormalized: true, isYNormalized: true, points: [] } })'],
	prepare(state, { functionCurveId, definition }) {
		const before = state.functionCurves.value.find(functionCurve => functionCurve.id === functionCurveId);
		if (before == null) throw new Error('Function Curve not found');
		const after = { ...definition, id: functionCurveId };
		validateProjectFunctionCurveName(state.functionCurves.value, after);
		return prepareProjectValueChange({
			before,
			after,
			changes: [{ type: 'functionCurves' }],
			result: undefined,
			write(current, next) { current.functionCurves.value[current.functionCurves.value.findIndex(functionCurve => functionCurve.id === functionCurveId)] = next; },
		});
	},
});

const removeProjectFunctionCurve = definePublicCommand({
	label: 'Remove project Function Curve',
	inputSchema: z.object({ functionCurveId: z.string().min(1) }),
	resultSchema: z.null(),
	description: 'Remove a project Function Curve. Existing references to its ID become unresolved. Undo restores the Function Curve and reconnects them.',
	examples: ['let functionCurve = Command:createProjectFunctionCurve({})\nCommand:removeProjectFunctionCurve(functionCurve)'],
	prepare(state, { functionCurveId }) {
		const index = state.functionCurves.value.findIndex(functionCurve => functionCurve.id === functionCurveId);
		if (index < 0) throw new Error('Function Curve not found');
		const saved = deepClone(state.functionCurves.value[index]);
		// 参照IDを残す既存仕様を維持し、Undoで同じ定義へ再接続する。
		return {
			result: undefined,
			change: {
				changes: [{ type: 'functionCurves' }],
				apply: current => { current.functionCurves.value = current.functionCurves.value.filter(functionCurve => functionCurve.id !== functionCurveId); },
				revert: current => { current.functionCurves.value.splice(index, 0, deepClone(saved)); },
			},
		};
	},
});

export const PROJECT_COMMAND_DEFS = {
	setProjectName, setProjectDescription, setProjectAuthor,
	setProjectResolution, setExportSettings, setTimelineRenderSettings,
	createProjectFunctionCurve: createProjectFunctionCurveCommand,
	duplicateProjectFunctionCurve,
	replaceProjectFunctionCurve, removeProjectFunctionCurve,
};
