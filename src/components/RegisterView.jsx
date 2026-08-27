import './RegisterView.css'

function RegisterView({ registers }) {
  const registerGroups = {
    'Zero/At': ['$zero', '$at'],
    'Return': ['$v0', '$v1'],
    'Arguments': ['$a0', '$a1', '$a2', '$a3'],
    'Temporary': ['$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7'],
    'Saved': ['$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7'],
    'More Temps': ['$t8', '$t9'],
    'Reserved': ['$k0', '$k1'],
    'Pointers': ['$gp', '$sp', '$fp', '$ra'],
    'Special': ['$pc', '$hi', '$lo'],
  }

  const formatValue = (value) => {
    return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
  }

  return (
    <div className="register-view">
      {Object.entries(registerGroups).map(([group, regs]) => (
        <div key={group} className="register-group">
          <div className="group-title">{group}</div>
          <div className="register-list">
            {regs.map((reg) => (
              <div key={reg} className="register-item">
                <span className="reg-name">{reg}</span>
                <span className="reg-value">{formatValue(registers[reg] || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default RegisterView
