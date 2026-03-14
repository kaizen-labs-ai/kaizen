import { getLogs, getLogCount } from "@/lib/logs/logger";
import { serialize } from "@/lib/db/serialize";
import { LogViewer } from "@/components/logs/log-viewer";

export default async function LogsPage() {
  const [logs, total] = await Promise.all([
    getLogs({ limit: 500 }),
    getLogCount(),
  ]);

  const initialData = serialize({ logs, total }) as unknown as Parameters<typeof LogViewer>[0]["initialData"];
  return <LogViewer initialData={initialData} />;
}
