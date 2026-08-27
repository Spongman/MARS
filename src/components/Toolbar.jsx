import { useState } from 'react'
import { EXAMPLES } from '../examples'
import './Toolbar.css'

function Toolbar({ onRun, onReset }) {
  const [showExamples, setShowExamples] = useState(false)

  const handleLoadExample = (example) => {
    // This should be passed from parent or via store
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
      <button className="btn btn-secondary" disabled>
        ⏸ Pause
      </button>
      <button className="btn btn-secondary" disabled>
        ⏭ Step
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
