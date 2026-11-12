// Context単体のテストにも完全なProjectを渡し、本番に未初期化状態やテスト専用の既定値を持ち込まない。
export function createTestProject(overrides = {}) {
	return {
		id: 'project', gsVersion: '2.0.0-alpha', name: 'Project', description: '', author: '',
		timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		resolution: { width: 1024, height: 1024 }, exportSettings: null,
		customShaderEffects: [], automationGraphs: [], assets: [], generatedSpeech: [], players: [], visualModules: [], timelineScenes: [],
		...overrides,
	};
}
