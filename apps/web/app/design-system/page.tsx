import {
  Alert,
  Badge,
  Button,
  Card,
  ContentCard,
  Field,
  IconButton,
  Input,
  KpiCard,
  MagazinePageThumb,
  Select,
  StatePanel,
  Tab,
  Tabs,
  brandColors,
  seasonalColors,
  semanticColors
} from "@raring2go/ui";

const swatches = [
  ["Brand purple", brandColors.purple],
  ["Brand plum", brandColors.plum],
  ["Spring", seasonalColors.spring],
  ["Summer", seasonalColors.summer],
  ["Autumn", seasonalColors.autumn],
  ["Winter", seasonalColors.winter],
  ["Text", semanticColors.textPrimary],
  ["Muted", semanticColors.textMuted],
  ["Focus", semanticColors.focusRing]
];

export default function DesignSystemPage() {
  return (
    <main className="ds-page">
      <section className="ds-hero" aria-labelledby="design-system-title">
        <Badge tone="info">FND-002</Badge>
        <h1 id="design-system-title">Raring2go digital product language</h1>
        <p>
          A warm, editorial and premium foundation for parent discovery,
          advertiser workflows, franchisee publishing and HQ operations.
        </p>
      </section>

      <section className="ds-section" aria-labelledby="tokens">
        <h2 id="tokens">Brand and semantic tokens</h2>
        <div className="ds-swatches">
          {swatches.map(([name, value]) => (
            <Card key={name}>
              <div className="ds-swatch" style={{ background: value }} />
              <strong>{name}</strong>
              <code>{value}</code>
            </Card>
          ))}
        </div>
      </section>

      <section className="ds-section" aria-labelledby="controls">
        <h2 id="controls">Controls and forms</h2>
        <Card className="ds-stack">
          <div className="ds-row">
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Danger</Button>
            <IconButton label="Reference icon slot">R2</IconButton>
          </div>
          <div className="ds-form-grid">
            <Field label="Edition title" hint="Comfortable density for creative work.">
              <Input placeholder="Autumn family guide" />
            </Field>
            <Field label="Season">
              <Select defaultValue="autumn">
                <option value="spring">Spring</option>
                <option value="summer">Summer</option>
                <option value="autumn">Autumn</option>
                <option value="winter">Winter</option>
              </Select>
            </Field>
          </div>
          <div data-density="compact" className="ds-compact">
            <Field label="Compact admin filter">
              <Input placeholder="Search territories" />
            </Field>
            <Button variant="secondary">Apply</Button>
          </div>
        </Card>
      </section>

      <section className="ds-section" aria-labelledby="status">
        <h2 id="status">Status, health and KPI components</h2>
        <div className="ds-grid">
          <KpiCard label="Edition readiness" value="82%" detail="12 editions need attention" tone="warning" />
          <KpiCard label="Approved pages" value="146" detail="Across active autumn editions" tone="success" />
          <KpiCard label="Preflight blocks" value="7" detail="Image resolution or bleed" tone="danger" />
        </div>
        <div className="ds-grid">
          <StatePanel title="Empty" tone="neutral">No local modules have been added yet.</StatePanel>
          <StatePanel title="Loading" tone="info">Fetching edition readiness and preflight status.</StatePanel>
          <StatePanel title="Permission denied" tone="danger">This action requires HQ approval permissions.</StatePanel>
        </div>
      </section>

      <section className="ds-section" aria-labelledby="experiences">
        <h2 id="experiences">Shared components across experiences</h2>
        <div className="ds-grid">
          <ContentCard kind="Article" title="Gearing up for autumn adventures" meta="Parent discovery card" season="autumn" />
          <ContentCard kind="Event" title="Half-term family trail" meta="Local event listing" season="spring" />
          <ContentCard kind="Offer" title="Advertiser proof ready" meta="Commercial status card" season="summer" />
          <ContentCard kind="Competition" title="Prize draw pending approval" meta="HQ review flow" season="winter" />
        </div>
      </section>

      <section className="ds-section" aria-labelledby="magazine">
        <h2 id="magazine">Magazine tooling primitives</h2>
        <Tabs>
          <Tab selected>Flatplan</Tab>
          <Tab>Template zones</Tab>
          <Tab>Preflight</Tab>
        </Tabs>
        <div className="ds-grid ds-pages">
          <MagazinePageThumb page={1} title="Cover" status="Review required" season="autumn" />
          <MagazinePageThumb page={2} title="Places to go" status="Approved" season="autumn" locked />
          <MagazinePageThumb page={3} title="Advertiser feature" status="Preflight warning" season="autumn" />
        </div>
        <Alert tone="warning" title="Presentational only">
          Drag-and-drop, command behaviour and template editing are future tickets.
          These primitives define the visible states FND-002 needs.
        </Alert>
      </section>
    </main>
  );
}
