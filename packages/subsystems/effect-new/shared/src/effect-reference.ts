export type EffectReference =
	| { type: 'nativeEffect'; id: string }
	| { type: 'customShaderEffectReference'; id: string }
	| { type: 'customNodeGraphEffectReference'; id: string };
