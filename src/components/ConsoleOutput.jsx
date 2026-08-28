import React from 'react'
import { useMarsStore } from '../store/marsStore'

function ConsoleOutput({ output }) {
  const endRef = React.useRef(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  return (
    <div className="console-output">
      {output.length > 0 ? (
        <pre>{output}</pre>
      ) : (
        <div className="console-empty">Program output will appear here</div>
      )}
      <div ref={endRef} />
    </div>
  )
}

export default ConsoleOutput
