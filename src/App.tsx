import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { IdentityProvider, useIdentity } from "./context/IdentityContext";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import ChatPage from "./pages/ChatPage";
import DocumentsPage from "./pages/DocumentsPage";
import FaqPage from "./pages/FaqPage";
import FaqReviewPage from "./pages/FaqReviewPage";
import LeaveApprovalsPage from "./pages/LeaveApprovalsPage";
import LoginPage from "./pages/LoginPage";
import MyLeaveRequestsPage from "./pages/MyLeaveRequestsPage";
import OpenDocPage from "./pages/OpenDocPage";
import ResetSecretCodePage from "./pages/ResetSecretCodePage";
import UploadPage from "./pages/UploadPage";
import ViewFeedbackPage from "./pages/ViewFeedbackPage";
import "./App.css";

function RequireIdentity({ children }: { children: React.ReactElement }) {
  const { identity } = useIdentity();
  if (!identity) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chat"
        element={
          <RequireIdentity>
            <ChatPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireIdentity>
            <UploadPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/documents"
        element={
          <RequireIdentity>
            <DocumentsPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/feedback"
        element={
          <RequireIdentity>
            <ViewFeedbackPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/leave-approvals"
        element={
          <RequireIdentity>
            <LeaveApprovalsPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/my-leave-requests"
        element={
          <RequireIdentity>
            <MyLeaveRequestsPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/faq"
        element={
          <RequireIdentity>
            <FaqPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/faq-review"
        element={
          <RequireIdentity>
            <FaqReviewPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireIdentity>
            <AdminDashboardPage />
          </RequireIdentity>
        }
      />
      {/* 2026-10-19 - a genuinely separate menu item, not a deep-link into
          the full Admin Dashboard - standaloneCategory hides the category
          picker entirely, so there's nothing here but Build & Deployment's
          own 3 sub-tabs. Reuses AdminDashboardPage's own component/state
          logic (low-risk), not a duplicated page. */}
      <Route
        path="/deployments"
        element={
          <RequireIdentity>
            <AdminDashboardPage standaloneCategory="build-deploy" />
          </RequireIdentity>
        }
      />
      <Route
        path="/admin/reset-secret-code"
        element={
          <RequireIdentity>
            <ResetSecretCodePage />
          </RequireIdentity>
        }
      />
      {/* Not RequireIdentity-wrapped - OpenDocPage shows its own
          "sign in required" state instead of bouncing to /login, since it's
          meant to be opened directly from a link inside a static document,
          not navigated to from within the app. */}
      <Route path="/admin/open-doc" element={<OpenDocPage />} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <IdentityProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </IdentityProvider>
  );
}

export default App;
