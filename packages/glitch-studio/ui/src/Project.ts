import { ref } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.js';
import { DEFAULT_TIMELINE_FPS, DEFAULT_TIMELINE_MOTION_BLUR } from './project-defaults.ts';
import { COMMAND_DEFS } from './commands.ts';
import { UndoRedo } from './utility/undo-redo.ts';
import { DEFAULT_PROJECT_NAME } from './gsproj.ts';
import type { Project } from './gsproj.ts';
import type { Ref } from 'vue';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { Asset, Player } from '@gs/shared/types.js';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.js';
import type { VisualModuleNodeChange } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';

// 取り込み元の記録はUIのプロジェクト状態が所有する。描画・保存のバイナリは常にfileDataを使い、
// 原本の移動・削除や別PCでの読み込みによって素材の内容が変わらないようにする。
export type ProjectAsset = Asset & {
	// Electronで取得できた元ファイルの絶対パス。ブラウザやディスクにない素材はnull。
	sourceFilePath: string | null;
};

export type ProjectState = {
	name: Ref<string>;
	description: Ref<string>;
	author: Ref<string>;
	timelineFps: Ref<number>;
	timelineMotionBlur: Ref<TimelineMotionBlurSettings>;
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<ProjectAsset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<ProjectVisualModule[]>;
	timelineScenes: Ref<TimelineScene[]>;
};

// 状態を所有する側の通知契約。通知先やキャッシュ・実行インスタンスの方針には依存しない。
export type ProjectContentChange =
	| { type: 'node'; target: VisualModuleTarget; nodeId: string; changes: VisualModuleNodeChange[] }
	| { type: 'visualModule'; target: VisualModuleTarget }
	| { type: 'layer'; sceneId: string; layerId: string; changes: TimelineLayerChange[] }
	| { type: 'layerOrder'; sceneId: string }
	| { type: 'scene'; sceneId: string };

export type AppStateChange = ProjectContentChange
	| { type: 'asset'; assetId: string }
	| { type: 'player'; playerId: string }
	| { type: 'projectResolution' }
	| { type: 'timelineRenderSettings' }
	| { type: 'layerName'; sceneId: string; layerId: string }
	| { type: 'sceneName'; sceneId: string };

export class ProjectContext {
	private projectId: Project['id'] | null = null;
	public readonly stateManager: UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>;

	constructor() {
		this.stateManager = new UndoRedo<ProjectState, AppStateChange, typeof COMMAND_DEFS>({
			name: ref(DEFAULT_PROJECT_NAME),
			description: ref(''),
			author: ref(''),
			timelineFps: ref(DEFAULT_TIMELINE_FPS),
			timelineMotionBlur: ref({ ...DEFAULT_TIMELINE_MOTION_BLUR }),
			resolution: ref<{ width: number; height: number }>({ width: 1024, height: 1024 }),
			assets: ref<ProjectAsset[]>([]), // TODO: バイナリをリアクティブでwrapするのをやめる
			players: ref<Player[]>([]),
			visualModules: ref<ProjectVisualModule[]>([]),
			timelineScenes: ref<TimelineScene[]>([]),
		}, COMMAND_DEFS);
	}

	public load(project: Project) {
		this.stateManager.state.name.value = project.name;
		this.stateManager.state.description.value = project.description;
		this.stateManager.state.author.value = project.author;
		this.stateManager.state.resolution.value = project.resolution;
		this.stateManager.state.timelineFps.value = project.timelineFps;
		this.stateManager.state.timelineMotionBlur.value = deepClone(project.timelineMotionBlur);
		this.stateManager.state.assets.value = project.assets;
		this.stateManager.state.visualModules.value = project.visualModules;
		this.stateManager.state.players.value = project.players;
		this.stateManager.state.timelineScenes.value = project.timelineScenes;
		this.stateManager.undoStack.value = [];
		this.stateManager.redoStack.value = [];
		this.projectId = project.id;
	}

	public snapshot(): Project | null {
		if (this.projectId == null) return null;
		const state = this.stateManager.state;
		// 保存・バックアップで同じ完全な状態を使う。非同期のエンコードや保存先選択の間に
		// 編集されても、取得済みのスナップショットへ変更が混入しないよう切り離す。
		return deepClone({
			id: this.projectId,
			gsVersion: _VERSION_,
			name: state.name.value,
			description: state.description.value,
			author: state.author.value,
			resolution: state.resolution.value,
			timelineFps: state.timelineFps.value,
			timelineMotionBlur: state.timelineMotionBlur.value,
			assets: state.assets.value,
			visualModules: state.visualModules.value,
			players: state.players.value,
			timelineScenes: state.timelineScenes.value,
		} satisfies Project);
	}

	public getVisualModuleById(id: ProjectVisualModule['id']) {
		return this.stateManager.state.visualModules.value.find(vm => vm.id === id) ?? null;
	}
}
