import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import * as z from 'zod';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { validateProjectCurveAnimationName } from '@gs/glitch-studio_shared/project/curve-animations.ts';
import { createProjectCurveAnimation } from '../utility/curve-animation.ts';
import { defineCommand, definePublicCommand, withCommandContract } from './definition.ts';
import { prepareProjectValueChange } from './prepared-value.ts';
import { projectResolutionSchema, timelineMotionBlurSettingsSchema, curveAnimationDefinitionSchema } from './project-contract-schemas.ts';
import { curveAnimationPointSchema } from './parameter-contract-schemas.ts';
import type { ExportDialogSettings } from '../export/export-settings.ts';
import type { ProjectState } from '../Project.ts';
import type { CurveAnimation, CurveAnimationData } from '@gs/shared/curve-animation/curve-animation.ts';

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

function validateCurveAnimationData(data: CurveAnimationData): void {
	if (typeof data.isNormalized !== 'boolean' || !Array.isArray(data.points)) throw new Error('Invalid Curve Animation data');
	const ids = new Set<string>();
	for (const point of data.points) {
		if (typeof point.id !== 'string' || point.id.length === 0 || ids.has(point.id)) throw new Error('Invalid or duplicate Curve Animation point ID');
		ids.add(point.id);
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
			|| !Array.isArray(point.bezierControlPointA) || point.bezierControlPointA.length !== 2 || !point.bezierControlPointA.every(Number.isFinite)
			|| !Array.isArray(point.bezierControlPointB) || point.bezierControlPointB.length !== 2 || !point.bezierControlPointB.every(Number.isFinite)) {
			throw new Error('Curve Animation points must contain finite coordinates');
		}
	}
}

function prepareCurveAnimationCreation(state: ProjectState, curveAnimation: CurveAnimation) {
	validateCurveAnimationData(curveAnimation);
	validateProjectCurveAnimationName(state.curveAnimations.value, curveAnimation);
	const saved = deepClone(curveAnimation);
	return { result: { curveAnimationId: saved.id }, change: {
		changes: [{ type: 'curveAnimations' as const }],
		apply: (current: ProjectState) => { current.curveAnimations.value.push(deepClone(saved)); },
		revert: (current: ProjectState) => { current.curveAnimations.value = current.curveAnimations.value.filter(curveAnimation => curveAnimation.id !== saved.id); },
	} };
}

const createProjectCurveAnimationCommand = definePublicCommand({
	label: 'Create project Curve Animation',
	inputSchema: z.object({
		nameForReference: z.string().nullish().describe('Omit or pass null to generate a unique name based on my_curve_animation.'),
		data: z.object({ isNormalized: z.boolean(), points: z.array(curveAnimationPointSchema.omit({ id: true })) }).nullish()
			.describe('Omit or pass null for the default Curve Animation. When isNormalized is true, X is normalized. Otherwise, X is in milliseconds. Point IDs are generated.'),
	}), resultSchema: z.object({ curveAnimationId: z.string() }),
	description: 'Create a project Curve Animation and return its reference. The supplied reference name must be valid and unique in the project.',
	examples: ['let curveAnimation = Command:createProjectCurveAnimation({ nameForReference: "brightness" })\n<: Query:getProjectCurveAnimation(curveAnimation)'],
	prepare(state, input) {
		const curveAnimation = createProjectCurveAnimation(state.curveAnimations.value);
		if (input.nameForReference != null) curveAnimation.nameForReference = input.nameForReference;
		if (input.data != null) {
			curveAnimation.isNormalized = input.data.isNormalized;
			curveAnimation.points = input.data.points.map(point => ({ ...deepClone(point), id: genId() }));
		}
		return prepareCurveAnimationCreation(state, curveAnimation);
	},
});

