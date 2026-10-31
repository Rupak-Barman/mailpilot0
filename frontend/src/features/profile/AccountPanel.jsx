import { FiMail, FiWifi } from "react-icons/fi";
import { Card } from "../../components/common/Card";
import { Badge } from "../../components/common/Badge";

export const AccountPanel = ({ profile }) => (
  <Card className="p-4">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-400/15 dark:text-blue-200">
          <FiMail className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Connected Account</p>
          <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{profile?.email || "Not connected"}</p>
        </div>
      </div>

      <Badge tone="emerald" className="w-fit">
        <FiWifi className="mr-1 h-3.5 w-3.5" />
        Active Sync
      </Badge>
    </div>
  </Card>
);
