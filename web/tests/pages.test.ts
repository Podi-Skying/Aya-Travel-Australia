import { beforeEach, describe, expect, it, vi } from "vitest";
import { asOwner, asStranger, signedOut, OWNER_ID } from "./helpers";

/* AC5 page level: owner pages check the session before loading the owner document. */

const { getCurrentTrip, redirect } = vi.hoisted(() => ({
  getCurrentTrip: vi.fn(async () => null),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock("@/server/trips", () => ({ getCurrentTrip }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/TripApp", () => ({ TripApp: () => null }));
vi.mock("@/components/journey/JourneyView", () => ({ JourneyView: () => null }));

beforeEach(() => {
  process.env.OWNER_GITHUB_IDS = OWNER_ID;
  getCurrentTrip.mockClear();
  redirect.mockClear();
});

const pages = [
  ["/", () => import("@/app/page")],
  ["/journey", () => import("@/app/journey/page")],
] as const;

describe("owner pages", () => {
  for (const [path, load] of pages) {
    it(`${path} redirects to sign-in without a session and never loads the trip`, async () => {
      signedOut();
      const Page = (await load()).default;
      await expect(Page()).rejects.toThrow(/REDIRECT \/api\/auth\/signin/);
      expect(getCurrentTrip).not.toHaveBeenCalled();
    });

    it(`${path} renders 403 for a non-owner and never loads the trip`, async () => {
      asStranger();
      const Page = (await load()).default;
      const out = (await Page()) as { props: { title: string } };
      expect(out.props.title).toContain("403");
      expect(getCurrentTrip).not.toHaveBeenCalled();
    });

    it(`${path} loads the trip for the owner`, async () => {
      asOwner();
      const Page = (await load()).default;
      await Page();
      expect(getCurrentTrip).toHaveBeenCalledTimes(1);
    });
  }
});
