import { useState } from "react";
import { RiRobot2Line } from "react-icons/ri";
import { Card } from "../../components/common/Card";
import { Textarea } from "../../components/common/FormControls";
import { Button } from "../../components/common/Button";
import { useUpdateProfile } from "../../hooks/useProfileSettings";

export const ProfileDescriptionForm = ({ profile }) => {
  const [description, setDescription] = useState(profile?.profileDescription || "");
  const updateProfile = useUpdateProfile();

  const save = () => {
    updateProfile.mutate({ profileDescription: description });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-400/15 dark:text-blue-200">
          <RiRobot2Line className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">AI Writing Profile</h2>
          <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">
            Describe your communication style. Sendora uses this context to generate drafts and replies that sound authentic to you.
          </p>

          <Textarea
            value={description}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-4 min-h-[200px] h-[40vh] max-h-[500px]"
            placeholder="Example: I am concise, warm, and direct. I prefer clear next steps, short paragraphs, and a friendly professional tone."
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-400">{description.length}/2000 characters</p>
            <div className="flex items-center gap-3">
              {updateProfile.isSuccess && <span className="text-sm text-emerald-500">Saved</span>}
              <Button onClick={save} disabled={updateProfile.isPending}>
                {updateProfile.isPending ? "Saving" : "Save Profile"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
