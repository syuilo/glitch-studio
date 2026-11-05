// Visual Module内のパラメータで使用可能な変数
export const IN_VISUAL_MODULE_VAR_DEFS = ['RESOLUTION', 'ASPECT_RATIO', 'TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT', 'POINTER_POSITION', 'TEST_ONLY_VM', 'TEST_SAME_NAME'] as const;

// 共有する値の意味を参照元ノードに依存させない。ノード固有の寸法・ポインター位置は含めない。
export const VISUAL_MODULE_CUSTOM_PARAMETER_VAR_DEFS = ['TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT'] as const;
