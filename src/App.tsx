import React from 'react'
import { useTHRAXStore } from './store/thraxStore'
import { useExamples } from './hooks/useExamples'
import Toolbar from './components/Toolbar'
import DockLayout from './components/DockLayout'
import './App.css'

function App() {
	const { code, refreshAssembly, run, reset } = useTHRAXStore()
	const [error, setError] = React.useState<string | null>(null)

	useExamples()

	// Keep the assembled program (and so the memory view) in step with the source.
	React.useEffect(() => {
		const handle = window.setTimeout(refreshAssembly, 300)
		return () => window.clearTimeout(handle)
	}, [code, refreshAssembly])

	const handleRun = React.useCallback(async () => {
		setError(null)
		try {
			await run()
		} catch (error) {
			setError(error instanceof Error ? error.message : String(error))
		}
	}, [run])

	const handleReset = React.useCallback(() => {
		setError(null)
		reset()
	}, [reset])

	return (
		<div className="thrax-app">
			<Toolbar onRun={handleRun} onReset={handleReset} />

			{error && (
				<div className="error-bar">
					<span className="error-icon">⚠️</span>
					<span>{error}</span>
					<button onClick={() => setError(null)}>×</button>
				</div>
			)}

			<div className="thrax-container">
				<DockLayout />
			</div>
		</div>
	)
}

export default App
