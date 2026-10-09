import { signOutAction, signOutEverywhereAction } from "../sign-in/actions";

export default function SignOutPage() {
  return (
    <main className="auth-page">
      <form action={signOutAction} className="auth-panel">
        <p className="eyebrow">Session</p>
        <h1>Sign out</h1>
        <p>End this Raring2go session on this device.</p>
        <button type="submit">Sign out</button>
      </form>
      <form action={signOutEverywhereAction} className="auth-panel">
        <h2>Lost a device or think someone else has access?</h2>
        <p>End your Raring2go sessions on every device, including this one. You can sign in again afterwards with a new link.</p>
        <button type="submit">Sign out of all devices</button>
      </form>
    </main>
  );
}
