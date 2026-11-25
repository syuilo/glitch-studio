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

const MAX_OUTPUT_ENTRIES = 1_000;
const MAX_OUTPUT_CHARACTERS = 100_000;

export type ProjectScriptExecutionResult = {
	output: string[];
	outputTruncated: boolean;
	commandsExecuted: number;
	error: string | null;
};

/** 本文・出力は編集セッション内だけで保持し、Projectの保存状態やUndoには含めない。 */
export class ProjectScriptingController {
	public readonly source = ref('');
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

	private createRuntime(dialog: ProjectScriptHost['dialog'], output: ProjectScriptHost['output'], commandCompleted: () => void = () => {}) {
		return new ProjectScriptRuntime({
			commands: SCRIPT_COMMAND_NAMES.map(name => ({ name, label: COMMAND_DEFS[name].label })),
			executeCommand: async (name, input, signal) => {
				// 公開名は上の一覧からだけ生成される。型・編集条件の検証はCommandが担当する。
				const commandName = name as typeof SCRIPT_COMMAND_NAMES[number];
				const result = await this.manager.execute(commandName, input as CommandInput<typeof COMMAND_DEFS[typeof commandName]>, null, signal);
				commandCompleted();
				return result;
			},
			queries: createProjectScriptQueries(this.manager.state),
			apiReference: { describe: getProjectScriptApiReference, search: searchProjectScriptApi },
			dialog,
			output,
		});
	}

	/** 外部からの一実行。パネルの編集中の本文・出力と共有するのは実行中状態だけ。 */
	public async runExternal(source: string, signal: AbortSignal, historyLabel = this.presentation.historyLabel): Promise<ProjectScriptExecutionResult> {
		if (this.disposed) throw new Error('PROJECT_CLOSED: The project session has closed.');
		if (this.isRunning.value) throw new Error('PROJECT_BUSY: A project script is already running.');
		if (source.length > 100_000) throw new Error('Script source exceeds 100,000 characters.');
		signal.throwIfAborted();
		this.isRunning.value = true;
		const result: ProjectScriptExecutionResult = { output: [], outputTruncated: false, commandsExecuted: 0, error: null };
		let outputCharacters = 0;
		const lifetime = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
		const runtime = this.createRuntime(async () => { throw new Error('Dialogs are unavailable in external project scripts.'); }, value => {
			if (result.outputTruncated) return;
			const entry = formatScriptOutput(value, MAX_OUTPUT_CHARACTERS - outputCharacters);
			result.output.push(entry);
			outputCharacters += entry.length;
			result.outputTruncated = result.output.length >= MAX_OUTPUT_ENTRIES || outputCharacters >= MAX_OUTPUT_CHARACTERS;
		}, () => { result.commandsExecuted++; });
		this.runtime = runtime;
		const cancel = () => runtime.dispose();
		lifetime.addEventListener('abort', cancel, { once: true });
		try {
			// 手動操作の混入は通常Scriptingと同じ扱いにする。MCPの失敗も成功済みの
			// Commandを取り消さず、一履歴として残して呼び出し側へ部分実行を報告する。
			await this.manager.runGroup(historyLabel, () => runtime.run(source));
			lifetime.throwIfAborted();
			if (this.disposed) throw new Error('The project session has closed.');
		} catch (error) {
			result.error = (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
		} finally {
			lifetime.removeEventListener('abort', cancel);
			runtime.dispose();
			this.runtime = null;
			this.isRunning.value = false;
		}
		return result;
	}

	public async run(): Promise<void> {
		if (this.disposed || this.isRunning.value) return;
		this.output.value = [];
		this.resetOutputBudget();
		this.isRunning.value = true;
		const runtime = this.createRuntime(this.presentation.dialog, value => this.appendOutput(value));
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
