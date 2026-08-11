import './Contract.css'

export default function Contract() {
  return (
    <section className="contract-section">
      <div className="page-header">
        <h1 className="page-title">Protocol status</h1>
        <p className="page-subtitle">Clear information about how Token Battle settles today.</p>
      </div>

      <div className="contract-container">
        <div className="contract-card animate-in">
          <div className="contract-title">On-chain contract</div>
          <div className="status-line status-line-warning">
            <span aria-hidden="true">!</span>
            No Token Battle smart contract is deployed.
          </div>
          <p className="contract-copy">
            Battles currently use a server-managed Solana treasury. Deposits and payouts are signed through Privy and recorded on Solana.
          </p>
        </div>

        <div className="contract-card animate-in stagger-2">
          <div className="contract-title">Settlement</div>
          <ul className="protocol-list">
            <li>Both players deposit SOL before a battle becomes active.</li>
            <li>At close, the winner receives 99.75% of the pot.</li>
            <li>0.25% is sent to the platform fee treasury and recorded internally.</li>
            <li>Each payout has a Solana transaction signature stored with the battle.</li>
          </ul>
        </div>

        <div className="contract-card animate-in stagger-3">
          <div className="contract-title">Security review</div>
          <div className="status-line status-line-neutral">
            <span aria-hidden="true">i</span>
            No independent audit has been completed yet.
          </div>
          <p className="contract-copy">
            Do not treat this protocol as audited or trustless. An audited on-chain escrow program must be deployed before making either claim.
          </p>
        </div>
      </div>
    </section>
  )
}
