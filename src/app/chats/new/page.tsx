"use client";

import { useSearchParams } from "next/navigation";
import { ChatView } from "@/components/chat/chat-view";

export default function NewChatPage() {
  const searchParams = useSearchParams();
  const skillId = searchParams.get("skillId");
  const skillName = searchParams.get("skillName");
  const pluginId = searchParams.get("pluginId");
  const pluginName = searchParams.get("pluginName");

  const initialSkill = skillId && skillName ? { id: skillId, name: skillName } : undefined;
  const initialPlugin = pluginId && pluginName ? { id: pluginId, name: pluginName } : undefined;

  return <ChatView key="new" initialSkill={initialSkill} initialPlugin={initialPlugin} />;
}
