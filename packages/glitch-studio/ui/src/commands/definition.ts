import { parseProjectApiValue } from '../project-api/contract.ts';
import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommandDef as UndoRedoCommandDef } from '../utility/undo-redo.ts';
import type { PreparedCommand } from '../utility/undo-redo.ts';
import type * as z from 'zod';
import type { ProjectApiContract } from '../project-api/contract.ts';

export type CommandDef<Input, Result = void> = UndoRedoCommandDef<ProjectState, Input, AppStateChange, Result>;

export function defineCommand<Input, Result = void>(def: CommandDef<Input, Result>) {
	return def;
}

type ContractCommandResult<Schema extends z.ZodType> = z.output<Schema> extends null ? void : z.output<Schema>;

/** 入力の型・構造検証・資料を同じ定義から得る公開Command用の入口。 */
export function definePublicCommand<InputSchema extends z.ZodType, ResultSchema extends z.ZodType>(
	definition: CommandDef<z.output<InputSchema>, ContractCommandResult<ResultSchema>> & ProjectApiContract<InputSchema, ResultSchema>,
): CommandDef<z.output<InputSchema>, ContractCommandResult<ResultSchema>> & ProjectApiContract<InputSchema, ResultSchema> {
	return validateCommandContract(definition, definition);
}

/**
 * ドメイン型を組み合わせる既存Commandにも、公開する位置で契約を付けられる。
 * 既存の型付き入力・戻り値が契約で受理されることを確認する。外部入力では省略値に
 * nullも使えるため、スキーマの型を既存のTypeScript型と完全一致にはしない。
 */
export function withCommandContract<Input, Result, InputSchema extends z.ZodType, ResultSchema extends z.ZodType>(
	definition: CommandDef<Input, Result>,
	contract: ProjectApiContract<InputSchema, ResultSchema>
		& (Input extends z.input<InputSchema> ? unknown : { incompatibleInputSchema: never })
		& ((Result extends void ? null : Result) extends z.input<ResultSchema> ? unknown : { incompatibleResultSchema: never }),
): CommandDef<Input, Result> & ProjectApiContract<InputSchema, ResultSchema> {
	return validateCommandContract(definition, contract);
}

function validateCommandContract<Input, Result, InputSchema extends z.ZodType, ResultSchema extends z.ZodType>(
	definition: CommandDef<Input, Result>, contract: ProjectApiContract<InputSchema, ResultSchema>,
): CommandDef<Input, Result> & ProjectApiContract<InputSchema, ResultSchema> {
	return { ...definition, ...contract, prepare(state, input) {
		parseProjectApiValue(contract.inputSchema, input, `${definition.label} input`);
		const prepared = definition.prepare(state, input);
		const validateResult = (result: PreparedCommand<ProjectState, AppStateChange, Result>) => {
			// 戻り値の不正はapplyより前に検出する。状態を変更してからAPI失敗と返すと、
			// 呼び出し側の再試行で変更が重複する。既存のvoidは公開時だけnullと解釈する。
			parseProjectApiValue(contract.resultSchema, result.result ?? null, `${definition.label} result`);
			return result;
		};
		return prepared instanceof Promise ? prepared.then(validateResult) : validateResult(prepared);
	} };
}
