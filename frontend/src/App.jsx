import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { DraftReplyLogPage } from "./pages/DraftReplyLogPage";

const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<AppShell />}>
      <Route index element={<Navigate to="/profile" replace />} />
      <Route path="/profile" element={<ProfilePage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
      <Route path="/logs" element={<DraftReplyLogPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/profile" replace />} />
  </Routes>
);

export default App;
