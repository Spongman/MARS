import './Toolbar.css'

function Toolbar({ onRun, onReset }) {
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
      <button className="btn btn-secondary" disabled>
        📁 Load File
      </button>
      <button className="btn btn-secondary" disabled>
        💾 Save
      </button>
    </div>
  )
}

export default Toolbar
