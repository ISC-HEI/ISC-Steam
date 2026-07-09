const CORE = [
  { name: '--isc-ink', hex: '#383838' },
  { name: '--isc-ink-strong', hex: '#1F2023' },
  { name: '--isc-magenta', hex: '#DD0069' },
  { name: '--isc-paper-dim', hex: '#F6F6F4' },
];

const FACETS = [
  { name: '--isc-sun', hex: '#F7F19F' },
  { name: '--isc-sky', hex: '#8CC6E6' },
  { name: '--isc-mint', hex: '#98C7BF' },
  { name: '--isc-lavender', hex: '#A890C0' },
  { name: '--isc-rose', hex: '#E2ABBA' },
];

function Swatch({ name, hex }) {
  return (
    <div className="swatch">
      <div className="chip" style={{ background: `var(${name})` }} />
      <div className="meta">
        {name}
        <br />
        {hex}
      </div>
    </div>
  );
}

// Living reference for anyone building screens on the template.
export default function StyleGuide() {
  return (
    <section className="section">
      <div className="container">
        <p className="eyebrow">shared identity</p>
        <h1 className="section-title">Style guide</h1>
        <p>
          Tokens live in <code>src/styles/theme.css</code>, reusable classes in{' '}
          <code>src/styles/base.css</code>. Colors and gradients come from the official ISC logos.
        </p>

        <h2>Core colors</h2>
        <div className="swatch-row">
          {CORE.map((c) => (
            <Swatch key={c.name} {...c} />
          ))}
        </div>

        <h2 style={{ marginTop: 'var(--space-5)' }}>Facet palette</h2>
        <p>
          The five gradient facets of the mountain symbol. Use them for badges, chart series, and card
          accents - as small touches on white or charcoal, never as full backgrounds.
        </p>
        <div className="swatch-row">
          {FACETS.map((c) => (
            <Swatch key={c.name} {...c} />
          ))}
        </div>

        <h2 style={{ marginTop: 'var(--space-5)' }}>The ridge</h2>
        <p>
          The signature element: the facet gradient as a thin structural line. It runs across the top
          of every page and under section titles.
        </p>
        <div style={{ height: 4, background: 'var(--isc-ridge)', borderRadius: 2 }} />

        <h2 style={{ marginTop: 'var(--space-5)' }}>Type</h2>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 600 }}>
          Space Grotesk - headings and buttons
        </p>
        <p>Inter - body text, forms, and everything readable.</p>
        <p className="mono">JetBrains Mono - eyebrows, badges, statuses. A nod to the ANSI logo.</p>

        <h2 style={{ marginTop: 'var(--space-5)' }}>Components</h2>
        <p>
          <button className="btn btn-primary">Primary action</button>{' '}
          <button className="btn btn-secondary">Secondary</button>{' '}
          <button className="btn btn-ghost">Ghost</button>
        </p>
        <p>
          <span className="badge badge-sun">badge-sun</span> <span className="badge badge-sky">badge-sky</span>{' '}
          <span className="badge badge-mint">badge-mint</span>{' '}
          <span className="badge badge-lavender">badge-lavender</span>{' '}
          <span className="badge badge-rose">badge-rose</span>
        </p>
        <div className="card" style={{ maxWidth: '24rem' }}>
          <h3>Card</h3>
          <p style={{ marginBottom: 0 }}>
            White surface, hairline border, soft shadow. Add <code>.facet-card</code> with a{' '}
            <code>--facet</code> color for a top accent.
          </p>
        </div>
      </div>
    </section>
  );
}
