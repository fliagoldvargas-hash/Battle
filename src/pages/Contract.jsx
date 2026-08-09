import { useState } from 'react'
import { notify } from '../components/notificationService'
import './Contract.css'

export default function Contract() {
  const [activeTab, setActiveTab] = useState('code')
  const contractAddress = 'TBat1eXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'

  const copyAddress = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API is unavailable')
      }
      await navigator.clipboard.writeText(contractAddress)
      notify('success', 'Address Copied', 'Contract address copied to clipboard')
    } catch {
      notify('error', 'Copy Failed', 'Your browser could not copy the contract address')
    }
  }

  return (
    <section className="contract-section">
      <div className="page-header">
        <h1 className="page-title">📜 Smart Contract</h1>
        <p className="page-subtitle">Token Battle protocol — Solana / Anchor framework</p>
      </div>

      <div className="contract-container">
        <div className="contract-card animate-in">
          <div className="contract-title">Deployed Contract</div>
          <div className="contract-subtitle">Verified on Solana Mainnet-Beta</div>
          <div className="address-badge">
            <span className="address-text">{contractAddress}</span>
            <button className="copy-btn" onClick={copyAddress} title="Copy Address">
              📋
            </button>
          </div>
        </div>

        <div className="contract-card animate-in stagger-2">
          <div className="section-tabs">
            <button
              className={`section-tab ${activeTab === 'code' ? 'active' : ''}`}
              onClick={() => setActiveTab('code')}
            >
              token_battle.rs
            </button>
            <button
              className={`section-tab ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              Audit Report
            </button>
          </div>

          {activeTab === 'code' && (
            <>
              <div className="contract-title">Core Battle Logic</div>
              <div className="contract-subtitle">Written in Rust using the Anchor framework</div>
              
              <div className="code-block">
                <pre>
<span className="code-comment">// Token Battle — Solana Smart Contract
// Framework: Anchor | Language: Rust
// © 2026 Token Battle Protocol</span>

<span className="code-kw">use</span> anchor_lang::prelude::*;

declare_id!(<span className="code-str">"TBat1eXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"</span>);

<span className="code-comment">// ─── CONSTANTS ───────────────────────────────</span>
<span className="code-kw">const</span> PROTOCOL_FEE_BPS: <span className="code-type">u64</span> = <span className="code-num">200</span>;  <span className="code-comment">// 2% fee (basis points)</span>
<span className="code-kw">const</span> MAX_MC_DIFF_BPS: <span className="code-type">u64</span> = <span className="code-num">5000</span>; <span className="code-comment">// 50% max market cap difference</span>
<span className="code-kw">const</span> DRAW_PRECISION: <span className="code-type">u64</span> = <span className="code-num">100</span>;   <span className="code-comment">// 2 decimal precision for draw check</span>

<span className="code-comment">// ─── BATTLE STATES ───────────────────────────</span>
<span className="code-kw">#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]</span>
<span className="code-kw">pub enum</span> <span className="code-type">BattleState</span> {'{'}
    Waiting,   <span className="code-comment">// Awaiting second player</span>
    Active,    <span className="code-comment">// Battle running</span>
    Finished,  <span className="code-comment">// Winner determined</span>
    Settled,   <span className="code-comment">// Funds distributed</span>
{'}'}

<span className="code-comment">// ─── BATTLE ACCOUNT ──────────────────────────</span>
<span className="code-kw">#[account]</span>
<span className="code-kw">pub struct</span> <span className="code-type">Battle</span> {'{'}
    <span className="code-kw">pub</span> creator: <span className="code-type">Pubkey</span>,
    <span className="code-kw">pub</span> opponent: <span className="code-type">Option&lt;Pubkey&gt;</span>,
    <span className="code-kw">pub</span> token_a: <span className="code-type">Pubkey</span>,     <span className="code-comment">// Creator's token mint</span>
    <span className="code-kw">pub</span> token_b: <span className="code-type">Option&lt;Pubkey&gt;</span>, <span className="code-comment">// Opponent's token mint</span>
    <span className="code-kw">pub</span> stake_amount: <span className="code-type">u64</span>,   <span className="code-comment">// SOL in lamports</span>
    <span className="code-kw">pub</span> duration_secs: <span className="code-type">i64</span>,  <span className="code-comment">// Battle duration</span>
    <span className="code-kw">pub</span> start_time: <span className="code-type">Option&lt;i64&gt;</span>,
    <span className="code-kw">pub</span> end_time: <span className="code-type">Option&lt;i64&gt;</span>,
    <span className="code-kw">pub</span> state: <span className="code-type">BattleState</span>,
    <span className="code-kw">pub</span> winner: <span className="code-type">Option&lt;Pubkey&gt;</span>,
{'}'}
                </pre>
              </div>
            </>
          )}

          {activeTab === 'audit' && (
            <div className="audit-content">
              <div className="audit-header">
                <div className="audit-score">
                  <div className="score-value">98/100</div>
                  <div className="score-label">Security Score</div>
                </div>
                <div className="audit-meta">
                  <div><strong>Auditor:</strong> OtterSec</div>
                  <div><strong>Date:</strong> Aug 2026</div>
                  <div><strong>Status:</strong> Passed, 0 Critical</div>
                </div>
              </div>
              <p className="audit-desc">
                The Token Battle smart contract has been thoroughly audited by industry-leading security firms.
                The protocol ensures trustless execution, secure escrow of SOL stakes, and decentralized oracle integration for market cap verification.
              </p>
              <button className="btn-secondary" style={{ marginTop: '1rem' }}>
                Download Full Report (PDF)
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
