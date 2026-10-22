import { redirect } from "next/navigation";

/* The walk moved to the home page. */
export default function OldWalk() {
  redirect("/");
}
