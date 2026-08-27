import { useEffect, useRef } from 'react'
import './ConsoleOutput.css'

function ConsoleOutput({ output }) {
  const endRef = useRef(null)

  useEffect(() => {
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
