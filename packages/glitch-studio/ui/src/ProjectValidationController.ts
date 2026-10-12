import { ref } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import { ProjectValidationState } from './project-validation-state.ts';
import { inspectRenderOptions } from './render-options-validation.ts';
import type { RendererProjectState, RendererProjectChange } from '@gs/glitch-studio_shared/project/renderer-state.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModuleArgumentBindings } from '@gs/subsystems_visual-module_shared/types.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';

/** UIが所有する一つの診断状態を、LIVE・タイムライン・書き出しの開始判断で共有する。 */
export class ProjectValidationController {
	public readonly errorMessage = ref<string | null>(null);
	public readonly canRender = ref(true);
	public readonly validation: ProjectValidationState;
	private state: RendererProjectState = { visualModules: [], timelineScenes: [] };
	private options = { resolution: { width: 1, height: 1 }, resolutionScale: 1 };
	private timeline = { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 0 } };
	private previewTimeline = this.timeline;
	private loading = false;
	private liveVisualModuleId: string | null = null;
	private liveValues: VisualModuleArgumentBindings = {};
	private listeners = new Set<() => void>();

	constructor(effectDefinitions: Readonly<Record<string, EffectDefinition>>) {
		this.validation = new ProjectValidationState(effectDefinitions);
	}

	subscribe(listener: () => void) {
		this.listeners.add(listener);
		listener();
		return () => this.listeners.delete(listener);
	}

	private publish() {
		this.errorMessage.value = this.validation.diagnostics.firstMessage;
		this.canRender.value = !this.loading && this.validation.valid;
		for (const listener of this.listeners) listener();
	}

	beginProjectLoad() { this.loading = true; this.publish(); }
	finishProjectLoad() { this.loading = false; this.publish(); }

	replace(state: RendererProjectState) {
		this.state = deepClone(state);
		this.validation.replace(this.state);
		this.validation.setOptions(this.inspectOptionDiagnostics(), this.options.resolutionScale, 8192);
		this.validation.updateLiveArguments(this.liveVisualModuleId, this.liveValues);
		this.publish();
	}

	apply(changes: readonly RendererProjectChange[]) {
		this.state = applyRendererProjectChanges(this.state, changes);
		this.validation.apply(this.state, changes);
		// 内部ノードの値編集でLIVEの公開引数を再検査しない。
		if (changes.some(change => change.type === 'visualModuleRegistration' ? change.visualModuleId === this.liveVisualModuleId
			: change.type === 'visualModule' && 'visualModuleId' in change.target && change.target.visualModuleId === this.liveVisualModuleId)) {
			this.validation.updateLiveArguments(this.liveVisualModuleId, this.liveValues);
		}
		this.publish();
	}

	updateAssets(assets: readonly Asset[]) { this.validation.updateAssets(assets); this.publish(); }

	updateRenderOptions(options: { resolution?: Resolution; resolutionScale?: number }) {
		this.options = { ...this.options, ...options };
		this.inspectOptions();
	}

	updateTimelineOptions(options: { timelineFps?: number; timelineMotionBlur?: TimelineMotionBlurSettings }) {
		this.timeline = { ...this.timeline, ...options };
		this.inspectOptions();
	}

	updatePreviewTimelineOptions(options: { timelineFps: number; timelineMotionBlur: TimelineMotionBlurSettings }) {
		this.previewTimeline = { timelineFps: options.timelineFps, timelineMotionBlur: options.timelineMotionBlur };
		this.inspectOptions();
	}

	private inspectOptionDiagnostics() {
		return [...inspectRenderOptions(this.options, 8192, this.timeline),
			...inspectRenderOptions(this.options, 8192, this.previewTimeline).filter(diagnostic => diagnostic.code.startsWith('timeline.'))];
	}

	private inspectOptions() {
		// 設定値の上限はUIで確認する。端末固有のGPU制限・生成リソースの障害は実行側の責務。
		this.validation.setOptions(this.inspectOptionDiagnostics(), this.options.resolutionScale, 8192);
		this.publish();
	}

	updateLiveArguments(visualModuleId: string | null, values: VisualModuleArgumentBindings) {
		this.liveVisualModuleId = visualModuleId;
		this.liveValues = deepClone(values);
		this.validation.updateLiveArguments(visualModuleId, this.liveValues);
		this.publish();
	}
}
