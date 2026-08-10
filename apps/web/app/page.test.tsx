import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home", () => {
  it("renders the web application shell", () => {
    const html = renderToString(<Home />);

    expect(html).toContain("Raring2go Business-in-a-Box");
    expect(html).toContain("The monorepo foundation is ready");
  });
});
