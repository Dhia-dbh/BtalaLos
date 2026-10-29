"use client";
import { useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApplicationHeader } from "@/app/(app)/applications/[id]/application-header";
import { ApplicationMenu } from "@/app/(app)/applications/[id]/application-menu";
import { StatusControl } from "@/app/(app)/applications/[id]/status-control";
import type { GmailSender } from "@/app/(app)/applications/[id]/send-with-gmail";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { PreparationPanel } from "./panel";

export function LatexApplication({
  application,
  meta,
  timeZone,
  gmail,
  initialTab,
  notes,
  conversation,
  showConversation,
}: {
  application: {
    id: string;
    title: string;
    status: ApplicationStatus;
    archived: boolean;
    nextInterviewAt: Date | null;
  };
  meta: string[];
  timeZone?: string;
  gmail?: GmailSender;
  initialTab: string;
  notes: ReactNode;
  conversation: ReactNode;
  showConversation: boolean;
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Tabs
      value={tab}
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={(value) => {
        setTab(value);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", value);
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      }}
    >
      <ApplicationHeader
        title={application.title}
        meta={meta}
        actions={
          <>
            <StatusControl
              id={application.id}
              status={application.status}
              interviewAt={application.nextInterviewAt}
              timeZone={timeZone}
            />
            <ApplicationMenu
              id={application.id}
              archived={application.archived}
            />
          </>
        }
      >
        <TabsList aria-label="Application">
          <TabsTrigger value="preparation">Preparation and email</TabsTrigger>
          {showConversation && (
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
          )}
          <TabsTrigger value="notes">Notes and activity</TabsTrigger>
        </TabsList>
      </ApplicationHeader>
      <TabsContent value="preparation" className="flex min-h-0 flex-1">
        <PreparationPanel applicationId={application.id} latex gmail={gmail} />
      </TabsContent>
      <TabsContent value="conversation" className="flex min-h-0 flex-1">
        {conversation}
      </TabsContent>
      <TabsContent value="notes" className="flex min-h-0 flex-1">
        {notes}
      </TabsContent>
    </Tabs>
  );
}
