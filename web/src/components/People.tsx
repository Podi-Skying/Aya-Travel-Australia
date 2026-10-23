"use client";

import { useTrip } from "./TripApp";
import { DEFAULT_PEOPLE, PEOPLE, type Person } from "@/domain/schema";

/*
 * Illustrated avatars for who takes part (DESIGN.md「參加的人」). Kai and Aya are named everywhere;
 * other people are named only for the owner (doc.peopleNames, emptied for guests), like driver names.
 */

const PUBLIC_NAME: Partial<Record<Person, string>> = { kai: "Kai", aya: "Aya" };

export function usePersonName() {
  const { doc, mode } = useTrip();
  return (p: Person) => PUBLIC_NAME[p] ?? (mode === "owner" ? doc.peopleNames?.[p] : undefined) ?? "朋友";
}

export const peopleOf = (item: { people?: Person[] }, day: { people?: Person[] }): Person[] => item.people ?? day.people ?? DEFAULT_PEOPLE;

export function AvatarStack({ people, size = 28 }: { people: Person[]; size?: number }) {
  const name = usePersonName();
  const ordered = PEOPLE.filter((p) => people.includes(p));
  const label = `參加：${ordered.map(name).join("、")}`;
  return (
    <span className="avatars" role="img" aria-label={label} title={label} style={{ ["--av" as string]: `${size}px` }}>
      {ordered.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- tiny static illustrations
        <img key={p} src={`/avatars/${p}.webp`} srcSet={`/avatars/${p}.webp 1x, /avatars/${p}@2x.webp 2x`} alt="" width={size} height={size} decoding="async" />
      ))}
    </span>
  );
}

/** Owner control: toggle who joins an activity (at least one person stays). */
export function PeopleToggle({ value, disabled, onChange }: { value: Person[]; disabled?: boolean; onChange: (next: Person[]) => void }) {
  const name = usePersonName();
  return (
    <span className="people-toggle" role="group" aria-label="參加的人">
      {PEOPLE.map((p) => {
        const on = value.includes(p);
        return (
          <button
            key={p}
            type="button"
            className={`person${on ? " on" : ""}`}
            aria-pressed={on}
            disabled={disabled || (on && value.length === 1)}
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- tiny static illustrations */}
            <img src={`/avatars/${p}.webp`} srcSet={`/avatars/${p}.webp 1x, /avatars/${p}@2x.webp 2x`} alt="" width={28} height={28} />
            {name(p)}
          </button>
        );
      })}
    </span>
  );
}
