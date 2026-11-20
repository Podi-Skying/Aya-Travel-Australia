"use client";

import { signIn } from "next-auth/react";

/* Sign-in choices on the private photo page: GitHub always (Kai), Google only when it is set up. */
export function PhotoSignIn({ google, viewers }: { google: boolean; viewers: boolean }) {
  return (
    <p className="photo-signin">
      <button type="button" className="btn" onClick={() => void signIn("github", { callbackUrl: "/photos" })}>
        用 GitHub 登入
      </button>
      {google && viewers && (
        <button type="button" className="btn" onClick={() => void signIn("google", { callbackUrl: "/photos" })}>
          用 Google 登入
        </button>
      )}
    </p>
  );
}
