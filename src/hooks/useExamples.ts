import { useEffect } from 'react'
import { useTHRAXStore } from '../store/thraxStore'
import { EXAMPLES } from '../examples'

interface LoadExampleEvent extends Event {
	detail: { code: string }
}

export function useExamples() {
	const setCode = useTHRAXStore((state) => state.setCode)

	useEffect(() => {
		const handleLoadExample = (event: Event) => {
			const { detail } = event as LoadExampleEvent
			setCode(detail.code)
		}

		window.addEventListener('load-example', handleLoadExample)
		return () => window.removeEventListener('load-example', handleLoadExample)
	}, [setCode])
}

export { EXAMPLES }
