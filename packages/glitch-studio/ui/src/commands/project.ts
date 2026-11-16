import { validateTimelineFps, validateTimelineMotionBlur } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { validateProjectAutomationGraphName } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { AutomationGraph, AutomationGraphData, BezierAnchorPoint } from '@gs/shared/automation-graph/automation-graph.ts';
import type { ProjectState } from '../Project.ts';
import type { ExportDialogSettings } from '../export/export-settings.ts';
import { createProjectAutomationGraph } from '../utility/automation-graph.ts';
import { defineCommand } from './definition.ts';
import { prepareProjectValueChange } from './prepared-value.ts';

function projectTextCommand<Field extends 'name' | 'description' | 'author'>(field: Field, label: string) {
	return defineCommand<Record<Field, string>>({
		label,
		getAutoMergeKey: () => `project:${field}`,
		prepare(state, input) {
			const value = input[field];
			if (typeof value !== 'string') throw new Error(`Project ${field} must be a string`);
			return prepareProjectValueChange({ before: state[field].value, after: value,
				write: (current, next) => { current[field].value = next; }, changes: [], result: undefined });
		},
	});
}

const setProjectName = projectTextCommand('name', 'Set project name');
const setProjectDescription = projectTextCommand('description', 'Set project description');
const setProjectAuthor = projectTextCommand('author', 'Set project author');

const setExportSettings = defineCommand<{ settings: ExportDialogSettings }>({
	label: 'Set export settings',
	prepare(state, { settings }) {
		return prepareProjectValueChange<ExportDialogSettings | null>({ before: state.exportSettings.value, after: settings,
			write: (current, next) => { current.exportSettings.value = next; }, changes: [], result: undefined });
	},
});

const setTimelineRenderSettings = defineCommand<{ timelineFps: number; timelineMotionBlur: TimelineMotionBlurSettings }>({
	label: 'Set timeline render settings',
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

const setProjectResolution = defineCommand<{ resolution: Resolution }>({
	label: 'Set project resolution',
	prepare(state, { resolution }) {
		if (![resolution.width, resolution.height].every(value => Number.isSafeInteger(value) && value > 0)) {
			throw new Error('Resolution width and height must be positive integers');
		}
		return prepareProjectValueChange({ before: state.resolution.value, after: resolution,
			write: (current, next) => { current.resolution.value = next; }, changes: [{ type: 'projectResolution' }], result: undefined });
	},
});

function validateAutomationGraphData(data: AutomationGraphData): void {
	if (typeof data.isNormalized !== 'boolean' || !Array.isArray(data.points)) throw new Error('Invalid Automation Graph data');
	const ids = new Set<string>();
	for (const point of data.points) {
		if (typeof point.id !== 'string' || point.id.length === 0 || ids.has(point.id)) throw new Error('Invalid or duplicate Automation Graph point ID');
		ids.add(point.id);
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
			|| !Array.isArray(point.bezierControlPointA) || point.bezierControlPointA.length !== 2 || !point.bezierControlPointA.every(Number.isFinite)
			|| !Array.isArray(point.bezierControlPointB) || point.bezierControlPointB.length !== 2 || !point.bezierControlPointB.every(Number.isFinite)) {
			throw new Error('Automation Graph points must contain finite coordinates');
		}
	}
}

function prepareAutomationGraphCreation(state: ProjectState, automationGraph: AutomationGraph) {
	validateAutomationGraphData(automationGraph);
	validateProjectAutomationGraphName(state.automationGraphs.value, automationGraph);
	const saved = deepClone(automationGraph);
	return { result: { automationGraphId: saved.id }, change: {
		changes: [{ type: 'automationGraphs' as const }],
		apply: (current: ProjectState) => { current.automationGraphs.value.push(deepClone(saved)); },
		revert: (current: ProjectState) => { current.automationGraphs.value = current.automationGraphs.value.filter(graph => graph.id !== saved.id); },
	} };
}

const createProjectAutomationGraphCommand = defineCommand<{
	nameForReference?: string;
	data?: { isNormalized: boolean; points: Omit<BezierAnchorPoint, 'id'>[] };
}, { automationGraphId: string }>({
	label: 'Create project Automation Graph',
	prepare(state, input) {
		const automationGraph = createProjectAutomationGraph(state.automationGraphs.value);
		if (input.nameForReference != null) automationGraph.nameForReference = input.nameForReference;
		if (input.data != null) {
			automationGraph.isNormalized = input.data.isNormalized;
			automationGraph.points = input.data.points.map(point => ({ ...deepClone(point), id: genId() }));
		}
		return prepareAutomationGraphCreation(state, automationGraph);
	},
});

const duplicateProjectAutomationGraph = defineCommand<{ automationGraphId: string; nameForReference?: string }, { automationGraphId: string }>({
	label: 'Duplicate project Automation Graph',
	prepare(state, input) {
		const source = state.automationGraphs.value.find(graph => graph.id === input.automationGraphId);
		if (source == null) throw new Error('Automation Graph not found');
		const definition = createProjectAutomationGraph(state.automationGraphs.value, source);
		if (input.nameForReference != null) definition.nameForReference = input.nameForReference;
		return prepareAutomationGraphCreation(state, definition);
	},
});

const replaceProjectAutomationGraph = defineCommand<{ automationGraphId: string; definition: Omit<AutomationGraph, 'id'> }>({
	label: 'Replace project Automation Graph',
	prepare(state, { automationGraphId, definition }) {
		const before = state.automationGraphs.value.find(graph => graph.id === automationGraphId);
		if (before == null) throw new Error('Automation Graph not found');
		const after = { ...definition, id: automationGraphId };
		validateAutomationGraphData(after);
		validateProjectAutomationGraphName(state.automationGraphs.value, after);
		return prepareProjectValueChange({ before, after, changes: [{ type: 'automationGraphs' }], result: undefined,
			write(current, next) { current.automationGraphs.value[current.automationGraphs.value.findIndex(graph => graph.id === automationGraphId)] = next; } });
	},
});

const removeProjectAutomationGraph = defineCommand<{ automationGraphId: string }>({
	label: 'Remove project Automation Graph',
	prepare(state, { automationGraphId }) {
		const index = state.automationGraphs.value.findIndex(graph => graph.id === automationGraphId);
		if (index < 0) throw new Error('Automation Graph not found');
		const saved = deepClone(state.automationGraphs.value[index]);
		// 参照IDを残す既存仕様を維持し、Undoで同じ定義へ再接続する。
		return { result: undefined, change: { changes: [{ type: 'automationGraphs' }],
			apply: current => { current.automationGraphs.value = current.automationGraphs.value.filter(graph => graph.id !== automationGraphId); },
			revert: current => { current.automationGraphs.value.splice(index, 0, deepClone(saved)); },
		} };
	},
});

export const PROJECT_COMMAND_DEFS = {
	setProjectName, setProjectDescription, setProjectAuthor,
	setProjectResolution, setExportSettings, setTimelineRenderSettings,
	createProjectAutomationGraph: createProjectAutomationGraphCommand,
	duplicateProjectAutomationGraph,
	replaceProjectAutomationGraph, removeProjectAutomationGraph,
};
