import { getAllSouls } from "@/lib/agent/soul";
import { serialize } from "@/lib/db/serialize";
import { SoulEditor } from "@/components/settings/soul-editor";

export default async function SoulPage() {
  const souls = await getAllSouls();
  const active = souls.find((s) => s.isActive) ?? souls[0] ?? null;
  return <SoulEditor initialData={active ? serialize(active) : null} />;
}
