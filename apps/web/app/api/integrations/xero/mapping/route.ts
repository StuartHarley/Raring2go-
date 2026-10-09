import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../../lib/auth-runtime";
import { parseXeroMapping, saveXeroMapping } from "../../../../../lib/xero-runtime";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const back = (code: string) => NextResponse.redirect(new URL(`/app/settings/connections?${code}`, url.origin), 303);
  const connectionId = url.searchParams.get("connectionId");
  if (!connectionId) return back("error=missing-connection");
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "");
  try {
    const mapping = parseXeroMapping({ salesAccountCode: text("salesAccountCode"), standardVat: text("standardVat"), zeroRated: text("zeroRated"), exempt: text("exempt") });
    const cookieStore = await cookies();
    await saveXeroMapping({ sessionToken: cookieStore.get(sessionCookieName)?.value }, connectionId, mapping);
    return back("xeroMapping=saved");
  } catch {
    return back("error=xero-mapping-invalid");
  }
}
