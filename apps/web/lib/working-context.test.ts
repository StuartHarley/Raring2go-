import { describe, expect, it } from "vitest";
import { parseWorkingContext, serialiseWorkingContext, workingContextFromParams } from "./working-context";

const org = "00000000-0000-4000-8000-000000000001";
const territory = "00000000-0000-4000-8000-000000000101";

describe("working context cookie", () => {
  it("round-trips an organisation with and without a territory", () => {
    expect(parseWorkingContext(serialiseWorkingContext({ organisationId: org, territoryId: territory }))).toEqual({ organisationId: org, territoryId: territory });
    expect(parseWorkingContext(serialiseWorkingContext({ organisationId: org }))).toEqual({ organisationId: org, territoryId: undefined });
  });

  it("ignores anything that is not a well-formed id", () => {
    expect(parseWorkingContext("o=not-an-id;t=" + territory)).toEqual({});
    expect(parseWorkingContext("o=" + org + ";t=garbage")).toEqual({ organisationId: org, territoryId: undefined });
    expect(parseWorkingContext("")).toEqual({});
    expect(parseWorkingContext(undefined)).toEqual({});
    expect(serialiseWorkingContext({ organisationId: "x" })).toBe("");
  });

  it("takes a context from query parameters only when the organisation is present", () => {
    expect(workingContextFromParams({ organisationId: org, territoryId: territory })).toEqual({ organisationId: org, territoryId: territory });
    expect(workingContextFromParams({ territoryId: territory })).toEqual({});
    expect(workingContextFromParams({ organisationId: "<script>" })).toEqual({});
  });
});
