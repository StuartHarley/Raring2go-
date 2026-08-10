import { signOutAction } from "../sign-in/actions";

export default function SignOutPage() {
  return (
    <main className="auth-page">
      <form action={signOutAction} className="auth-panel">
        <p className="eyebrow">Session</p>
        <h1>Sign out</h1>
        <p>End this Raring2go session on this device.</p>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
