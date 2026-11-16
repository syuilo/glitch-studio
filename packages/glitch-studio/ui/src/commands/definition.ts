import type { AppStateChange, ProjectState } from '../Project.ts';
import type { PreparedCommandDef as UndoRedoCommandDef } from '../utility/undo-redo.ts';

export type CommandDef<Input, Result = void> = UndoRedoCommandDef<ProjectState, Input, AppStateChange, Result>;

export function defineCommand<Input, Result = void>(def: CommandDef<Input, Result>) {
	return def;
}
