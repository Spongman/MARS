import { useState } from 'react'
import './MemoryView.css'

function MemoryView({ memory }) {
  const [addressInput, setAddressInput] = useState('0x10010000')

  const formatValue = (value) => {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
  }

  const memoryEntries = Object.entries(memory).slice(0, 20) // Show first 20 entries

  return (
    <div className="memory-view">
      <div className="memory-search">
        <input
          type="text"
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          placeholder="Address (e.g., 0x10010000)"
        />
        <button>Go</button>
      </div>

      <div className="memory-table">
        <div className="memory-header">
          <div className="col-address">Address</div>
          <div className="col-value">Value</div>
        </div>
        {memoryEntries.length > 0 ? (
          memoryEntries.map(([addr, value]) => (
            <div key={addr} className="memory-row">
              <div className="col-address">{addr}</div>
              <div className="col-value">{formatValue(value)}</div>
            </div>
          ))
        ) : (
          <div className="memory-empty">No memory allocated</div>
        )}
      </div>
    </div>
  )
}

export default MemoryView
