import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionCookieName } from "../../../../lib/auth-runtime";
import { parseBankDetails, saveBankDetails } from "../../../../lib/payments-runtime";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const back = (code: string) => NextResponse.redirect(new URL(`/app/settings/connections?${code}`, url.origin), 303);
  const form = await request.formData();
  const text = (name: string) => String(form.get(name) ?? "");
  try {
    const details = parseBankDetails({ accountName: text("accountName"), sortCode: text("sortCode"), accountNumber: text("accountNumber") });
    const cookieStore = await cookies();
    await saveBankDetails({ sessionToken: cookieStore.get(sessionCookieName)?.value }, details);
    return back("bankDetails=saved");
  } catch {
    return back("error=bank-details-invalid");
  }
}
