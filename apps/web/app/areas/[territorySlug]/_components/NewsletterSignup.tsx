"use client";

import { send } from "./Track";

/**
 * Signing up for the newsletter proves the address first: the form requests a sign-in link, and the
 * link lands on the preferences page where the parent presses a clear "email me" button. Nothing is
 * subscribed until that button, so nobody can be signed up with someone else's address.
 */
export function NewsletterSignup({
  territorySlug,
  territoryId,
  action
}: {
  territorySlug: string;
  territoryId: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form
      action={action}
      onSubmit={() => send({ eventType: "newsletter_signup_started", territorySlug, path: `/areas/${territorySlug}`, entityType: "newsletter" })}
    >
      <input type="hidden" name="returnTo" value={`/areas/${territorySlug}/preferences?confirm=${territoryId}`} />
      <input aria-label="Email address" name="email" placeholder="you@example.com" type="email" required autoComplete="email" />
      <button type="submit">Subscribe</button>
    </form>
  );
}
