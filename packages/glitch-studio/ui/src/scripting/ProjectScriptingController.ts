import { ref, shallowRef } from 'vue';
import { COMMAND_DEFS } from '../commands.ts';
import { SCRIPT_COMMAND_NAMES } from './script-command-names.ts';
import { createProjectScriptQueries } from './project-script-queries.ts';
import { ProjectScriptRuntime } from './project-script-runtime.ts';
import { formatScriptOutput } from './script-values.ts';
import { getProjectScriptApiReference, searchProjectScriptApi } from './project-script-api-reference.ts';
import type { ProjectScriptHost } from './project-script-runtime.ts';
import type { CommandInput } from '../utility/undo-redo.ts';
import type { ProjectContext } from '../Project.ts';
import type { values } from '@syuilo/aiscript';

const INITIAL_SCRIPT = `// Create a Visual Module with a Fill node.
let visualModule = Command:createVisualModule({ name: "Generated" })
let fillNode = Command:createVisualModuleEffectNode({
	visualModule: visualModule
	effectId: "fill"
	connectionMode: "appendToPrimaryOutput"
})
Command:setVisualModuleNodeParameterSource({
	target: fillNode
	parameterPath: ["color"]
	source: { inputSource: "literal", value: [1, 0.2, 0.1, 1] }
})
<: Query:getVisualModule(visualModule)
`;

const MAX_OUTPUT_ENTRIES = 1_000;
const MAX_OUTPUT_CHARACTERS = 100_000;

/** 本文・出力は編集セッション内だけで保持し、Projectの保存状態やUndoには含めない。 */
export class ProjectScriptingController {
	public readonly source = ref(INITIAL_SCRIPT);
	public readonly output = shallowRef<string[]>([]);
	public readonly isRunning = ref(false);
	private runtime: ProjectScriptRuntime | null = null;
	private disposed = false;
	private outputCharacters = 0;
	private outputEntries = 0;
	private outputTruncated = false;

	constructor(private readonly manager: ProjectContext['stateManager'], private readonly presentation: {
		dialog: ProjectScriptHost['dialog'];
		showError(message: string): Promise<void>;
		historyLabel: string;
		outputTruncated: string;
	}) {}

	public clearOutput(): void {
		this.output.value = [];
		// 実行中に表示を消しても同じ実行の出力予算は回復させない。
		if (!this.isRunning.value) this.resetOutputBudget();
	}

	private resetOutputBudget(): void {
		this.outputCharacters = 0;
		this.outputEntries = 0;
		this.outputTruncated = false;
	}

	private appendOutput(value: values.Value): void {
		if (this.disposed || this.outputTruncated) return;
		const available = MAX_OUTPUT_CHARACTERS - this.outputCharacters;
		const entry = formatScriptOutput(value, available);
		this.outputCharacters += entry.length;
		this.outputEntries++;
		this.output.value = [...this.output.value, entry];
		if (this.outputEntries >= MAX_OUTPUT_ENTRIES || this.outputCharacters >= MAX_OUTPUT_CHARACTERS) {
			this.outputTruncated = true;
			this.output.value = [...this.output.value, this.presentation.outputTruncated];
		}
	}

	public async run(): Promise<void> {
		if (this.disposed || this.isRunning.value) return;
		this.output.value = [];
		this.resetOutputBudget();
		this.isRunning.value = true;
		const runtime = new ProjectScriptRuntime({
			commands: SCRIPT_COMMAND_NAMES.map(name => ({ name, label: COMMAND_DEFS[name].label })),
			executeCommand: (name, input, signal) => {
				// 公開名は上の一覧からだけ生成される。型・編集条件の検証はCommandが担当する。
				const commandName = name as typeof SCRIPT_COMMAND_NAMES[number];
				return this.manager.execute(commandName, input as CommandInput<typeof COMMAND_DEFS[typeof commandName]>, null, signal);
			},
			queries: createProjectScriptQueries(this.manager.state),
			apiReference: { describe: getProjectScriptApiReference, search: searchProjectScriptApi },
			dialog: this.presentation.dialog,
			output: value => this.appendOutput(value),
		});
		this.runtime = runtime;
		try {
			// 非同期の入力待ちも一実行に含める。失敗時の履歴確定はrunGroupに任せ、
			// エラーダイアログを表示する時点では成功済み操作をUndo可能にしておく。
			await this.manager.runGroup(this.presentation.historyLabel, () => runtime.run(this.source.value));
		} catch (error) {
			if (!this.disposed) {
				const message = error instanceof Error ? error.message : String(error);
				// 通常出力の上限に達していても、失敗の理由は最後に残す。
				this.output.value = [...this.output.value, message.slice(0, 10_000)];
				await this.presentation.showError(message);
			}
		} finally {
			runtime.dispose();
			this.runtime = null;
			this.isRunning.value = false;
		}
	}

	public dispose(): void {
		this.disposed = true;
		this.runtime?.dispose();
	}
}
