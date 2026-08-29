/** Modifier keys a toggle button cares about. */
export interface ToggleModifiers {
	ctrlKey: boolean
	metaKey: boolean
	shiftKey: boolean
}

export const isSolo = (event: ToggleModifiers) => event.ctrlKey || event.metaKey

/**
 * Next state for a group of toggle buttons. A plain click toggles the clicked
 * entry; ctrl-click (cmd-click on a Mac) also clears every other entry.
 */
export function nextToggles<T extends Record<string, boolean>>(flags: T, key: keyof T, event: ToggleModifiers): T {
	const solo = isSolo(event)
	const next = { ...flags }
	for (const name of Object.keys(flags) as Array<keyof T>) {
		next[name] = (name === key ? !flags[key] : solo ? false : flags[name]) as T[keyof T]
	}
	return next
}

/**
 * Moves the selection on to the entry after `key` when a group that may not be
 * left empty has just had its last entry turned off, wrapping at the end.
 */
export function advanceOne<T extends Record<string, boolean>>(next: T, key: keyof T, order: Array<keyof T>): T {
	if (Object.values(next).some(Boolean)) return next
	const following = order[(order.indexOf(key) + 1) % order.length]
	return following === undefined ? next : { ...next, [following]: true }
}
