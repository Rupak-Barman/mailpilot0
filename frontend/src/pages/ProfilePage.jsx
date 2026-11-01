import { useState } from "react";
import clsx from "clsx";
import { FiUser, FiDatabase, FiGitCommit } from "react-icons/fi";

import { AccountPanel } from "../features/profile/AccountPanel";
import { KnowledgeUploadForm } from "../features/profile/KnowledgeUploadForm";
import { WritingPersonaManager } from "../features/profile/WritingPersonaManager";
import { LabelTable } from "../features/labels/LabelTable";
import { LoadingState, ErrorState } from "../components/common/States";
import { useProfileSettings } from "../hooks/useProfileSettings";

const tabs = [
  { id: "identity", label: "Identity & Persona", icon: FiUser },
  { id: "knowledge", label: "AI Knowledge Base", icon: FiDatabase },
  { id: "rules", label: "Routing Rules", icon: FiGitCommit }
];

export const ProfilePage = () => {
  const { data, isLoading, error } = useProfileSettings();
  const [activeTab, setActiveTab] = useState("identity");

  if (isLoading) {
    return <LoadingState label="Loading profile settings" />;
  }

  if (error) {
    return <ErrorState message="Could not load profile settings." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Profile Settings
        </p>

        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">
          Profile & Rules
        </h1>
      </div>

      <nav className="flex items-center gap-4 border-b border-slate-200 dark:border-zinc-800">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                "group flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-semibold transition-colors",
                isActive
                  ? "border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-slate-400 dark:hover:border-zinc-600 dark:hover:text-slate-300"
              )}
            >
              <Icon
                className={clsx(
                  "h-4 w-4",
                  isActive
                    ? "text-blue-600 dark:text-blue-500"
                    : "text-slate-400 group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-400"
                )}
              />

              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-6">
        {activeTab === "identity" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <AccountPanel profile={data?.profile} settings={data?.settings} />

            <WritingPersonaManager />
          </div>
        )}

        {activeTab === "knowledge" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <KnowledgeUploadForm />
          </div>
        )}

        {activeTab === "rules" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <LabelTable labels={data?.labels || []} />
          </div>
        )}
      </div>
    </div>
  );
};