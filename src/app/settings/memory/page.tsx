import { getUserMemory } from "@/lib/memory/user-memory";
import { MemoryViewer } from "@/components/settings/memory-viewer";

export default async function MemoryPage() {
  const content = await getUserMemory();
  return <MemoryViewer initialData={content} />;
}
