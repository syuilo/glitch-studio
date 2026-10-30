// TimelineのLayer(Visual Moduleに限らず)のパラメータで使用可能な変数
export const LAYER_VAR_DEFS = ['TIME', 'TIME_MS', 'TEST_ONLY_LAYER', 'TEST_SAME_NAME', 'IS_EXPORT'] as const;

export const EFFECT_LAYER_VAR_DEFS = [...LAYER_VAR_DEFS, 'RESOLUTION'] as const;
