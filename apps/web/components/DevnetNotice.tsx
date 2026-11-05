/** The safety line under the header. It stays on every view. Styles: styles/status-bar.css. */
export function DevnetNotice() {
  return (
    <div className="devnet-notice">
      <strong>Solana devnet only.</strong> Every card, seller and grader here is invented, and dUSD is a test token with no value.
      Never use a wallet that holds real funds on mainnet for experiments like this one.
    </div>
  )
}
