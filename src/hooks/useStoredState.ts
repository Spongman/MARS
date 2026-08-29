import React from 'react'

const KEY_PREFIX = 'thrax-web.settings.'

/** A stored setting, or `initial` when nothing valid is stored under `key`. */
export function readStoredSetting<T>(key: string, initial: T, isValid: (value: unknown) => boolean): T {
	try {
		const stored = window.localStorage.getItem(KEY_PREFIX + key)
		if (stored === null) return initial
		const parsed: unknown = JSON.parse(stored)
		return isValid(parsed) ? parsed as T : initial
	} catch {
		// Unreadable storage (private mode, bad JSON) just means no setting.
		return initial
	}
}

export function writeStoredSetting(key: string, value: unknown) {
	try {
		window.localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value))
	} catch {
		// Storage can be full or blocked; the setting simply is not remembered.
	}
}

/**
 * State that survives a reload. A stored value is used only when `isValid`
 * accepts it, so a renamed option or hand-edited storage falls back to the
 * default instead of breaking the view.
 */
export function useStoredState<T>(key: string, initial: T, isValid: (value: unknown) => boolean) {
	const [value, setValue] = React.useState<T>(() => readStoredSetting(key, initial, isValid))

	React.useEffect(() => writeStoredSetting(key, value), [key, value])

	return [value, setValue] as const
}

export const isOneOf = <T,>(options: readonly T[]) => (value: unknown) => options.includes(value as T)

/** True when every named key is present and holds a boolean. */
export const isFlagSet = (keys: readonly string[]) => (value: unknown) =>
	typeof value === 'object' && value !== null &&
	keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'boolean')
