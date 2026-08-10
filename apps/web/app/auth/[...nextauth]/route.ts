import { createAuthJsBoundary } from "@raring2go/auth";

const boundary = createAuthJsBoundary({
  providers: [
    {
      id: "raring2go-passwordless",
      kind: "email",
      displayName: "Email sign-in"
    }
  ],
  authJsProviders: []
});

export async function GET() {
  return Response.json({
    providers: boundary.providers
  });
}

export async function POST() {
  return Response.json(
    {
      error:
        "Passwordless sign-in is handled by the provider-neutral Raring2go auth service."
    },
    {
      status: 405
    }
  );
}
