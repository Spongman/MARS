import { useEffect } from 'react'
import { useMarsStore } from '../store/marsStore'
import { EXAMPLES } from '../examples'

export function useExamples() {
  const setCode = useMarsStore((state) => state.setCode)

  useEffect(() => {
    const handleLoadExample = (e) => {
      setCode(e.detail.code)
    }

    window.addEventListener('load-example', handleLoadExample)
    return () => window.removeEventListener('load-example', handleLoadExample)
  }, [setCode])
}

export { EXAMPLES }
