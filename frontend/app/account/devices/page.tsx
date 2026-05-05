/**
 * /account/devices — RSC shell (08-08 Task 2, D-23).
 *
 * Auth gate: unauthenticated → redirect to /auth?next=/account/devices.
 * Fetches single device row via user's RLS-scoped client.
 * Renders heading + DevicesClient.
 */
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DevicesClient } from "./devices-client";

export default async function DevicesPage() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect("/auth?next=/account/devices");
  }

  // RLS owner-only SELECT — returns null if no device row exists
  const { data: device } = await supabase
    .from("devices")
    .select("name, gpu, last_seen")
    .eq("user_id", user.id)
    .maybeSingle();

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        paddingTop: "var(--sp-8)",
        paddingBottom: "var(--sp-8)",
        paddingLeft: "var(--sp-6)",
        paddingRight: "var(--sp-6)",
      }}
    >
      <header style={{ marginBottom: "var(--sp-6)" }}>
        <h1
          className="serif"
          style={{
            fontSize: 28,
            fontWeight: 400,
            color: "var(--color-fg-0)",
            marginBottom: "var(--sp-2)",
          }}
        >
          Devices
        </h1>
        <p style={{ fontSize: 14, color: "var(--color-fg-2)" }}>
          Engines paired to your account.
        </p>
      </header>
      <DevicesClient initialDevice={device ?? null} />
    </main>
  );
}
