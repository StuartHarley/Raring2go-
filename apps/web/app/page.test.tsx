import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DesignSystemPage from "./design-system/page";
import Home from "./page";

describe("Home", () => {
  it("renders the web application shell", () => {
    const html = renderToString(<Home />);

    expect(html).toContain("Raring2go Business-in-a-Box");
    expect(html).toContain("The monorepo foundation is ready");
  });

  it("renders the design-system gallery for visual regression readiness", () => {
    const html = renderToString(<DesignSystemPage />);

    expect(html).toContain("Raring2go digital product language");
    expect(html).toContain("Magazine tooling primitives");
  });
});
