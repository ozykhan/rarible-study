import Link from "next/link"

const README = "https://github.com/ozykhan/rarible-study#readme"

/** The home page's footer: what Slabwatch is, its links, and the fictional-data line. Styles: styles/home.css (.footer). */
export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-row">
        <div className="footer-about">
          <span className="brand-mini">Slabwatch</span>
          <span className="muted small">A study marketplace for graded trading cards, on Solana devnet.</span>
        </div>
        <nav className="footer-col" aria-label="Market">
          <span className="eyebrow">Market</span>
          <Link href="/market">All listings</Link>
          <Link href="/#sets">Sets</Link>
          <Link href="/#graders">Graders</Link>
        </nav>
        <nav className="footer-col" aria-label="Slabwatch">
          <span className="eyebrow">Slabwatch</span>
          <Link href="/#how">How buying works</Link>
          <Link href="/agent">The agent</Link>
          <a href={README} target="_blank" rel="noreferrer">
            Devnet notes
          </a>
        </nav>
      </div>
      <p className="footer-note">Every card, seller and grader here is invented. dUSD is a test token with no value.</p>
    </footer>
  )
}
