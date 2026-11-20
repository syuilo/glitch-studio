// Custom Node Graph Effect内のパラメータで使用可能な変数
export const IN_CUSTOM_NODE_GRAPH_EFFECT_VAR_DEFS = ['RESOLUTION', 'ASPECT_RATIO', 'TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT', 'POINTER_POSITION'] as const;

// 共有する値の意味を参照元ノードに依存させない。ノード固有の寸法・ポインター位置は含めない。
export const CUSTOM_NODE_GRAPH_EFFECT_CUSTOM_PARAMETER_VAR_DEFS = ['TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS', 'IS_EXPORT'] as const;
