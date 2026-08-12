import './Contract.css'

export default function Contract() {
  const isDevnet = import.meta.env.VITE_BATTLE_NETWORK === 'devnet'

  return (
    <section className="contract-section">
      <div className="page-header">
        <h1 className="page-title">Protocol status</h1>
        <p className="page-subtitle">Clear information about what this deployment can do today.</p>
      </div>

      <div className="contract-container">
        <div className="contract-card animate-in">
          <div className="contract-title">On-chain contract</div>
          <div className="status-line status-line-neutral">
            <span aria-hidden="true">i</span>
            {isDevnet ? 'Devnet escrow program deployed for testing.' : 'Contract status is not available in this deployment.'}
          </div>
          <p className="contract-copy">
            {isDevnet
              ? 'Both player deposits are held by the Token Battle escrow program on Solana Devnet. Devnet SOL has no monetary value and this preview must not be used for real funds.'
              : 'This screen does not make claims about an escrow deployment or real-fund settlement.'}
          </p>
        </div>

        <div className="contract-card animate-in stagger-2">
          <div className="contract-title">Settlement</div>
          <ul className="protocol-list">
            <li>Both players deposit SOL before a battle becomes active.</li>
            <li>The oracle compares both Pump.fun market-cap changes to four decimals at settlement.</li>
            <li>Settlement sends the 0.25% platform fee and automatically pays the remaining pot to the winner after the battle ends.</li>
            <li>As a fallback, either player can refund both Devnet stakes after the configured safety delay.</li>
          </ul>
        </div>

        <div className="contract-card animate-in stagger-3">
          <div className="contract-title">Security review</div>
          <div className="status-line status-line-neutral">
            <span aria-hidden="true">i</span>
            No independent audit has been completed yet.
          </div>
          <p className="contract-copy">
            Do not treat this protocol as audited, production-ready, or trustless. The escrow program is a Devnet test deployment and has not undergone an independent security audit.
          </p>
        </div>
      </div>
    </section>
  )
}
