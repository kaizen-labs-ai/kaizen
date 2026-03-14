import { getAllSchedules, getNextRun } from "@/lib/schedules/queries";
import { serialize } from "@/lib/db/serialize";
import { SchedulesPageClient, type ScheduleListItem } from "./schedules-page-client";

export default async function SchedulesPage() {
  const schedules = await getAllSchedules();
  const enriched = schedules.map((s) => ({
    ...s,
    nextRunAt: s.enabled ? getNextRun(s.cron, s.lastRunAt) : null,
  }));
  return <SchedulesPageClient initialData={serialize(enriched) as unknown as ScheduleListItem[]} />;
}
