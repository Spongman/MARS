import type { editor } from 'monaco-editor'

/** The toolbar's Find targets the editor holding the file being assembled. */
let activeEditor: editor.IStandaloneCodeEditor | null = null

export function setFindReplaceEditor(instance: editor.IStandaloneCodeEditor | null) {
	activeEditor = instance
}

/** Opens Monaco's own find widget, so the toolbar and Ctrl+H share one UI. */
export function openFindReplace() {
	if (!activeEditor) return
	activeEditor.focus()
	activeEditor.trigger('toolbar', 'editor.action.startFindReplaceAction', null)
}
