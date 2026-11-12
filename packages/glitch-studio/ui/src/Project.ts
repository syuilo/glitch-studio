import { getReferencedGeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import { ref } from 'vue';
import type { AutomationGraph } from '@gs/shared/automation-graph/automation-graph.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { COMMAND_DEFS } from './commands.ts';
import { UndoRedo } from './utility/undo-redo.ts';
import { ExternalAssetMetadataStore } from './ExternalAssetMetadataStore.ts';
import type { GeneratedSpeech } from '@gs/glitch-studio_shared/voicevox.ts';
import type { Project } from './gsproj.ts';
import type { Ref } from 'vue';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { Asset, Player } from '@gs/shared/types.js';
import type { AssetThumbnailSequence } from './asset-thumbnail.ts';
import type { ProjectCustomShaderEffect, ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.js';
import type { VisualModuleNodeChange } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';
import type { ExportDialogSettings } from './export/export-settings.ts';

// 保存方法・原本パスはプロジェクトが所有し、subsystemにはBlob/URLの読み取り口だけを渡す。
export type ProjectAsset = Asset & {
	isExternalReference: boolean;
	// Electronでは解決済み絶対パス、保存時はプロジェクト配下だけ相対化する。
	// Webでは保存された表記を保持する。実ファイル由来でない素材はnull。
	sourceFilePath: string | null;
	thumbnailSequence: AssetThumbnailSequence | null;
};

export type ProjectState = {
	customShaderEffects: Ref<ProjectCustomShaderEffect[]>;
	automationGraphs: Ref<AutomationGraph[]>;
	exportSettings: Ref<ExportDialogSettings | null>;
	name: Ref<string>;
	description: Ref<string>;
	author: Ref<string>;
	timelineFps: Ref<number>;
	timelineMotionBlur: Ref<TimelineMotionBlurSettings>;
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<ProjectAsset[]>;
	/** 現在の発話が参照する結果だけ。一時キャッシュと書き出しの保持分は含めない。 */
	generatedSpeech: Ref<GeneratedSpeech[]>;
	players: Ref<Player[]>;
	visualModules: Ref<ProjectVisualModule[]>;
	timelineScenes: Ref<TimelineScene[]>;
};

// 状態を所有する側の通知契約。通知先やキャッシュ・実行インスタンスの方針には依存しない。
export type ProjectContentChange =
	| { type: 'customShaderEffect'; customShaderEffectId: string }
	| { type: 'automationGraphs' }
	| { type: 'node'; target: VisualModuleTarget; nodeId: string; changes: VisualModuleNodeChange[] }
	| { type: 'visualModule'; target: VisualModuleTarget; customParameterValuesOnly?: boolean }
	| { type: 'visualModuleRegistration'; visualModuleId: string }
	| { type: 'layer'; sceneId: string; layerId: string; changes: TimelineLayerChange[] }
	| { type: 'layerTree'; sceneId: string }
	| { type: 'layerOrder'; sceneId: string }
	| { type: 'scene'; sceneId: string };

export type AppStateChange = ProjectContentChange
	| { type: 'asset'; assetId: string }
	| { type: 'player'; playerId: string }
	| { type: 'projectResolution' }
	| { type: 'timelineRenderSettings' }
	| { type: 'nodeName'; target: VisualModuleTarget; nodeId: string }
	| { type: 'visualModuleName'; visualModuleId: string }
	| { type: 'layerName'; sceneId: string; layerId: string }
	| { type: 'layerColor'; sceneId: string; layerId: string }
	| { type: 'sceneName'; sceneId: string };

export class ProjectContext {
	private disposed = false;
	private readonly stopMetadataUpdates: () => void;
	public get isDisposed() { return this.disposed; }
	public readonly stateManager: UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>;
	public readonly externalAssetMetadata = new ExternalAssetMetadataStore();

	/** データの準備を終えてから生成し、購読側には最初から完成した編集状態を渡す。 */
	constructor(project: Project) {
		for (const asset of project.assets) this.externalAssetMetadata.record(asset);
		this.stateManager = new UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>({
			customShaderEffects: ref(project.customShaderEffects),
			automationGraphs: ref(project.automationGraphs),
			exportSettings: ref(deepClone(project.exportSettings)),
			name: ref(project.name),
			description: ref(project.description),
			author: ref(project.author),
			timelineFps: ref(project.timelineFps),
			timelineMotionBlur: ref(deepClone(project.timelineMotionBlur)),
			resolution: ref(project.resolution),
			assets: ref(project.assets), // TODO: バイナリをリアクティブでwrapするのをやめる
			players: ref(project.players),
			generatedSpeech: ref(getReferencedGeneratedSpeech(project.timelineScenes, project.generatedSpeech)),
			visualModules: ref(project.visualModules),
			timelineScenes: ref(project.timelineScenes),
		}, COMMAND_DEFS);
		// ProjectSessionContextの検証・レンダラー同期より先に登録し、履歴が復元した古い
		// 外部参照のメタデータをほかの購読側や保存スナップショットへ渡さない。
		this.stopMetadataUpdates = this.stateManager.onChange(changes => {
			if (changes.some(change => change.type === 'asset')) this.externalAssetMetadata.apply(this.stateManager.state.assets.value);
		});
	}

	public snapshot(): Project | null {
		if (this.disposed) return null;
		const state = this.stateManager.state;
		// 保存・バックアップで同じ完全な状態を使う。非同期のエンコードや保存先選択の間に
		// 編集されても、取得済みのスナップショットへ変更が混入しないよう切り離す。
		return deepClone({
			customShaderEffects: state.customShaderEffects.value,
			automationGraphs: state.automationGraphs.value,
			exportSettings: state.exportSettings.value,
			gsVersion: _VERSION_,
			name: state.name.value,
			description: state.description.value,
			author: state.author.value,
			resolution: state.resolution.value,
			timelineFps: state.timelineFps.value,
			timelineMotionBlur: state.timelineMotionBlur.value,
			assets: state.assets.value,
			generatedSpeech: getReferencedGeneratedSpeech(state.timelineScenes.value, state.generatedSpeech.value),
			visualModules: state.visualModules.value,
			players: state.players.value,
			timelineScenes: state.timelineScenes.value,
		} satisfies Project);
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.stopMetadataUpdates();
		this.stateManager.cancelEdit();
	}

	public getVisualModuleById(id: ProjectVisualModule['id']) {
		return this.stateManager.state.visualModules.value.find(vm => vm.id === id) ?? null;
	}
}
