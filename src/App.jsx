import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { useMarsStore } from './store/marsStore'
import Toolbar from './components/Toolbar'
import RegisterView from './components/RegisterView'
import MemoryView from './components/MemoryView'
import ConsoleOutput from './components/ConsoleOutput'
import './App.css'

function App() {
  const { code, registers, memory, console, setCode, run, reset } = useMarsStore()
  const [activeTab, setActiveTab] = useState('registers')

  return (
    <div className="mars-app">
      <header className="mars-header">
        <h1>MARS - MIPS Assembler and Runtime Simulator</h1>
        <div className="version">Web Edition (JavaScript Port)</div>
      </header>

      <Toolbar onRun={run} onReset={reset} />

      <div className="mars-container">
        <div className="editor-pane">
          <div className="pane-header">Source Code</div>
          <Editor
            height="100%"
            defaultLanguage="mips"
            value={code}
            onChange={(value) => setCode(value || '')}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>

        <div className="right-pane">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'registers' ? 'active' : ''}`}
              onClick={() => setActiveTab('registers')}
            >
              Registers
            </button>
            <button
              className={`tab ${activeTab === 'memory' ? 'active' : ''}`}
              onClick={() => setActiveTab('memory')}
            >
              Memory
            </button>
            <button
              className={`tab ${activeTab === 'console' ? 'active' : ''}`}
              onClick={() => setActiveTab('console')}
            >
              Console
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'registers' && <RegisterView registers={registers} />}
            {activeTab === 'memory' && <MemoryView memory={memory} />}
            {activeTab === 'console' && <ConsoleOutput output={console} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
