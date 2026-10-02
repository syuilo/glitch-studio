import type { VisualModuleNodeChange } from '@gs/subsystems_visual-module_shared/types.ts';
import type { TimelineLayerChange } from '@gs/subsystems_timeline_shared/types.ts';
import type { VisualModuleTarget } from '@gs/glitch-studio_shared/project/visual-module-target.ts';

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
	| { type: 'layerName'; sceneId: string; layerId: string }
	| { type: 'sceneName'; sceneId: string };
