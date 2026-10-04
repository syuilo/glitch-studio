import type { TimelineMotionBlurSettings } from '@gs/subsystems_timeline_shared/motion-blur.ts';
import type { Asset, Player } from '@gs/shared/types.ts';
import type { ProjectVisualModule } from '@gs/glitch-studio_shared/project/types.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { Ref } from 'vue';

// 取り込み元の記録はUIのプロジェクト状態が所有する。描画・保存のバイナリは常にfileDataを使い、
// 原本の移動・削除や別PCでの読み込みによって素材の内容が変わらないようにする。
export type ProjectAsset = Asset & {
	// Electronで取得できた元ファイルの絶対パス。ブラウザやディスクにない素材はnull。
	sourceFilePath: string | null;
};

export type AppState = {
	timelineFps: Ref<number>;
	timelineMotionBlur: Ref<TimelineMotionBlurSettings>;
	resolution: Ref<{ width: number; height: number }>;
	assets: Ref<ProjectAsset[]>;
	players: Ref<Player[]>;
	visualModules: Ref<ProjectVisualModule[]>;
	timelineScenes: Ref<TimelineScene[]>;
};