const duplicateProjectCurveAnimation = definePublicCommand({
	label: 'Duplicate project Curve Animation',
	inputSchema: z.object({ curveAnimationId: z.string().min(1), nameForReference: z.string().nullish() }),
	resultSchema: z.object({ curveAnimationId: z.string() }),
	description: 'Duplicate a project Curve Animation and generate new IDs for the copy and all its points. Omit nameForReference or pass null to generate a unique name from the original.',
	examples: ['let curveAnimation = Command:createProjectCurveAnimation({})\nlet copy = Command:duplicateProjectCurveAnimation(curveAnimation)'],
	prepare(state, input) {
		const source = state.curveAnimations.value.find(curveAnimation => curveAnimation.id === input.curveAnimationId);
		if (source == null) throw new Error('Curve Animation not found');
		const definition = createProjectCurveAnimation(state.curveAnimations.value, source);
		if (input.nameForReference != null) definition.nameForReference = input.nameForReference;
		return prepareCurveAnimationCreation(state, definition);
	},
});

const replaceProjectCurveAnimation = definePublicCommand({
	label: 'Replace project Curve Animation',
	inputSchema: z.object({ curveAnimationId: z.string().min(1), definition: curveAnimationDefinitionSchema }),
	resultSchema: z.null(),
	description: 'Replace the reference name and curve data of a project Curve Animation while preserving its ID. Supply all curve data and stable point IDs.',
	examples: ['let curveAnimation = Command:createProjectCurveAnimation({})\nCommand:replaceProjectCurveAnimation({ curveAnimationId: curveAnimation.curveAnimationId, definition: { nameForReference: "empty_curve_animation", isNormalized: true, points: [] } })'],
	prepare(state, { curveAnimationId, definition }) {
		const before = state.curveAnimations.value.find(curveAnimation => curveAnimation.id === curveAnimationId);
		if (before == null) throw new Error('Curve Animation not found');
		const after = { ...definition, id: curveAnimationId };
		validateCurveAnimationData(after);
		validateProjectCurveAnimationName(state.curveAnimations.value, after);
		return prepareProjectValueChange({
			before,
			after,
			changes: [{ type: 'curveAnimations' }],
			result: undefined,
			write(current, next) { current.curveAnimations.value[current.curveAnimations.value.findIndex(curveAnimation => curveAnimation.id === curveAnimationId)] = next; },
		});
	},
});

const removeProjectCurveAnimation = definePublicCommand({
	label: 'Remove project Curve Animation',
	inputSchema: z.object({ curveAnimationId: z.string().min(1) }),
	resultSchema: z.null(),
	description: 'Remove a project Curve Animation. Existing references to its ID become unresolved. Undo restores the Curve Animation and reconnects them.',
	examples: ['let curveAnimation = Command:createProjectCurveAnimation({})\nCommand:removeProjectCurveAnimation(curveAnimation)'],
	prepare(state, { curveAnimationId }) {
		const index = state.curveAnimations.value.findIndex(curveAnimation => curveAnimation.id === curveAnimationId);
		if (index < 0) throw new Error('Curve Animation not found');
		const saved = deepClone(state.curveAnimations.value[index]);
		// 参照IDを残す既存仕様を維持し、Undoで同じ定義へ再接続する。
		return {
			result: undefined,
			change: {
				changes: [{ type: 'curveAnimations' }],
				apply: current => { current.curveAnimations.value = current.curveAnimations.value.filter(curveAnimation => curveAnimation.id !== curveAnimationId); },
				revert: current => { current.curveAnimations.value.splice(index, 0, deepClone(saved)); },
			},
		};
	},
});

export const PROJECT_COMMAND_DEFS = {
	setProjectName, setProjectDescription, setProjectAuthor,
	setProjectResolution, setExportSettings, setTimelineRenderSettings,
	createProjectCurveAnimation: createProjectCurveAnimationCommand,
	duplicateProjectCurveAnimation,
	replaceProjectCurveAnimation, removeProjectCurveAnimation,
};
