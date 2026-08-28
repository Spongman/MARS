import React from 'react'
import { useMarsStore } from '../store/marsStore'
import './Toolbar.css'
import { EXAMPLES } from '../examples'

function Toolbar({ onRun, onReset }) {
  const { step, stepOver, pause, isPaused } = useMarsStore()
  const [showExamples, setShowExamples] = React.useState(false)

  const handleLoadExample = (example) => {
    window.dispatchEvent(
      new CustomEvent('load-example', {
        detail: { code: example.code },
      })
    )
    setShowExamples(false)
  }

  return (
    <div className="toolbar">
      <button className="btn btn-primary" onClick={onRun}>
        ▶ Run
      </button>
      <button className="btn btn-secondary" onClick={onReset}>
        ↻ Reset
      </button>
      <button className="btn btn-secondary" onClick={() => step()}>
        ⏭ Step
      </button>
      <button className="btn btn-secondary" onClick={() => stepOver()}>
        ⏭⏭ Step Over
      </button>
      <div className="spacer"></div>
      <div className="example-dropdown">
        <button
          className="btn btn-secondary"
          onClick={() => setShowExamples(!showExamples)}
        >
          📚 Examples
        </button>
        {showExamples && (
          <div className="dropdown-menu">
            {Object.entries(EXAMPLES).map(([key, example]) => (
              <button
                key={key}
                className="dropdown-item"
                onClick={() => handleLoadExample(example)}
              >
                <span className="item-name">{example.name}</span>
                <span className="item-desc">{example.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-secondary" disabled>
        💾 Save
      </button>
    </div>
  )
}

export default Toolbar
